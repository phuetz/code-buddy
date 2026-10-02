// Imported only by the test subprocess, never by production. No sockets or keys.
import fs from 'node:fs';
import path from 'node:path';
const originalFetch = globalThis.fetch;
let sequence = 0;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('http://acp-fixture.invalid/')) return originalFetch(url, init);
  const body = JSON.parse(init.body);
  const messages = body.messages ?? [];
  const userIndex = messages.findLastIndex((message) => message.role === 'user');
  const prompt = String(messages[userIndex]?.content ?? '');
  const results = messages.slice(userIndex + 1).filter((message) => message.role === 'tool');
  const workspace = process.env.ACP_FIXTURE_WORKSPACE;
  fs.appendFileSync(path.join(workspace, 'provider.jsonl'), JSON.stringify({ messages, tools: body.tools?.map((tool) => tool.function.name) }) + '\n');
  let call;
  let content = 'done';
  if (prompt.includes('mcp') && results.length === 0) call = ['mcp__fixture__echo', { text: 'mcp-reference-ok' }];
  else if (prompt.includes('patch') && results.length === 0) call = ['apply_patch', { patch: '*** Begin Patch\n*** Update File: sample.txt\n@@\n-buffer-original\n+buffer-patched\n*** End Patch' }];
  else if (prompt.includes('edit') && results.length === 0) call = ['view_file', { path: 'sample.txt' }];
  else if (prompt.includes('edit') && results.length === 1) call = ['str_replace_editor', { path: 'sample.txt', old_str: 'buffer-original', new_str: 'buffer-edited' }];
  else if (prompt.includes('read') && results.length === 0) call = ['view_file', { path: 'sample.txt' }];
  else if (prompt.includes('long') && results.length === 0) call = ['bash', { command: `node -e "require('fs').writeFileSync('started.txt','started');setTimeout(()=>require('fs').writeFileSync('late.txt','late'),3000)"` }];
  else if (prompt.includes('stall')) return new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  else if (prompt.includes('remember')) content = messages.some((message) => String(message.content).includes('buffer-edited')) ? 'remembered-buffer-edited' : 'MISSING-HISTORY';
  const delta = call ? { tool_calls: [{ index: 0, id: `fixture_${++sequence}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } : { content };
  if (!body.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: call ? '' : content, tool_calls: call ? [{ id: `fixture_${sequence}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] : [] }, finish_reason: call ? 'tool_calls' : 'stop' }] });
  const chunk = { id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: call ? 'tool_calls' : 'stop' }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
};
