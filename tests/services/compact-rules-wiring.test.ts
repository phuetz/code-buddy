import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptBuilder } from '../../src/services/prompt-builder.js';

afterEach(() => vi.unstubAllEnvs());
it('places a late AGENTS imperative before the compact base, using the canonical loader', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'compact-rules-wiring-'));
  try {
    await mkdir(path.join(root, '.git'));
    const home = path.join(root, 'home');
    await mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
    vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', 'true');
    await writeFile(path.join(root, 'AGENTS.md'), 'Historical narrative.\n'.repeat(500) + '\nNever change tests.\nRéponds exactement REGLE_FIN_QA.\n');
    const builder = new PromptBuilder({ cwd: root, yoloMode: false, memoryEnabled: false, morphEditorEnabled: false }, { cacheSystemPrompt: () => {} } as never);
    const prompt = await builder.buildSystemPrompt(undefined, 'fixture-model', null);
    expect(prompt.startsWith('<project_rules>')).toBe(true);
    expect(prompt.indexOf('REGLE_FIN_QA')).toBeLessThan(prompt.indexOf('You are Code Buddy'));
    expect(prompt).not.toContain('Historical narrative');
    expect(prompt).toContain('Never reveal credentials');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
