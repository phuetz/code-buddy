import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PromptManager } from '../../src/prompts/prompt-manager.js';
import { handlePromptCommand } from '../../src/commands/slash/prompt-commands.js';
import * as pmModule from '../../src/prompts/prompt-manager.js';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

class TestPromptManager extends PromptManager {
  constructor(homedir: string) {
    super();
    // We override userPromptsDir
    (this as any).userPromptsDir = path.join(homedir, '.codebuddy', 'prompts');
  }
}

describe('PromptManager and prompt slash commands with unknown ID', () => {
  let tmpDir: string;
  let pm: PromptManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-test-prompts-'));
    pm = new TestPromptManager(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('loadPrompt rejects for an unknown ID with a useful message', async () => {
    await expect(pm.loadPrompt('nosuch')).rejects.toThrow(/Unknown system prompt "nosuch"/);
    await expect(pm.loadPrompt('nosuch')).rejects.toThrow(/architect/); // checks available prompts in message
  });

  it('loadPrompt succeeds for built-in minimal and architect', async () => {
    const minimal = await pm.loadPrompt('minimal');
    expect(minimal).toBeTruthy();
    const architect = await pm.loadPrompt('architect');
    expect(architect).toBeTruthy();
  });

  it('loadPrompt succeeds for a custom user prompt', async () => {
    const userPromptsDir = path.join(tmpDir, '.codebuddy', 'prompts');
    await fs.ensureDir(userPromptsDir);
    await fs.writeFile(path.join(userPromptsDir, 'mon-style.md'), 'Mon prompt stylé');
    const custom = await pm.loadPrompt('mon-style');
    expect(custom).toBe('Mon prompt stylé');
  });

  it('/prompt use nosuch responds with not found', async () => {
    vi.spyOn(pmModule, 'getPromptManager').mockReturnValue(pm);
    const res = await handlePromptCommand('use nosuch');
    expect(res).toBe('Prompt "nosuch" not found. Run /prompt list to see available prompts.');
    vi.restoreAllMocks();
  });
});
