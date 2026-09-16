/**
 * Explicit pre-LLM router: a photo/selfie/portrait request for Lisa is served
 * from the on-disk cache immediately. Generation is not on this path.
 *
 * @module companion/lisa-selfie-router
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import {
  interpolatePersonaName,
  isCopinePersona,
  resolveCompanionPersona,
} from './personas/index.js';
import { pickUnsaidLine } from './recent-said.js';
import {
  inferLisaContentTier,
  inferLisaSelfieStyle,
  inferSelfieMood,
  isLisaSelfieContinuationRequest,
  isLisaSelfieRequest,
  resolveLisaContentTier,
  selectCachedLisaSelfie,
  type LisaContentTier,
  type LisaSelfieMood,
} from './lisa-selfie.js';
import {
  resolveLisaSelfieRecentPath,
  resolveSelfieCacheDir,
} from './lisa-selfie-ingest.js';
import {
  historyHasRecentSelfie,
  type CompanionHistoryTurn,
} from './companion-history.js';

export type CompanionSelfieSurface = 'telegram' | 'mobile' | 'voice';

export interface CompanionSelfieServeResult {
  handled: true;
  caption: string;
  imagePath?: string;
  mimeType?: string;
  imageBase64?: string;
  refused: boolean;
  reason: 'ok' | 'explicit-gate' | 'empty-cache';
  contentTier: LisaContentTier;
  style?: LisaSelfieMood;
}

export interface TryServeCompanionSelfieOptions {
  surface: CompanionSelfieSurface;
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
  /** Explicit "the previous assistant turn was a selfie" state. */
  hasRecentSelfie?: boolean;
  /**
   * The conversation so far. A follow-up is resolved when the LAST assistant
   * turn served a selfie — equivalent to, and combined with, `hasRecentSelfie`.
   */
  history?: readonly CompanionHistoryTurn[];
  cacheDir?: string;
  rotationPath?: string;
  now?: () => Date;
  rng?: () => number;
  includeImageBytes?: boolean;
}

const DEFAULT_CAPTIONS = [
  'Voilà — une photo de moi.',
  'Tiens, celle-ci.',
  'Une photo de moi, là, tout de suite.',
] as const;

const DEFAULT_REFUSALS = [
  'Ça, je ne l’envoie pas. Pas ici.',
  'Non. Cette demande-là, je la laisse de côté.',
  'Je garde ça pour moi. Demande-moi une photo simple.',
] as const;

const DEFAULT_EMPTY = [
  'Je n’ai pas de photo prête sous la main. Dès que le générateur est là, j’en prépare.',
  'Le tiroir est vide pour l’instant. Je te l’envoie dès qu’il y en a une.',
] as const;

interface RecentSelfieState {
  lastPath?: string;
  entries?: Array<{ path: string; at: number }>;
}

