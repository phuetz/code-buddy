import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLocalHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-local.js';
import { executeMixtureOfAgents } from '../../src/tools/mixture-of-agents-tool.js';
import { createMixtureOfAgentsTools } from '../../src/tools/registry/moa-tools.js';

interface RecordedRequest {
  authorization?: string;
  body: Record<string, unknown>;
  path: string;
}

let server: http.Server | undefined;
let baseUrl = '';
const requests: RecordedRequest[] = [];

describe('mixture_of_agents Hermes tool real HTTP path', () => {
  beforeEach(async () => {
    requests.length = 0;
    server = http.createServer(handleRequest);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
    server = undefined;
  });

  it('runs reference models over real HTTP, then aggregates their responses', async () => {
    const result = await executeMixtureOfAgents(
      { user_prompt: 'Find the safest migration plan.' },
      {
        apiKey: 'openrouter-test-token',
        baseUrl,
        referenceModels: ['ref-alpha', 'ref-beta'],
        aggregatorModel: 'agg-synth',
        maxRetries: 1,
        maxTokens: 256,
        timeoutMs: 10_000,
      },
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      response: string;
      models_used: { reference_models: string[]; aggregator_model: string };
      reference_results: Array<{ model: string; success: boolean }>;
    };
    expect(data.response).toBe('aggregated: ref-alpha says plan A | ref-beta says plan B');
    expect(data.models_used).toEqual({
      reference_models: ['ref-alpha', 'ref-beta'],
      aggregator_model: 'agg-synth',
    });
    expect(data.reference_results).toEqual([
      expect.objectContaining({ model: 'ref-alpha', success: true }),
      expect.objectContaining({ model: 'ref-beta', success: true }),
    ]);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.path === '/chat/completions')).toBe(true);
    expect(requests.every((request) => request.authorization === 'Bearer openrouter-test-token')).toBe(true);
    expect(requests.map((request) => request.body.model)).toEqual([
      'ref-alpha',
      'ref-beta',
      'agg-synth',
    ]);

    const aggregatorRequest = requests[2]!.body;
    expect(JSON.stringify(aggregatorRequest.messages)).toContain('ref-alpha says plan A');
    expect(JSON.stringify(aggregatorRequest.messages)).toContain('ref-beta says plan B');
    expect(aggregatorRequest.reasoning).toEqual({
      enabled: true,
      effort: 'low',
      exclude: true,
    });
  });

  it('assigns complementary use-case roles to simultaneous reference calls', async () => {
    const result = await executeMixtureOfAgents(
      { user_prompt: 'Review this patch.', use_case: 'code' },
      {
        apiKey: 'openrouter-test-token',
        baseUrl,
        referenceModels: ['ref-alpha', 'ref-beta'],
        aggregatorModel: 'agg-synth',
        maxRetries: 1,
      },
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      use_case: string;
      reference_results: Array<{ role: string }>;
    };
    expect(data.use_case).toBe('code');
    expect(data.reference_results[0]?.role).toContain('Architecte logiciel');
    expect(data.reference_results[1]?.role).toContain('Implémenteur');
    expect(JSON.stringify(requests[0]?.body.messages)).toContain('Architecte logiciel');
    expect(JSON.stringify(requests[1]?.body.messages)).toContain('Implémenteur');
  });

  it('uses a parallel redundancy race without a serial aggregator in the fast profile', async () => {
    const result = await executeMixtureOfAgents(
      { user_prompt: 'Answer quickly.', use_case: 'fast' },
      {
        apiKey: 'openrouter-test-token',
        baseUrl,
        referenceModels: ['ref-alpha', 'ref-beta'],
        aggregatorModel: 'agg-synth',
        maxRetries: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        use_case: 'fast',
        aggregation_skipped: true,
      }),
    );
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.body.model)).toEqual(['ref-alpha', 'ref-beta']);
  });

  it('returns the best reference with provenance when the free aggregator is unavailable', async () => {
    const result = await executeMixtureOfAgents(
      { user_prompt: 'Keep useful work when synthesis is down.' },
      {
        apiKey: 'openrouter-test-token',
        baseUrl,
        referenceModels: ['ref-alpha'],
        aggregatorModel: 'agg-fail',
        maxRetries: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        response: 'ref-alpha says plan A',
        aggregation_degraded: true,
        error: expect.stringContaining('Aggregator unavailable'),
      }),
    );
  });

  it('rejects unknown use-case profiles before making an HTTP request', async () => {
    const result = await executeMixtureOfAgents(
      { user_prompt: 'Test.', use_case: 'unknown-profile' },
      { apiKey: 'openrouter-test-token', baseUrl },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown mixture_of_agents use_case');
    expect(requests).toHaveLength(0);
  });

  it('continues when one reference model fails and the minimum threshold is still met', async () => {
    const result = await executeMixtureOfAgents(
      { user_prompt: 'Compare two approaches.' },
      {
        apiKey: 'openrouter-test-token',
        baseUrl,
        referenceModels: ['ref-alpha', 'ref-fail'],
        aggregatorModel: 'agg-synth',
        maxRetries: 1,
        minSuccessfulReferences: 1,
      },
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      response: string;
      reference_results: Array<{ model: string; success: boolean; error?: string }>;
    };
    expect(data.response).toContain('aggregated: ref-alpha says plan A');
    expect(data.reference_results).toEqual([
      expect.objectContaining({ model: 'ref-alpha', success: true }),
      expect.objectContaining({ model: 'ref-fail', success: false }),
    ]);
  });

  it('exposes the formal registry adapter and exact Hermes parity manifest entry', async () => {
    const [tool] = createMixtureOfAgentsTools({
      apiKey: 'openrouter-test-token',
      baseUrl,
      referenceModels: ['ref-alpha'],
      aggregatorModel: 'agg-synth',
      maxRetries: 1,
    });
    expect(tool?.getSchema().name).toBe('mixture_of_agents');
    const result = await tool!.execute({ user_prompt: 'Summarize.' });
    expect(result.success).toBe(true);

    const manifest = buildLocalHermesToolParityManifest('2026-05-30T18:00:00.000Z');
    expect(manifest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'mixture_of_agents',
        status: 'exact',
        detectedCodeBuddyTools: expect.arrayContaining(['mixture_of_agents']),
      }),
    ]));
  });
});

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  void readRequestBody(req).then((body) => {
    requests.push({
      authorization: typeof req.headers.authorization === 'string'
        ? req.headers.authorization
        : undefined,
      body,
      path: req.url ?? '',
    });

    const model = typeof body.model === 'string' ? body.model : '';
    if (model === 'ref-fail' || model === 'agg-fail') {
      writeJson(res, 429, { error: { message: 'rate limited' } });
      return;
    }

    if (model === 'ref-alpha') {
      writeJson(res, 200, chatResponse('ref-alpha says plan A'));
      return;
    }
    if (model === 'ref-beta') {
      writeJson(res, 200, chatResponse('ref-beta says plan B'));
      return;
    }
    if (model === 'agg-synth') {
      const joined = extractMessageText(body).includes('ref-beta says plan B')
        ? 'aggregated: ref-alpha says plan A | ref-beta says plan B'
        : 'aggregated: ref-alpha says plan A';
      writeJson(res, 200, chatResponse(joined));
      return;
    }

    writeJson(res, 404, { error: { message: `unknown model ${model}` } });
  }).catch((error: unknown) => {
    writeJson(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
  });
}

async function readRequestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function chatResponse(content: string): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
        },
      },
    ],
  };
}

function extractMessageText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.map((message) => JSON.stringify(message)).join('\n');
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
