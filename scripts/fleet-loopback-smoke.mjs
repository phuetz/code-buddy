#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const shouldRunChat = args.has('--chat');

process.env.JWT_SECRET ||= 'fleet-loopback-smoke-secret';
process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT ||= process.cwd();
process.env.LOG_LEVEL ||= 'error';
process.env.LOG_FILE ??= '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

async function main() {
  const { startServer, stopServer } = await import('../dist/server/index.js');
  const { createApiKey } = await import('../dist/server/auth/api-keys.js');
  const { FleetListener } = await import('../dist/fleet/fleet-listener.js');

  let started;
  let listener;
  const result = {
    ok: false,
    chatEnabled: shouldRunChat,
    url: null,
    pingPong: false,
    methods: [],
    peerChatProvider: null,
    listingHasReadme: false,
    listingTruncated: false,
    chatText: null,
    chatFinishReason: null,
    chatHasTraceId: false,
  };

  try {
    started = await withTimeout(
      startServer({
        port: 0,
        host: '127.0.0.1',
        authEnabled: true,
        websocketEnabled: true,
        rateLimit: false,
      }),
      15_000,
      'startServer',
    );

    const address = started.server.address();
    result.url = `ws://127.0.0.1:${address.port}/ws`;

    const { key } = createApiKey({
      name: 'Fleet loopback smoke',
      userId: 'fleet-loopback-smoke',
      scopes: ['admin'],
      persist: false,
    });

    listener = new FleetListener({
      url: result.url,
      apiKey: key,
      authTimeoutMs: 5_000,
    });

    await withTimeout(listener.connect(), 10_000, 'listener.connect');

    const ping = await listener.request('peer.ping', {}, { timeoutMs: 5_000 });
    const describe = await listener.request('peer.describe', {}, { timeoutMs: 5_000 });
    const listing = await listener.invokeTool(
      'list_directory',
      { path: 'docs/reprise', limit: 20 },
      { timeoutMs: 5_000 },
    );

    result.pingPong = ping?.pong === true;
    result.methods = Array.isArray(describe?.methods)
      ? describe.methods
        .filter((method) => [
          'peer.ping',
          'peer.describe',
          'peer.chat',
          'peer.chat-stream',
          'peer.tool.invoke',
        ].includes(method))
        .sort()
      : [];
    result.peerChatProvider = describe?.peerChatProvider ?? null;
    result.listingHasReadme = String(listing.output || '').includes('README.md');
    result.listingTruncated = listing.truncated === true;

    if (shouldRunChat) {
      const chat = await listener.request(
        'peer.chat',
        { prompt: 'Reply exactly: Fleet peer chat OK.' },
        { timeoutMs: 180_000 },
      );
      result.chatText = chat?.text ?? null;
      result.chatFinishReason = chat?.finishReason ?? null;
      result.chatHasTraceId = typeof chat?.traceId === 'string' && chat.traceId.length > 0;
    }

    result.ok = result.pingPong
      && result.methods.includes('peer.chat')
      && result.methods.includes('peer.tool.invoke')
      && result.listingHasReadme
      && (!shouldRunChat || result.chatText === 'Fleet peer chat OK.');
  } finally {
    if (listener) await listener.disconnect().catch(() => {});
    if (started) {
      await withTimeout(stopServer(started.server), 10_000, 'stopServer').catch((error) => {
        result.stopError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  console.log(JSON.stringify(result, null, 2));
  await sleep(1_000);
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await sleep(1_000);
  process.exit(1);
});
