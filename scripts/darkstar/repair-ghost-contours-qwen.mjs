#!/usr/bin/env node

/**
 * Retouches non destructives des contours de détourage résiduels d'Ambre.
 *
 * Qwen-Image-Edit ne reçoit qu'un crop du torse et un masque très étroit :
 * traits de 10 px autour des lignes fantômes, ou polygones serrés pour les
 * deux masses anatomiques parasites du maillot corail. Le résultat généré est
 * recomposé sur la source exacte ; tous les pixels hors masque sont conservés.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const comfyUrl =
  process.env.QWEN_GHOST_COMFY_URL ?? 'http://127.0.0.1:8189';
const sourceRoot =
  process.env.QWEN_GHOST_SOURCE ??
  '/home/patrice/Videos/personas/garde-robe-reparee/final';
const outputRoot =
  process.env.QWEN_GHOST_OUTPUT ??
  '/home/patrice/Videos/personas/garde-robe-reparee/' +
    'contours-fantomes-20260731/qwen';
const workflowPath = new URL(
  './workflows/insert-qwen-edit.json',
  import.meta.url,
);

const commonPrompt =
  'Effacer uniquement le contour résiduel de détourage couvert par le masque. ' +
  'Reconstituer la continuité naturelle de la peau, du tissu et du fond de part ' +
  "et d'autre du trait, sans halo, couture, liseré ni silhouette supplémentaire. " +
  'Ne modifier ni la pose, ni le vêtement, ni les bras réels, ni les mains, ni le ' +
  "visage, ni les cheveux, ni l'expression, ni la lumière, ni le cadrage. " +
  'Tout pixel hors du masque doit rester strictement identique à la source.';

const rightGhostLine = {
  type: 'polyline',
  points: [
    [895, 945],
    [895, 1180],
    [890, 1375],
    [883, 1420],
    [872, 1470],
    [840, 1500],
    [803, 1525],
    [811, 1550],
    [816, 1600],
    [833, 1625],
    [816, 1650],
    [840, 1685],
  ],
  strokeWidth: 10,
};

const tasks = [
  {
    id: 2,
    slug: 'ambre-combishort-lin-sable',
    prompt:
      "Retirer la fine ancienne silhouette de bras visible dans le vide entre " +
      'le flanc et le bras droit.',
    shapes: [rightGhostLine],
  },
  {
    id: 3,
    slug: 'ambre-jupe-pareo-bandeau',
    prompt:
      "Retirer la fine ancienne silhouette de bras visible dans le vide entre " +
      'le crop-top et le bras droit.',
    shapes: [rightGhostLine],
  },
  {
    id: 4,
    slug: 'ambre-kimono-azur-une-piece',
    prompt:
      'Retirer le fin contour fantôme dans le fond entre le kimono et le bras ' +
      'droit, sans modifier le kimono azur ni le maillot marine.',
    shapes: [rightGhostLine],
  },
  {
    id: 5,
    slug: 'ambre-maillot-une-piece-corail',
    prompt:
      "Sous l'aisselle droite, retirer la petite masse de chair et la languette " +
      'corail surnuméraires, puis restaurer le fond sombre entre le flanc et le seul ' +
      'bras réel. Retirer aussi le fragment de second bras entrant du bord inférieur ' +
      'droit. Conserver exactement le bras principal et le maillot hors masque.',
    crop: { left: 650, top: 820, width: 430, height: 880 },
    shapes: [
      {
        type: 'polygon',
        points: [
          [786, 943],
          [855, 916],
          [902, 1025],
          [851, 1192],
          [782, 1153],
        ],
      },
      {
        type: 'polygon',
        points: [
          [1030, 1120],
          [1080, 1140],
          [1080, 1645],
          [1026, 1575],
        ],
      },
    ],
  },
  {
    id: 6,
    slug: 'ambre-robe-longue-fluide-dos-nu',
    prompt:
      'Retirer la fine ancienne silhouette verticale visible dans le fond entre le ' +
      'corsage orange et le bras droit.',
    shapes: [rightGhostLine],
  },
  {
    id: 7,
    slug: 'ambre-robe-plage-crochet-ecru',
    prompt:
      'Retirer le fin contour fantôme dans le fond entre la robe en crochet et ' +
      'le bras droit, sans modifier la maille.',
    shapes: [rightGhostLine],
  },
  {
    id: 8,
    slug: 'ambre-une-piece-blanc-pareo-imprime',
    prompt:
      'Retirer la fine ancienne silhouette verticale visible dans le fond entre le ' +
      'maillot blanc et le bras droit.',
    shapes: [rightGhostLine],
  },
].map((task) => ({
  crop: { left: 35, top: 650, width: 1010, height: 1270 },
  ...task,
  source: path.join(sourceRoot, `${task.slug}.png`),
}));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function endpoint(route) {
  return `${comfyUrl.replace(/\/+$/u, '')}${route}`;
}

async function getJson(route, options = undefined) {
  const response = await fetch(endpoint(route), options);
  if (!response.ok) {
    throw new Error(
      `${options?.method ?? 'GET'} ${route}: HTTP ${response.status}`,
    );
  }
  return response.json();
}

async function uploadImage(filePath, remoteName) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set('image', new Blob([bytes], { type: 'image/png' }), remoteName);
  form.set('type', 'input');
  form.set('overwrite', 'true');
  const result = await getJson('/upload/image', {
    method: 'POST',
    body: form,
  });
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

function maskSvg(width, height, shapes) {
  const body = shapes
    .map((shape) => {
      if (shape.type === 'polyline') {
        const points = shape.points.map(([x, y]) => `${x},${y}`).join(' ');
        return (
          `<polyline points="${points}" fill="none" stroke="white" ` +
          `stroke-width="${shape.strokeWidth ?? 10}" stroke-linecap="round" ` +
          'stroke-linejoin="round"/>'
        );
      }
      if (shape.type === 'polygon') {
        const points = shape.points.map(([x, y]) => `${x},${y}`).join(' ');
        return `<polygon points="${points}" fill="white"/>`;
      }
      throw new Error(`Type de masque non pris en charge : ${shape.type}`);
    })
    .join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="black"/>${body}</svg>`,
  );
}

async function prepareInputs(task, attempt) {
  const metadata = await sharp(task.source).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Dimensions illisibles : ${task.source}`);
  }
  const workDir = path.join(
    outputRoot,
    '_work',
    task.slug,
    `attempt-${attempt}`,
  );
  await mkdir(workDir, { recursive: true });
  const cropPath = path.join(workDir, 'source-crop.png');
  const maskPath = path.join(workDir, 'mask-crop.png');
  await sharp(task.source).extract(task.crop).png().toFile(cropPath);
  const fullMask = await sharp(
    maskSvg(metadata.width, metadata.height, task.shapes),
  )
    .png()
    .blur(1.2)
    .toBuffer();
  await sharp(fullMask).extract(task.crop).png().toFile(maskPath);
  return { cropPath, maskPath, workDir };
}

function configureWorkflow(
  template,
  task,
  attempt,
  cropName,
  maskName,
  sourceName,
) {
  const graph = clone(template);
  const retryPrompt =
    attempt === 1
      ? ''
      : ' Deuxième et dernière tentative : le trait résiduel doit disparaître ' +
        'complètement. Lisser seulement les quelques pixels du masque avec les ' +
        'couleurs et la texture immédiatement voisines, sans créer de nouveau bord.';
  graph['4'].inputs.image = cropName;
  graph['5'].inputs.image = cropName;
  graph['6'].inputs.prompt =
    `${task.prompt} ${commonPrompt}${retryPrompt}`;
  graph['9'].inputs.pixels = ['4', 0];
  graph['10'].inputs.seed = 7310000 + task.id * 10 + attempt;
  graph['10'].inputs.latent_image = ['15', 0];
  graph['12'].inputs.images = ['18', 0];
  graph['12'].inputs.filename_prefix =
    `ghost-contours-20260731/${task.slug}-qwen-a${attempt}`;
  graph['13'] = {
    class_type: 'LoadImage',
    inputs: { image: maskName },
    _meta: { title: 'Narrow ghost-contour mask' },
  };
  graph['14'] = {
    class_type: 'ImageToMask',
    inputs: { image: ['13', 0], channel: 'red' },
    _meta: { title: 'Mask from white channel' },
  };
  graph['15'] = {
    class_type: 'SetLatentNoiseMask',
    inputs: { samples: ['9', 0], mask: ['14', 0] },
    _meta: { title: 'Masked latent only' },
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
    _meta: { title: 'Exact crop outside narrow mask' },
  };
  graph['17'] = {
    class_type: 'LoadImage',
    inputs: { image: sourceName },
    _meta: { title: 'Untouched full source' },
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
    _meta: { title: 'Restore narrow repair into full source' },
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
  console.log(`SUBMITTED ${label} ${submitted.prompt_id}`);
  const deadline = Date.now() + 20 * 60_000;
  let history;
  while (Date.now() < deadline) {
    const current = await getJson(`/history/${submitted.prompt_id}`);
    history = current[submitted.prompt_id];
    if (history?.status?.completed) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!history?.status?.completed) {
    throw new Error(`Délai dépassé : ${label}`);
  }
  if (history.status.status_str !== 'success') {
    throw new Error(`${label} a échoué : ${JSON.stringify(history.status)}`);
  }
  const image = Object.values(history.outputs ?? {})
    .flatMap((output) => output.images ?? [])
    .at(0);
  if (!image) throw new Error(`Aucune image de sortie : ${label}`);
  return { promptId: submitted.prompt_id, image };
}

async function downloadImage(image, destination) {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output',
  });
  const response = await fetch(endpoint(`/view?${query.toString()}`));
  if (!response.ok) throw new Error(`GET /view : HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function selectedTasks() {
  const only = process.argv.find((value) => value.startsWith('--only='));
  if (!only) return tasks;
  const requested = new Set(
    only
      .slice('--only='.length)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return tasks.filter(
    (task) =>
      requested.has(String(task.id)) || requested.has(task.slug),
  );
}

async function main() {
  const attempt = Number(
    process.argv
      .find((value) => value.startsWith('--attempt='))
      ?.split('=')[1] ?? 1,
  );
  if (![1, 2].includes(attempt)) {
    throw new Error('--attempt doit valoir 1 ou 2');
  }
  const stats = await getJson('/system_stats');
  if (stats.system?.os !== 'win32') {
    throw new Error(
      `Refus d'un ComfyUI autre que darkstar : os=${stats.system?.os}`,
    );
  }
  const queue = await getJson('/queue');
  if (queue.queue_running?.length || queue.queue_pending?.length) {
    throw new Error('File darkstar occupée : aucune interruption effectuée');
  }

  const template = JSON.parse(await readFile(workflowPath, 'utf8'));
  await mkdir(outputRoot, { recursive: true });
  const metricsPath = path.join(outputRoot, 'run-metrics.json');
  let metrics = [];
  try {
    metrics = JSON.parse(await readFile(metricsPath, 'utf8'));
  } catch {
    metrics = [];
  }

  for (const task of selectedTasks()) {
    const label =
      `${task.id.toString().padStart(2, '0')}/${task.slug}/a${attempt}`;
    console.log(`PREPARE ${label}`);
    const prepared = await prepareInputs(task, attempt);
    const prefix = `ghost-${task.id.toString().padStart(2, '0')}-a${attempt}`;
    const cropName = await uploadImage(
      prepared.cropPath,
      `${prefix}-crop.png`,
    );
    const maskName = await uploadImage(
      prepared.maskPath,
      `${prefix}-mask.png`,
    );
    const sourceName = await uploadImage(
      task.source,
      `${prefix}-source.png`,
    );
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
    );
    const startedAt = Date.now();
    const result = await runGraph(graph, label);
    const destination = path.join(
      outputRoot,
      `${task.slug}-qwen-a${attempt}.png`,
    );
    await downloadImage(result.image, destination);
    const outputMetadata = await sharp(destination).metadata();
    const sourceMetadata = await sharp(task.source).metadata();
    if (
      outputMetadata.width !== sourceMetadata.width ||
      outputMetadata.height !== sourceMetadata.height
    ) {
      throw new Error(`${label} : dimensions de sortie incorrectes`);
    }
    metrics = metrics.filter(
      (entry) => !(entry.id === task.id && entry.attempt === attempt),
    );
    metrics.push({
      id: task.id,
      slug: task.slug,
      source: task.source,
      output: destination,
      attempt,
      seed: graph['10'].inputs.seed,
      crop: task.crop,
      shapes: task.shapes,
      prompt: graph['6'].inputs.prompt,
      promptId: result.promptId,
      durationSeconds: (Date.now() - startedAt) / 1000,
      costUsd: 0,
    });
    metrics.sort(
      (left, right) => left.id - right.id || left.attempt - right.attempt,
    );
    await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`DONE ${label} -> ${destination}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
