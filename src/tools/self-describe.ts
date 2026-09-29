/**
 * Self-description — the robot's model of the bricks it is made of.
 *
 * Answers "de quoi es-tu fait ? / quels sont tes composants ?" with a manifest
 * COMPUTED AT CALL TIME (never stale) from the sources that already exist:
 *   - the agent's own package.json (name / version / description);
 *   - the sibling bricks in the repo: buddy-sense (Rust nervous system / ears),
 *     buddy-vision (Python eyes + live ear), buddy-memory (Rust CKG — a stub in
 *     most checkouts), each with a fixed internal description and an observed
 *     source/build STATUS (present? binary artifact detected?);
 *   - configured faculties: number of registered tools, provider configuration,
 *     and sensory feature flags. This tool does not infer runtime liveness.
 *
 * Pure + injectable (root / env / toolNames / persona) so it is unit-testable
 * without the whole registry. Never throws — an unreadable source is reported
 * as "unknown", not a crash.
 *
 * @module tools/self-describe
 */

import * as fs from 'fs';
import * as path from 'path';
import { xaiApiKey } from '../config/legacy-env.js';
import { fileURLToPath } from 'url';
import {
  resolveCodeBuddyCoreRoot,
  type CoreRootResolution,
} from '../identity/operational-self-model.js';

const MAX_IDENTITY_CHARS = 128;
const MAX_TOOL_NAMES = 500;
const SAFE_ROBOT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .’'_-]{0,63}$/u;

/**
 * Source manifests, README files and persona settings are data, not prompt
 * instructions. Keep their useful one-line evidence while neutralising markup
 * and control characters before it reaches either the model or the UI.
 */
