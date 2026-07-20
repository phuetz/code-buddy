/** Polling-only headless ComfyUI client for exported API workflows. */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import type { ComfyWorkflowGraph } from './comfy-workflow-template.js';

export interface ComfyDevice {
  name?: string;
  type?: string;
  index?: number;
  vram_total?: number;
  vram_free?: number;
  [key: string]: unknown;
}

export interface ComfyProbeResult {
  ok: boolean;
  devices: ComfyDevice[];
}

export interface ComfyOutput {
  nodeId: string;
  kind: 'image' | 'video' | 'gif';
  filename: string;
  subfolder: string;
  type: string;
  path: string;
}

export interface SubmitAndAwaitOptions {
  clientId: string;
  timeoutMs: number;
  pollMs: number;
  fetchImpl?: typeof fetch;
  workDir?: string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface SubmitAndAwaitResult {
  promptId: string;
  outputs: ComfyOutput[];
  workDir: string;
}

interface ComfyOutputReference {
  filename: string;
  subfolder?: string;
  type?: string;
}

function endpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}${suffix}`;
}

async function responseJson(response: Response, context: string): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${context} returned invalid JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(`${context} failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`${context} returned a non-object response`);
  return body as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function describeNodeError(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const found = describeNodeError(item);
      if (found) return found;
    }
    for (const item of value) {
      const found = describeNodeError(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['exception_message', 'message', 'error', 'details']) {
    const found = describeNodeError(record[key]);
    if (found) {
      const nodeId = stringField(record, 'node_id') ?? stringField(record, 'nodeId');
      return nodeId ? `node ${nodeId}: ${found}` : found;
    }
  }
  for (const nested of Object.values(record)) {
    const found = describeNodeError(nested);
    if (found) return found;
  }
  return undefined;
}

function outputReferences(outputs: unknown): Array<{ nodeId: string; kind: ComfyOutput['kind']; ref: ComfyOutputReference }> {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return [];
  const references: Array<{ nodeId: string; kind: ComfyOutput['kind']; ref: ComfyOutputReference }> = [];
  const categories = [
    ['images', 'image'],
    ['videos', 'video'],
    ['gifs', 'gif'],
  ] as const;
  for (const [nodeId, candidate] of Object.entries(outputs as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const nodeOutput = candidate as Record<string, unknown>;
    for (const [field, kind] of categories) {
      const items = nodeOutput[field];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const ref = item as Record<string, unknown>;
        const filename = stringField(ref, 'filename');
        if (filename) references.push({
          nodeId,
          kind,
          ref: {
            filename,
            subfolder: stringField(ref, 'subfolder'),
            type: stringField(ref, 'type'),
          },
        });
      }
    }
  }
  return references;
}

function safeOutputName(filename: string, nodeId: string, index: number): string {
  const basename = path.basename(filename);
  if (basename !== filename || !basename || basename === '.' || basename === '..') {
    throw new Error(`ComfyUI returned unsafe output filename: ${filename}`);
  }
  return `${nodeId}-${index}-${basename.replace(/[^A-Za-z0-9._-]/gu, '_')}`;
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithin(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  context: string,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${context} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probeComfy(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ComfyProbeResult> {
  try {
    const body = await responseJson(
      await fetchWithin(fetchImpl, endpoint(baseUrl, '/system_stats'), undefined, 10_000, 'ComfyUI /system_stats'),
      'ComfyUI /system_stats',
    );
    const devices = Array.isArray(body.devices)
      ? body.devices.filter((device): device is ComfyDevice => Boolean(device) && typeof device === 'object' && !Array.isArray(device))
      : [];
    return { ok: true, devices };
  } catch {
    return { ok: false, devices: [] };
  }
}

export async function submitAndAwait(
  baseUrl: string,
  graph: ComfyWorkflowGraph,
  options: SubmitAndAwaitOptions,
): Promise<SubmitAndAwaitResult> {
  if (!options.clientId.trim()) throw new Error('ComfyUI clientId is required');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('ComfyUI timeoutMs must be positive');
  if (!Number.isFinite(options.pollMs) || options.pollMs < 0) throw new Error('ComfyUI pollMs must be non-negative');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const submission = await responseJson(await fetchWithin(fetchImpl, endpoint(baseUrl, '/prompt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: options.clientId }),
  }, options.timeoutMs, 'ComfyUI /prompt'), 'ComfyUI /prompt');
  const promptId = stringField(submission, 'prompt_id');
  if (!promptId) {
    const detail = describeNodeError(submission.node_errors ?? submission.error);
    throw new Error(`ComfyUI rejected workflow without prompt_id${detail ? `: ${detail}` : ''}`);
  }

  let completedOutputs: unknown;
  for (;;) {
    if (now() - startedAt >= options.timeoutMs) {
      throw new Error(`ComfyUI prompt ${promptId} timed out after ${options.timeoutMs}ms`);
    }
    const remainingMs = Math.max(1, options.timeoutMs - (now() - startedAt));
    const history = await responseJson(
      await fetchWithin(
        fetchImpl,
        endpoint(baseUrl, `/history/${encodeURIComponent(promptId)}`),
        undefined,
        remainingMs,
        `ComfyUI /history/${promptId}`,
      ),
      `ComfyUI /history/${promptId}`,
    );
    const candidate = history[promptId];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const entry = candidate as Record<string, unknown>;
      const status = entry.status && typeof entry.status === 'object' && !Array.isArray(entry.status)
        ? entry.status as Record<string, unknown>
        : undefined;
      const statusText = typeof status?.status_str === 'string' ? status.status_str.toLowerCase() : '';
      const error = describeNodeError(entry.node_errors ?? status?.messages ?? entry.error);
      if (error || ['error', 'failed', 'cancelled', 'canceled'].includes(statusText)) {
        throw new Error(`ComfyUI prompt ${promptId} failed${error ? `: ${error}` : ` (${statusText})`}`);
      }
      if (entry.outputs && outputReferences(entry.outputs).length > 0) {
        completedOutputs = entry.outputs;
        break;
      }
      if (status?.completed === true) throw new Error(`ComfyUI prompt ${promptId} completed without downloadable outputs`);
    }
    await sleep(options.pollMs);
  }

  const workDir = options.workDir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-comfy-'));
  await fs.mkdir(workDir, { recursive: true });
  const refs = outputReferences(completedOutputs);
  const outputs: ComfyOutput[] = [];
  for (const [index, output] of refs.entries()) {
    const subfolder = output.ref.subfolder ?? '';
    if (subfolder.split(/[\\/]/u).some((part) => part === '..')) {
      throw new Error(`ComfyUI returned unsafe output subfolder: ${subfolder}`);
    }
    const type = output.ref.type ?? 'output';
    const query = new URLSearchParams({ filename: output.ref.filename, subfolder, type });
    const remainingMs = Math.max(1, options.timeoutMs - (now() - startedAt));
    const response = await fetchWithin(
      fetchImpl,
      endpoint(baseUrl, `/view?${query.toString()}`),
      undefined,
      remainingMs,
      `ComfyUI /view ${output.ref.filename}`,
    );
    if (!response.ok) throw new Error(`ComfyUI /view failed (${response.status}) for ${output.ref.filename}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const outputPath = path.join(workDir, safeOutputName(output.ref.filename, output.nodeId, index));
    await fs.writeFile(outputPath, bytes, { flag: 'wx' });
    outputs.push({
      nodeId: output.nodeId,
      kind: output.kind,
      filename: output.ref.filename,
      subfolder,
      type,
      path: outputPath,
    });
  }
  return { promptId, outputs, workDir };
}
