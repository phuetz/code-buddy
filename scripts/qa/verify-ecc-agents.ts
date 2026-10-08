/** Real Markdown loading and tool authorization against the pinned ECC files. */
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { clearAgentLoaderCache, loadCustomAgents, isToolAllowedForAgent } from '../../src/agent/agent-loader.js';
import { parseAgentFile } from '../../src/agent/definitions/agent-definition-loader.js';

const source = path.resolve(process.argv[2]!);
const home = path.resolve(process.argv[3]!);
const output = path.resolve(process.argv[4]!);
const project = fs.mkdtempSync(path.join(path.dirname(output), 'agents-live-'));
const active = path.join(project, '.codebuddy', 'agents');
fs.mkdirSync(active, { recursive: true });
const expected: Record<string, string[]> = {
  planner: ['view_file', 'search'],
  'tdd-guide': ['view_file', 'create_file', 'str_replace_editor', 'bash', 'search'],
  'security-reviewer': ['view_file', 'search', 'bash'],
};
for (const name of Object.keys(expected)) fs.copyFileSync(path.join(source, 'agents', `${name}.md`), path.join(active, `${name}.md`));
clearAgentLoaderCache();
const loaded = loadCustomAgents(project);
const results = Object.entries(expected).map(([name, tools]) => {
  const agent = loaded.find(item => item.name === name)!;
  assert.ok(agent, `${name} loaded`);
  assert.deepEqual(agent.tools, tools);
  assert.deepEqual(parseAgentFile(path.join(active, `${name}.md`)).tools, tools);
  const bashAllowed = isToolAllowedForAgent(agent, 'bash');
  const shellAliasAllowed = isToolAllowedForAgent(agent, 'shell_exec');
  assert.equal(bashAllowed, tools.includes('bash'));
  assert.equal(shellAliasAllowed, bashAllowed);
  assert.equal(isToolAllowedForAgent(agent, 'docker'), false);
  const staged = path.join(home, '.codebuddy', 'agents', 'review', `imported-${name}.md`);
  assert.ok(fs.existsSync(staged));
  assert.throws(() => parseAgentFile(staged), /disabled/);
  return { name, tools: agent.tools, bashAllowed, shellAliasAllowed, dockerAllowed: false, stagedDisabled: true };
});
clearAgentLoaderCache();
const emptyProject = path.join(project, 'empty');
fs.mkdirSync(emptyProject);
assert.equal(loadCustomAgents(emptyProject).length, 0, 'staged agents stay outside the active loader');
fs.writeFileSync(output, JSON.stringify({ source, project, stagedActiveCount: 0, results }, null, 2) + '\n');
