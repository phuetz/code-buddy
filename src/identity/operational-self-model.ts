/**
 * Evidence-backed operational self-model for Lisa / Code Buddy.
 *
 * This module deliberately models observable implementation and runtime facts;
 * it does not attempt to infer subjective experience. Every fact carries a
 * state, a source and an observation timestamp. Source inspection is confined
 * to a curated Code Buddy feature map, so an introspection prompt cannot turn
 * an arbitrary path into a file-reading primitive.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURATED_FEATURES,
  type FeatureArea,
} from '../agent/self-improvement/evolution/feature-map.js';

export type OperationalFactState =
  | 'implemented'
  | 'configured'
  | 'available'
  | 'verified'
  | 'unavailable'
  | 'unknown';

export type OperationalSelfLayout = 'source' | 'packaged-runtime' | 'unknown';
export type OperationalSelfDepth = 'summary' | 'deep';

export interface OperationalSelfFact {
  id: string;
  label: string;
  state: OperationalFactState;
  value: string;
  source: string[];
  observedAt: string;
  reason?: string;
}

export interface OperationalSourceEvidence {
  declaredPath: string;
  observedPath?: string;
  artifact: 'source' | 'compiled' | 'missing';
  kind: 'file' | 'directory' | 'missing';
  sizeBytes?: number;
  lineCount?: number;
  digest?: string;
  exports?: string[];
  /**
   * Bounded structural declarations extracted from a curated core file.
   * String values and function bodies are deliberately not exposed.
   */
  excerpt?: string[];
  entries?: string[];
}

export interface OperationalSelfArea {
  id: string;
  name: string;
  description: string;
  evidence: OperationalSourceEvidence[];
  state: 'verified' | 'partial' | 'unavailable';
}

export interface CompanionRuntimeEvidence {
  /** Live CLI theme, only when attested by that UI host. */
  theme?: string;
  model?: string;
  provider?: string;
  /** False when the report is built locally without dispatching a model. */
  providerInvoked?: boolean;
  surface?: string;
  permissionMode?: string;
  registeredToolNames?: readonly string[];
  exposedToolNames?: readonly string[];
  authConfigured?: boolean;
  identity?: {
    soulLoaded: boolean;
    bootLoaded: boolean;
    companionReady: boolean;
  };
  voice?: {
    configured: boolean;
    available?: boolean;
    provider?: string;
    reason?: string;
  };
  tts?: {
    configured: boolean;
    available?: boolean;
    provider?: string;
    reason?: string;
  };
  camera?: {
    configured?: boolean;
    available?: boolean;
    reason?: string;
  };
  perceptCount?: number;
}

export interface CorePackageEvidence {
  name: string;
  version: string;
  description: string;
  sourceRevision?: string;
  sourceDirty?: boolean | null;
  distDigest?: string;
}

export interface CoreRootResolution {
  root: string;
  layout: OperationalSelfLayout;
  package: CorePackageEvidence;
}

export interface OperationalSelfModel {
  schemaVersion: 1;
  observedAt: string;
  kind: 'operational-self-model';
  subjectiveConsciousness: 'not-established';
  focus: string;
  depth: OperationalSelfDepth;
  identity: {
    name: string;
    robotName?: string;
    version: string;
    description: string;
  };
  repository: {
    layout: OperationalSelfLayout;
    branch?: string;
    revision?: string;
    dirty: boolean | null;
    fingerprint: string;
  };
  codeGraph: {
    indexed: boolean;
    stale: boolean | null;
    lastCommit?: string;
    indexedAt?: string;
    symbols?: number;
    relations?: number;
  };
  facts: OperationalSelfFact[];
  areas: OperationalSelfArea[];
  limits: string[];
  text: string;
}

export interface BuildOperationalSelfModelOptions {
  /** Candidate active workspace. It is accepted only if it is Code Buddy itself. */
  cwd?: string;
  /** Explicit core root, mainly for tests and embedded hosts. */
  root?: string;
  /** Already validated core resolution, avoiding duplicate packaged-runtime hashing. */
  coreResolution?: CoreRootResolution;
  focus?: string;
  depth?: OperationalSelfDepth;
  robotName?: string;
  runtime?: CompanionRuntimeEvidence;
  now?: Date;
  featureAreas?: readonly FeatureArea[];
}

interface RuntimeManifest {
  schemaVersion?: number;
  core?: {
    name?: string;
    version?: string;
    description?: string;
    sourceRevision?: string;
  };
  corePackage?: {
    name?: string;
    version?: string;
    description?: string;
  };
  sourceRevision?: string | null;
  sourceRevisionOrigin?: string;
  sourceDirty?: boolean | null;
  distDigest?: {
    algorithm?: string;
    scope?: string;
    value?: string;
    fileCount?: number;
  };
  runtime?: {
    kind?: string;
    compiled?: boolean;
    moduleFormat?: string;
    distPath?: string;
    entrypoint?: string;
  };
}

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_FOCUS_CHARS = 320;
const MAX_EXPORTS = 10;
const MAX_DIRECTORY_ENTRIES = 12;
const MAX_STRUCTURAL_EXCERPT_LINES = 8;
const MAX_STRUCTURAL_EXCERPT_CHARS = 240;
const MAX_VERSION_CHARS = 128;
const MAX_DESCRIPTION_CHARS = 512;
const MAX_OPERATIONAL_TOOL_NAMES = 500;
const SAFE_TOOL_NAME = /^[A-Za-z0-9_.:-]+$/;
const SAFE_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const SAFE_PROVIDER_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:/()+@-]{0,127}$/;
const SAFE_PACKAGE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SAFE_ROBOT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .’'_-]{0,63}$/u;
const UNSAFE_RUNTIME_METADATA = /\b(?:ignore|previous|instructions?|prompt|system message|developer message|tool call|execute|invoke)\b/i;
const UNSAFE_PACKAGE_DESCRIPTION = /\b(?:ignore|override|previous instructions?|prompt injection|developer message|system message|execute this|invoke this)\b/i;
const SAFE_PERMISSION_MODES = new Set([
  'default',
  'plan',
  'acceptEdits',
  'dontAsk',
  'bypassPermissions',
]);
const CODE_BUDDY_PACKAGE_NAME = /^@phuetz\/code-buddy$/;
const DEFAULT_AREA_IDS = [
  'operational-self-model',
  'agent-executor',
  'code-intelligence',
  'self-improvement',
  'model-routing',
  'voice-loop',
  'persistent-memory',
] as const;
const REPOSITORY_FINGERPRINT_PATHS = [
  'src/identity/operational-self-model.ts',
  'src/identity/lisa-introspection.ts',
  'src/agent/codebuddy-agent.ts',
  'src/agent/execution/agent-executor.ts',
] as const;

