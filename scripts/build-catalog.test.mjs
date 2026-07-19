import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareTagsDesc } from './build-catalog.mjs';

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

test('a bare release tag outranks its prerelease', () => {
  assert.equal(['v2.0.0-rc.1', 'v2.0.0'].sort(compareTagsDesc)[0], 'v2.0.0');
});