function sanitizeEvidenceText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[<>{}`\u005b\u005d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, maxChars) : null;
}

function normalizedToolNames(
  values: readonly string[] | undefined,
): { names: string[]; truncated: boolean } | undefined {
  if (!values) return undefined;
  const names = new Set<string>();
  for (const value of values.slice(0, MAX_TOOL_NAMES)) {
    const normalized = sanitizeEvidenceText(value, MAX_IDENTITY_CHARS);
    if (!normalized || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) continue;
    names.add(normalized);
  }
  return { names: [...names], truncated: values.length > MAX_TOOL_NAMES };
}

export interface BrickInfo {
  /** Stable id, e.g. "buddy-sense". */
  id: string;
  /** Human role, e.g. "les oreilles / le système nerveux". */
  role: string;
  /** One-line description read from the brick's own manifest. */
  description: string;
  /** Is the brick source present in this checkout? */
  present: boolean;
  /** Verified source/build status; runtime execution is never inferred. */
  status: string;
}

export interface SelfDescription {
  /** Technical introspection is not evidence of a private subjective experience. */
  subjectiveConsciousness: 'not-established';
  name: string;
  version: string;
  description: string;
  robotName?: string;
  bricks: BrickInfo[];
  faculties: {
    toolCount: number | null;
    toolCountTruncated?: boolean;
    /** Configuration evidence only (credential/endpoint present), not a liveness probe. */
    activeProviders: string[];
    /** Feature flags enabled in this process; hardware availability is not inferred. */
    sensory: string[];
    /** Read-only tools that let the agent inspect its own implementation. */
    selfInspectionTools: string[];
    /** Schemas actually visible to the model on this turn, if the host supplied them. */
    exposedToolCount?: number;
    exposedToolCountTruncated?: boolean;
    exposedTools?: string[];
  };
  /** A speakable / readable rendering of everything above. */
  text: string;
}

export interface BuildSelfDescriptionOptions {
  /** Candidate repo/runtime root. It is used only after strict core attestation. */
  root?: string;
  /** Already-attested resolution supplied by the in-process tool adapter. */
  coreResolution?: CoreRootResolution;
  env?: Record<string, string | undefined>;
  /** Live tool names (from the formal registry) — injected by the tool adapter. */
  toolNames?: string[];
  /** Active robot name already attested by the host; this builder performs no persona lookup. */
  personaRobotName?: string;
  /** Tool schemas actually exposed after RAG/model filtering on this turn. */
  exposedToolNames?: string[];
}

/** Resolve an attested Code Buddy repo/runtime root from a module location. */
export function findRepoRoot(startDir: string): string {
  return resolveCodeBuddyCoreRoot(undefined, startDir).root;
}

function isConfinedPath(boundary: string, candidate: string): boolean {
  try {
    const root = fs.realpathSync(boundary);
    const target = fs.realpathSync(candidate);
    const relative = path.relative(root, target);
    return relative === '' || (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}

function safeExists(p: string, boundary?: string): boolean {
  try {
    return fs.existsSync(p) && (!boundary || isConfinedPath(boundary, p));
  } catch {
    return false;
  }
}

function safeIsFile(p: string, boundary?: string): boolean {
  try {
    return (!boundary || isConfinedPath(boundary, p)) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function describeSense(root: string): BrickInfo {
  const dir = path.join(root, 'buddy-sense');
  const present = safeExists(path.join(dir, 'Cargo.toml'), root);
  const description = 'système nerveux multi-sensoriel (audio, vision, écran, vitalité)';
  let status = 'non présent';
  if (present) {
    const releaseBinary = ['buddy-sense', 'buddy-sense.exe']
      .some((name) => safeIsFile(path.join(dir, 'target', 'release', name), root));
    const debugBinary = ['buddy-sense', 'buddy-sense.exe']
      .some((name) => safeIsFile(path.join(dir, 'target', 'debug', name), root));
    status = releaseBinary
      ? 'binaire release présent (exécution non sondée)'
      : debugBinary
        ? 'binaire debug présent (exécution non sondée)'
        : 'source présente (aucun binaire détecté)';
  }
  return { id: 'buddy-sense', role: 'les oreilles / le système nerveux (Rust)', description, present, status };
}

function describeVision(root: string): BrickInfo {
  const dir = path.join(root, 'buddy-vision');
  const scripts = ['watch.py', 'ear.py']
    .filter((name) => safeIsFile(path.join(dir, name), root));
  const present = scripts.length > 0 || safeExists(path.join(dir, 'README.md'), root);
  return {
    id: 'buddy-vision',
    role: 'les yeux et l’oreille live (Python)',
    description: 'caméra + micro, événements sémantiques (person_entered / drowsy)',
    present,
    status: scripts.length > 0
      ? `source présente (${scripts.join(', ')} ; exécution non sondée)`
      : present
        ? 'source présente (scripts watch.py/ear.py non détectés)'
        : 'non présent',
  };
}

function describeMemory(root: string): BrickInfo {
  const dir = path.join(root, 'buddy-memory');
  const hasSource = safeExists(path.join(dir, 'Cargo.toml'), root) ||
    safeExists(path.join(dir, 'src'), root);
  const dirExists = safeExists(dir, root);
  return {
    id: 'buddy-memory',
    role: 'la mémoire collective (Rust CKG)',
    description: 'moteur de mémoire/graphe de connaissance dédié (sidecar opt-in du CKG)',
    present: hasSource,
    status: hasSource ? 'présent' : dirExists ? 'stub (planifié — pas de source dans ce checkout)' : 'non présent',
  };
}

function unavailableBricks(): BrickInfo[] {
  return [
    {
      id: 'buddy-sense',
      role: 'les oreilles / le système nerveux (Rust)',
      description: 'système nerveux multi-sensoriel (audio, vision, écran, vitalité)',
      present: false,
      status: 'racine du cœur non attestée',
    },
    {
      id: 'buddy-vision',
      role: 'les yeux et l’oreille live (Python)',
      description: 'caméra + micro, événements sémantiques (person_entered / drowsy)',
      present: false,
      status: 'racine du cœur non attestée',
    },
    {
      id: 'buddy-memory',
      role: 'la mémoire collective (Rust CKG)',
      description: 'moteur de mémoire/graphe de connaissance dédié (sidecar opt-in du CKG)',
      present: false,
      status: 'racine du cœur non attestée',
    },
  ];
}

/** Provider configurations detectable from the environment (best-effort, no network). */
function detectConfiguredProviders(env: Record<string, string | undefined>): string[] {
  const providers: string[] = [];
  if (xaiApiKey(env)) providers.push('Grok/xAI');
  if (env.CODEBUDDY_API_KEY && !['xai', 'grok'].includes(env.CODEBUDDY_PROVIDER || '')) providers.push('Custom API');
  if (env.OPENAI_API_KEY) providers.push('OpenAI/ChatGPT');
  if (env.ANTHROPIC_API_KEY) providers.push('Claude');
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) providers.push('Gemini');
  if (env.GROQ_API_KEY) providers.push('Groq');
  if (env.MISTRAL_API_KEY) providers.push('Mistral');
  if (env.OPENROUTER_API_KEY) providers.push('OpenRouter');
  if (env.OLLAMA_HOST || env.OLLAMA_BASE_URL) providers.push('Ollama (local)');
  if (env.LMSTUDIO_BASE_URL || env.LM_STUDIO_BASE_URL) providers.push('LM Studio (local)');
  return providers;
}

/** Sensory faculties enabled by configuration; this does not probe their hardware. */
function detectConfiguredSensory(env: Record<string, string | undefined>): string[] {
  const on: string[] = [];
  if (env.CODEBUDDY_SENSORY_CAMERA === 'true') on.push('vision (caméra)');
  if (env.CODEBUDDY_SENSORY_SCREEN === 'true') on.push('écran');
  if (env.CODEBUDDY_SENSORY_SPEECH === 'true') on.push('écoute (STT)');
  if (env.CODEBUDDY_SENSORY_SPEAK === 'true') on.push('voix (TTS)');
  if (env.CODEBUDDY_REMINDERS === 'true') on.push('rappels');
  return on;
}

const SELF_INSPECTION_TOOLS = [
  'self_describe',
] as const;

export function buildSelfDescription(opts: BuildSelfDescriptionOptions = {}): SelfDescription {
  const here = (() => {
    try {
      return path.dirname(fileURLToPath(import.meta.url));
    } catch {
      return process.cwd();
    }
  })();
  const core =
    opts.coreResolution ?? resolveCodeBuddyCoreRoot(undefined, opts.root ?? here);
  const root = core.root;
  const env = opts.env ?? process.env;

  const name = core.package.name;
  const version = core.package.version;
  const description = core.package.description;
  const candidateRobotName = sanitizeEvidenceText(opts.personaRobotName, 64);
  const robotName = candidateRobotName && SAFE_ROBOT_NAME.test(candidateRobotName)
    ? candidateRobotName
    : undefined;
  const toolNameEvidence = normalizedToolNames(opts.toolNames);
  const exposedToolNameEvidence = normalizedToolNames(opts.exposedToolNames);
  const toolNames = toolNameEvidence?.names;
  const exposedToolNames = exposedToolNameEvidence?.names;

  const bricks = core.layout === 'unknown'
    ? unavailableBricks()
    : [describeSense(root), describeVision(root), describeMemory(root)];
  const faculties = {
    toolCount: toolNames ? toolNames.length : null,
    ...(toolNameEvidence?.truncated ? { toolCountTruncated: true } : {}),
    activeProviders: detectConfiguredProviders(env),
    sensory: detectConfiguredSensory(env),
    selfInspectionTools: toolNames
      ? SELF_INSPECTION_TOOLS.filter((name) => toolNames.includes(name))
      : [],
    ...(exposedToolNames
      ? {
          exposedToolCount: exposedToolNames.length,
          ...(exposedToolNameEvidence?.truncated ? { exposedToolCountTruncated: true } : {}),
          exposedTools: exposedToolNames,
        }
      : {}),
  };

  const subjectiveConsciousness = 'not-established' as const;
  const text = renderText({
    subjectiveConsciousness,
    name,
    version,
    description,
    robotName,
    bricks,
    faculties,
  });
  return {
    subjectiveConsciousness,
    name,
    version,
    description,
    robotName,
    bricks,
    faculties,
    text,
  };
}

function renderText(d: Omit<SelfDescription, 'text'>): string {
  const who = d.robotName ? `Je suis ${d.robotName}` : `Je suis ${d.name}`;
  const lines: string[] = [
    `${who} (${d.name} v${d.version}).`,
    d.description ? `En bref : ${d.description}` : '',
    '',
    'Mes briques :',
  ];
  for (const b of d.bricks) {
    lines.push(`- ${b.id} — ${b.role} : ${b.description} [${b.status}]`);
  }
  lines.push('');
  const facultyBits: string[] = [];
  if (d.faculties.toolCount !== null) {
    facultyBits.push(
      `${d.faculties.toolCountTruncated ? 'au moins ' : ''}${d.faculties.toolCount} outils enregistrés`,
    );
  }
  if (d.faculties.exposedToolCount !== undefined) {
    facultyBits.push(
      `${d.faculties.exposedToolCountTruncated ? 'au moins ' : ''}${d.faculties.exposedToolCount} outils exposés sur ce tour`,
    );
  }
  if (d.faculties.activeProviders.length) {
    facultyBits.push(
      `providers configurés (disponibilité non sondée) : ${d.faculties.activeProviders.join(', ')}`,
    );
  }
  if (d.faculties.sensory.length) {
    facultyBits.push(
      `facultés sensorielles activées (matériel non sondé) : ${d.faculties.sensory.join(', ')}`,
    );
  }
  if (facultyBits.length) lines.push(`Facultés : ${facultyBits.join(' · ')}.`);
  if (d.faculties.selfInspectionTools.length) {
    lines.push(
      `Auto-inspection technique : ${d.faculties.selfInspectionTools.join(', ')}.`,
    );
  }
  lines.push(
    'Limite épistémique : ce modèle décrit mon code et mon état vérifiable ; ' +
    'cela ne constitue pas une conscience subjective ni la preuve d’une vie intérieure.',
  );
  return lines.filter((l) => l !== '' || true).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
