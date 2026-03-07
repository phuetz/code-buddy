import { spawn } from 'child_process';

const port = 3333;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/gemini-chatbox/server.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

function waitForServer(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), timeoutMs);
    const onData = (chunk) => {
      const text = String(chunk);
      if (text.includes('Gemini Chatbox running')) {
        clearTimeout(timer);
        server.stdout.off('data', onData);
        resolve(undefined);
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (text.trim()) console.error(text.trim());
    });
  });
}

async function run() {
  try {
    await waitForServer();

    const healthResponse = await fetch(`${baseUrl}/health`);
    if (!healthResponse.ok) throw new Error(`Health check failed: ${healthResponse.status}`);
    const health = await healthResponse.json();
    if (!health.ok) throw new Error('Health payload invalid');

    const pageResponse = await fetch(baseUrl);
    if (!pageResponse.ok) throw new Error(`Home page failed: ${pageResponse.status}`);
    const html = await pageResponse.text();
    if (!html.includes('Gemini Chatbox')) throw new Error('Home page content invalid');

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Réponds avec exactement "OK_GEMINI_REAL_TEST".',
        history: [],
      }),
    });
    if (!chatResponse.ok) {
      const details = await chatResponse.text();
      throw new Error(`Chat request failed ${chatResponse.status}: ${details}`);
    }

    const chat = await chatResponse.json();
    if (!chat.reply || typeof chat.reply !== 'string') {
      throw new Error('Chat reply missing');
    }

    console.log('Health:', health);
    console.log('Chat reply preview:', chat.reply.slice(0, 200));
    console.log('Smoke test passed');
    process.exitCode = 0;
  } catch (error) {
    console.error('Smoke test failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (!server.killed) {
      server.kill();
    }
  }
}

run();
