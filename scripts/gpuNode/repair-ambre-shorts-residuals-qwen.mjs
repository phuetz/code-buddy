#!/usr/bin/env node

/**
 * Seconde passe Qwen-Edit, non destructive, sur les deux résidus des Shorts
 * d'Ambre. Les images générées sont recomposées sur les sources v3 exactes :
 * aucun pixel hors masque ne peut changer.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const comfyUrl = process.env.QWEN_RESIDUAL_COMFY_URL ?? 'http://127.0.0.1:8189';
const sourceRoot =
  '/home/patrice/Videos/personas/garde-robe-reparee/final-short-qc-20260731';
const outputRoot =
  '/home/patrice/Videos/personas/garde-robe-reparee/final-short-qc-20260731-v4';
const qcRoot =
  '/home/patrice/Videos/publication-2026-07-30/qc/reparation-2026-07-31/' +
  'seconde-passe';
const workflowPath = new URL('./workflows/insert-qwen-edit.json', import.meta.url);

const commonPrompt =
  'Retouche locale stricte. Reconstituer uniquement la continuité naturelle du ' +
  'fond et, si le masque la rencontre, de la peau immédiatement voisine. ' +
  'Conserver exactement la personne, son identité, sa pose, son vrai bras, sa ' +
  'main, son visage, ses cheveux, son vêtement, son drapé, sa lumière et son ' +
  'cadrage. Ne rien ajouter. Aucun halo, liseré, couture, trait, silhouette ou ' +
  'membre supplémentaire. Tout pixel hors masque doit rester strictement ' +
  'identique à la source.';

const tasks = [
  {
    id: 1,
    slug: 'ambre-kimono-azur-une-piece',
    output: 'ambre-kimono-azur-une-piece-v4.png',
    crop: { left: 760, top: 760, width: 320, height: 1040 },
    mask: path.join(qcRoot, 'masques/01-azur-bras-bord-droit-mask.png'),
    prompt:
      "Effacer le fragment d'ancien bras couvert par le masque au bord droit. " +
      'Restaurer le fond de plage continu derrière lui sans toucher au kimono ' +
      'azur, à la manche, au bras réel ni à la main réelle.',
  },
  {
    id: 3,
    slug: 'ambre-robe-longue-fluide-dos-nu',
    output: 'ambre-robe-longue-fluide-dos-nu-v4.png',
    crop: { left: 760, top: 950, width: 260, height: 600 },
    mask: path.join(qcRoot, 'masques/03-orange-ligne-sous-bras-mask.png'),
    prompt:
      'Effacer la fine ligne verticale couverte par le masque sous le bras. ' +
      'Restaurer la continuité du fond immédiatement voisin sans modifier la ' +
      'peau du vrai bras ni le drapé orange déjà réparé.',
  },
].map((task) => ({
  ...task,
  source: path.join(sourceRoot, `${task.slug}.png`),
  destination: path.join(outputRoot, task.output),
}));

function endpoint(route) {
  return `${comfyUrl.replace(/\/+$/u, '')}${route}`;
}

async function getJson(route, options = undefined) {
  const response = await fetch(endpoint(route), options);
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${route}: HTTP ${response.status}`);
  }
  return response.json();
}

async function uploadImage(filePath, remoteName) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set('image', new Blob([bytes], { type: 'image/png' }), remoteName);
  form.set('type', 'input');
  form.set('overwrite', 'true');
  const result = await getJson('/upload/image', { method: 'POST', body: form });
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function prepareInputs(task, attempt) {
  const workDir = path.join(qcRoot, 'qwen', task.slug, `attempt-${attempt}`);
  await mkdir(workDir, { recursive: true });
  const cropPath = path.join(workDir, 'source-crop.png');
  const maskPath = path.join(workDir, 'mask-crop.png');
  await sharp(task.source).extract(task.crop).png().toFile(cropPath);
  await sharp(task.mask)
    .extract(task.crop)
    .blur(0.8)
    .threshold(8)
    .png()
    .toFile(maskPath);
  if (task.id === 3 && attempt === 3) {
    const source = await sharp(cropPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mask = await sharp(maskPath).greyscale().raw().toBuffer();
    const pixels = Buffer.from(source.data);
    const channels = source.info.channels;
    for (let y = 0; y < source.info.height; y += 1) {
      let x = 0;
      while (x < source.info.width) {
        if (mask[y * source.info.width + x] === 0) {
          x += 1;
          continue;
        }
        const start = x;
        while (
          x < source.info.width &&
          mask[y * source.info.width + x] !== 0
        ) {
          x += 1;
        }
        const end = x - 1;
        const left = Math.max(0, start - 1);
        const right = Math.min(source.info.width - 1, end + 1);
        for (let current = start; current <= end; current += 1) {
          const mix = (current - start + 1) / (end - start + 2);
          for (let channel = 0; channel < channels; channel += 1) {
            const leftValue = source.data[(y * source.info.width + left) * channels + channel];
            const rightValue = source.data[(y * source.info.width + right) * channels + channel];
            pixels[(y * source.info.width + current) * channels + channel] =
              Math.round(leftValue * (1 - mix) + rightValue * mix);
          }
        }
      }
    }
    await sharp(pixels, { raw: source.info }).png().toFile(cropPath);
  }
  return { workDir, cropPath, maskPath };
}

function configureWorkflow(template, task, attempt, cropName, maskName, sourceName) {
  const graph = clone(template);
  const retry =
    attempt === 1
      ? ''
      : ' Dernière tentative : supprimer complètement le résidu, en copiant la ' +
        'texture et les couleurs du fond à quelques pixels de part et d’autre.';
  graph['4'].inputs.image = cropName;
  graph['5'].inputs.image = cropName;
  graph['6'].inputs.prompt = `${task.prompt} ${commonPrompt}${retry}`;
  graph['9'].inputs.pixels = ['4', 0];
  graph['10'].inputs.seed = 7314000 + task.id * 10 + attempt;
  graph['10'].inputs.latent_image = ['15', 0];
  graph['12'].inputs.images = ['18', 0];
  graph['12'].inputs.filename_prefix =
    `ambre-shorts-v4/${task.slug}-residual-a${attempt}`;
  graph['13'] = {
    class_type: 'LoadImage',
    inputs: { image: maskName },
    _meta: { title: 'Masque résiduel étroit' },
  };
  graph['14'] = {
    class_type: 'ImageToMask',
    inputs: { image: ['13', 0], channel: 'red' },
    _meta: { title: 'Masque depuis le canal blanc' },
  };
  graph['15'] = {
    class_type: 'SetLatentNoiseMask',
    inputs: { samples: ['9', 0], mask: ['14', 0] },
    _meta: { title: 'Bruit limité au masque' },
  };
  graph['16'] = {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['4', 0],
      source: ['11', 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ['14', 0],
    },
    _meta: { title: 'Crop source exact hors masque' },
  };
  graph['17'] = {
    class_type: 'LoadImage',
    inputs: { image: sourceName },
    _meta: { title: 'Source v3 intacte' },
  };
  graph['18'] = {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['17', 0],
      source: ['16', 0],
      x: task.crop.left,
      y: task.crop.top,
      resize_source: false,
      mask: ['14', 0],
    },
    _meta: { title: 'Retouche dans la source complète' },
  };
  return graph;
}

async function runGraph(graph, label) {
  const submitted = await getJson('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
  });
  if (!submitted.prompt_id) {
    throw new Error(`Soumission refusée ${label}: ${JSON.stringify(submitted)}`);
  }
  process.stdout.write(`SUBMITTED ${label} ${submitted.prompt_id}\n`);
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const current = await getJson(`/history/${submitted.prompt_id}`);
    const history = current[submitted.prompt_id];
    if (history?.status?.completed) {
      if (history.status.status_str !== 'success') {
        throw new Error(`${label} a échoué : ${JSON.stringify(history.status)}`);
      }
      const image = Object.values(history.outputs ?? {})
        .flatMap((output) => output.images ?? [])
        .at(0);
      if (!image) throw new Error(`Aucune image : ${label}`);
      return { promptId: submitted.prompt_id, image };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Délai dépassé : ${label}`);
}

async function downloadImage(image, destination) {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output',
  });
  const response = await fetch(endpoint(`/view?${query.toString()}`));
  if (!response.ok) throw new Error(`GET /view : HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function selectedTasks() {
  const only = process.argv.find((value) => value.startsWith('--only='));
  if (!only) return tasks;
  const wanted = new Set(only.slice(7).split(',').map((value) => value.trim()));
  return tasks.filter(
    (task) => wanted.has(String(task.id)) || wanted.has(task.slug),
  );
}

async function main() {
  const attempt = Number(
    process.argv.find((value) => value.startsWith('--attempt='))?.split('=')[1] ?? 1,
  );
  if (![1, 2, 3].includes(attempt)) {
    throw new Error('--attempt doit valoir 1, 2 ou 3');
  }

  const stats = await getJson('/system_stats');
  if (stats.system?.os !== 'win32') {
    throw new Error(`Refus : os=${stats.system?.os}, gpuNode win32 attendu`);
  }
  const queue = await getJson('/queue');
  if (queue.queue_running?.length || queue.queue_pending?.length) {
    throw new Error('GPU node occupé : aucune soumission, aucune interruption');
  }

  const template = JSON.parse(await readFile(workflowPath, 'utf8'));
  await mkdir(outputRoot, { recursive: true });
  const metricsPath = path.join(qcRoot, 'qwen/run-metrics.json');
  let metrics = [];
  try {
    metrics = JSON.parse(await readFile(metricsPath, 'utf8'));
  } catch {
    metrics = [];
  }

  for (const task of selectedTasks()) {
    const prepared = await prepareInputs(task, attempt);
    const prefix = `ambre-v4-${task.id}-a${attempt}`;
    const cropName = await uploadImage(prepared.cropPath, `${prefix}-crop.png`);
    const maskName = await uploadImage(prepared.maskPath, `${prefix}-mask.png`);
    const sourceName = await uploadImage(task.source, `${prefix}-source.png`);
    const graph = configureWorkflow(
      template,
      task,
      attempt,
      cropName,
      maskName,
      sourceName,
    );
    await writeFile(
      path.join(prepared.workDir, 'prompt.json'),
      `${JSON.stringify(graph, null, 2)}\n`,
      { flag: 'wx' },
    );
    const startedAt = Date.now();
    const result = await runGraph(graph, `${task.id}/${task.slug}/a${attempt}`);
    const destination =
      attempt === 1
        ? task.destination
        : task.destination.replace(/\.png$/u, `-a${attempt}.png`);
    await downloadImage(result.image, destination);

    const [sourceBytes, outputBytes] = await Promise.all([
      readFile(task.source),
      readFile(destination),
    ]);
    metrics.push({
      id: task.id,
      slug: task.slug,
      attempt,
      source: task.source,
      output: destination,
      mask: task.mask,
      crop: task.crop,
      prompt: graph['6'].inputs.prompt,
      seed: graph['10'].inputs.seed,
      promptId: result.promptId,
      sourceSha256: sha256(sourceBytes),
      outputSha256: sha256(outputBytes),
      durationSeconds: (Date.now() - startedAt) / 1000,
      costUsd: 0,
    });
    await mkdir(path.dirname(metricsPath), { recursive: true });
    await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    process.stdout.write(`DONE ${task.slug} -> ${destination}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
