/**
 * Read an OpenClaw workspace (SOUL.md, HEARTBEAT.md, MEMORY.md, USER.md)
 * without vendoring the OpenClaw runtime.
 *
 * OpenClaw is MIT © 2026 OpenClaw Foundation. This module copies the *file
 * contract* documented by OpenClaw (which files seed agent context), not their
 * gateway or channel implementations. See docs/openclaw-gap.md.
 *
 * @module openclaw/workspace-files
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OPENCLAW_WORKSPACE_FILENAMES = [
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'HEARTBEAT.md',
  'AGENTS.md',
  'TOOLS.md',
  'IDENTITY.md',
] as const;

export type OpenClawWorkspaceFileName = (typeof OPENCLAW_WORKSPACE_FILENAMES)[number];

export interface OpenClawWorkspaceFile {
  name: OpenClawWorkspaceFileName;
  path: string;
  content: string;
}

export interface OpenClawWorkspaceSnapshot {
  dir: string;
  files: OpenClawWorkspaceFile[];
}

export function resolveOpenClawWorkspaceDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_OPENCLAW_WORKSPACE?.trim() || env.OPENCLAW_WORKSPACE?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), '.openclaw', 'workspace');
}

export function isOpenClawWorkspaceImportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

export function readOpenClawWorkspace(
  env: NodeJS.ProcessEnv = process.env,
): OpenClawWorkspaceSnapshot | null {
  const dir = resolveOpenClawWorkspaceDir(env);
  if (!fs.existsSync(dir)) return null;
  const files: OpenClawWorkspaceFile[] = [];
  for (const name of OPENCLAW_WORKSPACE_FILENAMES) {
    const filePath = path.join(dir, name);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (!content) continue;
      files.push({ name, path: filePath, content });
    } catch {
      /* missing file is normal */
    }
  }
  return { dir, files };
}

const CONTEXT_CAP = 1_200;

function cap(content: string): string {
  if (content.length <= CONTEXT_CAP) return content;
  return `${content.slice(0, CONTEXT_CAP - 1).trimEnd()}…`;
}

/** Compact block Lisa can inject. Empty when the workspace is absent. */
export function formatOpenClawWorkspaceContext(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isOpenClawWorkspaceImportEnabled(env)) return '';
  const snapshot = readOpenClawWorkspace(env);
  if (!snapshot || snapshot.files.length === 0) return '';
  const preferred: OpenClawWorkspaceFileName[] = ['SOUL.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
  const picked = preferred
    .map((name) => snapshot.files.find((file) => file.name === name))
    .filter((file): file is OpenClawWorkspaceFile => Boolean(file));
  if (picked.length === 0) return '';
  const parts = [
    'Contexte OpenClaw (workspace local, import opt-in) :',
    ...picked.map((file) => `## ${file.name}\n${cap(file.content)}`),
  ];
  return parts.join('\n\n');
}
