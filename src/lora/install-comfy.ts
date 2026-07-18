/**
 * Install a trained LoRA into a local ComfyUI models/loras directory.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export function candidateComfyRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = [];
  if (env.COMFYUI_ROOT?.trim()) roots.push(path.resolve(env.COMFYUI_ROOT.trim()));
  const home = os.homedir();
  roots.push(
    path.join(home, 'ComfyUI'),
    path.join(home, 'DEV', 'ComfyUI'),
    path.join(home, '.codebuddy', 'comfyui'),
  );
  return roots;
}

export async function resolveComfyLorasDir(
  preferredRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const roots = preferredRoot
    ? [path.resolve(preferredRoot), ...candidateComfyRoots(env)]
    : candidateComfyRoots(env);
  for (const root of roots) {
    const loras = path.join(root, 'models', 'loras');
    try {
      await fs.access(root);
      await fs.mkdir(loras, { recursive: true });
      return loras;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function installLoraToComfy(options: {
  loraPath: string;
  name?: string;
  comfyRoot?: string;
}): Promise<{ destPath: string; lorasDir: string }> {
  const src = path.resolve(options.loraPath);
  await fs.access(src);
  const lorasDir = await resolveComfyLorasDir(options.comfyRoot);
  if (!lorasDir) {
    throw new Error(
      'No ComfyUI root found. Set COMFYUI_ROOT or install under ~/ComfyUI, ~/DEV/ComfyUI, or ~/.codebuddy/comfyui',
    );
  }
  const base =
    (options.name?.trim() || path.basename(src, path.extname(src))).replace(
      /[^a-zA-Z0-9._-]+/g,
      '-',
    ) + '.safetensors';
  const destPath = path.join(lorasDir, base);
  await fs.copyFile(src, destPath);
  // Sidecar for Code Buddy / companion: how to call the LoRA
  const side = destPath.replace(/\.safetensors$/i, '.codebuddy.json');
  await fs.writeFile(
    side,
    JSON.stringify(
      {
        name: path.basename(base, '.safetensors'),
        installedAt: new Date().toISOString(),
        source: src,
        usage: {
          comfyui: 'Load Krea 2 base + this LoRA in models/loras',
          triggerHint: 'Use the trigger phrase from project.json when prompting',
          codeBuddy: 'CODEBUDDY_IMAGE_PROVIDER=comfyui with a workflow that references this LoRA',
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return { destPath, lorasDir };
}

export async function listInstalledLoras(comfyRoot?: string): Promise<string[]> {
  const dir = await resolveComfyLorasDir(comfyRoot);
  if (!dir) return [];
  const names = await fs.readdir(dir);
  return names.filter((n) => n.endsWith('.safetensors')).sort();
}
