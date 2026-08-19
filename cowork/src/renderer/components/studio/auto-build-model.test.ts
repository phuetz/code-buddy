import { describe, expect, it } from 'vitest';
import {
  MAX_FIX_ATTEMPTS,
  shouldAutoBuild,
  canRetry,
  buildFixPrompt,
  autoFixNote,
} from './auto-build-model';

const base = {
  isNpm: true,
  hasPreview: false,
  previewStatus: 'idle',
  turnActive: false,
  alreadyBuilt: false,
};

describe('shouldAutoBuild', () => {
  it('builds a settled, never-built npm project with no preview yet', () => {
    expect(shouldAutoBuild(base)).toBe(true);
  });

  it('never auto-builds a static project (the hook auto-serves those)', () => {
    expect(shouldAutoBuild({ ...base, isNpm: false })).toBe(false);
  });

  it('waits while the agent turn is still running', () => {
    expect(shouldAutoBuild({ ...base, turnActive: true })).toBe(false);
  });

  it('does not rebuild once a build was already kicked off', () => {
    expect(shouldAutoBuild({ ...base, alreadyBuilt: true })).toBe(false);
  });

  it('does nothing when a preview is already live or starting', () => {
    expect(shouldAutoBuild({ ...base, hasPreview: true })).toBe(false);
    expect(shouldAutoBuild({ ...base, previewStatus: 'running' })).toBe(false);
    expect(shouldAutoBuild({ ...base, previewStatus: 'starting' })).toBe(false);
  });
});

describe('canRetry', () => {
  it('allows up to MAX_FIX_ATTEMPTS attempts', () => {
    expect(canRetry(0)).toBe(true);
    expect(canRetry(MAX_FIX_ATTEMPTS - 1)).toBe(true);
    expect(canRetry(MAX_FIX_ATTEMPTS)).toBe(false);
    expect(canRetry(MAX_FIX_ATTEMPTS + 1)).toBe(false);
  });
});

describe('buildFixPrompt', () => {
  it('embeds the error and a bounded tail of the build log, and forbids shell', () => {
    const logs = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const prompt = buildFixPrompt('npm install exited with code 1', logs);
    expect(prompt).toContain('npm install exited with code 1');
    expect(prompt).toContain('line 59');
    expect(prompt).not.toContain('line 0'); // trimmed to the last 40 lines
    expect(prompt).toContain('Do NOT run shell commands');
  });

  it('stays coherent with no error and no logs', () => {
    const prompt = buildFixPrompt('', []);
    expect(prompt).toContain('failed to install');
    expect(prompt).not.toContain('Recent build output');
  });
});

describe('autoFixNote', () => {
  it('renders a capped attempt pill, null when idle', () => {
    expect(autoFixNote(null)).toBeNull();
    expect(autoFixNote(2)).toBe(`Fixing… (attempt 2/${MAX_FIX_ATTEMPTS})`);
  });
});
