import { describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../src/agent/types.js';
import {
  NO_TRY_PROVIDER_MESSAGE,
  TRY_DEMO_PROMPT,
  chooseOllamaModel,
  resolveTryProvider,
  runTryDemo,
  type TryProvider,
} from '../../src/commands/try.js';

const chatGptProvider: TryProvider = {
  kind: 'chatgpt',
  label: 'ChatGPT OAuth',
  apiKey: 'oauth-chatgpt',
  baseURL: 'https://chatgpt.com/backend-api/codex',
  model: 'gpt-5.6-sol',
};

describe('buddy try', () => {
  it('prefers a coding-oriented Ollama model while honoring an installed request', () => {
    const models = ['llama3.2:latest', 'qwen2.5-coder:7b', 'devstral:latest'];

    expect(chooseOllamaModel(models)).toBe('qwen2.5-coder:7b');
    expect(chooseOllamaModel(models, 'devstral:latest')).toBe('devstral:latest');
    expect(chooseOllamaModel([])).toBeNull();
  });

  it('uses ChatGPT OAuth before probing Ollama', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const provider = await resolveTryProvider({
      env: {},
      hasChatGptCredentials: () => true,
      fetchImpl,
    });

    expect(provider).toMatchObject(chatGptProvider);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('probes localhost and selects an installed Ollama model as the fallback', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      models: [{ name: 'llama3.2:latest' }, { name: 'qwen3-coder:30b' }],
    }), { status: 200 }));

    const provider = await resolveTryProvider({
      env: {},
      hasChatGptCredentials: () => false,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(provider).toMatchObject({
      kind: 'ollama',
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen3-coder:30b',
    });
  });

  it('explains login first and Ollama second when neither free provider is ready', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const createAgent = vi.fn();

    const exitCode = await runTryDemo({
      resolveProvider: async () => null,
      createAgent,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([NO_TRY_PROVIDER_MESSAGE]);
    expect(stderr[0]!.indexOf('buddy login')).toBeLessThan(stderr[0]!.indexOf('Ollama'));
    expect(NO_TRY_PROVIDER_MESSAGE).toContain('ollama serve');
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('runs the scripted agent in an isolated workspace and verifies its test', async () => {
    const stdout: string[] = [];
    const dispose = vi.fn();
    const entries: ChatEntry[] = [
      {
        type: 'tool_call',
        content: 'write',
        timestamp: new Date(),
        toolCall: {
          id: 'call_1',
          type: 'function',
          function: { name: 'write_file', arguments: '{}' },
        },
      },
      {
        type: 'assistant',
        content: 'Two files created, tests green.',
        timestamp: new Date(),
      },
    ];
    const processUserMessage = vi.fn(async () => entries);
    const createAgent = vi.fn(async () => ({
      systemPromptReady: Promise.resolve(),
      processUserMessage,
      dispose,
    }));
    const verify = vi.fn(async () => ({ success: true, output: '# pass 4\n# fail 0' }));

    const exitCode = await runTryDemo({
      resolveProvider: async () => chatGptProvider,
      createWorkspace: async () => '/tmp/code-buddy-try-test',
      createAgent,
      verify,
      stdout: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(0);
    expect(createAgent).toHaveBeenCalledWith(chatGptProvider, '/tmp/code-buddy-try-test');
    expect(processUserMessage).toHaveBeenCalledWith(TRY_DEMO_PROMPT, { surface: 'cli' });
    expect(verify).toHaveBeenCalledWith('/tmp/code-buddy-try-test');
    expect(stdout.join('\n')).toContain('Tools used: write_file');
    expect(stdout.join('\n')).toContain('✅ Demo succeeded');
    expect(dispose).toHaveBeenCalledWith({ skipSessionLearning: true });
  });

  it('fait taire la télémétrie pendant la démo, et restaure le niveau ensuite', async () => {
    // `try` est la première commande qu'un nouvel utilisateur lance : la télémétrie de l'agent
    // noyait les huit lignes qui racontent la démo. Le silence est donc le défaut de la CLI.
    const precedentEnv = process.env.LOG_LEVEL;
    const { logger } = await import('../../src/utils/logger.js');
    const precedentLogger = logger.getLevel();
    process.env.LOG_LEVEL = 'warn';
    logger.setLevel('warn');
    const niveauPendantLaDemo: Array<string | undefined> = [];

    try {
      await runTryDemo({
        verbose: false,
        resolveProvider: async () => chatGptProvider,
        createWorkspace: async () => '/tmp/code-buddy-try-test',
        createAgent: async () => ({
          systemPromptReady: Promise.resolve(),
          processUserMessage: async () => {
            niveauPendantLaDemo.push(logger.getLevel());
            return [];
          },
          dispose: vi.fn(),
        }),
        verify: async () => ({ success: true, output: '# pass 1' }),
        stdout: () => {},
      });

      // On vérifie le NIVEAU EFFECTIF du logger, pas la variable d'environnement : le logger
      // est un singleton qui lit `LOG_LEVEL` à l'import, donc poser la variable ne l'affecte
      // pas. Un test qui regardait la variable passait au vert pendant que la démo restait
      // bavarde — mesuré : 15 lignes de télémétrie survivaient.
      expect(niveauPendantLaDemo).toEqual(['error']);
      expect(process.env.LOG_LEVEL).toBe('warn');
      expect(logger.getLevel()).toBe('warn');
    } finally {
      logger.setLevel(precedentLogger);
      if (precedentEnv === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = precedentEnv;
    }
  });

  it("restaure l'environnement si l'installation du silence échoue", async () => {
    const precedentEnv = process.env.LOG_LEVEL;
    const { logger } = await import('../../src/utils/logger.js');
    const precedentLogger = logger.getLevel();
    process.env.LOG_LEVEL = 'debug';
    logger.setLevel('debug');
    const getLevel = vi.spyOn(logger, 'getLevel').mockImplementationOnce(() => {
      throw new Error('échec installation logger');
    });

    try {
      await expect(runTryDemo({ verbose: false })).rejects.toThrow('échec installation logger');
      expect(process.env.LOG_LEVEL).toBe('debug');
      expect(logger.getLevel()).toBe('debug');
    } finally {
      getLevel.mockRestore();
      logger.setLevel(precedentLogger);
      if (precedentEnv === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = precedentEnv;
    }
  });

  it("préserve le niveau d'un appelant programmatique qui omet verbose", async () => {
    const precedentEnv = process.env.LOG_LEVEL;
    const { logger } = await import('../../src/utils/logger.js');
    const precedentLogger = logger.getLevel();
    const niveauAppelant = 'warn';
    process.env.LOG_LEVEL = niveauAppelant;
    logger.setLevel(niveauAppelant);
    const niveauxPendantLaDemo: string[] = [];

    try {
      await runTryDemo({
        resolveProvider: async () => chatGptProvider,
        createWorkspace: async () => '/tmp/code-buddy-try-test',
        createAgent: async () => ({
          systemPromptReady: Promise.resolve(),
          processUserMessage: async () => {
            niveauxPendantLaDemo.push(logger.getLevel());
            return [];
          },
          dispose: vi.fn(),
        }),
        verify: async () => ({ success: true, output: '# pass 1' }),
        stdout: () => {},
      });

      expect(niveauxPendantLaDemo).toEqual([niveauAppelant]);
      expect(process.env.LOG_LEVEL).toBe(niveauAppelant);
      expect(logger.getLevel()).toBe(niveauAppelant);
    } finally {
      logger.setLevel(precedentLogger);
      if (precedentEnv === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = precedentEnv;
    }
  });

  it('laisse passer la télémétrie quand on la demande explicitement', async () => {
    const precedentEnv = process.env.LOG_LEVEL;
    const { logger } = await import('../../src/utils/logger.js');
    const precedentLogger = logger.getLevel();
    const niveauAppelant = 'debug';
    process.env.LOG_LEVEL = niveauAppelant;
    logger.setLevel(niveauAppelant);
    const niveauPendantLaDemo: Array<string | undefined> = [];

    try {
      await runTryDemo({
        verbose: true,
        resolveProvider: async () => chatGptProvider,
        createWorkspace: async () => '/tmp/code-buddy-try-test',
        createAgent: async () => ({
          systemPromptReady: Promise.resolve(),
          processUserMessage: async () => {
            niveauPendantLaDemo.push(logger.getLevel());
            return [];
          },
          dispose: vi.fn(),
        }),
        verify: async () => ({ success: true, output: '# pass 1' }),
        stdout: () => {},
      });

      expect(niveauPendantLaDemo).toEqual([niveauAppelant]);
      expect(process.env.LOG_LEVEL).toBe(niveauAppelant);
      expect(logger.getLevel()).toBe(niveauAppelant);
    } finally {
      logger.setLevel(precedentLogger);
      if (precedentEnv === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = precedentEnv;
    }
  });

  it('honore un endpoint impose plutot que le fournisseur auto-detecte', async () => {
    const provider = await resolveTryProvider({
      env: {} as NodeJS.ProcessEnv,
      // Des identifiants ChatGPT sont presents : sans respect de l'override,
      // la demo partait dans le cloud en annoncant un succes.
      hasChatGptCredentials: () => true,
      baseUrlOverride: 'http://darkstar:11434/v1',
      modelOverride: 'qwen3.8:27b',
    });

    expect(provider?.baseURL).toBe('http://darkstar:11434/v1');
    expect(provider?.model).toBe('qwen3.8:27b');
    expect(provider?.kind).not.toBe('chatgpt');
  });

  it('interroge l endpoint impose quand aucun modele n est precise', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: 'ornith-1.5:35b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const provider = await resolveTryProvider({
      env: {} as NodeJS.ProcessEnv,
      hasChatGptCredentials: () => true,
      baseUrlOverride: 'http://darkstar:11434/v1/',
      fetchImpl,
    });

    expect(provider?.model).toBe('ornith-1.5:35b');
    // la barre oblique finale ne doit pas se retrouver dans l'URL construite
    expect(provider?.baseURL).toBe('http://darkstar:11434/v1');
  });

});
