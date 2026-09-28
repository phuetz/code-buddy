/**
 * Zero-configuration provider detection for a bare `buddy` launch.
 *
 * Runs ONLY when nothing explicit resolved a provider (no API key in the
 * environment, no `buddy login`, no onboarded settings, no stored credential,
 * no `--profile` endpoint). Explicit configuration therefore keeps priority and
 * behaves exactly as before; this module only replaces the historical dead end
 * ("No AI provider configured") with the simplest thing that works:
 *
 *   1. a local Ollama that already serves a tool-capable model → use it, no
 *      environment variable to export;
 *   2. otherwise the caller offers `buddy login` (ChatGPT OAuth);
 *   3. otherwise it prints the exact commands to install a recommended local
 *      model, tailored to what the probe actually saw.
 *
 * Every decision carries a one-line reason so the user is told what was chosen
 * and why. Probes are injectable so tests run against a fake Ollama.
 */

import { freemem } from 'os';
import { selectOllamaModel } from '../doctor/ollama-model-selection.js';
import type { DetectedCapability } from '../wizard/environment-detection.js';

/** Recommended local model: small, free, and able to call tools (edit files). */
export const RECOMMENDED_LOCAL_MODEL = 'qwen3:8b';

export type OllamaState = 'not-running' | 'no-models' | 'no-tool-model';

export type ZeroConfigDecision =
  | {
      kind: 'ollama';
      /** OpenAI-compatible endpoint, e.g. `http://localhost:11434/v1`. */
      baseURL: string;
      model: string;
      /** Why this model was chosen (tool-calling, size vs free RAM…). */
      reason: string;
    }
  | {
      kind: 'none';
      ollama: OllamaState;
      /** OpenAI-compatible endpoint that was probed. */
      baseURL: string;
      /** What the probe saw, in one line. */
      detail: string;
    };

export interface ZeroConfigDeps {
  probeOllama?: () => Promise<DetectedCapability>;
  freeMemoryBytes?: () => number;
}

/** `CODEBUDDY_ZERO_CONFIG=false|0|off|no` restores the historical behaviour. */
export function isZeroConfigDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CODEBUDDY_ZERO_CONFIG?.trim().toLowerCase();
  return raw === 'false' || raw === '0' || raw === 'off' || raw === 'no';
}

/**
 * Look for a local Ollama with a tool-capable model. Never throws: a failed
 * probe is reported as `not-running`.
 */
export async function detectZeroConfigLocal(deps: ZeroConfigDeps = {}): Promise<ZeroConfigDecision> {
  const probe = deps.probeOllama
    ?? (async () => (await import('../wizard/environment-detection.js')).detectOllama());
  let ollama: DetectedCapability;
  try {
    ollama = await probe();
  } catch {
    return {
      kind: 'none',
      ollama: 'not-running',
      baseURL: 'http://localhost:11434/v1',
      detail: 'Ollama probe failed',
    };
  }
  const baseURL = ollama.baseURL ?? 'http://localhost:11434/v1';
  if (!ollama.available) {
    return { kind: 'none', ollama: 'not-running', baseURL, detail: `no Ollama answering at ${baseURL}` };
  }
  const candidates = ollama.modelDetails ?? (ollama.models ?? []).map((name) => ({ name }));
  if (candidates.length === 0) {
    return { kind: 'none', ollama: 'no-models', baseURL, detail: 'Ollama is running but has no model installed' };
  }
  const free = (deps.freeMemoryBytes ?? freemem)();
  const selection = selectOllamaModel(candidates, free);
  if (!selection.model) {
    return {
      kind: 'none',
      ollama: 'no-tool-model',
      baseURL,
      detail: `Ollama is running (${candidates.length} model${candidates.length > 1 ? 's' : ''}) but ${selection.reason}`,
    };
  }
  return { kind: 'ollama', baseURL, model: selection.model, reason: selection.reason };
}

/** The line printed when zero-config picked a local model. */
export function formatZeroConfigChoice(
  decision: Extract<ZeroConfigDecision, { kind: 'ollama' }>,
  requestedModel?: string,
): string {
  const model = requestedModel?.trim() || decision.model;
  const why = requestedModel?.trim()
    ? `model given with --model`
    : decision.reason;
  return [
    `Zero-config: no provider configured, using the local Ollama at ${decision.baseURL.replace(/\/v1\/?$/, '')}`,
    `  model: ${model} (${why})`,
    '  No environment variable needed. To use something else: buddy login (ChatGPT),',
    '  buddy --profile cloud, --model <name>, or CODEBUDDY_ZERO_CONFIG=false to turn this off.',
  ].join('\n');
}

/** Exact command that installs Ollama on this platform. */
export function ollamaInstallCommand(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'winget install Ollama.Ollama';
  if (platform === 'darwin') return 'brew install ollama   (or download https://ollama.com/download)';
  return 'curl -fsSL https://ollama.com/install.sh | sh';
}

/**
 * Guidance printed when nothing usable was found (and the login offer was
 * declined or not possible). Tailored to what the Ollama probe saw, with the
 * exact commands to run — and no `export` to remember.
 */
export function buildNoProviderGuidance(
  decision?: ZeroConfigDecision,
  platform: NodeJS.Platform = process.platform,
): string {
  const lines = [
    '❌ No AI provider found.',
    '   1. Recommended — ChatGPT OAuth (no API key, $0 marginal cost with your plan):',
    '      buddy login',
    `   2. Local & free — Ollama with a model that can call tools (${RECOMMENDED_LOCAL_MODEL}):`,
  ];
  const state = decision?.kind === 'none' ? decision.ollama : 'not-running';
  if (state === 'not-running') {
    lines.push(
      `      ${ollamaInstallCommand(platform)}`,
      '      ollama serve            # if it does not start by itself',
      `      ollama pull ${RECOMMENDED_LOCAL_MODEL}`,
    );
  } else {
    lines.push(`      ollama pull ${RECOMMENDED_LOCAL_MODEL}`);
  }
  if (decision?.kind === 'none') lines.push(`      (seen: ${decision.detail})`);
  lines.push(
    '      Then run  buddy  again: the local model is detected automatically, nothing to export.',
    '      (qwen2.5 under 14B, including qwen2.5-coder:7b, is chat-only: it cannot edit files.)',
    '   3. More providers — run the full wizard or set an API key:',
    '      buddy onboard',
    '      GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY',
    '   After option 1 or 2, run  buddy try  for the one-minute coding demo.',
    '   Named profiles group the advanced settings:  buddy --profile local|cloud|fleet|max',
    '   Check anytime:  buddy doctor',
  );
  return lines.join('\n');
}
