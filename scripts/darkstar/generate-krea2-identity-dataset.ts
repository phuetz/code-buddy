#!/usr/bin/env npx tsx

/**
 * Generate a reference-locked synthetic identity dataset on Darkstar.
 *
 * Krea 2 Identity Edit receives one approved neutral portrait and re-stages the
 * same adult character. This avoids the face drift caused by independent
 * text-to-image calls. The script never trains a LoRA and never publishes.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'http://100.73.222.64:8189';
const DEFAULT_REFERENCE = '.codebuddy/lora/lisa-hq-v2/images/lisa_001.png';
const DEFAULT_OUTPUT = '.codebuddy/lora/lisa-hq-v2/identity-candidates';
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const WORKFLOW_REVISION = 'krea2-identity-edit-v1.2.1-r64';
const MODEL_LOCK = {
  diffusionModel: {
    filename: 'krea2_turbo_fp8_scaled.safetensors',
    sha256: 'eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1',
  },
  textEncoder: {
    filename: 'qwen3vl_4b_fp8_scaled.safetensors',
    sha256: '54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094',
  },
  vae: {
    filename: 'qwen_image_vae.safetensors',
    sha256: 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
  },
  identityAdapter: {
    filename: 'krea2_identity_edit_v1_2_r64.safetensors',
    sha256: 'f794b47142555c929cf536a2f1e4f335174b9aedbb08572b07d45814d4242423',
  },
} as const;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIGHTS_BASES = ['unverified', 'synthetic-owned', 'licensed', 'consented-person'] as const;

type RightsBasis = typeof RIGHTS_BASES[number];

const VARIATIONS = [
  'Create a clean studio headshot of this same adult woman, front view, neutral expression, plain light gray background, soft even beauty-dish lighting, black crew-neck top.',
  'Create a clean studio portrait of this same adult woman, three-quarter view facing left, calm expression, plain warm gray background, soft window light, dark navy crew-neck top.',
  'Create a clean studio portrait of this same adult woman, three-quarter view facing right, subtle closed-mouth smile, plain cool gray background, diffused key light, charcoal crew-neck top.',
  'Create a clean profile portrait of this same adult woman facing left, relaxed expression, plain off-white background, soft rim light, simple black crew-neck top.',
  'Create a waist-up editorial portrait of this same adult woman, facing camera, serious attentive expression, neutral studio background, soft directional window light, modest white blouse.',
  'Create a full-body catalog photograph of this same adult woman standing naturally, facing camera, neutral expression, seamless gray studio, soft even light, simple jeans and black long-sleeve top.',
  'Create a close-up beauty portrait of this same adult woman, gentle genuine smile, plain beige background, soft morning window light, natural skin texture, simple dark top.',
  'Create a waist-up portrait of this same adult woman looking slightly off camera, thoughtful expression, plain blue-gray studio background, controlled cinematic side light, modest burgundy sweater.',
  'Create a clean profile portrait of this same adult woman facing right, neutral expression, plain light gray background, soft even studio light, modest dark green crew-neck top.',
  'Create a shoulder-up portrait of this same adult woman, three-quarter view facing left, warm closed-mouth smile, plain cream background, diffuse daylight, modest pale blue blouse.',
  'Create a seated medium portrait of this same adult woman facing camera, relaxed posture with both hands visible, neutral expression, simple beige studio, soft frontal light, modest gray cardigan.',
  'Create a full-body catalog photograph of this same adult woman standing at a slight three-quarter angle, both hands visible, calm expression, seamless white studio, soft even light, simple black trousers and ivory long-sleeve top.',
  'Create a tight close-up portrait of this same adult woman facing camera, serious focused expression, plain charcoal background, controlled hard key light from camera left, modest black top.',
  'Create a medium outdoor portrait of this same adult woman facing camera, neutral expression, softly blurred overcast urban background, natural diffuse light, modest denim jacket over a white top.',
  'Create a waist-up indoor portrait of this same adult woman, three-quarter view facing right, gentle smile, simple warm home background out of focus, soft practical window light, modest rust-colored sweater.',
  'Create a shoulder-up editorial portrait of this same adult woman facing camera, composed professional expression, plain cool office background, broad softbox light, modest navy blazer and white top.',
  'Create a close-up portrait of this same adult woman facing camera, subtly raised eyebrows and attentive expression, plain warm-gray background, soft clamshell light, modest burgundy crew-neck top.',
  'Create a close-up portrait of this same adult woman facing camera, restrained natural laugh with lips slightly parted, plain beige background, soft window light, modest dark blue top.',
  'Create a medium portrait of this same adult woman looking slightly left of camera, mildly concerned thoughtful expression, plain cool-gray background, soft directional light, modest olive sweater.',
  'Create a shoulder-up portrait of this same adult woman, near-profile facing right while eyes look toward camera, calm expression, plain off-white studio, subtle rim light, modest black turtleneck.',
  'Create a full-body catalog photograph of this same adult woman facing camera, both hands relaxed and visible, neutral expression, seamless pale-gray studio, soft even lighting, modest knee-length navy dress and simple flat shoes.',
  'Create a waist-up portrait of this same adult woman facing camera, confident subtle smile, plain cream studio background, diffuse daylight, modest denim shirt with sleeves down.',
  'Create a close-up portrait of this same adult woman looking slightly down then toward camera, introspective expression, plain deep-gray background, soft cinematic top light, modest charcoal top.',
  'Create a medium portrait of this same adult woman facing camera with her hair tied in a simple low ponytail while preserving the exact hairline and face, neutral expression, plain light-gray studio, soft even light, modest white crew-neck top.',
] as const;

interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

interface UploadRef {
  name: string;
  subfolder: string;
  type: string;
}

function argument(name: string, fallback: string): string {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0 && process.argv[exact + 1]) return process.argv[exact + 1]!;
  const prefix = `--${name}=`;
  return process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

export function parseCount(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > VARIATIONS.length) {
    throw new Error(`--count must be an integer between 1 and ${VARIATIONS.length}`);
  }
  return value;
}

export function validateBaseUrl(raw: string): URL {
  const url = new URL(raw);
  const octets = url.hostname.split('.').map(Number);
  const tailscale = octets.length === 4
    && octets.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
    && octets[0] === 100
    && octets[1]! >= 64
    && octets[1]! <= 127;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    (!tailscale && !loopback)
  ) {
    throw new Error('ComfyUI URL must be a root URL on loopback or the Tailscale 100.64.0.0/10 range');
  }
  return new URL(`${url.origin}/`);
}

function endpoint(base: URL, pathname: string): URL {
  return new URL(pathname.replace(/^\/+/, ''), base);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function imageFromOutputs(value: unknown): ComfyImageRef | undefined {
  if (!isRecord(value)) return undefined;
  for (const output of Object.values(value)) {
    if (!isRecord(output) || !Array.isArray(output.images)) continue;
    for (const item of output.images) {
      if (!isRecord(item) || typeof item.filename !== 'string') continue;
      return {
        filename: item.filename,
        subfolder: typeof item.subfolder === 'string' ? item.subfolder : '',
        type: typeof item.type === 'string' ? item.type : 'output',
      };
    }
  }
  return undefined;
}

export function buildWorkflow(input: {
  reference: string;
  prompt: string;
  seed: number;
  prefix: string;
}): Record<string, unknown> {
  const source: [string, number] = ['5', 0];
  const vae: [string, number] = ['3', 0];
  const clip: [string, number] = ['2', 0];
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors', weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '4': {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['1', 0],
        lora_name: 'krea2_identity_edit_v1_2_r64.safetensors',
        strength_model: 1,
      },
    },
    '5': { class_type: 'LoadImage', inputs: { image: input.reference } },
    '6': { class_type: 'VAEEncode', inputs: { pixels: source, vae } },
    '7': {
      class_type: 'Krea2EditModelPatch',
      inputs: {
        model: ['4', 0],
        source_latent: ['6', 0],
        ref_boost: 4,
        ref_boost_a: 1,
        fit_mode: 'fit',
        vae,
        source_image: source,
      },
    },
    '8': {
      class_type: 'Krea2EditGroundedEncode',
      inputs: {
        clip,
        prompt: input.prompt,
        image: source,
        grounding_px: 1024,
        system_prompt: 'Preserve the exact adult facial identity, facial proportions, eye shape, nose, lips, hairline, skin tone, and distinguishing features of the synthetic reference character.',
      },
    },
    '9': {
      class_type: 'Krea2EditGroundedEncode',
      inputs: { clip, prompt: '', image: source, grounding_px: 1024, system_prompt: '' },
    },
    '10': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width: 768, height: 1024, batch_size: 1 },
    },
    '11': {
      class_type: 'KSampler',
      inputs: {
        seed: input.seed,
        steps: 10,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['7', 0],
        positive: ['8', 0],
        negative: ['9', 0],
        latent_image: ['10', 0],
      },
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae } },
    '13': { class_type: 'SaveImage', inputs: { filename_prefix: input.prefix, images: ['12', 0] } },
  };
}

async function readJson(response: Response, label: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const value = await response.json() as unknown;
  if (!isRecord(value)) throw new Error(`${label} returned invalid JSON`);
  return value;
}

function validatedSlug(raw: string, flag: string): string {
  const value = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`--${flag} must be a lowercase identifier of at most 64 characters`);
  }
  return value;
}

function validatedTrigger(raw: string): string {
  const value = raw.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(value)) {
    throw new Error('--trigger-token must be an identifier between 2 and 32 characters');
  }
  return value;
}

function rightsBasis(raw: string): RightsBasis {
  if ((RIGHTS_BASES as readonly string[]).includes(raw)) return raw as RightsBasis;
  throw new Error(`--rights-basis must be one of: ${RIGHTS_BASES.join(', ')}`);
}

async function fetchWithTimeout(url: URL, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
}

async function readBoundedPng(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`ComfyUI view returned HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error('ComfyUI declared an oversized PNG');
  }
  if (!response.body) throw new Error('ComfyUI returned an empty image response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_IMAGE_BYTES) {
      await reader.cancel('image exceeds maximum size');
      throw new Error('ComfyUI returned an oversized PNG');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!hasPngSignature(bytes)) {
    throw new Error('ComfyUI returned an invalid PNG');
  }
  return bytes;
}

async function writeNewFileAtomically(destination: string, data: Uint8Array | string): Promise<void> {
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await fs.link(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function candidateComplete(outputRoot: string, id: string): Promise<boolean> {
  const imagePath = path.join(outputRoot, `${id}.png`);
  const captionPath = path.join(outputRoot, `${id}.txt`);
  const metadataPath = path.join(outputRoot, `${id}.json`);
  const paths = [imagePath, captionPath, metadataPath];
  const present = await Promise.all(paths.map(async (candidatePath) => {
    try {
      await fs.access(candidatePath);
      return true;
    } catch {
      return false;
    }
  }));
  if (present.every((value) => !value)) return false;
  if (!present.every(Boolean)) {
    throw new Error(`Incomplete candidate ${id}; quarantine its partial files before retrying`);
  }
  const imageBytes = await fs.readFile(imagePath);
  if (imageBytes.length > MAX_IMAGE_BYTES || !hasPngSignature(imageBytes)) {
    throw new Error(`Invalid existing candidate PNG: ${imagePath}`);
  }
  const metadataValue = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as unknown;
  const expectedSha = createHash('sha256').update(imageBytes).digest('hex');
  if (
    !isRecord(metadataValue) ||
    metadataValue.id !== id ||
    metadataValue.outputSha256 !== expectedSha
  ) {
    throw new Error(`Candidate metadata/hash mismatch: ${metadataPath}`);
  }
  return true;
}

async function uploadReference(base: URL, referencePath: string): Promise<UploadRef> {
  const bytes = await fs.readFile(referencePath);
  if (bytes.length < 8 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Reference image size is invalid');
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), path.basename(referencePath));
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const result = await readJson(await fetchWithTimeout(endpoint(base, '/upload/image'), {
    method: 'POST',
    body: form,
  }, 120_000), 'ComfyUI upload');
  if (typeof result.name !== 'string') throw new Error('ComfyUI upload returned no filename');
  return {
    name: result.name,
    subfolder: typeof result.subfolder === 'string' ? result.subfolder : '',
    type: typeof result.type === 'string' ? result.type : 'input',
  };
}

async function waitForOutput(base: URL, promptId: string): Promise<ComfyImageRef> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const history = await readJson(
      await fetchWithTimeout(endpoint(base, `/history/${encodeURIComponent(promptId)}`)),
      'ComfyUI history',
    );
    const entry = history[promptId];
    if (isRecord(entry)) {
      const status = isRecord(entry.status) && typeof entry.status.status_str === 'string'
        ? entry.status.status_str
        : '';
      if (status === 'error' || status === 'failed') {
        throw new Error(`ComfyUI generation failed (${status})`);
      }
      const image = imageFromOutputs(entry.outputs);
      if (image) return image;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('ComfyUI generation timed out');
}

async function generateOne(base: URL, reference: string, prompt: string, seed: number, id: string): Promise<Uint8Array> {
  const workflow = buildWorkflow({ reference, prompt, seed, prefix: `codebuddy-identity/${id}` });
  const submitted = await readJson(await fetchWithTimeout(endpoint(base, '/prompt'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
  }), 'ComfyUI prompt');
  if (typeof submitted.prompt_id !== 'string') {
    throw new Error(`ComfyUI rejected workflow: ${JSON.stringify(submitted).slice(0, 500)}`);
  }
  const output = await waitForOutput(base, submitted.prompt_id);
  const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type });
  const response = await fetchWithTimeout(endpoint(base, `/view?${query.toString()}`), {}, 120_000);
  return readBoundedPng(response);
}

async function main(): Promise<void> {
  const base = validateBaseUrl(argument('base-url', DEFAULT_BASE_URL));
  const referencePath = path.resolve(argument('reference', DEFAULT_REFERENCE));
  const outputRoot = path.resolve(argument('out', DEFAULT_OUTPUT));
  const count = parseCount(argument('count', String(VARIATIONS.length)));
  const subjectId = validatedSlug(argument('subject-id', 'lisa'), 'subject-id');
  const triggerToken = validatedTrigger(argument('trigger-token', 'ohwx'));
  const claimedRightsBasis = rightsBasis(argument('rights-basis', 'unverified'));
  await fs.mkdir(outputRoot, { recursive: true });
  const referenceBytes = await fs.readFile(referencePath);
  const referenceSha256 = createHash('sha256').update(referenceBytes).digest('hex');
  const uploaded = await uploadReference(base, referencePath);
  const workflowReference = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;

  console.log(`[identity-dataset] darkstar=${base.origin} count=${count} reference=${referenceSha256}`);
  for (let index = 0; index < count; index++) {
    const id = `${subjectId}_identity_${String(index + 1).padStart(3, '0')}`;
    const destination = path.join(outputRoot, `${id}.png`);
    if (await candidateComplete(outputRoot, id)) {
      console.log(`SKIP ${index + 1}/${count} ${id}`);
      continue;
    }
    const prompt = VARIATIONS[index]!;
    const seed = randomInt(0, 2_000_000_000);
    console.log(`RUN  ${index + 1}/${count} ${id} seed=${seed}`);
    const bytes = await generateOne(base, workflowReference, prompt, seed, id);
    const metadata = `${JSON.stringify({
      schemaVersion: 1,
      id,
      models: MODEL_LOCK,
      workflowRevision: WORKFLOW_REVISION,
      prompt,
      seed,
      referencePath,
      referenceSha256,
      outputSha256: createHash('sha256').update(bytes).digest('hex'),
      subjectId,
      triggerToken,
      claimedIdentityRightsBasis: claimedRightsBasis,
      rightsEvidenceStatus: 'unverified-pending-human-review',
      claimedContentTier: 'safe',
      contentReviewStatus: 'pending-human-review',
      generatedAt: new Date().toISOString(),
      status: 'candidate-pending-human-identity-review',
    }, null, 2)}\n`;
    await writeNewFileAtomically(destination, bytes);
    await writeNewFileAtomically(
      path.join(outputRoot, `${id}.txt`),
      `${triggerToken} ${subjectId}, ${prompt}\n`,
    );
    await writeNewFileAtomically(path.join(outputRoot, `${id}.json`), metadata);
    console.log(`OK   ${index + 1}/${count} ${destination}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
