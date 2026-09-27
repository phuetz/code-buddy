/**
 * Contexte envoyé au modèle par App Studio, côté processus principal :
 * - `candidates` : fichiers texte du projet pouvant être joints à une demande,
 *   avec leur taille et une estimation en jetons (≈ 4 caractères par jeton) ;
 * - `read` : contenu des fichiers choisis ;
 * - `locate` : l'élément cliqué dans l'aperçu → fichier et lignes sources.
 *
 * Tout est confiné au dossier du projet (racine de confiance, chemins
 * relatifs sûrs, pas de lien symbolique suivi) et les fichiers `.env*` ne sont
 * JAMAIS proposés ni lus : un secret ne part pas dans le prompt par ce chemin.
 *
 * @module main/studio/studio-context-service
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertTrustedRoot, isSafeRelativePath } from './studio-versions-service.js';

export type ContextResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ContextCandidate {
  path: string;
  bytes: number;
  tokens: number;
}

export interface ContextFile {
  path: string;
  content: string;
  tokens: number;
}

/** Ce que le script injecté dans l'aperçu rapporte de l'élément cliqué. */
export interface ElementDescriptor {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  selector?: string;
  html?: string;
  component?: string;
  /** React (dev) : `_debugSource` de la fibre, chemin absolu sur le disque. */
  source?: { fileName: string; lineNumber?: number; columnNumber?: number };
}

export interface ElementLocation {
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  method: 'source' | 'composant' | 'texte' | 'classe' | 'id';
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.codebuddy', 'dist', 'build', '.next', '.vite', 'coverage', '.turbo']);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.html', '.htm', '.css', '.scss', '.less',
  '.json', '.md', '.txt', '.yml', '.yaml', '.toml', '.svg',
]);
const SOURCE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html', '.htm']);
const MAX_FILE_BYTES = 200 * 1024;
const MAX_FILES = 400;
const MAX_EXCERPT_LINES = 40;

/** `.env`, `.env.local`, `sub/.env.production`… à tout niveau. */
export function isEnvFile(rel: string): boolean {
  const base = rel.replace(/\\/g, '/').split('/').pop() ?? '';
  return base === '.env' || base.startsWith('.env.');
}

export function estimateTokens(text: string | number): number {
  const chars = typeof text === 'number' ? text : text.length;
  return Math.ceil(chars / 4);
}

async function walk(root: string, rel = '', out: ContextCandidate[] = []): Promise<ContextCandidate[]> {
  if (out.length >= MAX_FILES) return out;
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(root, childRel, out);
      continue;
    }
    if (!entry.isFile() || isEnvFile(childRel)) continue;
    if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    if (entry.name === 'package-lock.json' || entry.name.endsWith('.lock')) continue;
    const st = await fs.stat(path.join(root, childRel)).catch(() => null);
    if (!st || st.size > MAX_FILE_BYTES) continue;
    out.push({ path: childRel, bytes: st.size, tokens: estimateTokens(st.size) });
  }
  return out;
}

function numbered(lines: string[], start: number, end: number): string {
  const out: string[] = [];
  for (let n = start; n <= end; n += 1) out.push(`${n}| ${lines[n - 1] ?? ''}`);
  return out.join('\n');
}

/** Étendue d'un élément JSX/HTML qui s'ouvre à la ligne `start` (1-based), bornée. */
export function elementExtent(lines: string[], start: number, tag: string): number {
  const name = tag.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name) return start;
  const openRe = new RegExp(`<${name}(?=[\\s>/]|$)`, 'g');
  const closeRe = new RegExp(`</${name}\\s*>`, 'g');
  let opens = 0;
  let closes = 0;
  const last = Math.min(lines.length, start + MAX_EXCERPT_LINES - 1);
  for (let n = start; n <= last; n += 1) {
    const line = (lines[n - 1] ?? '').toLowerCase();
    const o = (line.match(openRe) ?? []).length;
    opens += o;
    closes += (line.match(closeRe) ?? []).length;
    if (n === start && opens === 0) return start;
    if (n === start && o > 0 && closes === 0 && /\/>\s*$/.test(line)) return start;
    if (opens > 0 && closes >= opens) return n;
  }
  return Math.min(lines.length, start + 8);
}

export class StudioContextService {
  constructor(private readonly options: { trustedRoots?: () => string[] } = {}) {}

  private root(root: unknown): Promise<string> {
    return assertTrustedRoot(root, this.options.trustedRoots);
  }