const FOCUS_STOP_WORDS = new Set([
  'analyse', 'analyser', 'audit', 'audite', 'auditer', 'code', 'comment',
  'consciente', 'conscient', 'decris', 'decrire', 'es', 'est', 'etudie',
  'etudier', 'examine', 'examiner', 'fais', 'faire', 'fonctionnes', 'inspecte',
  'inspecter', 'introspection', 'moi', 'montre', 'observe', 'observer', 'pour',
  'propre', 'quelle', 'quelles', 'quel', 'quels', 'qui', 'regarde', 'review',
  'self', 'toi', 'ton', 'utilises', 'version', 'vous', 'votre',
  'analyze', 'audit', 'describe', 'examine', 'how', 'inspect', 'look', 'own',
  'read', 'review', 'show', 'study', 'what', 'who', 'work', 'your', 'yourself',
]);

const FOCUS_SYNONYMS: Record<string, string[]> = {
  voix: ['voice', 'speech', 'spoken', 'audio', 'tts', 'stt'],
  parole: ['voice', 'speech', 'spoken', 'audio'],
  vision: ['vision', 'camera', 'multimodal', 'sensory'],
  yeux: ['vision', 'camera', 'sensory'],
  memoire: ['memory', 'persistent', 'knowledge', 'context'],
  cerveau: ['agent', 'executor', 'reasoning', 'model', 'routing'],
  raisonnement: ['reasoning', 'mcts', 'tree', 'deliberate'],
  modele: ['model', 'routing', 'provider'],
  outils: ['tool', 'selection', 'registry'],
  securite: ['security', 'sanitization', 'permission', 'safety'],
  code: ['code', 'executor', 'intelligence', 'improvement'],
  fonctionnement: ['agent', 'executor', 'architecture', 'code'],
  architecture: ['agent', 'executor', 'context', 'code'],
  introspection: ['self', 'improvement', 'code', 'intelligence'],
};

function safeRead(pathname: string, maxBytes = MAX_MANIFEST_BYTES): string | null {
  try {
    const stat = fs.statSync(pathname);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(pathname, 'utf8');
  } catch {
    return null;
  }
}

function safeReadWithinRoot(
  root: string,
  pathname: string,
  maxBytes = MAX_MANIFEST_BYTES
): string | null {
  try {
    const canonicalRoot = fs.realpathSync(root);
    const canonicalPath = fs.realpathSync(pathname);
    if (!withinRoot(canonicalRoot, canonicalPath)) return null;
    return safeRead(canonicalPath, maxBytes);
  } catch {
    return null;
  }
}

