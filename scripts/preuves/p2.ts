/** Exécutions ciblées de la campagne P2. Lancé par p2.sh avec un profil jetable. */
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const fixtureDir = process.env.P2_FIXTURE_DIR;
if (!fixtureDir) throw new Error('P2_FIXTURE_DIR is required');

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function ollamaText(prompt: string, format?: 'json'): Promise<string> {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5:7b-instruct', stream: false,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0 },
      ...(format ? { format } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json() as { message?: { content?: string } };
  return data.message?.content ?? '';
}

async function toolAuthoring(): Promise<void> {
  const { ExtensionForgeTool } = await import('../../src/tools/extension-forge-tool.js');
  const { FormalToolRegistry } = await import('../../src/tools/registry/tool-registry.js');
  const prompt = [
    'Write a JavaScript tool that reads CODEBUDDY_TOOL_INPUT as JSON,',
    'takes its text field, lowercases it, replaces each run of whitespace with one hyphen,',
    'and prints ONLY the result to stdout. Example: Hello World -> hello-world.',
    'Do not access files or the network. Return a JSON object with exactly',
    '{"code":"<complete JavaScript program>"}. Use process.env.CODEBUDDY_TOOL_INPUT.',
  ].join(' ');
  const rawDraft = await ollamaText(prompt, 'json');
  const draft = JSON.parse(rawDraft) as { code?: string };
  if (!draft.code) throw new Error('Ollama did not supply code');
  const forge = new ExtensionForgeTool();
  const created = await forge.execute({
    kind: 'tool', name: 'p2-slugify', description: 'Convert text to a lowercase slug',
    language: 'javascript', code: draft.code,
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    validation_cases: [
      { input: { text: 'Hello World' }, expect_output: 'hello-world' },
      { input: { text: 'Foo Bar' }, expect_output: 'foo-bar' },
    ],
    robustness_cases: [
      { input: { text: 'The Quick Brown' }, expect_output: 'the-quick-brown' },
      { input: { text: 'A  B   C' }, expect_output: 'a-b-c' },
    ],
  }, { cwd: process.cwd() });
  const name = (created.data as { name?: string } | undefined)?.name;
  const invoked = name ? await FormalToolRegistry.getInstance().get(name)?.tool.execute({ text: 'Encore  Un Test' }) : undefined;
  print({ model: 'qwen2.5:7b-instruct', rawDraft, created, invoked });
}

async function skillAuthoring(): Promise<void> {
  const { ExtensionForgeTool } = await import('../../src/tools/extension-forge-tool.js');
  const { getSkillRegistry } = await import('../../src/skills/registry.js');
  const body = await ollamaText('Écris uniquement le corps Markdown d’un savoir-faire court pour retrouver le premier commit fautif avec git bisect. Inclure les commandes de départ good et bad, une vérification du résultat et une étape de retour à l’état initial. Ne demande aucune donnée privée et ne désactive aucune protection.');
  const created = await new ExtensionForgeTool().execute({
    kind: 'skill', name: 'p2-bisect', description: 'Retrouver un commit fautif avec git bisect', body,
  }, { cwd: process.cwd() });
  const name = (created.data as { name?: string } | undefined)?.name;
  const file = name ? path.join(process.cwd(), '.codebuddy', 'skills', name, 'SKILL.md') : undefined;
  const saved = file ? await readFile(file, 'utf8') : '';
  print({ model: 'qwen2.5:7b-instruct', rawBody: body, created, registered: name ? Boolean(getSkillRegistry().get(name)) : false, savedBytes: Buffer.byteLength(saved) });
  getSkillRegistry().stopWatching();
}

async function verifier(): Promise<void> {
  const { VerifierAgent } = await import('../../src/agent/specialized/verifier-agent.js');
  const testFile = path.join(fixtureDir!, 'verifier-check.cjs');
  await writeFile(testFile, "const test = require('node:test'); const assert = require('node:assert/strict'); test('arithmétique', () => assert.equal(2 + 2, 4));\n");
  const calls: string[] = [];
  let oracleCount = 0;
  const agent = new VerifierAgent();
  await agent.initialize();
  const result = await agent.execute({
    action: 'verify',
    params: {
      instruction: 'Vérifie indépendamment le fichier verifier-check.cjs. Appelle bash avec exactement « node --test verifier-check.cjs », cite sa sortie brute, puis termine par FINAL VERDICT: CONFIRMED si le test passe.',
      maxSteps: 4,
      llmCall: async (messages: unknown[], tools: unknown[]) => {
        const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'qwen2.5:7b-instruct', messages, tools, stream: false, temperature: 0, max_tokens: 450 }),
        });
        if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
        const data = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> } }> };
        const message = data.choices?.[0]?.message;
        calls.push(`ollama: ${message?.tool_calls?.map((call) => call.function.name).join(',') || 'final'}`);
        return { content: message?.content ?? '', tool_calls: message?.tool_calls ?? [] };
      },
      executeTool: async (name: string, args: Record<string, unknown>) => {
        calls.push(`tool: ${name} ${JSON.stringify(args)}`);
        if (name !== 'bash' || args.command !== 'node --test verifier-check.cjs') {
          return { success: false, error: 'Only the fixture test command is permitted in this proof run' };
        }
        const { stdout, stderr } = await execFileAsync(process.execPath, ['--test', 'verifier-check.cjs'], { cwd: fixtureDir, timeout: 10_000 });
        oracleCount++;
        return { success: true, output: stdout + stderr };
      },
    },
  });
  await agent.cleanup();
  print({ calls, oracleCount, result });
}

