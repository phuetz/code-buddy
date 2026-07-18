/**
 * Cloud Krea 2 LoRA training via fal.ai queue API.
 * Endpoint: fal-ai/krea-2-trainer · ~$0.003/step (min 100 steps charged).
 */

import fs from 'fs/promises';
import path from 'path';
import type { LoraTrainCloudOptions, LoraTrainCloudResult } from './types.js';

const FAL_QUEUE = 'https://queue.fal.run';
const FAL_ENDPOINT = 'fal-ai/krea-2-trainer';
const FAL_UPLOAD = 'https://fal.media/files/upload';

export function resolveFalKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.FAL_KEY?.trim() || env.FAL_API_KEY?.trim() || undefined;
}

export async function uploadFileToFal(
  filePath: string,
  options?: { apiKey?: string; fetch?: typeof fetch; signal?: AbortSignal },
): Promise<string> {
  const apiKey = options?.apiKey ?? resolveFalKey();
  if (!apiKey) throw new Error('FAL_KEY is required to upload the dataset zip');
  const fetchFn = options?.fetch ?? fetch;
  const buf = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const res = await fetchFn(FAL_UPLOAD, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/octet-stream',
      'X-Fal-File-Name': fileName,
    },
    body: buf,
    signal: options?.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fal upload failed HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { url?: string; file_url?: string; access_url?: string };
  const url = json.url ?? json.file_url ?? json.access_url;
  if (!url) throw new Error(`fal upload response missing url: ${JSON.stringify(json).slice(0, 200)}`);
  return url;
}

export async function submitKrea2Train(
  input: {
    images_data_url: string;
    trigger_phrase?: string;
    auto_captioning?: string;
    steps?: number;
    learning_rate?: number;
    resolution?: number;
    debug_dataset?: boolean;
  },
  options?: { apiKey?: string; fetch?: typeof fetch; signal?: AbortSignal },
): Promise<{ requestId: string; statusUrl: string; responseUrl: string }> {
  const apiKey = options?.apiKey ?? resolveFalKey();
  if (!apiKey) throw new Error('FAL_KEY is required for cloud LoRA training');
  const fetchFn = options?.fetch ?? fetch;
  const res = await fetchFn(`${FAL_QUEUE}/${FAL_ENDPOINT}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: options?.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fal train submit failed HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    request_id?: string;
    status_url?: string;
    response_url?: string;
  };
  if (!json.request_id) throw new Error('fal train submit missing request_id');
  return {
    requestId: json.request_id,
    statusUrl: json.status_url ?? `${FAL_QUEUE}/${FAL_ENDPOINT}/requests/${json.request_id}/status`,
    responseUrl: json.response_url ?? `${FAL_QUEUE}/${FAL_ENDPOINT}/requests/${json.request_id}`,
  };
}

export async function pollKrea2Train(
  requestId: string,
  options?: {
    apiKey?: string;
    fetch?: typeof fetch;
    pollMs?: number;
    timeoutMs?: number;
    onStatus?: (status: string) => void;
    signal?: AbortSignal;
  },
): Promise<{ lora_file?: { url: string; file_name?: string }; config_file?: { url: string } }> {
  const apiKey = options?.apiKey ?? resolveFalKey();
  if (!apiKey) throw new Error('FAL_KEY is required');
  const fetchFn = options?.fetch ?? fetch;
  const pollMs = options?.pollMs ?? 5000;
  const timeoutMs = options?.timeoutMs ?? 2 * 60 * 60 * 1000;
  const started = Date.now();
  const statusUrl = `${FAL_QUEUE}/${FAL_ENDPOINT}/requests/${requestId}/status`;
  const resultUrl = `${FAL_QUEUE}/${FAL_ENDPOINT}/requests/${requestId}`;

  while (Date.now() - started < timeoutMs) {
    if (options?.signal?.aborted) throw new Error('aborted');
    const st = await fetchFn(`${statusUrl}?logs=0`, {
      headers: { Authorization: `Key ${apiKey}` },
      signal: options?.signal,
    });
    if (!st.ok) {
      const text = await st.text().catch(() => '');
      throw new Error(`fal status HTTP ${st.status}: ${text.slice(0, 300)}`);
    }
    const body = (await st.json()) as { status?: string };
    const status = body.status ?? 'UNKNOWN';
    options?.onStatus?.(status);
    if (status === 'COMPLETED') {
      const res = await fetchFn(resultUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        signal: options?.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`fal result HTTP ${res.status}: ${text.slice(0, 400)}`);
      }
      return (await res.json()) as {
        lora_file?: { url: string; file_name?: string };
        config_file?: { url: string };
      };
    }
    if (status === 'FAILED' || status === 'CANCELLED') {
      throw new Error(`fal train ended with status ${status}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`fal train timed out after ${timeoutMs}ms`);
}

