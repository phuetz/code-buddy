import { expect, it } from 'vitest';
import { parseAgentTools, translateClaudeTools } from '../../src/agent/agent-tools.js';
import { buildCustomAgentToolFilter } from '../../src/agent/custom/custom-agent-tool-filter.js';
import { filterToolNames } from '../../src/utils/tool-filter.js';
it('the positive ?ash glob selects bash without opening unrelated tools and still honors denial', () => {
  expect(() => translateClaudeTools(['?ash'])).toThrow(/allowlist/);
  const names = ['bash', 'terminal', 'shell_exec', 'interactive_shell', 'view_file', 'docker', 'write_file', 'search'];
  const config = { id: 'policy', name: 'Policy', description: '', systemPrompt: 'Review.', tools: parseAgentTools(['?ash']) };
  expect(filterToolNames(names, buildCustomAgentToolFilter(config))).toEqual(['bash']);
  expect(filterToolNames(names, buildCustomAgentToolFilter({ ...config, disabledTools: ['Bash'] }))).toEqual([]);
});
