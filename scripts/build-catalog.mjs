#!/usr/bin/env node
// Aggregates per-agent ADL `agent.yaml` files from the GitHub repos listed in
// `agents.yaml` and writes the bundled catalog to `catalog.json`.
//
// Run with: npm run build
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_FILE = resolve(ROOT, 'agents.yaml');
const OUTPUT_FILE = resolve(ROOT, 'catalog.json');

const ADL_SCHEMA_URL =
  process.env.ADL_SCHEMA_URL ??
  'https://cdn.jsdelivr.net/gh/inference-gateway/adl@main/schema/v1/schema.json';

const GH_API = 'https://api.github.com';
// Optional. Raises the API rate limit from 60/hr to 5000/hr; public repos read
// fine without it, so token-less local `npm run build` still works.
const GH_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

const GITHUB_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/i;
const RETRY_LIMIT = 3;
const RETRY_BACKOFF_MS = 750;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithRetry(url, label, { headers, allow404 = false } = {}) {
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    const res = await fetch(url, {
      headers: headers ?? { accept: 'application/json, text/plain, */*' },
    });
    if (res.ok || (allow404 && res.status === 404)) return res;
    const transient = res.status >= 500 || res.status === 429;
    if (!transient || attempt === RETRY_LIMIT) {
      throw new Error(`${label}: HTTP ${res.status} ${res.statusText} (${url})`);
    }
    await sleep(RETRY_BACKOFF_MS * attempt);
  }
  // unreachable
  throw new Error(`${label}: unreachable retry path`);
}

async function loadSourceList() {
  const raw = readFileSync(SOURCES_FILE, 'utf8');
  const parsed = load(raw);
  if (!parsed || !Array.isArray(parsed.agents)) {
    throw new Error(`${SOURCES_FILE}: must contain top-level 'agents' array`);
  }
  return parsed.agents.map((entry, i) => {
    if (!entry || typeof entry.url !== 'string') {
      throw new Error(`${SOURCES_FILE}: entry ${i} missing 'url' string`);
    }
    const m = entry.url.match(GITHUB_URL_RE);
    if (!m) {
      throw new Error(`${SOURCES_FILE}: entry ${i} has invalid GitHub URL '${entry.url}'`);
    }
    const ref = typeof entry.ref === 'string' && entry.ref.length > 0 ? entry.ref : 'latest';
    return { url: entry.url.replace(/\/+$/, ''), ref, owner: m[1], repo: m[2] };
  });
}

