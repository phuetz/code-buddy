import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { safeResolve, isInside } from '../src/main/studio2/archive-utils.js';

describe('archive-utils', () => {
  const root = path.resolve('/w/root');

  it('safeResolve allows legitimate relative paths like ..cache', () => {
    expect(safeResolve(root, '..cache')).toBe(path.join(root, '..cache'));
  });

  it('isInside allows legitimate paths like ..cache', () => {
    expect(isInside(root, path.join(root, '..cache'))).toBe(true);
  });

  it('safeResolve denies breaking out of root', () => {
    expect(safeResolve(root, '../x')).toBeNull();
    expect(safeResolve(root, '..')).toBeNull();
    expect(safeResolve(root, 'a/../../x')).toBeNull();
  });

  it('safeResolve allows current directory', () => {
    expect(safeResolve(root, '.')).toBe(root);
  });

  it('isInside denies breaking out of root', () => {
    expect(isInside(root, path.dirname(root))).toBe(false);
  });
});