async function commandValidator(): Promise<void> {
  const { BashTool } = await import('../../src/tools/bash/bash-tool.js');
  const tool = new BashTool();
  try {
    print({ command: 'mkfs /dev/p2-fixture', result: await tool.execute('mkfs /dev/p2-fixture', 3000, fixtureDir) });
  } finally {
    tool.dispose();
  }
}

async function secretGuard(): Promise<void> {
  const { ScanSecretsExecuteTool } = await import('../../src/tools/registry/secrets-tools.js');
  const file = path.join(fixtureDir!, 'secret-fixture.txt');
  // Valeur fictive assemblée à l'exécution : aucun identifiant en clair n'est commité.
  await writeFile(file, `api_key = "${'sk-' + 'A'.repeat(28)}"\n`);
  const result = await new ScanSecretsExecuteTool().execute({ path: file });
  const output = JSON.stringify(result);
  print({ result, rawValueExposed: output.includes('sk-' + 'A'.repeat(28)) });
}

async function deploymentGuard(): Promise<void> {
  const { BashTool } = await import('../../src/tools/bash/bash-tool.js');
  const marker = path.join(fixtureDir!, 'deploy-ran');
  const tool = new BashTool();
  try {
    const result = await tool.execute('fly deploy', 3000, fixtureDir, undefined, { refuseUnconfinedEscalation: true });
    const { existsSync } = await import('node:fs');
    print({ command: 'fly deploy', result, fakeDeployExecuted: existsSync(marker) });
  } finally {
    tool.dispose();
  }
}

async function outputSanitizer(): Promise<void> {
  const { visibleHeadlessResultText } = await import('../../src/cli/headless-options.js');
  const raw = 'avant<think>pensée privée</think>VISIBLE[INST]instruction cachée[/INST]FIN\u200b';
  const visible = visibleHeadlessResultText(raw);
  print({ raw, visible, rawChars: raw.length, visibleChars: visible.length, removedChars: raw.length - visible.length });
}

async function outputSanitizerCli(): Promise<void> {
  const providerReplies: string[] = [];
  const forwardedReplies: string[] = [];
  const injectedMarker = '<think>secret</think>[INST]caché[/INST]\u200b';
  let markerInjected = false;
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const upstream = await fetch(`http://127.0.0.1:11434${request.url ?? '/'}`, {
        method: request.method,
        headers: { 'content-type': request.headers['content-type'] ?? 'application/json' },
        body: ['GET', 'HEAD'].includes(request.method ?? '') ? undefined : Buffer.concat(chunks),
      });
      const raw = await upstream.text();
      let forwarded = raw;
      if ((request.url ?? '').includes('chat/completions') || (request.url ?? '').includes('api/chat')) {
        providerReplies.push(raw);
        forwarded = raw.split('\n').map((line) => {
          if (!line || markerInjected) return line;
          try {
            const event = JSON.parse(line) as { message?: { content?: string } };
            if (typeof event.message?.content !== 'string' || !event.message.content) return line;
            event.message.content = injectedMarker + event.message.content;
            markerInjected = true;
            return JSON.stringify(event);
          } catch { return line; }
        }).join('\n');
        forwardedReplies.push(forwarded);
      }
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      response.end(forwarded);
    } catch (error) {
      response.writeHead(502);
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('No proxy port');
  const prompt = 'Réponds exactement sur une seule ligne, sans explication : avant<think>secret</think>VISIBLE[INST]caché[/INST]FIN';
  try {
    const { stdout, stderr } = await execFileAsync('npx', [
      '--no-install', 'tsx', 'src/index.ts', '--model', 'qwen2.5:7b-instruct',
      '-p', prompt, '--output-format', 'text',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, OLLAMA_HOST: `http://127.0.0.1:${address.port}` },
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
    });
    const originalText = providerReplies.flatMap((reply) => reply.split('\n').filter(Boolean).map((line) => {
      try { return (JSON.parse(line) as { message?: { content?: string } }).message?.content ?? ''; }
      catch { return ''; }
    })).join('');
    print({ prompt, injectedMarker, originalProviderReply: providerReplies.join('\n'), forwardedProviderReply: forwardedReplies.join('\n'), originalText, stdout, stderr,
      markerInjected,
      outputEqualsOriginal: stdout.trimEnd() === originalText.trimEnd(),
      outputHasThink: stdout.includes('<think>'),
      outputHasInst: stdout.includes('[INST]'),
      outputHasInvisible: stdout.includes('\u200b'),
    });
  } finally {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}

