const fs = require('fs');

const statuses = {
  'agent-identity': 'covered',
  'cli-tui': 'covered',
  'prompt-size': 'covered',
  'providers-models': 'covered',
  'toolsets': 'covered',
  'built-in-tools': 'covered',
  'messaging-gateway': 'covered-partial',
  'browser-automation': 'covered-partial',
  'nous-portal': 'covered',
  'memory-providers': 'covered',
  'skills': 'covered',
  'closed-learning-loop': 'covered',
  'cron-scheduling': 'covered',
  'delegation-parallelism': 'covered',
  'runtime-backends': 'covered-partial',
  'mobile-supervision': 'covered-partial',
  'research-trajectories': 'covered',
  'kanban': 'covered',
  'mcp-acp': 'covered',
  'openclaw-migration': 'partial'
};

const path = 'tests/commands/hermes-commands.test.ts';
let content = fs.readFileSync(path, 'utf8');

for (const [id, expectedStatus] of Object.entries(statuses)) {
  const regex = new RegExp(`id:\\s*'${id}',\\s*status:\\s*'[^']+'`, 'g');
  content = content.replace(regex, `id: '${id}',\n          status: '${expectedStatus}'`);
}

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed statuses in hermes-commands.test.ts');
