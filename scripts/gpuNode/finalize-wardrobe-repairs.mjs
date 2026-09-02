#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = '/home/patrice/Videos/personas/garde-robe-reparee';
const scoreFiles = [
  'arcface-ambre-attempt-1.json',
  'arcface-lisa-attempt-1.json',
  'arcface-ambre-retries.json',
  'arcface-lisa-retries.json',
];
const entries = [
  [1, 'ambre-cocooning-flanelle-sapin', 'ambre-cocooning-flanelle-sapin.png'],
  [2, 'ambre-doudoune-sapin', 'ambre-doudoune-sapin.png'],
  [3, 'ambre-kimono-manteau-rouille', 'ambre-kimono-manteau-rouille.png'],
  [4, 'ambre-kimono-traditionnel-sakura', 'ambre-kimono-traditionnel-sakura.png'],
  [5, 'ambre-manteau-voyage-bordeaux', 'ambre-manteau-voyage-bordeaux.png'],
  [6, 'ambre-pull-torsade-creme', 'ambre-pull-torsade-creme.png'],
  [7, 'ambre-trench-camel', 'ambre-trench-camel.png'],
  [8, 'ambre-velours-cognac-echarpe', 'ambre-velours-cognac-echarpe.png'],
  [9, 'ambre-chemise-lin-chapeau', 'ambre-chemise-lin-chapeau.png'],
  [10, 'ambre-combishort-lin-sable', 'ambre-combishort-lin-sable.png'],
  [11, 'ambre-jupe-pareo-bandeau', 'ambre-jupe-pareo-bandeau.png'],
  [12, 'ambre-kimono-azur-une-piece', 'ambre-kimono-azur-une-piece.png'],
  [13, 'ambre-maillot-une-piece-corail', 'ambre-maillot-une-piece-corail.png'],
  [14, 'ambre-robe-longue-fluide-dos-nu', 'ambre-robe-longue-fluide-dos-nu.png'],
  [15, 'ambre-robe-plage-crochet-ecru', 'ambre-robe-plage-crochet-ecru.png'],
  [16, 'ambre-une-piece-blanc-pareo-imprime', 'ambre-une-piece-blanc-pareo-imprime.png'],
  [17, 'lisa-jean-chemisier', 'lisa-jean-chemisier.png'],
  [18, 'lisa-col-roule-bordeaux', 'lisa-col-roule-bordeaux-retry.png'],
  [19, 'ambre-030-salon-dore-flanelle', 'ambre-030-salon-dore-flanelle-retry.png'],
  [20, 'ambre-034-ruelle-pluie-trench', 'ambre-034-ruelle-pluie-trench-retry.png'],
  [21, 'ambre-035-ruelle-pluie-bordeaux', 'ambre-035-ruelle-pluie-bordeaux-retry.png'],
];

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function splitLabel(value, limit = 28) {
  const words = value.split('-');
  const lines = [''];
  for (const word of words) {
    const current = lines.at(-1);
    const candidate = current ? `${current}-${word}` : word;
    if (candidate.length > limit && current) lines.push(word);
    else lines[lines.length - 1] = candidate;
  }
  return lines.slice(0, 2);
}

