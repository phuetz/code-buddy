#!/usr/bin/env node

/**
 * Run the fixed Ambre/Lisa Krea 2 identity benchmark on GPU node.
 *
 * This script never starts, stops, or restarts ComfyUI. It refuses to run
 * against anything except the Windows tunnel and refuses a non-empty queue.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

const comfyUrl = process.env.KREA2_COMFY_URL ?? 'http://127.0.0.1:8189';
const outputRoot =
  process.env.KREA2_BENCHMARK_OUT ??
  '/home/patrice/Videos/personas/benchmark-krea2-local-2026-07-29';
const workflowPath = new URL('./workflows/krea2-persona-edit.json', import.meta.url);

const personas = [
  {
    name: 'ambre',
    trigger: 'ohwx ambre',
    lora: 'ambre-v3-best.safetensors',
    aspectRatio: '16:9 (Widescreen)',
    reference:
      '/home/patrice/Videos/personas/ambre-scenes/automne-composites/' +
      'ambre-002-chalet-exterieur-flanelle.png',
  },
  {
    name: 'lisa',
    trigger: 'ohwx lisa',
    lora: 'lisa-v3-best.safetensors',
    aspectRatio: '9:16 (Portrait Widescreen)',
    reference: '/home/patrice/.codebuddy/personas/lisa/identity-kit/lisa-hotel-2.png',
  },
];

const prompts = [
  'même femme, même visage, manteau de laine camel, rue pavée européenne en automne, lumière douce',
  "même femme, même visage, pull col roulé crème, intérieur chaleureux près d'une fenêtre",
  "même femme, même visage, robe d'été fluide, terrasse méditerranéenne au coucher du soleil",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function getJson(route, options) {
  const response = await fetch(`${comfyUrl}${route}`, options);
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${route}: HTTP ${response.status}`);
  }
  return response.json();
}

async function uploadReference(persona) {
  const bytes = await readFile(persona.reference);
  const filename = `benchmark-krea2-${persona.name}-reference.png`;
  const form = new FormData();
  form.set('image', new Blob([bytes], { type: 'image/png' }), filename);
  form.set('type', 'input');
  form.set('overwrite', 'true');
  const result = await getJson('/upload/image', { method: 'POST', body: form });
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

function configureWorkflow(template, persona, promptIndex, config, inputName) {
  const graph = clone(template);
  const caseNumber = promptIndex + 1;
  const benchmarkPrompt = prompts[promptIndex];
  const seed = 7290000 + (persona.name === 'ambre' ? 100 : 200) + caseNumber;

  graph['72'].inputs.image = inputName;
  graph['83'].inputs.aspect_ratio = persona.aspectRatio;
  graph['84'].inputs.prompt =
    config === 'b' ? `${persona.trigger}, ${benchmarkPrompt}` : benchmarkPrompt;
  graph['85'].inputs.prompt = '';
  graph['53'].inputs.seed = seed;
  graph['29'].inputs.filename_prefix =
    `benchmark-krea2-local-2026-07-29/${config}/${persona.name}-p${caseNumber}`;

  if (config === 'a') {
    delete graph['108'];
    graph['79'].inputs.model = ['71', 0];
  } else {
    graph['108'].inputs.lora_name = persona.lora;
    graph['108'].inputs.strength_model = 1;
  }
  return { graph, seed, benchmarkPrompt, effectivePrompt: graph['84'].inputs.prompt };
}

async function runGraph(graph) {
  const clientId = randomUUID();
  const submitted = await getJson('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  });
  if (!submitted.prompt_id) {
    throw new Error(`ComfyUI rejected the prompt: ${JSON.stringify(submitted)}`);
  }

  let minVramFree = Number.POSITIVE_INFINITY;
  let maxVramUsed = 0;
  let minTorchFree = Number.POSITIVE_INFINITY;
  let maxTorchUsed = 0;
  const deadline = Date.now() + 15 * 60_000;
  let history;

  while (Date.now() < deadline) {
    const stats = await getJson('/system_stats');
    const device = stats.devices?.[0];
    if (device) {
      minVramFree = Math.min(minVramFree, device.vram_free);
      maxVramUsed = Math.max(maxVramUsed, device.vram_total - device.vram_free);
      minTorchFree = Math.min(minTorchFree, device.torch_vram_free);
      maxTorchUsed = Math.max(
        maxTorchUsed,
        device.torch_vram_total - device.torch_vram_free,
      );
    }

    const current = await getJson(`/history/${submitted.prompt_id}`);
    history = current[submitted.prompt_id];
    if (history?.status?.completed) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!history?.status?.completed) {
    throw new Error(`Timed out waiting for ${submitted.prompt_id}`);
  }
  if (history.status.status_str !== 'success') {
    throw new Error(
      `ComfyUI failed ${submitted.prompt_id}: ${JSON.stringify(history.status)}`,
    );
  }

  const messages = history.status.messages ?? [];
  const start = messages.find(([type]) => type === 'execution_start')?.[1]?.timestamp;
  const success = messages.find(([type]) => type === 'execution_success')?.[1]
    ?.timestamp;
  const image = Object.values(history.outputs ?? {})
    .flatMap((output) => output.images ?? [])
    .at(0);
  if (!image) throw new Error(`No image output for ${submitted.prompt_id}`);

  return {
    promptId: submitted.prompt_id,
    durationSeconds: start && success ? (success - start) / 1000 : null,
    minVramFreeBytes: Number.isFinite(minVramFree) ? minVramFree : null,
    peakVramUsedBytes: maxVramUsed || null,
    minTorchFreeBytes: Number.isFinite(minTorchFree) ? minTorchFree : null,
    peakTorchUsedBytes: maxTorchUsed || null,
    image,
  };
}

async function downloadImage(image, destination) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output',
  });
  const response = await fetch(`${comfyUrl}/view?${params}`);
  if (!response.ok) throw new Error(`GET /view: HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  const stats = await getJson('/system_stats');
  if (stats.system?.os !== 'win32') {
    throw new Error(`Refusing non-GPU node ComfyUI: os=${stats.system?.os}`);
  }
  const queue = await getJson('/queue');
  if (queue.queue_running?.length || queue.queue_pending?.length) {
    throw new Error('Refusing to start: GPU node ComfyUI queue is not empty');
  }

  const template = JSON.parse(await readFile(workflowPath, 'utf8'));
  await mkdir(outputRoot, { recursive: true });
  const metricsPath = path.join(outputRoot, 'run-metrics.json');
  const metrics = [];
  const uploaded = new Map();

  for (const persona of personas) {
    uploaded.set(persona.name, await uploadReference(persona));
  }

  for (const config of ['a', 'b']) {
    for (const persona of personas) {
      for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
        const configured = configureWorkflow(
          template,
          persona,
          promptIndex,
          config,
          uploaded.get(persona.name),
        );
        const label = `${config}/${persona.name}-p${promptIndex + 1}`;
        console.log(`START ${label}`);
        const result = await runGraph(configured.graph);
        const destination = path.join(
          outputRoot,
          config,
          `${persona.name}-p${promptIndex + 1}.png`,
        );
        await mkdir(path.dirname(destination), { recursive: true });
        await downloadImage(result.image, destination);
        metrics.push({
          config,
          persona: persona.name,
          prompt: `P${promptIndex + 1}`,
          benchmarkPrompt: configured.benchmarkPrompt,
          effectivePrompt: configured.effectivePrompt,
          seed: configured.seed,
          lora:
            config === 'b'
              ? { name: persona.lora, strength: 1, trigger: persona.trigger }
              : null,
          genericReferenceAdapter: {
            name: 'krea2_identity_edit_v1_2.safetensors',
            strength: 1,
            refBoost: 4,
          },
          output: destination,
          ...result,
        });
        await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
        console.log(`DONE ${label} ${result.durationSeconds?.toFixed(1)}s`);
      }
    }
  }
}

await main();
