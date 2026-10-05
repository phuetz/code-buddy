/**
 * B1-PATCH-1005 — fixe les 3 coupes headless sûres.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getBaseSystemPrompt } from '../../src/prompts/system-base.js';
import { stripHeadlessIrrelevantWorkspaceSections } from '../../src/services/prompt-builder.js';

describe('B1 headless prompt/tool cuts', () => {
  const prevHeadless = process.env.CODEBUDDY_HEADLESS;

  afterEach(() => {
    if (prevHeadless === undefined) delete process.env.CODEBUDDY_HEADLESS;
    else process.env.CODEBUDDY_HEADLESS = prevHeadless;
  });

  it('omits confirmation_system and softens bash confirmation wording when headless', () => {
    delete process.env.CODEBUDDY_HEADLESS;
    const interactive = getBaseSystemPrompt(false, '/tmp/project');
    expect(interactive).toContain('<confirmation_system>');
    expect(interactive).toContain('with user confirmation');
    expect(interactive).toContain('Commands require user confirmation before execution');

    process.env.CODEBUDDY_HEADLESS = 'true';
    const headless = getBaseSystemPrompt(false, '/tmp/project');
    expect(headless).not.toContain('<confirmation_system>');
    expect(headless).not.toContain('with user confirmation');
    expect(headless).not.toContain('Commands require user confirmation before execution');
    expect(headless).toContain('- bash: Execute shell commands');
    expect(headless).toContain('Destructive commands (rm -rf, format) still need an explicit user request');
  });

  it('stripHeadlessIrrelevantWorkspaceSections drops Cowork, Fleet and Slash sections', () => {
    const sample = [
      '# Workspace Context',
      '',
      '## Keep Me',
      'important',
      '',
      '## Cowork — Desktop GUI (`cowork/`)',
      'gui stuff',
      '',
      '## Fleet (Multi-AI Hub) — `src/fleet/` + `src/server/websocket/`',
      'fleet stuff',
      '',
      '## CLI & Slash Commands',
      'slash stuff',
      '',
      '## After',
      'tail',
    ].join('\n');
    const out = stripHeadlessIrrelevantWorkspaceSections(sample);
    expect(out).toContain('## Keep Me');
    expect(out).toContain('## After');
    expect(out).not.toContain('## Cowork');
    expect(out).not.toContain('## Fleet');
    expect(out).not.toContain('## CLI & Slash Commands');
    expect(out).not.toContain('gui stuff');
    expect(out).not.toContain('fleet stuff');
    expect(out).not.toContain('slash stuff');
  });

  it('drops extension_forge from the forced tool set when headless (real strategy)', async () => {
    const { ToolSelectionStrategy } = await import('../../src/agent/execution/tool-selection-strategy.js');
    const names = async () => {
      const strategy = new ToolSelectionStrategy();
      const r = await strategy.selectToolsForQuery('Explique le rôle de PromptBuilder dans ce dépôt.');
      return r.tools.map((t) => t.function.name);
    };
    delete process.env.CODEBUDDY_HEADLESS;
    expect(await names()).toContain('extension_forge');

    process.env.CODEBUDDY_HEADLESS = 'true';
    const headless = await names();
    // ÉCHOUE sur l'ancienne logique : extension_forge restait forcé en headless.
    expect(headless).not.toContain('extension_forge');
    expect(headless).toContain('view_file');
  });
});
