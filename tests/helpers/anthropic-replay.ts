/**
 * Replay of RECORDED Anthropic responses (tests/fixtures/anthropic-5-5/, captured
 * 2026-10-08 on `POST /v1/chat/completions` with a real key — the key never
 * appears in a fixture). The replay stands in for the network only: the real
 * `openai` SDK still parses the status line, the error body and the SSE stream.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/anthropic-5-5',
);

export function fixtureText(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/** Parse an SSE fixture (`data: {...}` blocks) into its JSON chunks. */
export function sseChunks(name: string): Array<Record<string, unknown>> {
  return fixtureText(name)
    .split('\n')
    .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map(line => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
}

export interface ReplayCall {
  url: string;
  body: Record<string, unknown>;
}

export interface Replay {
  client: OpenAI;
  calls: ReplayCall[];
}

export interface ReplayStep {
  fixture: string;
  status?: number;
}

/** An OpenAI client whose network is answered by recorded fixtures, one per call (the last one repeats). */
export function replaySequence(steps: ReplayStep[], baseURL = 'https://api.anthropic.com/v1'): Replay {
  const calls: ReplayCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const step = steps[Math.min(calls.length, steps.length - 1)]!;
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return new Response(fixtureText(step.fixture), {
      status: step.status ?? 200,
      headers: { 'content-type': step.fixture.endsWith('.sse') ? 'text/event-stream' : 'application/json' },
    });
  }) as unknown as typeof fetch;
  const client = new OpenAI({ apiKey: 'sk-ant-test', baseURL, fetch: fetchImpl, maxRetries: 0 });
  return { client, calls };
}

/** An OpenAI client whose network is answered by a recorded fixture. */
export function replayClient(fixture: string, status = 200, baseURL = 'https://api.anthropic.com/v1'): Replay {
  return replaySequence([{ fixture, status }], baseURL);
}