async function main() {
  const scores = new Map();
  for (const filename of scoreFiles) {
    const rows = JSON.parse(await readFile(path.join(root, filename), 'utf8'));
    for (const row of rows) scores.set(path.basename(row.path), row.arcface);
  }

  const selection = [];
  for (const [id, slug, filename] of entries) {
    const selectedPath = path.join(root, filename);
    const qc = JSON.parse(await readFile(`${selectedPath}.qc.json`, 'utf8'));
    const arcface = scores.get(filename);
    if (typeof arcface !== 'number') throw new Error(`Missing ArcFace score: ${filename}`);
    const repaired = arcface >= 0.55 && qc.verdict !== 'REJET';
    selection.push({
      id,
      slug,
      persona: slug.startsWith('lisa-') ? 'lisa' : 'ambre',
      selected: selectedPath,
      selected_attempt: filename.endsWith('-retry.png') ? 2 : 1,
      arcface,
      arcface_threshold: 0.55,
      arcface_target: 0.75,
      visual_gate: qc.verdict,
      defects: qc.defauts ?? [],
      status: repaired ? 'réparé' : 'irréparable → à regénérer GPT Image',
      cost_usd: 0,
    });
  }

  const finalDir = path.join(root, 'final');
  const rejectedDir = path.join(root, 'irreparables');
  await mkdir(finalDir, { recursive: true });
  await mkdir(rejectedDir, { recursive: true });
  for (const item of selection) {
    const destinationDir = item.status === 'réparé' ? finalDir : rejectedDir;
    await copyFile(item.selected, path.join(destinationDir, `${item.slug}.png`));
    await copyFile(`${item.selected}.qc.json`, path.join(destinationDir, `${item.slug}.png.qc.json`));
  }

  await writeFile(
    path.join(root, 'selection-finale.json'),
    `${JSON.stringify(selection, null, 2)}\n`,
  );
  const csvRows = [
    'id,slug,persona,tentative,arcface,gate,statut',
    ...selection.map((item) =>
      [
        item.id,
        item.slug,
        item.persona,
        item.selected_attempt,
        item.arcface.toFixed(6),
        item.visual_gate,
        `"${item.status}"`,
      ].join(','),
    ),
  ];
  await writeFile(path.join(root, 'selection-finale.csv'), `${csvRows.join('\n')}\n`);

  const columns = 4;
  const tileWidth = 420;
  const tileHeight = 570;
  const rows = Math.ceil(selection.length / columns);
  const board = sharp({
    create: {
      width: columns * tileWidth,
      height: rows * tileHeight + 100,
      channels: 3,
      background: '#101216',
    },
  });
  const composites = [];
  const titleSvg = Buffer.from(
    `<svg width="${columns * tileWidth}" height="100" xmlns="http://www.w3.org/2000/svg">` +
      '<rect width="100%" height="100%" fill="#101216"/>' +
      '<text x="40" y="44" fill="#ffffff" font-family="DejaVu Sans" font-size="30" font-weight="700">' +
      'Garde-robe réparée — Qwen-Edit masqué</text>' +
      '<text x="40" y="78" fill="#b9c2cf" font-family="DejaVu Sans" font-size="20">' +
      'ArcFace seuil 0,55 · cible 0,75 · gate visuel local</text></svg>',
  );
  composites.push({ input: titleSvg, left: 0, top: 0 });

  for (let index = 0; index < selection.length; index += 1) {
    const item = selection[index];
    const repaired = item.status === 'réparé';
    const background = repaired ? '#173629' : '#4a1f24';
    const accent = repaired ? '#7ee2a8' : '#ff8e98';
    const image = await sharp(item.selected)
      .resize(380, 400, {
        fit: 'contain',
        background: '#090a0c',
        withoutEnlargement: true,
      })
      .flatten({ background: '#090a0c' })
      .jpeg({ quality: 91 })
      .toBuffer();
    const labelLines = splitLabel(item.slug);
    const text = [
      `<text x="20" y="438" fill="#ffffff" font-family="DejaVu Sans" font-size="19" font-weight="700">${escapeXml(`${String(item.id).padStart(2, '0')}. ${labelLines[0]}`)}</text>`,
      labelLines[1]
        ? `<text x="20" y="464" fill="#ffffff" font-family="DejaVu Sans" font-size="19" font-weight="700">${escapeXml(labelLines[1])}</text>`
        : '',
      `<text x="20" y="500" fill="${accent}" font-family="DejaVu Sans" font-size="20" font-weight="700">ArcFace ${item.arcface.toFixed(3)} · ${escapeXml(item.visual_gate)}</text>`,
      `<text x="20" y="532" fill="${accent}" font-family="DejaVu Sans" font-size="18">${escapeXml(repaired ? 'RÉPARÉ' : 'IRRÉPARABLE → GPT IMAGE')}</text>`,
    ].join('');
    const tile = await sharp({
      create: {
        width: 400,
        height: 550,
        channels: 3,
        background,
      },
    })
      .composite([
        { input: image, left: 10, top: 10 },
        {
          input: Buffer.from(
            `<svg width="400" height="550" xmlns="http://www.w3.org/2000/svg">${text}</svg>`,
          ),
          left: 0,
          top: 0,
        },
      ])
      .jpeg({ quality: 92 })
      .toBuffer();
    composites.push({
      input: tile,
      left: (index % columns) * tileWidth + 10,
      top: Math.floor(index / columns) * tileHeight + 110,
    });
  }

  await board
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'planche-contact-reparations.jpg'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
