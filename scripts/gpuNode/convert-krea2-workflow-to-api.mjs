#!/usr/bin/env node

/** Export the installed Krea 2 identity-edit UI graph through graphToPrompt. */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const [uiPath, outPath, comfyUrl = 'http://127.0.0.1:8189'] = process.argv.slice(2);
if (!uiPath || !outPath) {
  console.error(
    'Usage: node scripts/gpuNode/convert-krea2-workflow-to-api.mjs ' +
      '<ui.json> <api-out.json> [comfyUrl]',
  );
  process.exit(2);
}

const workflow = JSON.parse(readFileSync(uiPath, 'utf8'));
const requiredTypes = [
  'UNETLoader',
  'CLIPLoader',
  'LoraLoaderModelOnly',
  'Krea2EditModelPatch',
  'Krea2EditGroundedEncode',
  'KSampler',
  'SaveImage',
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));
  await page.goto(comfyUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    const app = window.app ?? window.comfyAPI?.app?.app;
    return Boolean(app?.graph && typeof app.graphToPrompt === 'function');
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction(
    (types) => {
      const registered = window.LiteGraph?.registered_node_types;
      return Boolean(registered && types.every((type) => registered[type]));
    },
    requiredTypes,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(3_000);

  const result = await page.evaluate(async ({ uiWorkflow, types }) => {
    const app = window.app ?? window.comfyAPI?.app?.app;
    await app.loadGraphData(uiWorkflow);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const nodeTypes = app.graph._nodes.map((node) =>
      String(node.type ?? node.comfyClass),
    );
    const missing = types.filter((type) => !nodeTypes.includes(type));
    if (missing.length > 0) {
      throw new Error(
        `Missing node types after loadGraphData: ${missing.join(', ')}; ` +
          `graph contains: ${nodeTypes.join(', ')}`,
      );
    }

    const lora = app.graph._nodes.find(
      (node) => String(node.type ?? node.comfyClass) === 'LoraLoaderModelOnly',
    );
    const fileWidget = lora?.widgets?.find((widget) => widget.name === 'lora_name');
    if (!fileWidget) throw new Error('Krea 2 adapter LoRA widget not found');
    fileWidget.value = 'krea2_identity_edit_v1_2.safetensors';

    const prompt = await app.graphToPrompt();
    return prompt.output;
  }, { uiWorkflow: workflow, types: requiredTypes });

  if (Object.keys(result).length === 0) {
    throw new Error('graphToPrompt returned an empty prompt');
  }
  const types = new Set(Object.values(result).map((node) => node.class_type));
  for (const requiredType of requiredTypes) {
    if (!types.has(requiredType)) {
      throw new Error(`API export is missing ${requiredType}`);
    }
  }

  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(`OK ${Object.keys(result).length} nodes -> ${outPath}`);
} finally {
  await browser.close();
}
