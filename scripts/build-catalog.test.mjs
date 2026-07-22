import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVersion,
  compareTagsDesc,
  withoutTimestamps,
  carryTimestamps,
} from './build-catalog.mjs';

test('parseVersion extracts a leading semver, else null', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('v0.6.4-rc.1'), [0, 6, 4]);
  assert.equal(parseVersion('nightly'), null);
});

test('compareTagsDesc sorts newest-first, numerically not lexically', () => {
  // v1.10.0 must beat v1.2.0 - the classic "10 < 2" lexical bug.
  const tags = ['v1.0.0', 'v1.2.0', 'v1.10.0', 'v1.2.0-rc.1', 'v0.6.4'];
  assert.equal([...tags].sort(compareTagsDesc)[0], 'v1.10.0');
});

test('withoutTimestamps ignores updated/fetchedAt but sees real changes', () => {
  const cat = (updated, fetchedAt, ref) => ({
    version: 1,
    updated,
    agents: [{ metadata: { name: 'a' }, _source: { url: 'u', ref, fetchedAt } }],
  });
  assert.equal(
    withoutTimestamps(cat('2026-01-01', 't1', 'v1')),
    withoutTimestamps(cat('2026-02-02', 't2', 'v1')),
  );
  assert.notEqual(
    withoutTimestamps(cat('2026-01-01', 't1', 'v1')),
    withoutTimestamps(cat('2026-01-01', 't1', 'v2')),
  );
});

test('carryTimestamps only bumps timestamps for entries that changed', () => {
  const entry = (name, ref, fetchedAt) => ({
    metadata: { name },
    _source: { url: `https://github.com/o/${name}`, ref, fetchedAt },
  });
  const existing = { version: 1, updated: 't0', agents: [entry('a', 'v1', 't0'), entry('b', 'v1', 't0')] };

  let agents = [entry('a', 'v1', 't1'), entry('b', 'v1', 't1')];
  assert.deepEqual(carryTimestamps(existing, agents, 't1'), { changed: false, updated: 't0' });
  assert.equal(agents[0]._source.fetchedAt, 't0');

  agents = [entry('a', 'v1', 't1'), entry('b', 'v2', 't1')];
  assert.deepEqual(carryTimestamps(existing, agents, 't1'), { changed: true, updated: 't1' });
  assert.equal(agents[0]._source.fetchedAt, 't0');
  assert.equal(agents[1]._source.fetchedAt, 't1');

  assert.equal(carryTimestamps(existing, [entry('a', 'v1', 't1')], 't1').changed, true);
  assert.equal(carryTimestamps(null, [entry('a', 'v1', 't1')], 't1').changed, true);
});

test('a bare release tag outranks its prerelease', () => {
  assert.equal(['v2.0.0-rc.1', 'v2.0.0'].sort(compareTagsDesc)[0], 'v2.0.0');
});
