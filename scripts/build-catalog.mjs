#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const AGENTS_DIR = join(ROOT, 'agents');
const OUT = join(ROOT, 'catalog.json');

const REQUIRED_TOP = [
  'id',
  'name',
  'version',
  'description',
  'image',
  'author',
  'license',
  'homepage',
  'repository',
  'documentation',
  'categories',
  'tags',
];
const REQUIRED_IMAGE = ['repository', 'tag', 'size'];
const REQUIRED_AUTHOR = ['name', 'email'];

function assertKeys(obj, keys, path) {
  for (const k of keys) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') {
      throw new Error(`${path}: missing required field '${k}'`);
    }
  }
}

function loadAgent(dir) {
  const file = join(AGENTS_DIR, dir, 'metadata.yaml');
  const raw = readFileSync(file, 'utf8');
  const data = yaml.load(raw);
  if (!data || typeof data !== 'object') throw new Error(`${file}: not a YAML object`);
  assertKeys(data, REQUIRED_TOP, file);
  assertKeys(data.image, REQUIRED_IMAGE, `${file}#image`);
  assertKeys(data.author, REQUIRED_AUTHOR, `${file}#author`);
  if (!Array.isArray(data.categories) || data.categories.length === 0)
    throw new Error(`${file}: 'categories' must be a non-empty array`);
  if (!Array.isArray(data.tags)) throw new Error(`${file}: 'tags' must be an array`);
  return data;
}

const dirs = readdirSync(AGENTS_DIR)
  .filter((d) => statSync(join(AGENTS_DIR, d)).isDirectory())
  .sort();

const agents = dirs.map(loadAgent).sort((a, b) => a.id.localeCompare(b.id));

const catalog = {
  version: 1,
  updated: new Date().toISOString(),
  agents,
};

writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Wrote ${agents.length} agents to ${OUT}`);
