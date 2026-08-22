/** Seed the instant safe cache from the already quality-reviewed Krea dataset. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { AVATAR_STYLE_IDS } from '../src/lora/lisa-avatar-bible.js';

const root = process.cwd();
const sourceDir = path.join(root, '.codebuddy', 'lora-krea2-clean', 'lisa', 'images');
const cacheDir = path.join(root, '.codebuddy', 'lora', 'lisa', 'selfie-cache', 'safe');

let copied = 0;
for (let index = 0; index < 24; index++) {
  const style = AVATAR_STYLE_IDS[index % AVATAR_STYLE_IDS.length]!;
  const variation = Math.floor(index / AVATAR_STYLE_IDS.length) + 1;
  const sourceId = `lisa_${String(index + 1).padStart(3, '0')}`;
  const destinationDir = path.join(cacheDir, style);
  const destinationBase = `${style}-${String(variation).padStart(3, '0')}`;
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.copyFile(
    path.join(sourceDir, `${sourceId}.png`),
    path.join(destinationDir, `${destinationBase}.png`),
  );
  const sourceMeta = JSON.parse(
    await fs.readFile(path.join(sourceDir, `${sourceId}.json`), 'utf8'),
  ) as Record<string, unknown>;
  await fs.writeFile(
    path.join(destinationDir, `${destinationBase}.json`),
    JSON.stringify({
      ...sourceMeta,
      avatarId: 'lisa',
      contentTier: 'safe',
      style,
      variation,
      cacheSeedSource: sourceId,
      disclosure: 'AI-generated image',
    }, null, 2) + '\n',
    'utf8',
  );
  copied += 1;
}

process.stdout.write(`Seeded ${copied} safe Lisa selfies in ${cacheDir}\n`);
