/**
 * Convert documents to Markdown for LLM consumption, via Microsoft's MarkItDown.
 *
 * Why a converter rather than a plain text extractor: a spreadsheet or an
 * administrative PDF flattened to raw text becomes soup — the columns run into
 * each other and the model has to guess the shape back. MarkItDown keeps
 * headings, lists, links and **tables**, so the model reads structure instead of
 * reconstructing it.
 *
 * It complements the existing `pdf` and `document` tools rather than replacing
 * them: those extract from one family each, this one takes ~everything (Office,
 * PDF, HTML, CSV, JSON, XML, ZIP, EPub, images, audio, YouTube URLs) and always
 * answers in the same shape.
 *
 * MarkItDown is a Python CLI, following the same sidecar pattern as Piper,
 * Parakeet and YOLO. It is **optional**: when it is absent the tool explains how
 * to install it and fails cleanly — it never pretends to have converted anything.
 *
 * @module tools/markdown-convert
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types/index.js';

/** Max characters returned inline before the result is truncated (LLM budget). */
const DEFAULT_MAX_CHARS = 60_000;
/** Hard stop so a pathological file cannot hang a turn. */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface MarkdownConvertOptions {
  /** Path to a local file, or an http(s)/YouTube URL. */
  source: string;
  /** Write the Markdown here instead of returning it inline. */
  outputPath?: string;
  /** Inline truncation budget (default 60 000 characters). */
  maxChars?: number;
  /** Conversion timeout in ms (default 120 000). */
  timeoutMs?: number;
}

export interface MarkdownConvertDeps {
  /** Injectable spawn, for tests. */
  spawnFn?: typeof spawn;
  /** Binary to call (default `markitdown`, override via CODEBUDDY_MARKITDOWN_BIN). */
  bin?: string;
}

/** True for something MarkItDown should fetch itself rather than read from disk. */
function isRemote(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/**
 * Build the argv (pure — the testable core).
 *
 * The source is passed as a positional argument, never interpolated into a
 * shell string: a filename containing spaces or quotes must stay a filename.
 */
export function buildMarkitdownArgs(source: string, outputPath?: string): string[] {
  const args = [source];
  if (outputPath) args.push('-o', outputPath);
  return args;
}

/** Actionable message for a missing sidecar — never a bare ENOENT. */
function missingBinaryError(bin: string): string {
  return (
    `MarkItDown introuvable (\`${bin}\`). Installez-le avec :\n` +
    `    pip install 'markitdown[all]'\n` +
    `Ou indiquez le binaire via CODEBUDDY_MARKITDOWN_BIN. ` +
    `Les outils \`pdf\` et \`document\` restent disponibles en attendant.`
  );
}

export class MarkdownConvertTool {
  private readonly spawnFn: typeof spawn;
  private readonly bin: string;

  constructor(deps: MarkdownConvertDeps = {}) {
    this.spawnFn = deps.spawnFn ?? spawn;
    this.bin = deps.bin ?? process.env.CODEBUDDY_MARKITDOWN_BIN ?? 'markitdown';
  }

  async convert(opts: MarkdownConvertOptions): Promise<ToolResult> {
    const source = opts.source?.trim();
    if (!source) {
      return { success: false, error: 'source manquante : chemin de fichier ou URL attendu.' };
    }

    // A local path that does not exist must be refused BEFORE spawning: letting
    // the sidecar fail would surface a Python traceback instead of a clear cause.
    if (!isRemote(source)) {
      const resolved = path.resolve(source);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: `Fichier introuvable : ${resolved}` };
      }
      if (fs.statSync(resolved).isDirectory()) {
        return { success: false, error: `${resolved} est un dossier, pas un document.` };
      }
    }

    const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const args = buildMarkitdownArgs(source, opts.outputPath);

    return new Promise<ToolResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: ToolResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const child = this.spawnFn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({
          success: false,
          error: `Conversion interrompue après ${Math.round(timeoutMs / 1000)} s : ${source}`,
        });
      }, timeoutMs);

      child.stdout?.on('data', (d: Buffer) => {
        stdout += String(d);
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr += String(d);
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        finish({
          success: false,
          error:
            err.code === 'ENOENT'
              ? missingBinaryError(this.bin)
              : `Échec de MarkItDown : ${err.message}`,
        });
      });

      child.on('close', (code: number | null) => {
        if (code !== 0) {
          finish({
            success: false,
            error: `MarkItDown a échoué (code ${code}) sur ${source}${
              stderr.trim() ? ` — ${stderr.trim().slice(-500)}` : ''
            }`,
          });
          return;
        }

        if (opts.outputPath) {
          // Written to disk: prove the file exists and is non-empty rather than
          // trusting the exit code — an empty output announced as a success is
          // exactly the false success we hunt everywhere else.
          try {
            const size = fs.statSync(opts.outputPath).size;
            if (size <= 0) {
              finish({ success: false, error: `MarkItDown a produit un fichier vide : ${opts.outputPath}` });
              return;
            }
            finish({ success: true, output: `Markdown écrit : ${opts.outputPath} (${size} octets)` });
          } catch {
            finish({
              success: false,
              error: `MarkItDown a annoncé un succès mais ${opts.outputPath} est absent.`,
            });
          }
          return;
        }

        const text = stdout.trim();
        if (!text) {
          finish({ success: false, error: `Aucun contenu extrait de ${source}.` });
          return;
        }

        if (text.length > maxChars) {
          logger.info(`[markdown-convert] ${source} tronqué à ${maxChars} caractères`);
          finish({
            success: true,
            output:
              `${text.slice(0, maxChars)}\n\n---\n` +
              `[tronqué : ${text.length} caractères au total. ` +
              `Utilisez outputPath pour obtenir le document entier.]`,
          });
          return;
        }

        finish({ success: true, output: text });
      });
    });
  }
}
