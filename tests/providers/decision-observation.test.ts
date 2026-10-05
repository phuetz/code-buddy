import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResponseDecider, waitForKevObservations } from '../../src/sensory/respond-decider.js';
import { logger } from '../../src/utils/logger.js';
import { decide } from '../../src/providers/decision/index.js';

interface Hit {
  method: string | undefined;
  url: string | undefined;
  contentType: string | undefined;
  body: string;
}

/**
 * Local stand-in for POST /v1/systemone. It only echoes a fixed answer shape
 * from kev/api.py to_answers. It is not Kev and does not load a model.
 */
function fakeKev(script: {
  noul?: number;
  status?: number;
}): Promise<{ server: Server; port: number; hits: Hit[] }> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      hits.push({
        method: req.method,
        url: req.url,
        contentType: req.headers['content-type'],
        body,
      });
      if ((script.status ?? 200) !== 200) {
        res.writeHead(script.status ?? 500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'forced failure' }));
        return;
      }
      const parsed = JSON.parse(body) as {
        model?: string;
        questions: Record<string, { type: string }>;
      };
      const id = Object.keys(parsed.questions)[0]!;
      const type = parsed.questions[id]!.type;
      let answer: Record<string, unknown>;
      if (type === 'noul') {
        answer = { type: 'noul', noul: script.noul ?? 0 };
      } else if (type === 'choice') {
        answer = {
          type: 'choice',
          choice: 'oui',
          confidence: 0.5,
          probabilities: { oui: 0.75, non: 0.25 },
        };
      } else if (type === 'score') {
        answer = {
          type: 'score',
          score: 1.5,
          legend: { '0': 'low', '1': 'mid', '2': 'high' },
          probabilities: { '0': 0.25, '1': 0.25, '2': 0.5 },
          confidence: 0.2,
        };
      } else {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'unknown type' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: parsed.model ?? 'kev-latest',
        answers: { [id]: answer },
        usage: { input_tokens: 1, output_tokens: 1 },
        latency_ms: 1,
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, hits });
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('decision provider observation', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    delete process.env.CODEBUDDY_DECISION_URL;
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => close(server)));
  });

  it('does not call when CODEBUDDY_DECISION_URL is absent', async () => {
    const fake = await fakeKev({ noul: 0.99 });
    servers.push(fake.server);
    delete process.env.CODEBUDDY_DECISION_URL;
    const judge = vi.fn(async () => false);
    const decider = createResponseDecider({
      robotName: 'Buddy',
      chimeIn: true,
      judge,
      recentContext: async () => [],
    });
    const decision = await decider.decide('pourquoi le ciel est bleu ?');
    expect(decision).toEqual({ respond: false, reason: 'not-warranted' });
    expect(judge).toHaveBeenCalledOnce();
    expect(fake.hits).toEqual([]);
  });

  it('does not call when CODEBUDDY_DECISION_URL is empty', async () => {
    const fake = await fakeKev({ noul: 0.99 });
    servers.push(fake.server);
    process.env.CODEBUDDY_DECISION_URL = '   ';
    const decider = createResponseDecider({
      robotName: 'Buddy',
      respondToGreeting: true,
      judge: async () => {
        throw new Error('judge must not run');
      },
    });
    const decision = await decider.decide('bonjour');
    expect(decision).toEqual({ respond: true, reason: 'greeting' });
    expect(fake.hits).toEqual([]);
  });

  it('logs the noul probability and leaves respond unchanged when the URL is set', async () => {
    const fake = await fakeKev({ noul: 0.01 });
    servers.push(fake.server);
    process.env.CODEBUDDY_DECISION_URL = `http://127.0.0.1:${fake.port}`;
    const seen: Array<{ message: string; context?: Record<string, unknown> }> = [];
    vi.spyOn(logger, 'info').mockImplementation((message, context) => {
      seen.push({ message, context });
    });
    const judge = vi.fn(async () => true);
    const decider = createResponseDecider({
      robotName: 'Buddy',
      respondToGreeting: true,
      judge,
    });
    const decision = await decider.decide('bonjour');
    await waitForKevObservations();
    expect(decision).toEqual({ respond: true, reason: 'greeting' });
    expect(judge).not.toHaveBeenCalled();
    expect(fake.hits).toHaveLength(1);
    const hit = fake.hits[0]!;
    expect(hit.method).toBe('POST');
    expect(hit.url).toBe('/v1/systemone');
    expect(hit.contentType).toContain('application/json');
    const body = JSON.parse(hit.body) as {
      state: string;
      model: string;
      questions: Record<string, { type: string; instructions: string; criteria?: unknown }>;
    };
    expect(body.state).toBe('bonjour');
    expect(body.model).toBe('kev-latest');
    expect(body.questions['chime-in']).toMatchObject({ type: 'noul' });
    expect(body.questions['chime-in']!.criteria).toBeUndefined();
    expect(Object.keys(body.questions)).toEqual(['chime-in']);
    expect(seen).toEqual([
      {
        message: '[respond] kev observation',
        context: {
          mode: 'observation',
          respond: true,
          reason: 'greeting',
          kevType: 'noul',
          kevProbability: 0.01,
        },
      },
    ]);
  });

  it('does not replace a negative judge with a high noul probability', async () => {
    const fake = await fakeKev({ noul: 0.99 });
    servers.push(fake.server);
    process.env.CODEBUDDY_DECISION_URL = `http://127.0.0.1:${fake.port}`;
    const seen: Array<{ message: string; context?: Record<string, unknown> }> = [];
    vi.spyOn(logger, 'info').mockImplementation((message, context) => {
      seen.push({ message, context });
    });
    const decider = createResponseDecider({
      robotName: 'Buddy',
      chimeIn: true,
      judge: async () => false,
      recentContext: async () => [],
    });
    const decision = await decider.decide('pourquoi le ciel est bleu ?');
    await waitForKevObservations();
    expect(decision).toEqual({ respond: false, reason: 'not-warranted' });
    expect(seen[0]?.context).toMatchObject({
      respond: false,
      reason: 'not-warranted',
      kevProbability: 0.99,
    });
  });

  it('keeps respond when the fake server returns HTTP 500', async () => {
    const fake = await fakeKev({ status: 500 });
    servers.push(fake.server);
    process.env.CODEBUDDY_DECISION_URL = `http://127.0.0.1:${fake.port}`;
    const decider = createResponseDecider({
      robotName: 'Buddy',
      respondToGreeting: true,
    });
    const decision = await decider.decide('bonjour');
    await waitForKevObservations();
    expect(decision).toEqual({ respond: true, reason: 'greeting' });
    expect(fake.hits).toHaveLength(1);
  });

  it('decide() rend sa réponse en moins de 50 ms même si Kev met 2 s à répondre', async () => {
    const slow = createServer((req, res) => {
      req.resume();
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ answers: { 'chime-in': { type: 'noul', noul: 0.5 } } }));
      }, 2000);
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', () => resolve()));
    servers.push(slow);
    process.env.CODEBUDDY_DECISION_URL = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
    const decider = createResponseDecider({ robotName: 'Buddy', respondToGreeting: true });
    await decider.decide('bonjour'); // chauffe les imports
    await waitForKevObservations();
    const started = performance.now();
    const decision = await decider.decide('salut');
    const elapsed = performance.now() - started;
    expect(decision.respond).toBe(true);
    // ÉCHOUE sur l'ancienne logique : decide() attendait l'observation (>= 1 s).
    expect(elapsed).toBeLessThan(50);
    await waitForKevObservations();
  });

  it('au plus 2 observations en vol : les suivantes sont abandonnées sans retarder la décision', async () => {
    const hits: number[] = [];
    const slow = createServer((req, res) => {
      req.resume();
      hits.push(Date.now());
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }, 300);
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', () => resolve()));
    servers.push(slow);
    process.env.CODEBUDDY_DECISION_URL = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
    const decider = createResponseDecider({ robotName: 'Buddy', respondToGreeting: true });
    for (let i = 0; i < 6; i++) await decider.decide('bonjour');
    await new Promise((r) => setTimeout(r, 150));
    expect(hits.length).toBeLessThanOrEqual(2);
    await waitForKevObservations();
  });

  it('decide() sends nothing when the URL is empty', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error('fetch must not run');
    };
    await expect(decide('question', 'texte', 'noul', { baseUrl: '', fetchImpl })).rejects.toThrow(
      /no request sent/,
    );
    await expect(decide('question', 'texte', 'noul', { baseUrl: '  ', fetchImpl })).rejects.toThrow(
      /no request sent/,
    );
    expect(calls).toBe(0);
  });

  it('decide() refuses a type kev/api.py does not declare, before any request', async () => {
    const fake = await fakeKev({});
    servers.push(fake.server);
    await expect(
      decide('question', 'texte', 'boolean', { baseUrl: `http://127.0.0.1:${fake.port}` }),
    ).rejects.toThrow(/noul, choice, score/);
    expect(fake.hits).toEqual([]);
  });

  it('decide() reads choice probabilities[choice] and does not treat score as a probability', async () => {
    const fake = await fakeKev({});
    servers.push(fake.server);
    const baseUrl = `http://127.0.0.1:${fake.port}`;
    await expect(
      decide('which', 'texte', 'choice', {
        baseUrl,
        criteria: { oui: 'yes', non: 'no' },
      }),
    ).resolves.toBe(0.75);
    const choiceBody = JSON.parse(fake.hits[0]!.body) as {
      questions: Record<string, { type: string; criteria: Record<string, string> }>;
    };
    expect(choiceBody.questions.q).toEqual({
      type: 'choice',
      instructions: 'which',
      criteria: { oui: 'yes', non: 'no' },
    });
    await expect(
      decide('how much', 'texte', 'score', {
        baseUrl,
        criteria: ['low', 'mid', 'high'],
      }),
    ).resolves.toBeNull();
    await expect(decide('which', 'texte', 'choice', { baseUrl })).rejects.toThrow(/choice criteria/);
    expect(fake.hits).toHaveLength(2);
  });

  it('decide() aborts within the timeout when headers arrive but the body never ends', async () => {
    const stalled = createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"answers":');
    });
    await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', () => resolve()));
    servers.push(stalled);
    const port = (stalled.address() as AddressInfo).port;
    const started = Date.now();
    await expect(
      decide('q', 'texte', 'noul', { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 200 }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('decide() sends redirect: error', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      seen = init;
      return new Response(
        JSON.stringify({ answers: { q: { type: 'noul', noul: 0.5 } } }),
        { status: 200 },
      );
    };
    await expect(decide('q', 't', 'noul', { baseUrl: 'http://x', fetchImpl })).resolves.toBe(0.5);
    expect(seen?.redirect).toBe('error');
  });
});
