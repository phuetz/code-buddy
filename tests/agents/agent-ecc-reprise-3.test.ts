import { afterEach, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as yaml from 'yaml';
import { isToolAllowedForAgent } from '../../src/agent/agent-loader.js';
import { CustomAgentLoader } from '../../src/agent/custom/custom-agent-loader.js';
import { buildCustomAgentToolFilter } from '../../src/agent/custom/custom-agent-tool-filter.js';
import { filterToolNames } from '../../src/utils/tool-filter.js';
import { parseAgentTools, translateClaudeTools } from '../../src/agent/agent-tools.js';

const dirs: string[] = [];
const invalidPolicies = [['*'], ['!bash'], ['Read', '!bash'], ['**'], ['?*']].map(tools => ({ tools }));
const names = ['bash', 'terminal', 'shell_exec', 'interactive_shell', 'view_file', 'docker', 'write_file', 'search'];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(ext: string, tools: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-policy3-')); dirs.push(dir);
  const fields = { name: 'policy', systemPrompt: 'Review.', tools };
  const body = ext === 'json' ? JSON.stringify(fields) : ext === 'toml' ? `name="policy"\nsystemPrompt="Review."\ntools=${JSON.stringify(tools)}` : ext === 'md' ? `---\n${yaml.stringify({ name: 'policy', tools })}---\nReview.` : yaml.stringify(fields);
  fs.writeFileSync(path.join(dir, `policy.${ext}`), body); return dir;
}
for (const ext of ['yaml', 'json', 'toml', 'md']) {
  it.each(invalidPolicies)(`${ext} refuses unsafe allowlist $tools in sync and async production loaders`, async ({ tools }) => {
    const dir = fixture(ext, tools);
    for (const asynchronous of [false, true]) {
      const loader = new CustomAgentLoader(dir); const agents = asynchronous ? await loader.loadAgentsAsync() : loader.loadAgents();
      expect(agents.map(a => a.config.id)).not.toContain('policy');
    }
  });
  it(`${ext} still loads a literal Read allowlist and denies every execution alias`, () => {
    const config = new CustomAgentLoader(fixture(ext, ['Read'])).getAgent('policy');
    expect(config).not.toBeNull(); expect(filterToolNames(names, buildCustomAgentToolFilter(config!))).toEqual(['view_file']);
  });
}
it.each(invalidPolicies)('the filter refuses invalid programmatic allowlists $tools', ({ tools }) => {
  expect(() => buildCustomAgentToolFilter({ id: 'policy', name: 'Policy', description: '', systemPrompt: 'Review.', tools })).toThrow(/allowlist/);
});
it('positive narrow globs retain their actual filtering effect', () => {
  const tools = parseAgentTools(['view_?ile']);
  expect(filterToolNames(names, buildCustomAgentToolFilter({ id: 'policy', name: 'Policy', description: '', systemPrompt: 'Review.', tools }))).toEqual(['view_file']);
});
it('a deny-all wildcard is supported only as a denial', () => {
  expect(() => parseAgentTools('*')).toThrow(/allowlist/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-policy3-')); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'policy.yaml'), 'name: policy\nsystemPrompt: Review.\ndisabledTools: "*"');
  const config = new CustomAgentLoader(dir).getAgent('policy'); expect(config).not.toBeNull();
  expect(filterToolNames(names, buildCustomAgentToolFilter(config!))).toEqual([]);
});
it('external Claude agent imports also refuse general or negative tool policies', () => {
  for (const policy of ['*', '!bash']) expect(() => translateClaudeTools(policy)).toThrow(/allowlist/);
});

it('the secondary predicate also enforces wildcard denials and rejects invalid direct policies', () => {
  const base = { name: 'policy', description: '', systemPrompt: 'Review.', source: '', isCustom: true };
  for (const name of names) expect(isToolAllowedForAgent({ ...base, disallowedTools: ['*'] }, name)).toBe(false);
  for (const tools of [['*'], ['!bash']]) for (const name of names) expect(isToolAllowedForAgent({ ...base, tools }, name)).toBe(false);
  expect(isToolAllowedForAgent({ ...base, tools: ['Read'] }, 'view_file')).toBe(true);
});