  async candidates(root: unknown): Promise<ContextResult<ContextCandidate[]>> {
    try {
      return { ok: true, data: await walk(await this.root(root)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async readSafe(real: string, rel: string): Promise<string | null> {
    if (!isSafeRelativePath(rel) || isEnvFile(rel)) return null;
    const abs = path.join(real, rel);
    const st = await fs.lstat(abs).catch(() => null);
    if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFile(abs, 'utf8');
  }

  async read(root: unknown, paths: unknown): Promise<ContextResult<ContextFile[]>> {
    try {
      const real = await this.root(root);
      if (!Array.isArray(paths)) return { ok: false, error: 'liste de fichiers invalide' };
      const out: ContextFile[] = [];
      for (const rel of paths.slice(0, 50)) {
        if (typeof rel !== 'string') continue;
        const content = await this.readSafe(real, rel);
        if (content !== null) out.push({ path: rel, content, tokens: estimateTokens(content) });
      }
      return { ok: true, data: out };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async locate(root: unknown, descriptor: unknown): Promise<ContextResult<ElementLocation | null>> {
    try {
      const real = await this.root(root);
      const d = descriptor as ElementDescriptor | null;
      if (!d || typeof d !== 'object' || typeof d.tag !== 'string') return { ok: false, error: 'élément invalide' };
      const tag = d.tag.toLowerCase().replace(/[^a-z0-9-]/g, '');

      // 1. Source exacte (React en dev : _debugSource) — seulement si elle est DANS le projet.
      if (d.source && typeof d.source.fileName === 'string' && typeof d.source.lineNumber === 'number') {
        const abs = path.resolve(d.source.fileName.split('?')[0] ?? '');
        const rel = path.relative(real, abs);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          const posix = rel.split(path.sep).join('/');
          const content = await this.readSafe(real, posix);
          if (content !== null) {
            const lines = content.split(/\r?\n/);
            const start = Math.max(1, Math.min(lines.length, d.source.lineNumber));
            const end = elementExtent(lines, start, tag);
            return { ok: true, data: { file: posix, startLine: start, endLine: end, excerpt: numbered(lines, start, end), method: 'source' } };
          }
        }
      }

      // 2. Recherche dans les sources : texte visible, puis id, classes, composant.
      const files = (await walk(real)).filter((c) => SOURCE_EXT.has(path.extname(c.path).toLowerCase()));
      const contents = new Map<string, string[]>();
      for (const f of files) {
        const text = await this.readSafe(real, f.path);
        if (text !== null) contents.set(f.path, text.split(/\r?\n/));
      }
      const probes: { needle: string; method: ElementLocation['method'] }[] = [];
      const text = (d.text ?? '').replace(/\s+/g, ' ').trim();
      if (text.length >= 2) probes.push({ needle: text.slice(0, 60), method: 'texte' });
      if (d.id) probes.push({ needle: `id="${d.id}"`, method: 'id' });
      const cls = (d.classes ?? []).filter((c) => c.length > 2).slice(0, 3);
      if (cls.length) probes.push({ needle: cls.join(' '), method: 'classe' });
      for (const c of cls) probes.push({ needle: c, method: 'classe' });
      if (d.component && /^[A-Z][A-Za-z0-9_]*$/.test(d.component)) {
        probes.push({ needle: `function ${d.component}`, method: 'composant' });
        probes.push({ needle: `const ${d.component} `, method: 'composant' });
      }
      for (const probe of probes) {
        for (const [file, lines] of contents) {
          const idx = lines.findIndex((line) => line.includes(probe.needle));
          if (idx < 0) continue;
          // Remonter jusqu'à l'ouverture de la balise de l'élément si elle est proche.
          let start = idx + 1;
          if (probe.method === 'texte' || probe.method === 'classe' || probe.method === 'id') {
            for (let n = idx + 1; n >= Math.max(1, idx - 5); n -= 1) {
              if ((lines[n - 1] ?? '').toLowerCase().includes(`<${tag}`)) {
                start = n;
                break;
              }
            }
          }
          const end = probe.method === 'composant' ? Math.min(lines.length, start + 20) : elementExtent(lines, start, tag);
          return { ok: true, data: { file, startLine: start, endLine: Math.max(start, end), excerpt: numbered(lines, start, Math.max(start, end)), method: probe.method } };
        }
      }
      return { ok: true, data: null };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const STUDIO_CONTEXT_CHANNELS = {
  candidates: 'studio.context.candidates',
  read: 'studio.context.read',
  locate: 'studio.preview.locate',
} as const;

export function registerStudioContextIpc(
  ipcMain: { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void },
  service: StudioContextService,
): void {
  ipcMain.handle(STUDIO_CONTEXT_CHANNELS.candidates, (_e, root) => service.candidates(root));
  ipcMain.handle(STUDIO_CONTEXT_CHANNELS.read, (_e, root, paths) => service.read(root, paths));
  ipcMain.handle(STUDIO_CONTEXT_CHANNELS.locate, (_e, root, descriptor) => service.locate(root, descriptor));
}
