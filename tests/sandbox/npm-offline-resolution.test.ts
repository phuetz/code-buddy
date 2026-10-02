import { expect, it } from 'vitest';
import { assertNoLocalPackageSources, assertOpaqueLockEntriesUnchanged } from '../../src/sandbox/npm-offline-resolution.js';

it.each(['file:/outside', 'link:/outside', 'git+file:/outside'])('refuse la source locale %s', spec => {
  expect(() => assertNoLocalPackageSources({ dependencies: { dependency: spec } })).toThrow('file and link');
});

it.each(['ajout', 'modification', 'suppression'])('refuse la %s d’une entrée opaque', operation => {
  const entry = { version: '1.0.0', resolved: 'https://outside.invalid/opaque.tgz', integrity: 'sentinel' };
  const before = { packages: operation === 'ajout' ? {} : { 'node_modules/opaque': entry } };
  const after = { packages: operation === 'suppression' ? {} : { 'node_modules/opaque': { ...entry, version: '2.0.0' } } };
  expect(() => assertOpaqueLockEntriesUnchanged(before, after)).toThrow('preserve');
});
