import { afterEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CustomAgentLoader } from '../../src/agent/custom/custom-agent-loader.js';
import { parseAgentTools } from '../../src/agent/agent-tools.js';
import { buildCustomAgentToolFilter } from '../../src/agent/custom/custom-agent-tool-filter.js';
import { filterToolNames } from '../../src/utils/tool-filter.js';
import { isToolAllowedForAgent } from '../../src/agent/agent-loader.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function root() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-live-loader-')); dirs.push(d); return d; }
it('production loader supports reviewed Markdown in both sync and async paths', async () => {
  const dir = root(); fs.writeFileSync(path.join(dir, 'planner.md'), '---\nname: planner\ntools: Read, Grep, Glob\n---\nPlan safely.');
  for (const asyncLoad of [false, true]) {
    const loader = new CustomAgentLoader(dir);
    const agents = asyncLoad ? await loader.loadAgentsAsync() : loader.loadAgents();
    expect(agents.find(a => a.config.id === 'planner')).toBeDefined();
    const config = agents.find(a => a.config.id === 'planner')!.config;
    expect(config.tools).toEqual(['view_file', 'search']);
    expect(filterToolNames(['bash', 'terminal', 'interactive_shell', 'shell_exec', 'view_file', 'search', 'docker'], buildCustomAgentToolFilter(config))).toEqual(['view_file', 'search']);
  }
});
it.each(['yaml', 'json', 'md', 'toml'])('production loader refuses disabled %s even in the active directory', async ext => {
  const dir = root();
  const content = ext === 'md' ? '---\nname: disabled\ntools: Read\ndisabled: true\n---\nReview.' : ext === 'json' ? JSON.stringify({ name: 'disabled', systemPrompt: 'Review.', disabled: true }) : ext === 'toml' ? 'name="disabled"\nsystemPrompt="Review."\ndisabled=true' : 'name: disabled\nsystemPrompt: Review.\ndisabled: true';
  fs.writeFileSync(path.join(dir, `disabled.${ext}`), content);
  for (const asyncLoad of [false, true]) {
    const loader = new CustomAgentLoader(dir);
    const agents = asyncLoad ? await loader.loadAgentsAsync() : loader.loadAgents();
    expect(agents.map(a => a.config.id)).not.toContain('disabled');
  }
});
it('legacy colon in a descriptive YAML scalar cannot erase a valid tool policy', () => {
  const dir = root(); fs.writeFileSync(path.join(dir, 'legacy.yaml'), 'name: legacy\ndescription: Use when: reviewing code\nsystemPrompt: Review.\ntools: Read\n');
  const config = new CustomAgentLoader(dir).getAgent('legacy')!;
  expect(config).not.toBeNull();
  expect(config.description).toBe('Use when: reviewing code'); expect(config.tools).toEqual(['view_file']);
});
it.each(['*_exec', '*file*', 'view_?ile', '!bash'])('retains supported glob policy %s', pattern => {
  expect(parseAgentTools([pattern])).toEqual([pattern]);
});
it('all execution aliases are denied by the production agent filter', () => {
  for (const denial of ['Bash', 'bash', 'shell_exec', 'terminal']) {
    const config = { id: 'probe', name: 'Probe', description: '', systemPrompt: 'Review', disabledTools: parseAgentTools(denial) };
    expect(filterToolNames(['bash', 'terminal', 'interactive_shell', 'shell_exec', 'view_file'], buildCustomAgentToolFilter(config))).toEqual(['view_file']);
  }
});
it('prototype names stay strings and neither filter path crashes', () => {
  expect(parseAgentTools(['toString', 'constructor'])).toEqual(['toString', 'constructor']);
  const config = { id: 'probe', name: 'Probe', description: '', systemPrompt: 'Review', tools: parseAgentTools(['constructor']) };
  expect(filterToolNames(['bash', 'constructor'], buildCustomAgentToolFilter(config))).toEqual(['constructor']);
  expect(isToolAllowedForAgent({ name: 'probe', description: '', systemPrompt: '', source: '', isCustom: true, tools: ['view_file'] }, 'constructor')).toBe(false);
});

it('production loader retains a wildcard denial instead of losing the agent', () => {
  const dir = root(); fs.writeFileSync(path.join(dir, 'glob.toml'), 'name="glob"\nsystemPrompt="Review."\ndisabledTools=["*_exec"]');
  const config = new CustomAgentLoader(dir).getAgent('glob');
  expect(config).not.toBeNull();
  expect(config!.disabledTools).toEqual(['*_exec']);
  expect(filterToolNames(['bash', 'shell_exec', 'terminal', 'interactive_shell', 'view_file'], buildCustomAgentToolFilter(config!))).toEqual(['view_file']);
});

it('a Bash allowlist reaches the same execution aliases as its denials', () => {
  const config = { id: 'probe', name: 'Probe', description: '', systemPrompt: 'Review', tools: ['bash'] };
  expect(filterToolNames(['bash', 'terminal', 'shell_exec', 'interactive_shell', 'docker'], buildCustomAgentToolFilter(config))).toEqual(['bash', 'terminal', 'shell_exec', 'interactive_shell']);
});
