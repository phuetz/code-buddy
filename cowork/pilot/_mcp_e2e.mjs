/** End-to-end MCP test: spawn mcp-server.mjs, launch Cowork (real ChatGPT),
 *  chat, screenshot, close. Validates the MCP server drives the real GUI. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(dir, 'mcp-server.mjs')],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':10.0' },
  stderr: 'inherit',
});
const client = new Client({ name: 'mcp-e2e', version: '0' });

const textOf = (r) => (r?.content || []).map((c) => c.text).filter(Boolean).join('\n');

try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log('[mcp-e2e] tools:', tools.tools.map((t) => t.name).join(', '));

  console.log('[mcp-e2e] launch(real)…');
  console.log('  ->', textOf(await client.callTool({ name: 'cowork_launch', arguments: { real: true } })).slice(0, 200));

  console.log('[mcp-e2e] chat…');
  const chat = await client.callTool({
    name: 'cowork_chat',
    arguments: {
      prompt:
        'Calcule 17 multiplie par 23. Reponds par UNE seule ligne commencant exactement par CBMCP suivi du resultat.',
      marker: 'CBMCP',
      timeoutMs: 120000,
    },
  });
  console.log('  -> reply:', textOf(chat));

  console.log('[mcp-e2e] screenshot…');
  const shot = await client.callTool({
    name: 'cowork_screenshot',
    arguments: { path: '/tmp/cowork-mcp-e2e.png', fullPage: true },
  });
  const img = (shot.content || []).find((c) => c.type === 'image');
  console.log('  -> image content present:', !!img, '| text:', textOf(shot).slice(0, 120));

  console.log('[mcp-e2e] get_state…');
  console.log('  ->', textOf(await client.callTool({ name: 'cowork_get_state', arguments: {} })).slice(0, 200));

  await client.callTool({ name: 'cowork_close', arguments: {} });
  console.log('[mcp-e2e] PASS');
} catch (e) {
  console.error('[mcp-e2e] FAIL', e?.stack || e);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
