import { afterEach, describe, expect, it } from 'vitest';
import {
  applyLocalLoopContextCap,
  createLoopCommand,
  loopRunSucceeded,
  validateLoopCommandNumericOptions,
} from '../../src/commands/loop-cli.js';

describe('buddy loop — options de ligne de commande', () => {
  it('accepte --permission-mode APRÈS la sous-commande', () => {
    // Commander n'accepte une option du programme principal qu'AVANT la sous-commande.
    // `buddy loop "objectif" --permission-mode acceptEdits` échouait donc sur « unknown
    // option », sans indiquer où la placer — alors que c'est la forme naturelle, et que
    // c'est justement sur une boucle autonome qu'on veut préciser la posture.
    const noms = createLoopCommand()
      .options.map((o) => o.long)
      .filter(Boolean);
    expect(noms).toContain('--permission-mode');
  });

  it('documente les postures valides dans son aide', () => {
    const option = createLoopCommand().options.find((o) => o.long === '--permission-mode');
    expect(option?.description).toContain('acceptEdits');
    expect(option?.description).toContain('bypassPermissions');
  });

  it('nomme la valeur reçue pour --max-turns et --budget', () => {
    expect(() =>
      validateLoopCommandNumericOptions(['node', 'buddy', 'loop', 'x', '--max-turns', 'abc']),
    ).toThrow(/received "abc"/);
    expect(() =>
      validateLoopCommandNumericOptions(['node', 'buddy', 'loop', 'x', '--budget', '-5']),
    ).toThrow(/received "-5"/);
  });
});

describe('loopRunSucceeded', () => {
  it('refuses exit-0 when the judge says done without an independent CONFIRMED verdict', () => {
    expect(loopRunSucceeded({ status: 'done', lastVerifierVerdict: 'NEEDS REVIEW' }, false)).toBe(false);
    expect(loopRunSucceeded({ status: 'done', lastVerifierVerdict: 'unverified' }, false)).toBe(false);
    expect(loopRunSucceeded({ status: 'paused', lastVerifierVerdict: 'CONFIRMED' }, false)).toBe(false);
    expect(loopRunSucceeded({ status: 'done', lastVerifierVerdict: 'CONFIRMED' }, false)).toBe(true);
  });

  it('accepts judge-only done when --no-verify is set', () => {
    expect(loopRunSucceeded({ status: 'done', lastVerifierVerdict: 'unverified' }, true)).toBe(true);
  });
});

describe('applyLocalLoopContextCap', () => {
  const previous = process.env.CODEBUDDY_MAX_CONTEXT;

  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_MAX_CONTEXT;
    else process.env.CODEBUDDY_MAX_CONTEXT = previous;
  });

  it('caps an Ollama loop at 32768 unless the operator already set CODEBUDDY_MAX_CONTEXT', () => {
    delete process.env.CODEBUDDY_MAX_CONTEXT;
    applyLocalLoopContextCap({ apiKey: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', providerLabel: 'ollama' });
    expect(process.env.CODEBUDDY_MAX_CONTEXT).toBe('32768');
  });

  it('does not override an explicit CODEBUDDY_MAX_CONTEXT', () => {
    process.env.CODEBUDDY_MAX_CONTEXT = '8192';
    applyLocalLoopContextCap({ apiKey: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', providerLabel: 'ollama' });
    expect(process.env.CODEBUDDY_MAX_CONTEXT).toBe('8192');
  });
});