export async function downloadToFile(
  url: string,
  destPath: string,
  options?: { fetch?: typeof fetch; signal?: AbortSignal },
): Promise<void> {
  const fetchFn = options?.fetch ?? fetch;
  const res = await fetchFn(url, { signal: options?.signal });
  if (!res.ok) throw new Error(`download failed HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
}

/** Full cloud train: optional local zip already packed; uploads if path given. */
export async function trainKrea2Cloud(
  options: LoraTrainCloudOptions & {
    /** Local zip to upload when imagesDataUrl is empty / 'upload'. */
    localZipPath?: string;
    outDir?: string;
  },
): Promise<LoraTrainCloudResult> {
  try {
    const apiKey = options.apiKey ?? resolveFalKey();
    if (!apiKey) {
      return { success: false, error: 'FAL_KEY is not set' };
    }
    let imagesDataUrl = options.imagesDataUrl;
    if (!imagesDataUrl || imagesDataUrl === 'upload') {
      if (!options.localZipPath) {
        return { success: false, error: 'imagesDataUrl or localZipPath required' };
      }
      options.onStatus?.('UPLOADING', options.localZipPath);
      imagesDataUrl = await uploadFileToFal(options.localZipPath, {
        apiKey,
        fetch: options.fetch,
        signal: options.signal,
      });
    }

    const steps = Math.max(50, Math.min(10000, options.steps ?? 1000));
    options.onStatus?.('SUBMITTING', `${steps} steps`);
    const submitted = await submitKrea2Train(
      {
        images_data_url: imagesDataUrl,
        ...(options.triggerPhrase ? { trigger_phrase: options.triggerPhrase } : {}),
        auto_captioning: options.autoCaptioning ?? 'Off',
        steps,
        learning_rate: options.learningRate ?? 0.0005,
        resolution: options.resolution ?? 768,
        debug_dataset: options.debugDataset ?? false,
      },
      { apiKey, fetch: options.fetch, signal: options.signal },
    );

    options.onStatus?.('QUEUED', submitted.requestId);
    const result = await pollKrea2Train(submitted.requestId, {
      apiKey,
      fetch: options.fetch,
      pollMs: options.pollMs,
      timeoutMs: options.timeoutMs,
      onStatus: (s) => options.onStatus?.(s),
      signal: options.signal,
    });

    const loraUrl = result.lora_file?.url;
    if (!loraUrl) {
      return {
        success: false,
        requestId: submitted.requestId,
        error: 'Training completed but lora_file.url missing',
        raw: result,
      };
    }

    const outDir = options.outDir ?? path.join(process.cwd(), '.codebuddy', 'lora', 'output');
    await fs.mkdir(outDir, { recursive: true });
    const loraName = result.lora_file?.file_name || `krea2-${submitted.requestId.slice(0, 8)}.safetensors`;
    const loraPath = path.join(outDir, loraName);
    options.onStatus?.('DOWNLOADING', loraUrl);
    await downloadToFile(loraUrl, loraPath, { fetch: options.fetch, signal: options.signal });

    let configPath: string | undefined;
    if (result.config_file?.url) {
      configPath = path.join(outDir, `config-${submitted.requestId.slice(0, 8)}.json`);
      await downloadToFile(result.config_file.url, configPath, {
        fetch: options.fetch,
        signal: options.signal,
      });
    }

    return {
      success: true,
      requestId: submitted.requestId,
      loraUrl,
      configUrl: result.config_file?.url,
      loraPath,
      configPath,
      raw: result,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
