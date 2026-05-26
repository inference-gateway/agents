#!/usr/bin/env node
// Aggregates per-agent ADL `agent.yaml` files from the GitHub repos listed in
// `agents.yaml` and writes the bundled catalog to `catalog.json`.
//
// Run with: npm run build
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_FILE = resolve(ROOT, 'agents.yaml');
const OUTPUT_FILE = resolve(ROOT, 'catalog.json');

const ADL_SCHEMA_URL =
  process.env.ADL_SCHEMA_URL ??
  'https://cdn.jsdelivr.net/gh/inference-gateway/adl@main/schema/v1/schema.json';

const GITHUB_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/i;
const RETRY_LIMIT = 3;
const RETRY_BACKOFF_MS = 750;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithRetry(url, label) {
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json, text/plain, */*' } });
    if (res.ok) return res;
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
  const parsed = yaml.load(raw);
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
    const ref = typeof entry.ref === 'string' && entry.ref.length > 0 ? entry.ref : 'main';
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
    doc = yaml.load(text);
  } catch (err) {
    throw new Error(`${url}@${ref}: YAML parse error: ${err.message}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${url}@${ref}: agent.yaml is not a YAML object`);
  }
  return doc;
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
      const doc = await fetchAgent(source);
      const ok = validate(doc);
      if (!ok) {
        const details = (validate.errors ?? [])
          .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
          .join('\n');
        throw new Error(`${source.url}@${source.ref}: ADL validation failed:\n${details}`);
      }
      const name = doc.metadata?.name;
      if (!name) throw new Error(`${source.url}@${source.ref}: missing metadata.name`);
      if (seenNames.has(name)) {
        throw new Error(
          `${source.url}@${source.ref}: duplicate metadata.name '${name}' (also claimed by ${seenNames.get(name)})`,
        );
      }
      seenNames.set(name, `${source.url}@${source.ref}`);
      doc._source = { url: source.url, ref: source.ref, fetchedAt };
      agents.push(doc);
      console.log(`  ✓ ${name}  ←  ${source.url}@${source.ref}`);
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

  const catalog = {
    version: 1,
    updated: fetchedAt,
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

await main();