async function loadAdlValidator() {
  const res = await fetchWithRetry(ADL_SCHEMA_URL, 'ADL schema');
  const schema = await res.json();
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

async function fetchAgent({ owner, repo, ref, url }) {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/agent.yaml`;
  const res = await fetchWithRetry(rawUrl, `agent.yaml from ${url}@${ref}`);
  const text = await res.text();
  let doc;
  try {
    doc = load(text);
  } catch (err) {
    throw new Error(`${url}@${ref}: YAML parse error: ${err.message}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${url}@${ref}: agent.yaml is not a YAML object`);
  }
  return doc;
}

function ghHeaders() {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'inference-gateway-agents-catalog',
  };
  if (GH_TOKEN) headers.authorization = `Bearer ${GH_TOKEN}`;
  return headers;
}

// Serialize a catalog with the `updated`/`fetchedAt` timestamps blanked, so two
// catalogs can be compared on content alone.
export function withoutTimestamps(catalog) {
  return JSON.stringify(catalog, (key, value) =>
    key === 'updated' || key === 'fetchedAt' ? undefined : value,
  );
}

// Carry timestamps forward from the previous catalog: an entry whose content is
// unchanged keeps its old `fetchedAt`, and the top-level `updated` only moves
// when at least one entry changed (or was added/removed). Mutates `agents`.
export function carryTimestamps(existing, agents, now) {
  const prev = new Map((existing?.agents ?? []).map((a) => [a?.metadata?.name, a]));
  let changed = !existing || prev.size !== agents.length;
  for (const doc of agents) {
    const old = prev.get(doc.metadata.name);
    if (old && withoutTimestamps(old) === withoutTimestamps(doc)) {
      doc._source.fetchedAt = old._source?.fetchedAt ?? now;
    } else {
      changed = true;
    }
  }
  return { changed, updated: changed ? now : (existing.updated ?? now) };
}

// Parse a leading semver (major.minor.patch) out of a tag like `v1.2.3`.
export function parseVersion(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Descending sort: highest version first. A bare release tag outranks its
// prereleases (v1.2.3 before v1.2.3-rc.1); unparseable tags sort last.
export function compareTagsDesc(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va && vb) {
    for (let i = 0; i < 3; i++) {
      if (va[i] !== vb[i]) return vb[i] - va[i];
    }
    return a.length - b.length || a.localeCompare(b);
  }
  if (va) return -1;
  if (vb) return 1;
  return a.localeCompare(b);
}

// Resolve the `latest` sentinel to a concrete ref: the newest GitHub *release*
// tag, or - only when the repo has cut no releases at all - the newest git tag.
// This is what keeps a dangling tag (tag pushed, but the release/CD step failed)
// out of the catalog: releases/latest ignores any tag that has no release.
export async function resolveLatestRef({ owner, repo, url }) {
  const relRes = await fetchWithRetry(
    `${GH_API}/repos/${owner}/${repo}/releases/latest`,
    `latest release for ${url}`,
    { headers: ghHeaders(), allow404: true },
  );
  if (relRes.ok) {
    const rel = await relRes.json();
    if (rel?.tag_name) return rel.tag_name;
  }
  // No release yet - fall back to the newest tag by semver.
  // ponytail: page 1 (100 tags) only; a repo with >100 tags and zero releases
  // could miss the newest - add pagination if that ever actually happens.
  const tagsRes = await fetchWithRetry(
    `${GH_API}/repos/${owner}/${repo}/tags?per_page=100`,
    `tags for ${url}`,
    { headers: ghHeaders() },
  );
  const tags = await tagsRes.json();
  const names = (Array.isArray(tags) ? tags : []).map((t) => t?.name).filter(Boolean);
  if (names.length === 0) {
    throw new Error(`${url}: 'latest' requested but the repo has no releases or tags`);
  }
  names.sort(compareTagsDesc);
  return names[0];
}

async function main() {
  const sources = await loadSourceList();
  if (sources.length === 0) {
    throw new Error(`${SOURCES_FILE}: 'agents' array is empty — nothing to build`);
  }
  console.log(`Aggregating ${sources.length} agents…`);

  const validate = await loadAdlValidator();
  const fetchedAt = new Date().toISOString();

  const seenNames = new Map();
  const agents = [];
  const errors = [];

  for (const source of sources) {
    try {
      const ref = source.ref === 'latest' ? await resolveLatestRef(source) : source.ref;
      const doc = await fetchAgent({ ...source, ref });
      const ok = validate(doc);
      if (!ok) {
        const details = (validate.errors ?? [])
          .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
          .join('\n');
        throw new Error(`${source.url}@${ref}: ADL validation failed:\n${details}`);
      }
      const name = doc.metadata?.name;
      if (!name) throw new Error(`${source.url}@${ref}: missing metadata.name`);
      if (seenNames.has(name)) {
        throw new Error(
          `${source.url}@${ref}: duplicate metadata.name '${name}' (also claimed by ${seenNames.get(name)})`,
        );
      }
      seenNames.set(name, `${source.url}@${ref}`);
      doc._source = { url: source.url, ref, fetchedAt };
      agents.push(doc);
      console.log(`  ✓ ${name}  ←  ${source.url}@${ref}`);
    } catch (err) {
      errors.push(err.message);
      console.error(`  ✗ ${source.url}@${source.ref}`);
      console.error(`     ${err.message.replaceAll('\n', '\n     ')}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`${errors.length} agent(s) failed to aggregate; aborting catalog write`);
  }

  agents.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

  let existing = null;
  try {
    existing = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'));
  } catch {
    // missing or unparseable previous catalog - write fresh
  }
  // Unchanged entries keep their previous fetchedAt; `updated` only bumps when
  // something real changed. A fully unchanged catalog is left untouched.
  const { changed, updated } = carryTimestamps(existing, agents, fetchedAt);
  if (!changed) {
    console.log(`Catalog unchanged; leaving ${OUTPUT_FILE} untouched`);
    return;
  }

  const catalog = {
    version: 1,
    updated,
    agents,
  };

  const serialized = JSON.stringify(catalog, null, 2) + '\n';
  try {
    JSON.parse(serialized);
  } catch (err) {
    throw new Error(`Refusing to overwrite ${OUTPUT_FILE}: serialized catalog is not valid JSON: ${err.message}`);
  }

  writeFileSync(OUTPUT_FILE, serialized);
  console.log(`Wrote ${agents.length} agents to ${OUTPUT_FILE}`);
}

// Only build when run directly; importing (e.g. from tests) must not hit the network.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
