import fetch from 'node-fetch';
import { spawn } from 'child_process';

const port = 3300 + Math.floor(Math.random() * 500);
const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error('API_KEY not found. Please set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.');
  process.exit(1);
}

const serverProcess = spawn('node', ['server.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProcess.stdout.on('data', (data) => {
  console.log(`Server: ${data}`);
});

serverProcess.stderr.on('data', (data) => {
  console.error(`Server Error: ${data}`);
});

const runSmokeTest = async () => {
  console.log('Running smoke test...');

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // Test /health endpoint
    const healthResponse = await fetch(`http://localhost:${port}/health`);
    if (healthResponse.status !== 200) {
      throw new Error(`Health check failed with status ${healthResponse.status}`);
    }
    console.log('Health check passed.');

    // Test /api/chat endpoint
    const chatResponse = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello, what is your purpose?' }),
    });

    const chatData = await chatResponse.json();

    if (!chatResponse.ok || !chatData.response) {
      throw new Error(`Chat API failed: ${chatData.error || 'No response'}`);
    }
    console.log('Chat API test passed.');
    console.log('Smoke test successful!');
    process.exitCode = 0;
  } catch (error) {
    console.error('Smoke test failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (!serverProcess.killed) {
      serverProcess.kill();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    process.exit(process.exitCode ?? 0);
  }
};

runSmokeTest();
