/**
 * TurboQuantProvider — unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TurboQuantProvider,
  createTurboQuantProvider,
} from '@/providers/turboquant-provider.js';
import type { TurboQuantProviderConfig } from '@/providers/turboquant-provider.js';
import type { CodeBuddyMessage } from '@/codebuddy/client.js';

// ---------------------------------------------------------------------------
// Shared config factory
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<TurboQuantProviderConfig>): TurboQuantProviderConfig {
  return {
    vllmEndpoint: 'http://vllm.local:8000',
    ollamaEndpoint: 'http://ollama.local:11434',
    turboquant: {
      enabled: true,
      nbits: 4,
      residualLength: 128,
      mode: 'mse',
      rotation: 'walsh_hadamard',
      skipLayers: 'auto',
    },
    modelRouting: {
      lightweight: 'llama3.2',
      heavy: 'qwen2.5-72b',
      complexityThreshold: 'auto',
    },
    ...overrides,
  };
}

const SHORT_MESSAGES: CodeBuddyMessage[] = [
  { role: 'user', content: 'Hello!' },
];

const LONG_MESSAGES: CodeBuddyMessage[] = [
  {
    role: 'user',
    content: 'A'.repeat(5000), // ~1250 tokens — well above AUTO threshold of 800
  },
];

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(responseData: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Internal Server Error',
      json: () => Promise.resolve(responseData),
      body: null,
    })
  );
}

function mockFetchStream(bodyText: string, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Internal Server Error',
      json: () => Promise.resolve({}),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(bodyText));
          controller.close();
        },
      }),
    })
  );
}

function mockFetchError(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

async function collectStream(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------

describe('TurboQuantProvider — routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes short messages to Ollama', async () => {
    const ollamaResponse = {
      message: { role: 'assistant', content: 'Hi there' },
      done: true,
      prompt_eval_count: 5,
      eval_count: 3,
    };
    mockFetch(ollamaResponse);

    const provider = new TurboQuantProvider(makeConfig());
    await provider.chat(SHORT_MESSAGES);

    const url = (vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(url).toContain('/api/chat');
    expect(url).toContain('ollama.local');
  });

  it('routes long messages to vLLM', async () => {
    const vllmResponse = {
      choices: [{ message: { role: 'assistant', content: 'Long answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1250, completion_tokens: 10, total_tokens: 1260 },
    };
    mockFetch(vllmResponse);

    const provider = new TurboQuantProvider(makeConfig());
    await provider.chat(LONG_MESSAGES);

    const url = (vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(url).toContain('/v1/chat/completions');
    expect(url).toContain('vllm.local');
  });

  it('always routes to Ollama when vllmEndpoint is absent', async () => {
    const ollamaResponse = {
      message: { role: 'assistant', content: 'ok' },
      done: true,
      prompt_eval_count: 0,
      eval_count: 0,
    };
    mockFetch(ollamaResponse);

    const provider = new TurboQuantProvider(
      makeConfig({ vllmEndpoint: undefined })
    );
    await provider.chat(LONG_MESSAGES);

    const url = (vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(url).toContain('/api/chat');
  });

  it('always routes to vLLM when lightweight model is empty', async () => {
    const vllmResponse = {
      choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    mockFetch(vllmResponse);

    const provider = new TurboQuantProvider(
      makeConfig({ modelRouting: { lightweight: '', heavy: 'qwen2.5-72b', complexityThreshold: 'auto' } })
    );
    await provider.chat(SHORT_MESSAGES);

    const url = (vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(url).toContain('/v1/chat/completions');
  });

  it('uses numeric complexityThreshold for routing', async () => {
    const ollamaResponse = {
      message: { role: 'assistant', content: 'ok' },
      done: true,
      prompt_eval_count: 0,
      eval_count: 0,
    };
    mockFetch(ollamaResponse);

    // threshold=99999 → short messages still go to Ollama
    const provider = new TurboQuantProvider(
      makeConfig({ modelRouting: { lightweight: 'llama3.2', heavy: 'qwen2.5-72b', complexityThreshold: 99999 } })
    );
    await provider.chat(LONG_MESSAGES);

    const url = (vi.mocked(fetch).mock.calls[0]![0] as string);
    expect(url).toContain('/api/chat');
  });
});

// ---------------------------------------------------------------------------
// Ollama response formatting
// ---------------------------------------------------------------------------

describe('TurboQuantProvider — Ollama response', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('formats Ollama response into CodeBuddyResponse', async () => {
    mockFetch({
      message: { role: 'assistant', content: 'Hello from Ollama' },
      done: true,
      prompt_eval_count: 10,
      eval_count: 5,
    });

    const provider = new TurboQuantProvider(makeConfig());
    const result = await provider.chat(SHORT_MESSAGES);

    expect(result.choices).toHaveLength(1);
    expect(result.choices[0]!.message.content).toBe('Hello from Ollama');
    expect(result.choices[0]!.message.role).toBe('assistant');
    expect(result.choices[0]!.finish_reason).toBe('stop');
    expect(result.usage?.prompt_tokens).toBe(10);
    expect(result.usage?.completion_tokens).toBe(5);
    expect(result.usage?.total_tokens).toBe(15);
  });

  it('throws when Ollama message content is missing', async () => {
    mockFetch({ done: true });

    const provider = new TurboQuantProvider(makeConfig());
    await expect(provider.chat(SHORT_MESSAGES)).rejects.toThrow(
      'Ollama returned empty response content'
    );
  });

  it('throws when Ollama message content is blank', async () => {
    mockFetch({
      message: { role: 'assistant', content: '   ' },
      done: true,
      prompt_eval_count: 1,
      eval_count: 1,
    });

    const provider = new TurboQuantProvider(makeConfig());
    await expect(provider.chat(SHORT_MESSAGES)).rejects.toThrow(
      'Ollama returned empty response content'
    );
  });

  it('throws on Ollama HTTP error', async () => {
    mockFetch({}, false, 500);

    const provider = new TurboQuantProvider(makeConfig({ vllmEndpoint: undefined }));
    await expect(provider.chat(SHORT_MESSAGES)).rejects.toThrow('Ollama API error: 500');
  });
});

// ---------------------------------------------------------------------------
// vLLM response formatting
// ---------------------------------------------------------------------------

describe('TurboQuantProvider — vLLM response', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('formats vLLM response into CodeBuddyResponse', async () => {
    mockFetch({
      choices: [
        { message: { role: 'assistant', content: 'Hello from vLLM' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    });

    const provider = new TurboQuantProvider(makeConfig());
    const result = await provider.chat(LONG_MESSAGES);

    expect(result.choices[0]!.message.content).toBe('Hello from vLLM');
    expect(result.choices[0]!.finish_reason).toBe('stop');
    expect(result.usage?.total_tokens).toBe(28);
  });

  it('throws when vLLM returns no content without tool calls', async () => {
    mockFetch({
      choices: [
        { message: { role: 'assistant', content: null }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
    });

    const provider = new TurboQuantProvider(makeConfig());
    await expect(provider.chat(LONG_MESSAGES)).rejects.toThrow(
      'vLLM returned empty response content'
    );
  });

  it('throws when vLLM omits choices', async () => {
    mockFetch({ usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 } });

    const provider = new TurboQuantProvider(makeConfig());
    await expect(provider.chat(LONG_MESSAGES)).rejects.toThrow(
      'vLLM returned empty response content'
    );
  });

  it('includes tool_calls in vLLM response when present', async () => {
    mockFetch({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"foo.ts"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    });

    const provider = new TurboQuantProvider(makeConfig());
    const result = await provider.chat(LONG_MESSAGES);

    const tc = result.choices[0]!.message.tool_calls;
    expect(tc).toHaveLength(1);
    expect(tc![0]!.id).toBe('call_abc');
    expect(tc![0]!.function.name).toBe('read_file');
    expect(result.choices[0]!.message.content).toBeNull();
  });

  it('throws on vLLM HTTP error', async () => {
    mockFetch({}, false, 503);

    const provider = new TurboQuantProvider(makeConfig());
    await expect(provider.chat(LONG_MESSAGES)).rejects.toThrow('vLLM API error: 503');
  });
});

// ---------------------------------------------------------------------------
// Streaming response formatting
// ---------------------------------------------------------------------------

describe('TurboQuantProvider — streaming response', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams Ollama tokens when content is present', async () => {
    mockFetchStream(
      [
        JSON.stringify({ message: { role: 'assistant', content: 'Hel' } }),
        JSON.stringify({ message: { role: 'assistant', content: 'lo' }, done: true }),
        '',
      ].join('\n')
    );

    const provider = new TurboQuantProvider(makeConfig());
    await expect(collectStream(provider.chatStream(SHORT_MESSAGES))).resolves.toEqual([
      'Hel',
      'lo',
    ]);
  });

  it('throws when Ollama streaming returns no content', async () => {
    mockFetchStream(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`);

    const provider = new TurboQuantProvider(makeConfig());
    await expect(collectStream(provider.chatStream(SHORT_MESSAGES))).rejects.toThrow(
      'Ollama returned empty response content'
    );
  });

  it('throws when vLLM streaming returns no content', async () => {
    mockFetchStream('data: {"choices":[{"delta":{"content":""}}]}\n\ndata: [DONE]\n\n');

    const provider = new TurboQuantProvider(makeConfig());
    await expect(collectStream(provider.chatStream(LONG_MESSAGES))).rejects.toThrow(
      'vLLM returned empty response content'
    );
  });
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe('TurboQuantProvider — isAvailable', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns true when Ollama is reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('ollama')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.reject(new Error('not reachable'));
      })
    );

    const provider = new TurboQuantProvider(makeConfig());
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns true when vLLM is reachable but Ollama is not', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes('vllm')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.reject(new Error('not reachable'));
      })
    );

    const provider = new TurboQuantProvider(makeConfig());
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns false when neither endpoint is reachable', async () => {
    mockFetchError('connection refused');

    const provider = new TurboQuantProvider(makeConfig());
    expect(await provider.isAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TurboQuant extra_body
// ---------------------------------------------------------------------------

describe('TurboQuantProvider — getTurboQuantExtraBody', () => {
  it('returns null when TurboQuant is disabled', () => {
    const provider = new TurboQuantProvider(
      makeConfig({ turboquant: { enabled: false, nbits: 4, residualLength: 128, mode: 'mse', rotation: 'walsh_hadamard', skipLayers: 'auto' } })
    );
    expect(provider.getTurboQuantExtraBody()).toBeNull();
  });

  it('returns quantization params when enabled', () => {
    const provider = new TurboQuantProvider(makeConfig());
    const body = provider.getTurboQuantExtraBody();
    expect(body).not.toBeNull();
    expect(body!['turboquant']).toMatchObject({
      nbits: 4,
      residual_length: 128,
      mode: 'mse',
      rotation: 'walsh_hadamard',
      skip_layers: null, // 'auto' maps to null
    });
  });

  it('passes explicit skipLayers array through', () => {
    const provider = new TurboQuantProvider(
      makeConfig({ turboquant: { enabled: true, nbits: 2, residualLength: 64, mode: 'prod', rotation: 'dense_gaussian', skipLayers: [0, 1, 31] } })
    );
    const body = provider.getTurboQuantExtraBody();
    expect(body!['turboquant']).toMatchObject({ skip_layers: [0, 1, 31] });
  });
});

// ---------------------------------------------------------------------------
// createTurboQuantProvider factory
// ---------------------------------------------------------------------------

describe('createTurboQuantProvider', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  it('returns null when no endpoints are configured', () => {
    delete process.env['TURBOQUANT_VLLM_ENDPOINT'];
    delete process.env['TURBOQUANT_OLLAMA_ENDPOINT'];
    delete process.env['OLLAMA_HOST'];
    expect(createTurboQuantProvider()).toBeNull();
  });

  it('returns a provider when TURBOQUANT_VLLM_ENDPOINT is set', () => {
    process.env['TURBOQUANT_VLLM_ENDPOINT'] = 'http://192.168.1.50:8000';
    const provider = createTurboQuantProvider();
    expect(provider).toBeInstanceOf(TurboQuantProvider);
  });

  it('returns a provider when OLLAMA_HOST is set', () => {
    delete process.env['TURBOQUANT_VLLM_ENDPOINT'];
    process.env['OLLAMA_HOST'] = 'http://localhost:11434';
    const provider = createTurboQuantProvider();
    expect(provider).toBeInstanceOf(TurboQuantProvider);
  });

  it('merges overrides into default config', () => {
    process.env['TURBOQUANT_VLLM_ENDPOINT'] = 'http://vllm:8000';
    const provider = createTurboQuantProvider({
      turboquant: { enabled: true, nbits: 2, residualLength: 64, mode: 'prod', rotation: 'dense_gaussian', skipLayers: [] },
    });
    expect(provider).toBeInstanceOf(TurboQuantProvider);
    // Verify nbits=2 is reflected in extra_body
    const body = provider!.getTurboQuantExtraBody();
    expect(body!['turboquant']).toMatchObject({ nbits: 2 });
  });
});

// ---------------------------------------------------------------------------
// Message normalization (multi-part content)
// ---------------------------------------------------------------------------

describe('TurboQuantProvider — message normalization', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('concatenates multi-part content parts', async () => {
    mockFetch({
      message: { role: 'assistant', content: 'ok' },
      done: true,
      prompt_eval_count: 0,
      eval_count: 0,
    });

    const provider = new TurboQuantProvider(makeConfig({ vllmEndpoint: undefined }));
    const messages: CodeBuddyMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ],
      },
    ];

    await provider.chat(messages);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string) as { messages: Array<{ content: string }> };
    expect(body.messages[0]!.content).toBe('Hello world');
  });
});