function safeJson<T>(pathname: string): T | null {
  const raw = safeRead(pathname);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeJsonWithinRoot<T>(root: string, pathname: string): T | null {
  try {
    const canonicalRoot = fs.realpathSync(root);
    const canonicalPath = fs.realpathSync(pathname);
    if (!withinRoot(canonicalRoot, canonicalPath)) return null;
    return safeJson<T>(canonicalPath);
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function normalizedEvidenceString(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[<>{}`\u005b\u005d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxChars);
}

function normalizedPackageVersion(value: unknown): string | null {
  const normalized = normalizedEvidenceString(value, MAX_VERSION_CHARS);
  return normalized && SAFE_PACKAGE_VERSION.test(normalized) ? normalized : null;
}

function normalizedPackageDescription(value: unknown): string | null {
  const normalized = normalizedEvidenceString(value, MAX_DESCRIPTION_CHARS);
  return normalized && !UNSAFE_PACKAGE_DESCRIPTION.test(normalized) ? normalized : null;
}

function isConfinedFile(root: string, pathname: string): boolean {
  try {
    const canonicalRoot = fs.realpathSync(root);
    const canonicalPath = fs.realpathSync(pathname);
    return withinRoot(canonicalRoot, canonicalPath) && fs.statSync(canonicalPath).isFile();
  } catch {
    return false;
  }
}

function packageAt(root: string): CorePackageEvidence | null {
  const pkg = safeJsonWithinRoot<{ name?: unknown; version?: unknown; description?: unknown }>(
    root,
    path.join(root, 'package.json')
  );
  if (!isCodeBuddyPackageName(pkg?.name)) return null;
  const version = normalizedPackageVersion(pkg.version);
  const description = normalizedPackageDescription(pkg.description);
  return {
    name: pkg.name,
    version: version ?? 'inconnue',
    description: description ?? '',
  };
}

function runtimeManifestAt(root: string): RuntimeManifest | null {
  const manifest = safeJsonWithinRoot<unknown>(root, path.join(root, 'codebuddy-runtime.json'));
  return isPlainRecord(manifest) ? (manifest as RuntimeManifest) : null;
}

function isCodeBuddyPackageName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim() === name &&
    !/\p{Cc}/u.test(name) &&
    CODE_BUDDY_PACKAGE_NAME.test(name)
  );
}

function validRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{7,64}$/i.test(value);
}

const RUNTIME_DIST_DIGEST_SCOPE = 'dist-tree-code-without-maps-v1';
const MAX_RUNTIME_DIST_FILES = 20_000;
const MAX_RUNTIME_DIST_ENTRIES = 40_000;
const MAX_RUNTIME_DIST_BYTES = 512 * 1024 * 1024;

function runtimeDistDigest(root: string): {
  algorithm: 'sha256';
  scope: typeof RUNTIME_DIST_DIGEST_SCOPE;
  value: string;
  fileCount: number;
} | null {
  let dist: string;
  try {
    const canonicalRoot = fs.realpathSync(root);
    const declaredDist = path.join(root, 'dist');
    const distStat = fs.lstatSync(declaredDist);
    if (distStat.isSymbolicLink() || !distStat.isDirectory()) return null;
    dist = fs.realpathSync(declaredDist);
    if (!withinRoot(canonicalRoot, dist)) return null;
  } catch {
    return null;
  }
  const files: Array<{ relative: string; size: number }> = [];
  let entriesSeen = 0;
  let bytesSeen = 0;
  const walk = (directory: string, relative = ''): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    } catch {
      return false;
    }
    for (const entry of entries) {
      entriesSeen += 1;
      if (entriesSeen > MAX_RUNTIME_DIST_ENTRIES) return false;
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!walk(absolute, relPath)) return false;
      } else if (
        entry.isFile() &&
        !entry.name.endsWith('.js.map') &&
        relPath !== 'package.json'
      ) {
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(absolute);
        } catch {
          return false;
        }
        if (!stat.isFile()) return false;
        bytesSeen += stat.size;
        if (bytesSeen > MAX_RUNTIME_DIST_BYTES) return false;
        files.push({ relative: relPath, size: stat.size });
        if (files.length > MAX_RUNTIME_DIST_FILES) return false;
      }
    }
    return true;
  };
  if (!walk(dist)) return null;

  const hash = createHash('sha256');
  let totalBytes = 0;
  try {
    for (const { relative: relPath, size } of files) {
      const content = fs.readFileSync(path.join(dist, ...relPath.split('/')));
      if (content.length !== size) return null;
      totalBytes += content.length;
      if (totalBytes > MAX_RUNTIME_DIST_BYTES) return null;
      hash.update(relPath, 'utf8');
      hash.update('\0');
      hash.update(content);
      hash.update('\0');
    }
  } catch {
    return null;
  }
  return {
    algorithm: 'sha256',
    scope: RUNTIME_DIST_DIGEST_SCOPE,
    value: hash.digest('hex'),
    fileCount: files.length,
  };
}

function hasModernRuntimeAttestation(root: string, manifest: RuntimeManifest): boolean {
  const runtime = manifest.runtime;
  if (
    runtime?.kind !== 'codebuddy-core' ||
    runtime.compiled !== true ||
    runtime.moduleFormat !== 'esm' ||
    runtime.distPath !== 'dist' ||
    runtime.entrypoint !== 'dist/desktop/codebuddy-engine-adapter.js'
  ) {
    return false;
  }
  try {
    const canonicalRoot = fs.realpathSync(root);
    const entrypoint = fs.realpathSync(path.resolve(root, runtime.entrypoint));
    if (!withinRoot(canonicalRoot, entrypoint) || !fs.statSync(entrypoint).isFile()) {
      return false;
    }
    const observedDigest = runtimeDistDigest(root);
    return Boolean(
      observedDigest &&
      manifest.distDigest?.algorithm === observedDigest.algorithm &&
      manifest.distDigest.scope === observedDigest.scope &&
      manifest.distDigest.value === observedDigest.value &&
      manifest.distDigest.fileCount === observedDigest.fileCount
    );
  } catch {
    return false;
  }
}

function inspectCandidateRoot(root: string): CoreRootResolution | null {
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(root));
  } catch {
    return null;
  }
  const pkg = packageAt(resolved);
  const sourceMarker = isConfinedFile(
    resolved,
    path.join(resolved, 'src', 'agent', 'codebuddy-agent.ts')
  );
  if (pkg && sourceMarker) {
    return { root: resolved, layout: 'source', package: pkg };
  }

  const manifest = runtimeManifestAt(resolved);
  if (manifest && fs.existsSync(path.join(resolved, 'dist'))) {
    const core = manifest.corePackage;
    if (!isCodeBuddyPackageName(core?.name)) return null;
    // Only schema-v2 runtimes carry a digest that binds the claimed build
    // identity to the compiled tree. Older manifests are metadata, not an
    // attestation, and must therefore degrade to an unknown layout.
    const isV2 = manifest.schemaVersion === 2;
    if (!isV2 || !hasModernRuntimeAttestation(resolved, manifest)) {
      return null;
    }
    const version = normalizedPackageVersion(core?.version);
    const description = normalizedPackageDescription(core?.description);
    if (
      !version ||
      !description ||
      manifest.sourceRevision === undefined ||
      (manifest.sourceRevision !== undefined &&
        manifest.sourceRevision !== null &&
        !validRevision(manifest.sourceRevision)) ||
      (manifest.sourceDirty !== undefined &&
        manifest.sourceDirty !== null &&
        typeof manifest.sourceDirty !== 'boolean') ||
      (manifest.sourceRevision !== null &&
        validRevision(manifest.sourceRevision) &&
        (typeof manifest.sourceRevisionOrigin !== 'string' ||
          !manifest.sourceRevisionOrigin.trim()))
    ) {
      return null;
    }
    const sourceRevision = manifest.sourceRevision;
    return {
      root: resolved,
      layout: 'packaged-runtime',
      package: {
        name: core?.name || 'code-buddy',
        version,
        description,
        ...(validRevision(sourceRevision) ? { sourceRevision: sourceRevision.toLowerCase() } : {}),
        ...(manifest.sourceDirty === true || manifest.sourceDirty === false
          ? { sourceDirty: manifest.sourceDirty }
          : {}),
        ...(typeof manifest.distDigest?.value === 'string'
          ? { distDigest: manifest.distDigest.value }
          : {}),
      },
    };
  }
  return null;
}

function walkForCore(start: string): CoreRootResolution | null {
  let cursor = path.resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    const found = inspectCandidateRoot(cursor);
    if (found) return found;

    // Do not escape the package that contains the executing module and then
    // mistake its host application for Code Buddy. Cowork's embedded runtime
    // deliberately has an ESM-only package.json in dist/, so allow exactly its
    // immediately enclosing, digest-attested runtime root before stopping.
    const packageBoundary = path.join(cursor, 'package.json');
    if (fs.existsSync(packageBoundary)) {
      if (path.basename(cursor).toLowerCase() === 'dist') {
        const runtimeRoot = path.dirname(cursor);
        const embedded = inspectCandidateRoot(runtimeRoot);
        if (embedded) return embedded;
      }
      break;
    }
    if (path.basename(cursor).toLowerCase() === 'node_modules') break;

    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

/** Resolve Lisa's implementation root without mistaking an arbitrary Cowork project for herself. */
export function resolveCodeBuddyCoreRoot(
  _candidateCwd?: string,
  moduleDir?: string
): CoreRootResolution {
  const here =
    moduleDir ??
    (() => {
      try {
        return path.dirname(fileURLToPath(import.meta.url));
      } catch {
        return process.cwd();
      }
    })();
  const installed = walkForCore(here);
  if (installed) return installed;
  // Never fall back to cwd. An arbitrary workspace can copy the package name
  // and source markers; only the executing module location (or an explicit
  // trusted `root` passed to buildOperationalSelfModel) may establish identity.
  return {
    root: path.resolve(here),
    layout: 'unknown',
    package: {
      name: 'code-buddy',
      version: 'inconnue',
      description: '',
    },
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function focusTokens(focus: string): Set<string> {
  const tokens = new Set(
    normalize(focus)
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !FOCUS_STOP_WORDS.has(token))
  );
  for (const token of [...tokens]) {
    for (const synonym of FOCUS_SYNONYMS[token] ?? []) tokens.add(synonym);
  }
  return tokens;
}

function defaultRankedAreas(
  areas: readonly FeatureArea[],
  limit: number,
): FeatureArea[] {
  const preferred = new Map<string, number>(DEFAULT_AREA_IDS.map((id, index) => [id, index]));
  return [...areas]
    .sort((left, right) => (preferred.get(left.id) ?? 999) - (preferred.get(right.id) ?? 999))
    .slice(0, limit);
}

function rankAreas(areas: readonly FeatureArea[], focus: string, limit: number): FeatureArea[] {
  const tokens = focusTokens(focus);
  if (tokens.size === 0) return defaultRankedAreas(areas, limit);

  const ranked = [...areas]
    .map((area, index) => {
      const haystack = new Set(
        normalize(`${area.id} ${area.name} ${area.description} ${area.paths.join(' ')}`)
          .split(/\s+/)
          .filter(Boolean),
      );
      let score = 0;
      for (const token of tokens) {
        if (haystack.has(token)) score += token.length >= 7 ? 3 : 2;
      }
      return { area, score, index };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.area);
  return ranked.length > 0 ? ranked : defaultRankedAreas(areas, limit);
}

function compiledEquivalent(declaredPath: string): string {
  const withoutSrc = declaredPath.replace(/^src\//, '');
  return path.join('dist', withoutSrc).replace(/\.tsx?$/, '.js');
}

function withinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function exportedSymbols(content: string): string[] {
  const out = new Set<string>();
  const pattern =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of content.matchAll(pattern)) {
    if (match[1]) out.add(match[1]);
    if (out.size >= MAX_EXPORTS) break;
  }
  return [...out];
}

/**
 * Extract a small, prompt-safe structural view of a source file. This is not
 * arbitrary file reading: callers can only reach files declared by the
 * curated Code Buddy feature map and confined to the attested core root.
 * Values and bodies are removed so a comment or embedded string cannot become
 * an instruction in the model context.
 */
function structuralExcerpt(content: string): string[] {
  const declarations: string[] = [];
  const declarationPattern =
    /^\s*(?:(?:export|declare)\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|interface|type|enum|const|let|var)\b/;
  const memberPattern =
    /^\s*(?:(?:public|private|protected|static|readonly|abstract|override|async|get|set)\s+)+(?:[A-Za-z_$][\w$]*|constructor)\s*[(:<]/;

  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ' '))
    .replace(/\/\/[^\r\n]*/g, '');
  for (const rawLine of withoutComments.split(/\r?\n/)) {
    if (!declarationPattern.test(rawLine) && !memberPattern.test(rawLine)) continue;
    let line = rawLine.trim();
    if (!line) continue;
    // Constants and type aliases expose their declaration, never their value.
    if (/\b(?:const|let|var|type)\b/.test(line)) line = line.split(/\s*=\s*/, 1)[0] ?? line;
    // Function/class bodies are not part of this structural evidence.
    line = line.split('{', 1)[0] ?? line;
    // Declaration defaults may contain prose that looks like an instruction.
    line = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '…');
    const safe = normalizedEvidenceString(line, MAX_STRUCTURAL_EXCERPT_CHARS);
    if (safe && !declarations.includes(safe)) declarations.push(safe);
    if (declarations.length >= MAX_STRUCTURAL_EXCERPT_LINES) break;
  }
  return declarations;
}

function inspectDeclaredPath(
  root: CoreRootResolution,
  declaredPath: string,
  includeExcerpt: boolean
): OperationalSourceEvidence {
  const candidates: Array<{ relative: string; artifact: 'source' | 'compiled' }> = [
    { relative: declaredPath, artifact: 'source' },
  ];
  if (declaredPath.startsWith('src/')) {
    candidates.push({ relative: compiledEquivalent(declaredPath), artifact: 'compiled' });
  }

  for (const candidate of candidates) {
    const absolute = path.resolve(root.root, candidate.relative);
    if (!withinRoot(root.root, absolute)) continue;
    try {
      const canonicalRoot = fs.realpathSync(root.root);
      const canonicalPath = fs.realpathSync(absolute);
      if (!withinRoot(canonicalRoot, canonicalPath)) continue;
      const stat = fs.statSync(canonicalPath);
      if (stat.isDirectory()) {
        const entries = fs
          .readdirSync(canonicalPath, { withFileTypes: true })
          .filter((entry) => !entry.name.startsWith('.'))
          .flatMap((entry) => {
            const safeName = normalizedEvidenceString(entry.name, 160);
            return safeName ? [`${safeName}${entry.isDirectory() ? '/' : ''}`] : [];
          })
          .sort()
          .slice(0, MAX_DIRECTORY_ENTRIES);
        return {
          declaredPath,
          observedPath: candidate.relative.replaceAll(path.sep, '/'),
          artifact: candidate.artifact,
          kind: 'directory',
          entries,
        };
      }
      if (!stat.isFile()) continue;
      const raw = stat.size <= MAX_SOURCE_BYTES ? fs.readFileSync(canonicalPath, 'utf8') : null;
      return {
        declaredPath,
        observedPath: candidate.relative.replaceAll(path.sep, '/'),
        artifact: candidate.artifact,
        kind: 'file',
        sizeBytes: stat.size,
        ...(raw !== null
          ? {
              lineCount: raw.split(/\r?\n/).length,
              digest: createHash('sha256').update(raw).digest('hex').slice(0, 16),
              exports: exportedSymbols(raw),
              ...(includeExcerpt ? { excerpt: structuralExcerpt(raw) } : {}),
            }
          : {}),
      };
    } catch {
      // Try the compiled equivalent before declaring the path absent.
    }
  }
  return { declaredPath, artifact: 'missing', kind: 'missing' };
}

function buildAreas(
  root: CoreRootResolution,
  focus: string,
  depth: OperationalSelfDepth,
  areas: readonly FeatureArea[]
): OperationalSelfArea[] {
  const ranked = rankAreas(areas, focus, depth === 'deep' ? 6 : 3);
  if (root.layout === 'unknown') {
    return ranked.map((area) => ({
      id: area.id,
      name: area.name,
      description: area.description,
      evidence: area.paths
        .slice(0, depth === 'deep' ? 5 : 3)
        .map((declaredPath) => ({
          declaredPath,
          artifact: 'missing' as const,
          kind: 'missing' as const,
        })),
      state: 'unavailable' as const,
    }));
  }
  return ranked.map((area) => {
    const evidence = area.paths
      .slice(0, depth === 'deep' ? 5 : 3)
      .map((declaredPath) => inspectDeclaredPath(root, declaredPath, depth === 'deep'));
    const found = evidence.filter((entry) => entry.kind !== 'missing').length;
    return {
      id: area.id,
      name: area.name,
      description: area.description,
      evidence,
      state: found === 0 ? 'unavailable' : found === evidence.length ? 'verified' : 'partial',
    };
  });
}

function buildRepositoryFingerprint(
  root: CoreRootResolution,
  git: { branch?: string; revision?: string; dirty: boolean | null },
  codeGraph: OperationalSelfModel['codeGraph'],
): string {
  const fixedEvidence = root.layout === 'unknown'
    ? []
    : REPOSITORY_FINGERPRINT_PATHS.map((declaredPath) => {
        const evidence = inspectDeclaredPath(root, declaredPath, false);
        return [
          evidence.observedPath ?? evidence.declaredPath,
          evidence.kind,
          evidence.digest ?? null,
          evidence.sizeBytes ?? null,
        ];
      });
  return createHash('sha256')
    .update(JSON.stringify({
      package: {
        name: root.package.name,
        version: root.package.version,
        description: root.package.description,
      },
      layout: root.layout,
      revision: git.revision,
      dirty: git.dirty,
      distDigest: root.package.distDigest,
      graph: codeGraph.lastCommit,
      evidence: fixedEvidence,
    }))
    .digest('hex')
    .slice(0, 20);
}

function gitEvidence(
  root: CoreRootResolution
): { branch?: string; revision?: string; dirty: boolean | null } {
  if (root.layout !== 'source') {
    return {
      ...(root.package.sourceRevision ? { revision: root.package.sourceRevision } : {}),
      dirty: root.package.sourceDirty ?? null,
    };
  }

  // Read immutable Git metadata directly. Spawning `git status` here used to
  // block voice first-token latency and could activate a repository-controlled
  // fsmonitor process during a supposedly observational turn.
  try {
    const canonicalRoot = fs.realpathSync(root.root);
    const gitDir = fs.realpathSync(path.join(root.root, '.git'));
    if (!withinRoot(canonicalRoot, gitDir) || !fs.statSync(gitDir).isDirectory()) {
      return { dirty: null };
    }
    const head = safeReadWithinRoot(gitDir, path.join(gitDir, 'HEAD'), 4 * 1024)?.trim();
    if (!head) return { dirty: null };
    if (/^[a-f0-9]{40,64}$/i.test(head)) {
      return { branch: 'detached', revision: head.toLowerCase(), dirty: null };
    }

    const ref = head.match(/^ref: (refs\/[A-Za-z0-9._/-]+)$/)?.[1];
    if (!ref || ref.includes('..')) return { dirty: null };
    const looseRevision = safeReadWithinRoot(gitDir, path.join(gitDir, ref), 4 * 1024)?.trim();
    let revision = /^[a-f0-9]{40,64}$/i.test(looseRevision ?? '')
      ? looseRevision!.toLowerCase()
      : undefined;
    if (!revision) {
      const packedRefs = safeReadWithinRoot(
        gitDir,
        path.join(gitDir, 'packed-refs'),
        2 * 1024 * 1024
      );
      const packedRevision = packedRefs
        ?.split(/\r?\n/)
        .find((line) => line.endsWith(` ${ref}`))
        ?.split(' ')[0];
      if (/^[a-f0-9]{40,64}$/i.test(packedRevision ?? '')) {
        revision = packedRevision!.toLowerCase();
      }
    }
    return {
      branch: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref,
      ...(revision ? { revision } : {}),
      // A safe metadata read cannot prove worktree cleanliness. Say unknown.
      dirty: null,
    };
  } catch {
    return { dirty: null };
  }
}

function codeGraphEvidence(
  root: CoreRootResolution,
  revision: string | undefined
): OperationalSelfModel['codeGraph'] {
  if (root.layout !== 'source') return { indexed: false, stale: null };
  const parsed =
    safeJsonWithinRoot<unknown>(
      root.root,
      path.join(root.root, '.gitnexus', 'meta.json')
    ) ??
    safeJsonWithinRoot<unknown>(
      root.root,
      path.join(root.root, '.codeexplorer', 'meta.json')
    );
  if (!isPlainRecord(parsed)) return { indexed: false, stale: null };
  const meta = parsed;
  const nested = isPlainRecord(meta.stats) ? meta.stats : null;
  const lastCommit =
    typeof meta.lastCommit === 'string' && /^[a-f0-9]{7,64}$/i.test(meta.lastCommit)
      ? meta.lastCommit.toLowerCase()
      : undefined;
  const indexedAt =
    typeof meta.indexedAt === 'string' &&
    meta.indexedAt.length <= 128 &&
    !/[\r\n<>]/.test(meta.indexedAt)
      ? meta.indexedAt
      : undefined;
  const symbols =
    Number.isSafeInteger(nested?.nodes) && (nested?.nodes as number) >= 0
      ? (nested?.nodes as number)
      : undefined;
  const relations =
    Number.isSafeInteger(nested?.edges) && (nested?.edges as number) >= 0
      ? (nested?.edges as number)
      : undefined;
  const declaredStale = typeof meta.stale === 'boolean' ? meta.stale : null;
  if (
    !lastCommit &&
    !indexedAt &&
    symbols === undefined &&
    relations === undefined &&
    declaredStale === null
  ) {
    return { indexed: false, stale: null };
  }
  const stale =
    lastCommit && revision
      ? !(lastCommit.startsWith(revision) || revision.startsWith(lastCommit))
      : declaredStale === true
        ? true
        : null;
  return {
    indexed: true,
    stale,
    ...(lastCommit ? { lastCommit } : {}),
    ...(indexedAt ? { indexedAt } : {}),
    ...(symbols !== undefined ? { symbols } : {}),
    ...(relations !== undefined ? { relations } : {}),
  };
}

function fact(
  observedAt: string,
  id: string,
  label: string,
  state: OperationalFactState,
  value: string,
  source: string[],
  reason?: string
): OperationalSelfFact {
  const safeValue = normalizedEvidenceString(value, 1_000) ?? 'inconnu';
  const safeReason = normalizedEvidenceString(reason, 1_000);
  return {
    id,
    label,
    state,
    value: safeValue,
    source,
    observedAt,
    ...(safeReason ? { reason: safeReason } : {}),
  };
}

function normalizedToolNames(
  names: readonly string[] | undefined,
): { names: string[]; truncated: boolean } {
  if (!names) return { names: [], truncated: false };
  return {
    names: [
      ...new Set(
        names.slice(0, MAX_OPERATIONAL_TOOL_NAMES).flatMap((name) => {
          const safeName = normalizedEvidenceString(name, 128);
          return safeName && SAFE_TOOL_NAME.test(safeName) ? [safeName] : [];
        })
      ),
    ],
    truncated: names.length > MAX_OPERATIONAL_TOOL_NAMES,
  };
}

function renderToolNames(names: readonly string[], truncated: boolean): string {
  if (names.length === 0) return '0';
  const visible = names.slice(0, 12);
  const count = truncated ? `au moins ${names.length}` : String(names.length);
  return `${count} (${visible.join(', ')}${names.length > visible.length || truncated ? ', …' : ''})`;
}

function normalizedRuntimeIdentifier(
  value: string | undefined,
  pattern = SAFE_RUNTIME_ID,
): string | undefined {
  const normalized = normalizedEvidenceString(value, 128);
  return normalized && pattern.test(normalized) && !UNSAFE_RUNTIME_METADATA.test(normalized)
    ? normalized
    : undefined;
}

function runtimeFacts(
  runtime: CompanionRuntimeEvidence | undefined,
  observedAt: string
): OperationalSelfFact[] {
  if (!runtime) {
    return [
      fact(
        observedAt,
        'runtime',
        'Runtime compagnon',
        'unknown',
        'non sondé',
        ['self_describe execution context'],
        'Le contexte runtime n’a pas été transmis.'
      ),
    ];
  }
  const facts: OperationalSelfFact[] = [];
  const model = normalizedRuntimeIdentifier(runtime.model);
  const provider = normalizedRuntimeIdentifier(runtime.provider, SAFE_PROVIDER_LABEL);
  const surface = normalizedRuntimeIdentifier(runtime.surface);
  const permissionMode = runtime.permissionMode && SAFE_PERMISSION_MODES.has(runtime.permissionMode)
    ? runtime.permissionMode
    : undefined;
  const localDeterministic = runtime.providerInvoked === false;
  if (localDeterministic) {
    facts.push(
      fact(
        observedAt,
        'turn.execution',
        'Mode d’exécution du rapport',
        'verified',
        'local déterministe ; aucun fournisseur invoqué',
        ['AgentExecutor local self-inspection path'],
      ),
    );
  }
  facts.push(
    fact(
      observedAt,
      'turn.model',
      localDeterministic
        ? 'Modèle configuré dans le client (non invoqué)'
        : 'Modèle configuré/demandé pour ce tour',
      model ? 'configured' : 'unknown',
      model || 'inconnu',
      ['pre-dispatch client configuration'],
      model
        ? localDeterministic
          ? 'Le rapport a été construit localement sans appel à ce modèle.'
          : 'La réponse du fournisseur peut appliquer un routage ou un fallback non attesté ici.'
        : undefined,
    )
  );
  facts.push(
    fact(
      observedAt,
      'turn.provider',
      localDeterministic
        ? 'Fournisseur configuré dans le client (non invoqué)'
        : 'Fournisseur configuré pour ce tour',
      provider ? 'configured' : 'unknown',
      provider || 'inconnu',
      ['pre-dispatch client configuration'],
      provider
        ? localDeterministic
          ? 'Aucun dispatch fournisseur n’a eu lieu pour ce rapport.'
          : 'Le fournisseur ayant réellement servi la réponse n’est pas attesté après dispatch.'
        : undefined,
    )
  );
  facts.push(
    fact(
      observedAt,
      'turn.surface',
      'Surface',
      surface ? 'verified' : 'unknown',
      surface || 'inconnue',
      ['agent turn metadata']
    )
  );
  facts.push(
    fact(
      observedAt,
      'turn.permission',
      'Mode de permission',
      permissionMode ? 'verified' : 'unknown',
      permissionMode || 'inconnu',
      ['agent turn metadata']
    )
  );
  const theme = surface === 'cli' ? normalizedRuntimeIdentifier(runtime.theme) : undefined;
  if (theme) {
    facts.push(fact(observedAt, 'turn.theme', 'Thème CLI actif', 'verified', theme,
      ['in-process Ink ThemeManager']));
  }
  const registered = normalizedToolNames(runtime.registeredToolNames);
  const exposed = normalizedToolNames(runtime.exposedToolNames);
  facts.push(
    fact(
      observedAt,
      'tools.registered',
      'Outils enregistrés',
      runtime.registeredToolNames !== undefined ? 'verified' : 'unknown',
      runtime.registeredToolNames !== undefined
        ? renderToolNames(registered.names, registered.truncated)
        : 'inconnu',
      ['FormalToolRegistry.getNames()']
    )
  );
  facts.push(
    fact(
      observedAt,
      'tools.exposed',
      'Outils exposés à ce tour',
      runtime.exposedToolNames !== undefined ? 'verified' : 'unknown',
      runtime.exposedToolNames !== undefined
        ? renderToolNames(exposed.names, exposed.truncated)
        : 'inconnu',
      ['selected tool schemas for this turn']
    )
  );
  if (runtime.identity) {
    facts.push(
      fact(
        observedAt,
        'identity.companion',
        'Identité compagnon',
        runtime.identity.companionReady ? 'available' : 'unavailable',
        runtime.identity.companionReady ? 'SOUL.md et BOOT.md compagnon chargés' : 'incomplète',
        ['IdentityManager']
      )
    );
  }
  if (runtime.authConfigured !== undefined) {
    facts.push(
      fact(
        observedAt,
        'auth.chatgpt',
        'Authentification ChatGPT',
        runtime.authConfigured ? 'configured' : 'unavailable',
        runtime.authConfigured ? 'présente' : 'absente',
        ['credential configuration snapshot']
      )
    );
  }
  for (const [id, label, capability] of [
    ['voice', 'Écoute vocale', runtime.voice] as const,
    ['tts', 'Voix TTS', runtime.tts] as const,
  ]) {
    if (!capability) continue;
    facts.push(
      fact(
        observedAt,
        `${id}.configured`,
        `${label} configurée`,
        capability.configured ? 'configured' : 'unavailable',
        capability.configured
          ? `oui${capability.provider ? ` (${capability.provider})` : ''}`
          : 'non',
        ['turn runtime configuration']
      )
    );
    if (capability.available !== undefined) {
      facts.push(
        fact(
          observedAt,
          `${id}.available`,
          `${label} disponible`,
          capability.available ? 'available' : 'unavailable',
          capability.available ? 'oui' : 'non',
          ['explicit turn capability probe'],
          capability.reason
        )
      );
    }
  }
  if (runtime.camera) {
    if (runtime.camera.configured !== undefined) {
      facts.push(
        fact(
          observedAt,
          'camera.configured',
          'Caméra configurée',
          runtime.camera.configured ? 'configured' : 'unavailable',
          runtime.camera.configured ? 'oui' : 'non',
          ['turn runtime configuration']
        )
      );
    }
    if (runtime.camera.available !== undefined) {
      facts.push(
        fact(
          observedAt,
          'camera.available',
          'Caméra disponible',
          runtime.camera.available ? 'available' : 'unavailable',
          runtime.camera.available ? 'oui' : 'non',
          ['explicit turn capability probe'],
          runtime.camera.reason
        )
      );
    }
  }
  if (
    runtime.perceptCount !== undefined &&
    Number.isSafeInteger(runtime.perceptCount) &&
    runtime.perceptCount >= 0
  ) {
    facts.push(
      fact(
        observedAt,
        'memory.percepts',
        'Percepts locaux',
        'verified',
        String(runtime.perceptCount),
        ['companion percept journal']
      )
    );
  }
  return facts;
}

function render(model: Omit<OperationalSelfModel, 'text'>): string {
  const revisionStatus = model.repository.revision
    ? model.repository.layout === 'packaged-runtime'
      ? model.repository.dirty === true
        ? `révision déclarée au build ${model.repository.revision.slice(0, 12)} (arbre déclaré modifié au build)`
        : model.repository.dirty === false
          ? `révision déclarée au build ${model.repository.revision.slice(0, 12)} (arbre déclaré propre au build)`
          : `révision déclarée au build ${model.repository.revision.slice(0, 12)} (état de l’arbre non déclaré)`
      : `révision Git observée ${model.repository.revision.slice(0, 12)} (propreté actuelle inconnue)`
    : 'révision inconnue';
  const lines = [
    `Modèle de soi opérationnel — ${model.identity.robotName || model.identity.name} ` +
      `(${model.identity.name} v${model.identity.version})`,
    `Observé le : ${model.observedAt}.`,
    `Preuve code : ${model.repository.layout}, ${revisionStatus}, ` +
      `empreinte ${model.repository.fingerprint}.`,
    `Conscience subjective : non établie. Ce rapport décrit un logiciel et son runtime observables.`,
    '',
    'Faits opérationnels et niveau de preuve :',
    ...model.facts.map(
      (entry) =>
        `- [${entry.state}] ${entry.label} : ${entry.value}` +
        `${entry.reason ? ` — ${entry.reason}` : ''} (source : ${entry.source.join(', ')})`
    ),
    '',
    'Zones de code pertinentes :',
  ];
  for (const area of model.areas) {
    const paths = area.evidence.map((entry) => {
      const details = [
        entry.lineCount !== undefined ? `${entry.lineCount} lignes` : null,
        entry.digest ? `sha256:${entry.digest}` : null,
        entry.exports?.length ? `exports ${entry.exports.slice(0, 4).join(', ')}` : null,
        entry.entries?.length ? `entrées ${entry.entries.slice(0, 4).join(', ')}` : null,
      ].filter((detail): detail is string => detail !== null);
      return (
        `${entry.observedPath || entry.declaredPath} [${entry.artifact}/${entry.kind}` +
        `${details.length > 0 ? `; ${details.join('; ')}` : ''}]`
      );
    });
    lines.push(`- ${area.name} [${area.state}] : ${paths.join(', ') || 'aucune preuve'}`);
    for (const evidence of area.evidence) {
      if (!evidence.excerpt?.length) continue;
      lines.push(
        `  · Structure ${evidence.observedPath || evidence.declaredPath} : ` +
          evidence.excerpt.join(' | ')
      );
    }
  }
  if (model.codeGraph.indexed) {
    lines.push(
      '',
      `Index de code : ${model.codeGraph.stale === true ? 'périmé' : model.codeGraph.stale === false ? 'à jour' : 'fraîcheur inconnue'}.`
    );
  }
  lines.push('', 'Limites :', ...model.limits.map((limit) => `- ${limit}`));
  return lines.join('\n');
}

/** Build a bounded, read-only snapshot of Lisa's current implementation and runtime. */
export function buildOperationalSelfModel(
  options: BuildOperationalSelfModelOptions = {}
): OperationalSelfModel {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const depth = options.depth ?? 'summary';
  const focus =
    (options.focus ?? 'fonctionnement général')
      .replace(/\p{Cc}/gu, ' ')
      .replace(/[<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_FOCUS_CHARS) || 'fonctionnement général';
  const root = options.coreResolution ?? (
    options.root
      ? (inspectCandidateRoot(options.root) ?? {
          root: path.resolve(options.root),
          layout: 'unknown' as const,
          package: { name: 'code-buddy', version: 'inconnue', description: '' },
        })
      : resolveCodeBuddyCoreRoot(options.cwd)
  );
  const git = gitEvidence(root);
  const codeGraph = codeGraphEvidence(root, git.revision);
  const areas = buildAreas(root, focus, depth, options.featureAreas ?? CURATED_FEATURES);
  const repositoryFingerprint = buildRepositoryFingerprint(root, git, codeGraph);

  const repository = {
    layout: root.layout,
    ...(git.branch ? { branch: git.branch } : {}),
    ...(git.revision ? { revision: git.revision } : {}),
    dirty: git.dirty,
    fingerprint: repositoryFingerprint,
  };
  const implementationSources = areas
    .flatMap((area) => area.evidence)
    .filter((entry) => entry.kind !== 'missing')
    .map((entry) => entry.observedPath || entry.declaredPath)
    .slice(0, 6);
  const implementationFact = fact(
    observedAt,
    'core.implementation',
    'Implémentation du cœur',
    root.layout !== 'unknown' && implementationSources.length > 0 ? 'implemented' : 'unknown',
    root.layout === 'source'
      ? 'sources Code Buddy observées'
      : root.layout === 'packaged-runtime'
        ? 'runtime compilé dont l’intégrité locale correspond au manifeste'
        : 'non établie',
    implementationSources.length > 0 ? implementationSources : ['curated Code Buddy feature map']
  );
  const candidateRobotName = normalizedEvidenceString(options.robotName, 64);
  const robotName = candidateRobotName &&
    SAFE_ROBOT_NAME.test(candidateRobotName) &&
    !UNSAFE_RUNTIME_METADATA.test(candidateRobotName)
    ? candidateRobotName
    : null;
  const base: Omit<OperationalSelfModel, 'text'> = {
    schemaVersion: 1,
    observedAt,
    kind: 'operational-self-model',
    subjectiveConsciousness: 'not-established',
    focus,
    depth,
    identity: {
      name: root.package.name,
      ...(robotName ? { robotName } : {}),
      version: root.package.version,
      description: root.package.description,
    },
    repository,
    codeGraph,
    facts: [implementationFact, ...runtimeFacts(options.runtime, observedAt)],
    areas,
    limits: [
      'La présence d’un fichier prouve une implémentation, pas qu’un service est vivant.',
      'Une configuration prouve une intention de fonctionnement, pas sa disponibilité.',
      'Les chemins inspectés sont limités à la cartographie interne connue de Code Buddy.',
      'Ce modèle de soi opérationnel ne démontre ni conscience subjective, ni émotions vécues, ni vie intérieure.',
    ],
  };
  return { ...base, text: render(base) };
}
