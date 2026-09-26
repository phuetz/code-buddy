import { describe, expect, it } from 'vitest';
import { lisaBashTargets } from '../../src/checkpoints/lisa-bash-targets.js';

describe('Lisa shell return-point targets', () => {
  it('captures the actual files changed by a simple destructive command', () => {
    expect(lisaBashTargets('rm note.txt')).toEqual(['note.txt']);
    expect(lisaBashTargets('mv old.txt new.txt')).toEqual(['old.txt', 'new.txt']);
    expect(lisaBashTargets('cp source.txt target.txt')).toEqual(['target.txt']);
  });

  it('refuses shell shapes whose changed files cannot be enumerated', () => {
    expect(() => lisaBashTargets('rm *.txt')).toThrow('Wildcard targets');
    expect(() => lisaBashTargets('rm note.txt && touch other.txt')).toThrow('Compound destructive');
    expect(() => lisaBashTargets('cp -t directory source.txt')).toThrow('options have no complete return point');
  });

  it('does not miss a destructive command behind a wrapper or an absolute executable', () => {
    expect(() => lisaBashTargets('sudo rm note.txt')).toThrow('no complete return point');
    expect(lisaBashTargets('/bin/rm note.txt')).toEqual(['note.txt']);
  });

  it('leaves a read-only command outside checkpoint handling', () => {
    expect(lisaBashTargets('git status --short')).toEqual([]);
  });
});
