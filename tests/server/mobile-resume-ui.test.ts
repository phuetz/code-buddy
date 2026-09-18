// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../src/server/mobile/assets');

type MobileApi = {
  destroy: () => void;
  showMain: () => void;
  state: {
    ws: { readyState: number; send: (raw: string) => void } | null;
    resumeSessionId?: string;
    assistant?: string;
  };
  loadResumeSessions: () => Promise<Array<{ id: string; title: string }>>;
  openResumeSession: (id: string) => Promise<boolean>;
  sendText: (text: string) => boolean;
  currentChatPayload: (message: string) => Record<string, unknown>;
  getMessages: () => Array<{ role: string; text: string }>;
};

function asset(name: string): string {
  return readFileSync(path.join(assetsDir, name), 'utf8');
}

function extractBody(): string {
  const html = asset('index.html');
  const match = html.match(/<body>([\s\S]*)<\/body>/i);
  if (!match?.[1]) throw new Error('index.html has no body');
  return match[1].replace(/<script[\s\S]*?<\/script>/gi, '');
}

function mount(): MobileApi {
  document.body.innerHTML = extractBody();
  new Function(asset('emoji-data.js'))();
  new Function(asset('app.js'))();
  const api = (window as unknown as { CodeBuddyMobile: MobileApi }).CodeBuddyMobile;
  api.showMain();
  return api;
}

describe('Mobile Reprendre UI', () => {
  let sent: unknown[];
  let api: MobileApi;

  beforeEach(() => {
    sent = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sessions')) {
        return {
          ok: true,
          json: async () => ({
            sessions: [{
              id: 'session_cli_demo',
              title: 'Session CLI démo',
              origin: 'cli',
              updatedAt: '2026-09-17T10:00:00.000Z',
              createdAt: '2026-09-17T09:00:00.000Z',
              messageCount: 2,
            }],
          }),
        };
      }
      if (url.includes('/sessions/session_cli_demo')) {
        return {
          ok: true,
          json: async () => ({
            id: 'session_cli_demo',
            title: 'Session CLI démo',
            origin: 'cli',
            updatedAt: '2026-09-17T10:00:00.000Z',
            createdAt: '2026-09-17T09:00:00.000Z',
            messageCount: 2,
            messages: [
              { role: 'user', content: 'bonjour CLI', timestamp: '2026-09-17T09:00:00.000Z' },
              { role: 'assistant', content: 'réponse CLI', timestamp: '2026-09-17T09:00:01.000Z' },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }));
    api = mount();
    api.state.ws = {
      readyState: 1,
      send: (raw: string) => {
        sent.push(JSON.parse(raw));
      },
    };
  });

  afterEach(() => {
    api?.destroy();
    vi.unstubAllGlobals();
  });

  it('lists resume sessions and continues the same thread', async () => {
    expect(document.getElementById('resume-section')).not.toBeNull();
    expect(document.querySelector('[data-section="resume-section"]')?.textContent).toContain('Reprendre');

    const listed = await api.loadResumeSessions();
    expect(listed[0]?.id).toBe('session_cli_demo');
    expect(document.querySelector('[data-session-id="session_cli_demo"]')?.textContent).toContain('Session CLI démo');

    const opened = await api.openResumeSession('session_cli_demo');
    expect(opened).toBe(true);
    expect(api.state.resumeSessionId).toBe('session_cli_demo');
    expect(api.state.assistant).toBe('agent');
    expect(api.getMessages().map((row) => row.text)).toEqual(['bonjour CLI', 'réponse CLI']);
    expect(document.getElementById('chat-section')?.classList.contains('active')).toBe(true);

    expect(api.sendText('on continue')).toBe(true);
    const chat = sent.find((frame) => (frame as { type?: string }).type === 'chat') as {
      payload: { sessionId?: string; message?: string; assistant?: string };
    };
    expect(chat.payload.sessionId).toBe('session_cli_demo');
    expect(chat.payload.message).toBe('on continue');
    expect(chat.payload.assistant).toBe('agent');
  });
});
