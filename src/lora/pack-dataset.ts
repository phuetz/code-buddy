/**
 * Pack images (+ captions) into a .zip for fal Krea 2 trainer.
 */

import fs from 'fs/promises';
import path from 'path';
import type JSZipInstance from 'jszip';
import { listImages } from './dataset.js';

export async function packDatasetZip(
  projectDirectory: string,
  outZipPath?: string,
): Promise<{ zipPath: string; fileCount: number }> {
  const imagesDir = path.join(projectDirectory, 'images');
  const images = await listImages(imagesDir);
  if (images.length === 0) {
    throw new Error(`No images to pack in ${imagesDir}`);
  }

  const zipPath =
    outZipPath ?? path.join(projectDirectory, 'dataset.zip');

  const jszipModule = await import('jszip');
  type JSZipConstructor = new () => JSZipInstance;
  const JSZip = ((jszipModule as unknown as { default?: JSZipConstructor }).default
    ?? jszipModule) as unknown as JSZipConstructor;
  const zip = new JSZip();

  let fileCount = 0;
  for (const img of images) {
    const imgPath = path.join(imagesDir, img);
    const buf = await fs.readFile(imgPath);
    zip.file(img, buf);
    fileCount += 1;
    const stem = img.replace(/\.[^.]+$/, '');
    const capPath = path.join(imagesDir, `${stem}.txt`);
    try {
      const cap = await fs.readFile(capPath);
      zip.file(`${stem}.txt`, cap);
      fileCount += 1;
    } catch {
      /* optional caption */
    }
  }

  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fs.writeFile(zipPath, content);
  return { zipPath, fileCount };
}