/** Pre-LLM intercept. Null = not a Lisa photo request (caller continues). */
export async function tryServeCompanionSelfie(
  text: string,
  options: TryServeCompanionSelfieOptions,
): Promise<CompanionSelfieServeResult | null> {
  const env = options.env ?? process.env;
  if (env.CODEBUDDY_LISA_SELFIE === 'false') return null;
  const hasRecentSelfie =
    options.hasRecentSelfie === true || historyHasRecentSelfie(options.history);
  const continuation = isLisaSelfieContinuationRequest(text, hasRecentSelfie);
  if (!isLisaSelfieRequest(text) && !continuation) return null;

  const inferredTier = inferLisaContentTier(text);
  if (inferredTier === 'explicit' && resolveLisaContentTier(env, 'explicit') !== 'explicit') {
    const caption = pickCaption('refusal', env, options);
    logger.info('[lisa-selfie-router] explicit request refused (adult gate off)');
    return {
      handled: true,
      caption,
      refused: true,
      reason: 'explicit-gate',
      contentTier: 'safe',
    };
  }

  const contentTier = resolveLisaContentTier(env, inferredTier);
  const style = inferLisaSelfieStyle(text)
    ?? (continuation ? undefined : inferSelfieMood(text));
  const cacheDir = options.cacheDir ?? resolveSelfieCacheDir(env);
  const rotationPath = options.rotationPath ?? resolveLisaSelfieRecentPath(env);
  const lastPath = loadLastSelfiePath(rotationPath);
  const exclude = lastPath ? [lastPath] : [];

  let imagePath = style
    ? await selectCachedLisaSelfie(cacheDir, style, contentTier, { exclude })
    : undefined;
  if (!imagePath) {
    imagePath = await selectCachedLisaSelfie(cacheDir, style ?? 'portrait', contentTier, {
      rotateAcrossStyles: true,
      exclude,
    });
  }

  if (!imagePath) {
    logger.info(`[lisa-selfie-router] cache empty tier=${contentTier} style=${style ?? 'any'}`);
    return {
      handled: true,
      caption: pickCaption('empty', env, options),
      refused: false,
      reason: 'empty-cache',
      contentTier,
      ...(style ? { style } : {}),
    };
  }

  rememberLastSelfiePath(rotationPath, imagePath, options.now?.().getTime() ?? Date.now());
  const caption = pickCaption('ok', env, options);
  const mimeType = selfieMime(imagePath);
  let imageBase64: string | undefined;
  if (options.includeImageBytes === true) {
    try {
      imageBase64 = (await fs.readFile(imagePath)).toString('base64');
    } catch {
      imageBase64 = undefined;
    }
  }
  logger.info(
    `[lisa-selfie-router] cache hit surface=${options.surface} tier=${contentTier} image=${path.basename(imagePath)}`,
  );
  return {
    handled: true,
    caption,
    imagePath,
    mimeType,
    ...(imageBase64 ? { imageBase64 } : {}),
    refused: false,
    reason: 'ok',
    contentTier,
    ...(style ? { style } : {}),
  };
}

function pickCaption(
  kind: 'ok' | 'refusal' | 'empty',
  env: NodeJS.ProcessEnv,
  options: TryServeCompanionSelfieOptions,
): string {
  const persona = resolveCompanionPersona(env);
  const pool = kind === 'ok'
    ? (persona?.selfieCaptions ?? DEFAULT_CAPTIONS)
    : kind === 'refusal'
      ? (persona?.selfieRefusals ?? DEFAULT_REFUSALS)
      : (persona?.selfieEmpty ?? DEFAULT_EMPTY);
  const line = isCopinePersona(env)
    ? pickUnsaidLine(pool, {
        ...(options.rng ? { rng: options.rng } : {}),
        ...(options.now ? { now: options.now().getTime() } : {}),
        env,
      })
    : pool[0] ?? DEFAULT_CAPTIONS[0];
  return interpolatePersonaName(line, env);
}

function loadLastSelfiePath(statePath: string): string | undefined {
  try {
    const data = readJsonAtomicSync<RecentSelfieState | null>(statePath, null, {
      mode: 0o600,
      isValid: (value): value is RecentSelfieState =>
        Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    });
    const last = data?.lastPath?.trim();
    return last || undefined;
  } catch {
    return undefined;
  }
}

function rememberLastSelfiePath(statePath: string, imagePath: string, at: number): void {
  try {
    const prev = readJsonAtomicSync<RecentSelfieState | null>(statePath, null, {
      mode: 0o600,
      isValid: (value): value is RecentSelfieState =>
        Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    }) ?? {};
    const entries = [
      ...(Array.isArray(prev.entries) ? prev.entries : []),
      { path: imagePath, at },
    ].slice(-16);
    writeJsonAtomicSync(statePath, { lastPath: imagePath, entries }, { mode: 0o600 });
  } catch {
    /* rotation persistence is best-effort */
  }
}

export function selfieMime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}
