/**
 * Un appel auxiliaire de fin de session ne doit pas quitter le fournisseur
 * choisi pour la session, même si un login ChatGPT est présent sur la machine.
 *
 * Avant le correctif, `proposeLessonsFromSession` sans client appelle
 * `detectProviderFromEnv()` et part vers chatgpt.com / gpt-6-sol.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBuddyClient, type CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { proposeLessonsFromSession } from '../../src/agent/lesson-auto-proposer.js';
import { runSessionEndFlush } from '../../src/agent/session-end-flush.js';
import { proposeMemoryCandidatesFromSession } from '../../src/memory/memory-auto-proposer.js';
import {
  clearSessionLlmRouteIfMatches,
  setSessionLlmRoute,
} from '../../src/providers/session-llm-route.js';
import type { ChatEntry } from '../../src/agent/types.js';

const SESSION_URL = 'https://openrouter.ai/api/v1';
const SESSION_MODEL = 'deepseek/deepseek-v4.1-flash';
const MARKER = 'MARQUEUR-TRANSCRIPT-9f3c-aux';

interface CapturedCall {
  baseURL: string;
  model: string;
  system: string;
  user: string;
}

const calls: CapturedCall[] = [];
let workDir = '';

function textOf(content: CodeBuddyMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : ''))
      .join('\n');
  }
  return '';
}

function history(): ChatEntry[] {
  return [
    {
      type: 'user',
      content: `Note le fait durable suivant : ${MARKER}. Le dépôt utilise Vitest.`,
      timestamp: new Date(),
    },
    { type: 'assistant', content: 'Première réponse de la session.', timestamp: new Date() },
    { type: 'assistant', content: 'Deuxième réponse, la session n’est plus triviale.', timestamp: new Date() },
  ];
}

function writeFakeOAuth(): void {
  const dir = path.join(os.homedir(), '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'faux-jeton-de-test' } }),
  );
}

function publishSession(): void {
  setSessionLlmRoute({
    apiKey: 'sk-test-session',
    model: SESSION_MODEL,
    baseURL: SESSION_URL,
    provider: 'grok',
  });
}

describe('fournisseur auxiliaire = session, jamais ChatGPT par défaut', () => {
  beforeEach(() => {
    calls.length = 0;
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-aux-session-'));
    writeFakeOAuth();
    publishSession();
    vi.spyOn(CodeBuddyClient.prototype, 'chat').mockImplementation(async function (
      this: CodeBuddyClient,
      messages: CodeBuddyMessage[],
    ) {
      const system = messages.find((message) => message.role === 'system');
      const user = messages.find((message) => message.role === 'user');
      calls.push({
        baseURL: this.getBaseURL(),
        model: this.getCurrentModel(),
        system: system ? textOf(system.content) : '',
        user: user ? textOf(user.content) : '',
      });
      return { choices: [{ message: { content: '[]' } }] } as Awaited<ReturnType<CodeBuddyClient['chat']>>;
    });
  });

  afterEach(() => {
    clearSessionLlmRouteIfMatches(SESSION_URL, 'sk-test-session');
    setSessionLlmRoute(null);
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_LOCAL_ONLY;
    delete process.env.CODEBUDDY_LLM_LOCAL_ONLY;
    delete process.env.CODEBUDDY_AUXILIARY_LESSONS_PROVIDER;
    delete process.env.CODEBUDDY_AUXILIARY_LESSONS_MODEL;
    delete process.env.CODEBUDDY_AUXILIARY_LESSONS_BASE_URL;
    delete process.env.CODEBUDDY_AUXILIARY_LESSONS_API_KEY;
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('envoie l’extraction de leçons au modèle de la session, transcript inclus', async () => {
    await proposeLessonsFromSession(history(), workDir);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.baseURL).toBe(SESSION_URL);
    expect(calls[0]?.model).toBe(SESSION_MODEL);
    expect(calls[0]?.baseURL).not.toContain('chatgpt.com');
    expect(calls[0]?.model).not.toBe('gpt-6-sol');
    expect(calls[0]?.system).toContain('REUSABLE PROCEDURAL LESSONS');
    expect(calls[0]?.user).toContain(MARKER);
  });

  it('envoie aussi l’extraction de mémoire au même fournisseur sous Vitest', async () => {
    expect(process.env.VITEST).toBeTruthy();
    await proposeMemoryCandidatesFromSession(history(), workDir);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.baseURL).toBe(SESSION_URL);
    expect(calls[0]?.model).toBe(SESSION_MODEL);
    expect(calls[0]?.system).toContain('durable declarative long-term memory');
    expect(calls[0]?.user).toContain(MARKER);
  });

  it('n’appelle aucun fournisseur cloud quand CODEBUDDY_LOCAL_ONLY est actif', async () => {
    process.env.CODEBUDDY_LOCAL_ONLY = 'true';
    await proposeLessonsFromSession(history(), workDir);
    await proposeMemoryCandidatesFromSession(history(), workDir);

    expect(calls).toHaveLength(0);
  });

  it('honore un fournisseur explicite pour le rôle leçons', async () => {
    process.env.CODEBUDDY_AUXILIARY_LESSONS_PROVIDER = 'openrouter';
    process.env.CODEBUDDY_AUXILIARY_LESSONS_MODEL = 'meta-llama/llama-3.1-8b-instruct';
    process.env.CODEBUDDY_AUXILIARY_LESSONS_BASE_URL = 'http://127.0.0.1:9/v1';
    process.env.CODEBUDDY_AUXILIARY_LESSONS_API_KEY = 'sk-role-lessons';

    await proposeLessonsFromSession(history(), workDir);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.baseURL).toBe('http://127.0.0.1:9/v1');
    expect(calls[0]?.model).toBe('meta-llama/llama-3.1-8b-instruct');
    expect(calls[0]?.user).toContain(MARKER);
  });

  it('échoue fermé si le fournisseur de rôle n’est pas configuré', async () => {
    process.env.CODEBUDDY_AUXILIARY_LESSONS_PROVIDER = 'fournisseur-inexistant';
    await proposeLessonsFromSession(history(), workDir);
    expect(calls).toHaveLength(0);
  });

  it('laisse ChatGPT ambiant quand c’est le seul login et qu’aucune session n’est publiée', async () => {
    setSessionLlmRoute(null);
    await proposeLessonsFromSession(history(), workDir);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.baseURL).toContain('chatgpt.com');
    expect(calls[0]?.model).toBe('gpt-6-sol');
    expect(calls[0]?.user).toContain(MARKER);
  });

  it('bloque ChatGPT ambiant quand CODEBUDDY_LOCAL_ONLY est actif', async () => {
    setSessionLlmRoute(null);
    process.env.CODEBUDDY_LOCAL_ONLY = 'true';
    await proposeLessonsFromSession(history(), workDir);
    expect(calls).toHaveLength(0);
  });

  it('ne bascule pas le juge gpt-5.5 vers ChatGPT quand le mode local est actif', async () => {
    process.env.CODEBUDDY_LOCAL_ONLY = 'true';
    const { shouldUseStandaloneChatGptJudge } = await import('../../src/goals/goal-judge-client.js');
    expect(shouldUseStandaloneChatGptJudge('gpt-5.5', {
      apiKey: 'sk-test-session',
      baseURL: SESSION_URL,
      providerLabel: 'grok',
    })).toBe(false);
  });

  it('un client cloud injecté ne contourne pas CODEBUDDY_LOCAL_ONLY', async () => {
    process.env.CODEBUDDY_LOCAL_ONLY = 'true';
    const injected = new CodeBuddyClient('sk-test-session', SESSION_MODEL, SESSION_URL, {
      enableFallbacks: false,
    });

    await proposeLessonsFromSession(history(), workDir, injected);
    await proposeMemoryCandidatesFromSession(history(), workDir, injected);
    await runSessionEndFlush({ chatHistory: history(), workDir, client: injected });

    expect(calls).toHaveLength(0);
  });

  it('un rôle explicite prime sur le client injecté, même s’il pointe vers ChatGPT', async () => {
    process.env.CODEBUDDY_AUXILIARY_LESSONS_PROVIDER = 'openrouter';
    process.env.CODEBUDDY_AUXILIARY_LESSONS_MODEL = 'meta-llama/llama-3.1-8b-instruct';
    process.env.CODEBUDDY_AUXILIARY_LESSONS_BASE_URL = 'http://127.0.0.1:9/v1';
    process.env.CODEBUDDY_AUXILIARY_LESSONS_API_KEY = 'sk-role-lessons';
    const injected = new CodeBuddyClient('oauth-chatgpt', 'gpt-6-sol', 'https://chatgpt.com/backend-api/codex', {
      enableFallbacks: false,
    });

    await proposeLessonsFromSession(history(), workDir, injected);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.baseURL).toBe('http://127.0.0.1:9/v1');
    expect(calls[0]?.model).toBe('meta-llama/llama-3.1-8b-instruct');
    expect(calls[0]?.baseURL).not.toContain('chatgpt.com');
    expect(calls[0]?.user).toContain(MARKER);
  });

  it('fait partir le flush de fin de session (leçons et mémoire) vers la session', async () => {
    await runSessionEndFlush({ chatHistory: history(), workDir });

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.baseURL === SESSION_URL && call.model === SESSION_MODEL)).toBe(true);
    expect(calls.map((call) => call.system).join('\n')).toContain('REUSABLE PROCEDURAL LESSONS');
    expect(calls.map((call) => call.system).join('\n')).toContain('durable declarative long-term memory');
    expect(calls.every((call) => call.user.includes(MARKER))).toBe(true);
    expect(calls.some((call) => call.baseURL.includes('chatgpt.com'))).toBe(false);
  });
});
