/**
 * Child entry for the MCP bash sandbox tests.
 * Same server as `buddy mcp serve` (`serveMCP`). The only extra step is the
 * capability probe, installed before the server listens. ToolHandler is not mocked.
 */
import { setSandboxCapabilityProbe } from '../../src/sandbox/os-sandbox.js';

if (process.env.CODEBUDDY_TEST_SANDBOX_FORCE === 'none') {
  setSandboxCapabilityProbe(() => ({
    landlock: false,
    bubblewrap: false,
    seatbelt: false,
    docker: false,
    recommended: 'none',
  }));
  process.stderr.write('probe=none recommended=none\n');
}

const { serveMCP } = await import('../../src/commands/mcp.js');

function option(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const tools = option('--tools');
await serveMCP({
  allowWrite: process.argv.includes('--allow-write'),
  ...(tools ? { tools } : {}),
});
