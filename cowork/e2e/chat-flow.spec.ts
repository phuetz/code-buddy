import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

type ChatRequest = {
  model?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  stream?: boolean;
};

type ReceivedRequest = {
  url: string;
  body: ChatRequest;
};

async function readJsonRequest(request: IncomingMessage): Promise<ChatRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

async function startLocalOpenAiServer(): Promise<{
  server: Server;
  baseUrl: string;
  requests: ReceivedRequest[];
}> {
  const requests: ReceivedRequest[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    try {
      const body = await readJsonRequest(request);
      requests.push({ url: request.url, body });
      const prompt = [...(body.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'user');
      const reply = `LOCAL-OPENAI-E2E: ${contentText(prompt?.content)}`;
      const created = Math.floor(Date.now() / 1000);
      const id = `chatcmpl-local-${requests.length}`;

      if (body.stream === false) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: body.model ?? 'local-e2e-model',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
        }));
        return;
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model: body.model ?? 'local-e2e-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model: body.model ?? 'local-e2e-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
      })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        error: { message: error instanceof Error ? error.message : String(error) },
      }));
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  expect(address.port).toBeGreaterThan(3100);
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
  };
}

async function stopServer(server: Server): Promise<void> {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

async function configureLocalProvider(appPage: Page, baseUrl: string): Promise<void> {
  await appPage.evaluate(async ({ localBaseUrl }) => {
    localStorage.setItem('cowork.tourSeen', '1');
    const current = await window.electronAPI.config.get();
    const saved = await window.electronAPI.config.save({
      provider: 'ollama',
      customProtocol: 'openai',
      activeProfileKey: 'ollama',
      profiles: {
        ...current.profiles,
        ollama: {
          apiKey: '',
          baseUrl: localBaseUrl,
          model: 'local-e2e-model',
        },
      },
      apiKey: '',
      baseUrl: localBaseUrl,
      model: 'local-e2e-model',
      onboardingCompleted: true,
    });
    if (!saved.success) {
      throw new Error(saved.error ?? 'Could not configure the local e2e provider');
    }
  }, { localBaseUrl: baseUrl });
  await appPage.reload();
  await expect(appPage.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
}

function visibleComposer(appPage: Page) {
  return appPage.locator(
    '[data-testid="home-input"]:visible, [data-testid="welcome-prompt-input"]:visible, [data-testid="chat-prompt-input"]:visible',
  ).first();
}

test('renders two consecutive chat replies from a local OpenAI-compatible server', async ({ appPage }) => {
  test.setTimeout(120_000);
  const localServer = await startLocalOpenAiServer();

  try {
    await configureLocalProvider(appPage, localServer.baseUrl);

    const initialPrompt = 'Initial local server chat proof';
    const initialReply = `LOCAL-OPENAI-E2E: ${initialPrompt}`;
    await visibleComposer(appPage).fill(initialPrompt);
    await visibleComposer(appPage).press('Enter');

    await expect(appPage.getByText(initialPrompt, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(appPage.getByText(initialReply, { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => localServer.requests.filter(
      (request) => JSON.stringify(request.body).includes(initialPrompt),
    ).length).toBeGreaterThan(0);
    const initialRequest = localServer.requests.find(
      (request) => JSON.stringify(request.body).includes(initialPrompt),
    );
    expect(initialRequest?.url).toBe('/v1/chat/completions');

    const followUpPrompt = 'Second local server chat proof';
    const followUpReply = `LOCAL-OPENAI-E2E: ${followUpPrompt}`;
    const followUpComposer = visibleComposer(appPage);
    await expect(followUpComposer).toBeVisible({ timeout: 20_000 });
    await followUpComposer.fill(followUpPrompt);
    await followUpComposer.press('Enter');

    await expect(appPage.getByText(followUpPrompt, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(appPage.getByText(followUpReply, { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(appPage.getByText(initialReply, { exact: false })).toBeVisible();
    await expect.poll(() => localServer.requests.filter(
      (request) => JSON.stringify(request.body).includes(followUpPrompt),
    ).length).toBeGreaterThan(0);

    const screenshotPath = process.env.COWORK_E17_CHAT_SCREENSHOT?.trim();
    if (screenshotPath) {
      await appPage.screenshot({ path: screenshotPath, fullPage: true });
    }
  } finally {
    await stopServer(localServer.server);
  }
});
