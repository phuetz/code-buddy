import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { CustomAgentLoader } from '../../src/agent/custom/custom-agent-loader.js';
import { buildCustomAgentToolFilter } from '../../src/agent/custom/custom-agent-tool-filter.js';
import { filterToolNames } from '../../src/utils/tool-filter.js';

const [ecc, staged, output, importReport] = process.argv.slice(2);
assert(ecc && staged && output);
const project = fs.mkdtempSync(path.join(path.dirname(output), 'production-agents-'));
const active = path.join(project, 'agents'); fs.mkdirSync(active);
const names = ['planner', 'tdd-guide', 'security-reviewer'];
for (const name of names) fs.copyFileSync(path.join(ecc, 'agents', `${name}.md`), path.join(active, `${name}.md`));
const results = [];
for (const asynchronous of [false, true]) {
  const loader = new CustomAgentLoader(active);
  const loaded = asynchronous ? await loader.loadAgentsAsync() : loader.loadAgents();
  for (const name of names) {
    const config = loaded.find(a => a.config.id === name)?.config;
    assert(config);
    const allowed = filterToolNames(['view_file', 'search', 'bash', 'terminal', 'shell_exec', 'interactive_shell', 'docker'], buildCustomAgentToolFilter(config));
    assert(allowed.includes('view_file')); assert(!allowed.includes('docker'));
    for (const shell of ['bash', 'terminal', 'shell_exec', 'interactive_shell']) assert.equal(allowed.includes(shell), name !== 'planner');
    results.push({ name, asynchronous, tools: config.tools, allowed });
  }
}
const stagedRoot = path.join(project, 'staged'); fs.mkdirSync(stagedRoot);
const report = importReport ? JSON.parse(fs.readFileSync(importReport, 'utf8')).report as {
  agents: { quarantined: { sourcePath: string }[]; review: { sourcePath: string }[] };
} : undefined;
const stagedChecks = names.map(name => {
  const sourcePath = `agents/${name}.md`;
  const quarantined = report?.agents.quarantined.some(a => a.sourcePath === sourcePath) ?? false;
  const file = path.join(staged, 'review', `imported-${name}.md`);
  assert.equal(fs.existsSync(file), !quarantined);
  if (!quarantined) {
    if (report) assert(report.agents.review.some(a => a.sourcePath === sourcePath));
    fs.copyFileSync(file, path.join(stagedRoot, `imported-${name}.md`));
  }
  return { name, quarantined, copiedToReview: !quarantined };
});
const stagedLoader = new CustomAgentLoader(stagedRoot);
const stagedActiveCount = stagedLoader.listAgents().filter(a => a.id.startsWith('imported-')).length;
assert.equal(stagedActiveCount, 0);
fs.writeFileSync(output, JSON.stringify({ consumer: 'CustomAgentLoader + buildCustomAgentToolFilter (buddy --agent)', results, stagedChecks, stagedActiveCount }, null, 2) + '\n');