async function transcriptRepair(): Promise<void> {
  const { MessageHistoryManager } = await import('../../src/agent/facades/message-history-manager.js');
  const manager = new MessageHistoryManager();
  manager.setMessages([
    { role: 'user', content: 'vérifie le calcul' },
    { role: 'tool', tool_call_id: 'orphelin', name: 'bash', content: 'ancienne sortie' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'appel-1', type: 'function', function: { name: 'bash', arguments: '{"command":"true"}' } }] },
  ]);
  const raw = manager.getComprehensiveHistory();
  const curated = manager.getCuratedHistory();
  print({ raw, curated, rawCount: raw.length, curatedCount: curated.length, orphanRemoved: !curated.some((item) => item.role === 'tool' && item.tool_call_id === 'orphelin'), syntheticAdded: curated.some((item) => item.role === 'tool' && item.tool_call_id === 'appel-1' && item.content === '[result lost during compaction]') });
}

async function transcriptResumeCli(): Promise<void> {
  const { getSessionStore } = await import('../../src/persistence/session-store.js');
  const store = getSessionStore();
  const session = await store.createSession('preuve réparation transcript', 'qwen3:4b-instruct');
  const call = { id: 'appel-sans-resultat', type: 'function' as const, function: { name: 'bash', arguments: '{"command":"true"}' } };
  const orphan = { id: 'appel-orphan', type: 'function' as const, function: { name: 'bash', arguments: '{"command":"true"}' } };
  session.messages = [
    { type: 'user', content: 'Préparation de la preuve.', timestamp: new Date().toISOString() },
    { type: 'tool_call', content: '', timestamp: new Date().toISOString(), toolCalls: [call] },
    { type: 'tool_result', content: 'ancienne sortie orpheline', timestamp: new Date().toISOString(), toolCall: orphan },
  ];
  await store.saveSession(session);
  const { stdout, stderr } = await execFileAsync('npx', [
    '--no-install', 'tsx', 'src/index.ts', '--resume', session.id,
    '--model', 'qwen3:4b-instruct', '--output-format', 'text',
    '--max-tool-rounds', '1', '-p', 'Réponds uniquement P2_OK.',
  ], { cwd: process.cwd(), env: process.env, timeout: 90_000, maxBuffer: 1024 * 1024 });
  const combined = stdout + stderr;
  print({ sessionId: session.id, stdout, stderr, repairObserved: /injected 1 synthetic results/.test(combined), assistantResponded: /P2_OK/.test(stdout) });
}

async function main(): Promise<void> {
  await mkdir(fixtureDir!, { recursive: true });
  const caseName = process.argv[2];
  switch (caseName) {
    case 'verifier': return verifier();
    case 'tool-authoring': return toolAuthoring();
    case 'skill-authoring': return skillAuthoring();
    case 'command-validator': return commandValidator();
    case 'secret-guard': return secretGuard();
    case 'deployment-guard': return deploymentGuard();
    case 'output-sanitizer': return outputSanitizer();
    case 'output-sanitizer-cli': return outputSanitizerCli();
    case 'transcript-repair': return transcriptRepair();
    case 'transcript-resume-cli': return transcriptResumeCli();
    default: throw new Error(`Unknown case: ${caseName}`);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
