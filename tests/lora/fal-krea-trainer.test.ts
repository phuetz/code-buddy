import { describe, expect, it, vi } from 'vitest';

import {
  pollKrea2Train,
  submitKrea2Train,
  trainKrea2Cloud,
} from '../../src/lora/fal-krea-trainer.js';

describe('fal krea trainer client', () => {
  it('submits train job to queue', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          request_id: 'req-1',
          status_url: 'https://queue.fal.run/fal-ai/krea-2-trainer/requests/req-1/status',
          response_url: 'https://queue.fal.run/fal-ai/krea-2-trainer/requests/req-1',
        }),
        { status: 200 },
      ),
    );
    const out = await submitKrea2Train(
      { images_data_url: 'https://example.com/d.zip', trigger_phrase: 'ohwx lisa', steps: 100 },
      { apiKey: 'test-key', fetch: fetchMock as unknown as typeof fetch },
    );
    expect(out.requestId).toBe('req-1');
    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject(
      expect.objectContaining({ Authorization: 'Key test-key' }),
    );
  });

  it('polls until completed and returns lora url', async () => {
    let n = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/status')) {
        n += 1;
        return new Response(
          JSON.stringify({ status: n < 2 ? 'IN_PROGRESS' : 'COMPLETED' }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          lora_file: { url: 'https://cdn.example/lora.safetensors', file_name: 'lora.safetensors' },
          config_file: { url: 'https://cdn.example/cfg.json' },
        }),
        { status: 200 },
      );
    });
    const result = await pollKrea2Train('req-2', {
      apiKey: 'k',
      fetch: fetchMock as unknown as typeof fetch,
      pollMs: 1,
      timeoutMs: 5000,
    });
    expect(result.lora_file?.url).toContain('lora.safetensors');
  });

  it('trainKrea2Cloud fails closed without key', async () => {
    const prev = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    delete process.env.FAL_API_KEY;
    const r = await trainKrea2Cloud({ imagesDataUrl: 'https://x/z.zip' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/FAL_KEY/i);
    if (prev !== undefined) process.env.FAL_KEY = prev;
  });
});
