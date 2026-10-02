/** Real local model + production browser tool; no stubbed planner or browser. */
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { BrowserExecuteTool } from '../../src/tools/registry/misc-tools.js';
import { WebTestTool } from '../../src/tools/registry/web-test-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { registerDevOrigin, unregisterDevOrigin } from '../../src/security/dev-origins.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.env.QA_ARTIFACTS ?? path.join(root, '_qa/rejeu');
await mkdir(output, { recursive: true });
const project = await mkdtemp(path.join(output, 'live-project-'));
process.chdir(project);
const html = await readFile(path.join(root, 'tests/fixtures/rejeu/demo.html'), 'utf8');
let changed = false;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  // Change markup while keeping URL/context identical, as a deployed update would.
  response.end(changed && request.url?.includes('flow=details') ? html.replace("const changed=new URL(location.href).searchParams.has('changed');", 'const changed=true;') : html);
});
server.on('error', error => { throw error; });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
registerDevOrigin(origin);
const tool = new BrowserExecuteTool();
const traces: unknown[] = [];
const originalChat = CodeBuddyClient.prototype.chat;
CodeBuddyClient.prototype.chat = async function (...args) {
  const started = Date.now();
  const response = await originalChat.apply(this, args);
  traces.push({ modelCall: { messages: args[0], response, elapsedMs: Date.now() - started } });
  return response;
};
const service = ConfirmationService.getInstance();
// Only these local demo browser effects were authorized by the benchmark task.
service.setInteractiveBridge(async options => ({ confirmed: options.toolName === 'browser' && options.filename.startsWith(origin) }));
async function call(input: Record<string, unknown>) {
  const start = Date.now();
  const result = await tool.execute(input);
  traces.push({ input, result, elapsedMs: Date.now() - start });
  await writeFile(path.join(output, 'live-trace.json'), JSON.stringify({ model: process.env.CODEBUDDY_UI_MODEL, traces }, null, 2));
  process.stdout.write(JSON.stringify({ input, result }) + '\n');
  if (!result.success) throw new Error(result.error ?? result.output);
  return result;
}
try {
  await call({ action: 'launch', headless: true });
  const flows = [
    { name: 'details', instruction: 'Open the information details', expectedText: 'Details ready' },
    { name: 'theme', instruction: 'Open appearance preferences and enable the dark theme', expectedText: 'Dark theme enabled' },
    { name: 'greeting', instruction: 'Fill Name using the visitor parameter, then click Greet', expectedText: 'Welcome Alice', values: { visitor: 'Alice' } },
  ];
  for (const flow of flows) {
    for (const pass of ['model', 'replay']) {
      await call({ action: 'navigate', url: `${origin}/?flow=${flow.name}` });
      const result = await call({ action: 'act', ...flow });
      traces.push({ measurement: flow.name, pass, stats: result.data });
    }
  }
  changed = true;
  await call({ action: 'navigate', url: `${origin}/?flow=details` });
  await call({ action: 'act', ...flows[0] });
  await call({ action: 'navigate', url: `${origin}/?flow=details` });
  await call({ action: 'act', ...flows[0] });
  const assertion = await new WebTestTool().execute({ url: `${origin}/?flow=details`, screenshot: false,
    assertions: [{ type: 'assert', value: 'There is a control for displaying information' }] });
  traces.push({ naturalAssertion: assertion });
  if (!(assertion.data as { passed: boolean })?.passed) throw new Error('Natural assertion failed');
} finally {
  CodeBuddyClient.prototype.chat = originalChat;
  await tool.execute({ action: 'close' }); service.setInteractiveBridge(null); unregisterDevOrigin(origin);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await writeFile(path.join(output, 'live-trace.json'), JSON.stringify({ model: process.env.CODEBUDDY_UI_MODEL, traces }, null, 2));
}
