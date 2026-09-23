/**
 * Where the daemon heartbeat reads its checklist.
 * Local `.codebuddy/HEARTBEAT.md` first, then an OpenClaw workspace file
 * when workspace import is on.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveOpenClawWorkspaceDir } from '../openclaw/workspace-files.js';

export const DEFAULT_HEARTBEAT_MARKDOWN = `# HEARTBEAT.md

## Morning
Brief doux : ce qui est ouvert dans le d\u00e9p\u00f4t, rien d'urgent invent\u00e9.

## Evening
Demander s'il a souffl\u00e9. Ne pas relancer le travail.

## Vendredi
Revue de la semaine : commits, tests rouges, rien \u00e0 inventer.
`;

export interface HeartbeatSource {
  path: string;
  label: string;
  content: string;
}

export async function ensureLocalHeartbeatFile(localPath: string): Promise<boolean> {
  try {
    await fs.access(localPath);
    return false;
  } catch {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, DEFAULT_HEARTBEAT_MARKDOWN, 'utf8');
    return true;
  }
}

export async function readHeartbeatSources(options: {
  localPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<HeartbeatSource[]> {
  const env = options.env ?? process.env;
  const sources: HeartbeatSource[] = [];

  try {
    const content = await fs.readFile(options.localPath, 'utf8');
    if (content.trim()) {
      sources.push({ path: options.localPath, label: 'code-buddy', content });
    }
  } catch {
    const seed = (env.CODEBUDDY_HEARTBEAT_SEED ?? 'true').trim().toLowerCase();
    if (seed !== 'false' && seed !== '0' && seed !== 'off') {
      try {
        const created = await ensureLocalHeartbeatFile(options.localPath);
        if (created) {
          sources.push({
            path: options.localPath,
            label: 'code-buddy',
            content: DEFAULT_HEARTBEAT_MARKDOWN,
          });
        }
      } catch {
        /* seed is best-effort */
      }
    }
  }

  const importOn = (env.CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT ?? '').trim().toLowerCase();
  if (importOn === 'true' || importOn === '1' || importOn === 'on') {
    const clawPath = path.join(resolveOpenClawWorkspaceDir(env), 'HEARTBEAT.md');
    if (path.resolve(clawPath) !== path.resolve(options.localPath)) {
      try {
        const content = await fs.readFile(clawPath, 'utf8');
        if (content.trim()) {
          sources.push({ path: clawPath, label: 'openclaw', content });
        }
      } catch {
        /* OpenClaw workspace is optional */
      }
    }
  }

  return sources;
}

export function mergeHeartbeatChecklists(sources: HeartbeatSource[]): string {
  if (sources.length === 0) return '';
  if (sources.length === 1) return sources[0]?.content ?? '';
  return sources
    .map((source) => `# Source: ${source.label} (${source.path})\n\n${source.content.trim()}`)
    .join('\n\n---\n\n');
}
