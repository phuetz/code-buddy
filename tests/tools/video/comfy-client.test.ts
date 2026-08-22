import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeComfy, submitAndAwait } from '../../../src/tools/video/comfy-client.js';
import type { ComfyWorkflowGraph } from '../../../src/tools/video/comfy-workflow-template.js';

const roots: string[] = [];
const graph: ComfyWorkflowGraph = { '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'test' } } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('headless ComfyUI client', () => {
  it('probes system devices', async () => {
    const fetchImpl = vi.fn(async () => json({ devices: [{ name: 'RTX 3090', type: 'cuda' }] }));
    await expect(probeComfy('http://comfy.test', fetchImpl)).resolves.toEqual({
      ok: true,
      devices: [{ name: 'RTX 3090', type: 'cuda' }],
    });
  });

  it('submits, polls until done, and downloads image/video/gif outputs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comfy-client-test-'));
    roots.push(root);
    let historyCalls = 0;
    const paths: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      paths.push(url.pathname);
      if (url.pathname === '/prompt') return json({ prompt_id: 'prompt-1' });
      if (url.pathname === '/history/prompt-1') {
        historyCalls += 1;
        if (historyCalls === 1) return json({});
        return json({
          'prompt-1': {
            status: { completed: true, status_str: 'success' },
            outputs: {
              '10': { images: [{ filename: 'frame.png', subfolder: '', type: 'output' }] },
              '11': { videos: [{ filename: 'clip.mp4', subfolder: 'batch', type: 'output' }] },
              '12': { gifs: [{ filename: 'preview.gif', subfolder: '', type: 'output' }] },
            },
          },
        });
      }
      if (url.pathname === '/view') return new Response(Buffer.from(`bytes:${url.searchParams.get('filename')}`));
      return json({ error: 'not found' }, 404);
    });

    const result = await submitAndAwait('http://comfy.test/', graph, {
      clientId: 'client-1', timeoutMs: 1000, pollMs: 0, fetchImpl, workDir: root, sleep: async () => {},
    });
    expect(result.promptId).toBe('prompt-1');
    expect(result.outputs.map((output) => output.kind)).toEqual(['image', 'video', 'gif']);
    expect(await Promise.all(result.outputs.map((output) => fs.readFile(output.path, 'utf8'))))
      .toEqual(['bytes:frame.png', 'bytes:clip.mp4', 'bytes:preview.gif']);
    expect(paths).toEqual(['/prompt', '/history/prompt-1', '/history/prompt-1', '/view', '/view', '/view']);
  });

  it('surfaces the failing node exception message from history', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/prompt') return json({ prompt_id: 'bad-prompt' });
      return json({
        'bad-prompt': {
          status: {
            status_str: 'error',
            messages: [['execution_error', { node_id: '42', exception_message: 'CUDA out of memory' }]],
          },
        },
      });
    });
    await expect(submitAndAwait('http://comfy.test', graph, {
      clientId: 'client', timeoutMs: 100, pollMs: 0, fetchImpl, sleep: async () => {},
    })).rejects.toThrow(/node 42: CUDA out of memory/u);
  });

  it('times out frankly when history never completes', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return url.pathname === '/prompt' ? json({ prompt_id: 'slow' }) : json({});
    });
    let clock = 0;
    await expect(submitAndAwait('http://comfy.test', graph, {
      clientId: 'client', timeoutMs: 10, pollMs: 0, fetchImpl,
      now: () => { clock += 6; return clock; }, sleep: async () => {},
    })).rejects.toThrow(/timed out after 10ms/u);
  });
});
