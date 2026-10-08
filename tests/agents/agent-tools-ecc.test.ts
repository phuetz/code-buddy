import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearAgentLoaderCache, loadCustomAgents, isToolAllowedForAgent } from '../../src/agent/agent-loader.js';
import { parseAgentFile } from '../../src/agent/definitions/agent-definition-loader.js';
import { CustomAgentLoader } from '../../src/agent/custom/custom-agent-loader.js';
import { parseAgentTools, translateClaudeTools } from '../../src/agent/agent-tools.js';
import { buildCustomAgentToolFilter, hasCustomAgentToolFilter } from '../../src/agent/custom/custom-agent-tool-filter.js';

const dirs: string[] = [];
afterEach(() => { clearAgentLoaderCache(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function agent(tools: string, extra = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agent-'));
  dirs.push(root);
  const dir = path.join(root, '.codebuddy', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ecc-test-agent.md');
  fs.writeFileSync(file, `---\nname: ecc-test-agent\ntools: ${tools}\n${extra}---\nOnly review code.\n`);
  clearAgentLoaderCache();
  return { root, file };
}
describe('ECC agent allowlists fail closed', () => {
  it('both Markdown loaders translate inline Claude tools and deny Bash', () => {
    const { root, file } = agent('Read, Grep, Glob');
    const loaded = loadCustomAgents(root).find(a => a.name === 'ecc-test-agent')!;
    expect(loaded.tools).toEqual(['view_file', 'search']);
    expect(isToolAllowedForAgent(loaded, 'bash')).toBe(false);
    expect(parseAgentFile(file).tools).toEqual(loaded.tools);
  });
  it.each(['null', '42', '{Read: true}', '[Read, 42]', 'Read,,Bash', '""'])('rejects unreadable tools %s', value => {
    const { root, file } = agent(value);
    expect(loadCustomAgents(root).some(a => a.name === 'ecc-test-agent')).toBe(false);
    expect(() => parseAgentFile(file)).toThrow();
  });
  it('accepts YAML block arrays', () => {
    const { file } = agent('\n  - Read\n  - Bash');
    expect(parseAgentFile(file).tools).toEqual(['view_file', 'bash']);
  });
  it('an explicit empty allowlist grants no tools', () => {
    const { root, file } = agent('[]');
    const loaded = loadCustomAgents(root).find(a => a.name === 'ecc-test-agent')!;
    expect(parseAgentFile(file).tools).toEqual([]);
    expect(isToolAllowedForAgent(loaded, 'bash')).toBe(false);
    const custom = { id: 'empty', name: 'empty', systemPrompt: 'Review', tools: [] };
    expect(hasCustomAgentToolFilter(custom)).toBe(true);
    expect(buildCustomAgentToolFilter(custom).disabledPatterns).toContain('*');
  });
  it('disabled staged agents cannot load, even when moved to the active root', () => {
    const { root, file } = agent('[Read]', 'disabled: true\n');
    expect(loadCustomAgents(root).some(a => a.name === 'ecc-test-agent')).toBe(false);
    expect(() => parseAgentFile(file)).toThrow('disabled');
  });
  it('a malformed frontmatter containing tools is refused', () => {
    const { root, file } = agent('Read');
    fs.writeFileSync(file, '---\nname: ecc-test-agent\ntools: Read\nNo closing delimiter');
    expect(loadCustomAgents(root).some(a => a.name === 'ecc-test-agent')).toBe(false);
    expect(() => parseAgentFile(file)).toThrow();
  });
  it.each(['null', '42', '{Read: true}', '[Read, 42]'])('custom YAML loader rejects %s', value => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-yaml-agent-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'bad.yaml'), `name: bad\nsystemPrompt: Review code\ntools: ${value}\n`);
    expect(new CustomAgentLoader(dir).loadAgents().some(a => a.config.name === 'bad')).toBe(false);
  });
  it('custom YAML loader accepts inline and block restrictions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-yaml-agent-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'inline.yaml'), 'name: inline\nsystemPrompt: Review code\ntools: Read, Grep\n');
    fs.writeFileSync(path.join(dir, 'block.yaml'), 'name: block\nsystemPrompt: Review code\ntools:\n  - Read\n');
    const loaded = new CustomAgentLoader(dir).loadAgents();
    expect(loaded.find(a => a.config.name === 'inline')?.config.tools).toEqual(['view_file', 'search']);
    expect(loaded.find(a => a.config.name === 'block')?.config.tools).toEqual(['view_file']);
  });
  it('unknown imported Claude tools and missing allowlists are rejected', () => {
    expect(() => translateClaudeTools('Read, UnknownTool')).toThrow();
    expect(() => translateClaudeTools(undefined)).toThrow();
    expect(parseAgentTools('file_read, shell_exec')).toEqual(['file_read', 'shell_exec']);
  });
});
