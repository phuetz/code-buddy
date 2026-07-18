import { lstat, readdir, realpath } from 'fs/promises';
import { homedir } from 'os';
import { extname, isAbsolute, join, relative, sep } from 'path';
import { COMFY_LAB_MANIFEST } from '../../shared/comfy-lab-manifest';
import type {
  ComfyLabActionResult,
  ComfyLabManifestRequirement,
  ComfyLabReadiness,
  ComfyLabRequirementView,
  ComfyLabSnapshot,
  ComfyLabUseCaseId,
  ComfyLabUseCaseView,
} from '../../shared/comfy-lab';

const DEFAULT_PORT = 8188;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const MAX_PROBE_BYTES = 8 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 10_000;
const MAX_MODELS = 4_000;
const MAX_TEMPLATES = 1_000;
const MAX_MATCHES_PER_REQUIREMENT = 4;
const MODEL_EXTENSIONS = new Set([
  '.bin',
  '.ckpt',
  '.gguf',
  '.onnx',
  '.pt',
  '.pth',
  '.safetensors',
]);

interface LocalFileSignal {
  relativePath: string;
  bytes: number;
}

interface InstallationResult {
  found: boolean;
  root?: string;
  source: 'COMFYUI_ROOT' | 'auto' | 'none';
  reason: string;
}

interface ProbeResult {
  reachable: boolean;
  nodes: string[];
  comfyuiVersion?: string;
  device?: { name: string; type: string };
  cpuFallback: boolean;
  reason: string;
}

interface InventoryResult {
  models: LocalFileSignal[];
  templates: LocalFileSignal[];
  truncated: boolean;
}

export interface ComfyLabServiceOptions {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  probeTimeoutMs?: number;
  openExternal?: (url: string) => Promise<void>;
  writeClipboard?: (text: string) => void;
}

/**
 * Read-only local capability audit plus two explicit safe actions.
 *
 * It never downloads a model, imports a workflow, starts ComfyUI or queues a
 * prompt. Network requests target either loopback or an explicitly configured
 * private/HTTPS ComfyUI endpoint (for example Darkstar).
 */
export class ComfyLabService {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly homeDirectory: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly probeTimeoutMs: number;
  private readonly openExternal?: (url: string) => Promise<void>;
  private readonly writeClipboard?: (text: string) => void;
  private readonly endpointUrl: string;
  private readonly endpointScope: 'local' | 'remote';

  constructor(options: ComfyLabServiceOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.probeTimeoutMs = clampTimeout(options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    this.openExternal = options.openExternal;
    this.writeClipboard = options.writeClipboard;
    const endpoint = resolveComfyEndpoint(this.environment);
    this.endpointUrl = endpoint.url;
    this.endpointScope = endpoint.scope;
  }

  async inspect(): Promise<ComfyLabSnapshot> {
    const [installation, probe] = await Promise.all([
      this.resolveInstallation(),
      this.probeEndpoint(),
    ]);
    const inventory = installation.root
      ? await scanInstallation(installation.root)
      : { models: [], templates: [], truncated: false };
    const useCases = COMFY_LAB_MANIFEST
      .map((manifest) => evaluateUseCase(manifest, installation, inventory, probe))
      .sort((left, right) => left.priority - right.priority);
    return {
      schemaVersion: 1,
      generatedAt: this.now().toISOString(),
      installation,
      probe: {
        state: probe.reachable ? 'reachable' : 'unreachable',
        url: this.endpointUrl,
        scope: this.endpointScope,
        ...(probe.comfyuiVersion ? { comfyuiVersion: probe.comfyuiVersion } : {}),
        ...(probe.device ? { device: probe.device } : {}),
        cpuFallback: probe.cpuFallback,
        reason: probe.reason,
      },
      inventory: {
        modelFiles: inventory.models.length,
        modelBytes: inventory.models.reduce((total, model) => total + model.bytes, 0),
        templates: inventory.templates.length,
        nodes: probe.nodes.length,
        truncated: inventory.truncated,
      },
      useCases,
      safety: {
        localOnly: this.endpointScope === 'local',
        implicitDownloads: false,
        implicitExecution: false,
        note: `${this.endpointScope === 'local' ? 'Diagnostic local' : 'Diagnostic distant explicitement configuré'} : aucun modèle téléchargé, workflow importé ou prompt exécuté.`,
      },
    };
  }

  async openComfyUi(): Promise<ComfyLabActionResult> {
    if (!this.openExternal) {
      return { ok: false, error: 'L’ouverture externe n’est pas configurée.' };
    }
    const probe = await this.probeEndpoint();
    if (!probe.reachable) {
      return { ok: false, error: `ComfyUI est inaccessible : ${probe.reason}` };
    }
    try {
      await this.openExternal(this.endpointUrl);
      return { ok: true, message: `ComfyUI ${this.endpointScope === 'local' ? 'local' : 'distant'} a été ouvert.` };
    } catch (error) {
      return { ok: false, error: cleanError(error) };
    }
  }

  async copyPlan(useCaseId: ComfyLabUseCaseId): Promise<ComfyLabActionResult> {
    if (!this.writeClipboard) {
      return { ok: false, error: 'Le presse-papiers local n’est pas configuré.' };
    }
    const snapshot = await this.inspect();
    const useCase = snapshot.useCases.find((candidate) => candidate.id === useCaseId);
    if (!useCase) return { ok: false, error: 'Cas d’usage ComfyUI inconnu.' };
    const plan = buildPlan(snapshot, useCase);
    try {
      this.writeClipboard(plan);
      return { ok: true, plan, message: `Plan « ${useCase.title} » copié.` };
    } catch (error) {
      return { ok: false, error: cleanError(error) };
    }
  }

  private async resolveInstallation(): Promise<InstallationResult> {
    const configured = this.environment.COMFYUI_ROOT?.trim();
    if (configured) {
      if (!isAbsolute(configured) || configured.includes('\0')) {
        return {
          found: false,
          source: 'COMFYUI_ROOT',
          reason: 'COMFYUI_ROOT doit être un chemin absolu local.',
        };
      }
      const root = await validComfyRoot(configured);
      return root
        ? {
            found: true,
            root,
            source: 'COMFYUI_ROOT',
            reason: 'Installation résolue depuis COMFYUI_ROOT.',
          }
        : {
            found: false,
            source: 'COMFYUI_ROOT',
            reason: 'COMFYUI_ROOT ne désigne pas une installation ComfyUI lisible.',
          };
    }

    const candidates = [
      join(this.homeDirectory, 'ComfyUI'),
      join(this.homeDirectory, 'DEV', 'ComfyUI'),
      join(this.homeDirectory, '.codebuddy', 'comfyui'),
    ];
    for (const candidate of candidates) {
      const root = await validComfyRoot(candidate);
      if (root) {
        return {
          found: true,
          root,
          source: 'auto',
          reason: 'Installation ComfyUI locale détectée dans un emplacement standard.',
        };
      }
    }
    return {
      found: false,
      source: 'none',
      reason: 'Aucune installation trouvée. Définir COMFYUI_ROOT pour activer l’inventaire disque.',
    };
  }

  private async probeEndpoint(): Promise<ProbeResult> {
    try {
      const [stats, objectInfo] = await Promise.all([
        fetchBoundedJson(
          this.fetcher,
          `${this.endpointUrl}/system_stats`,
          this.probeTimeoutMs,
          MAX_PROBE_BYTES,
        ),
        fetchBoundedJson(
          this.fetcher,
          `${this.endpointUrl}/object_info`,
          this.probeTimeoutMs,
          MAX_PROBE_BYTES,
        ),
      ]);
      const nodes = objectInfo && typeof objectInfo === 'object' && !Array.isArray(objectInfo)
        ? Object.keys(objectInfo).slice(0, MAX_SCAN_ENTRIES)
        : [];
      const comfyuiVersion = nestedString(stats, 'system', 'comfyui_version');
      const device = firstDevice(stats);
      const cpuFallback = Boolean(
        device
        && (device.type.toLocaleLowerCase('en-US') === 'cpu'
          || device.name.toLocaleLowerCase('en-US') === 'cpu'),
      );
      return {
        reachable: true,
        nodes,
        ...(comfyuiVersion ? { comfyuiVersion } : {}),
        ...(device ? { device } : {}),
        cpuFallback,
        reason: cpuFallback
          ? 'ComfyUI répond en fallback CPU ; les générations seront nettement plus lentes.'
          : nodes.length > 0
            ? 'ComfyUI répond ; les nœuds ont été inventoriés sans exécuter de workflow.'
            : 'ComfyUI répond, mais aucun nœud exploitable n’a été retourné.',
      };
    } catch (error) {
      return {
        reachable: false,
        nodes: [],
        cpuFallback: false,
        reason: `Sonde ComfyUI bornée indisponible : ${cleanError(error)}`,
      };
    }
  }
}

function resolveComfyEndpoint(environment: NodeJS.ProcessEnv): { url: string; scope: 'local' | 'remote' } {
  const fallback = `http://127.0.0.1:${safePort(environment.COMFYUI_PORT)}`;
  const configured = environment.CODEBUDDY_COMFYUI_URL?.trim() || environment.COMFYUI_URL?.trim();
  if (!configured) return { url: fallback, scope: 'local' };
  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('scheme');
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('origin');
    const host = parsed.hostname.toLowerCase();
    const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    const privateHost = local || host === 'darkstar' || host.endsWith('.local')
      || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\.)/.test(host);
    if (parsed.protocol === 'http:' && !privateHost) throw new Error('public-http');
    return { url: parsed.origin, scope: local ? 'local' : 'remote' };
  } catch {
    return { url: fallback, scope: 'local' };
  }
}

async function validComfyRoot(candidate: string): Promise<string | null> {
  try {
    const canonical = await realpath(candidate);
    const rootInfo = await lstat(canonical);
    if (!rootInfo.isDirectory()) return null;
    const entries = new Set(await readdir(canonical));
    if (!entries.has('models') || (!entries.has('main.py') && !entries.has('comfy'))) return null;
    return canonical;
  } catch {
    return null;
  }
}

async function scanInstallation(root: string): Promise<InventoryResult> {
  const state = { visited: 0, truncated: false };
  const [models, templates] = await Promise.all([
    scanFiles(root, ['models'], (path, bytes) => (
      bytes > 0 && MODEL_EXTENSIONS.has(extname(path).toLowerCase())
    ), MAX_MODELS, state),
    scanFiles(root, ['workflows', 'templates', 'blueprints', join('user', 'default', 'workflows')], (
      path,
      bytes,
    ) => bytes > 0 && extname(path).toLowerCase() === '.json', MAX_TEMPLATES, state),
  ]);
  return { models, templates, truncated: state.truncated };
}

async function scanFiles(
  root: string,
  starts: string[],
  accept: (relativePath: string, bytes: number) => boolean,
  limit: number,
  state: { visited: number; truncated: boolean },
): Promise<LocalFileSignal[]> {
  const results: LocalFileSignal[] = [];
  const queue = starts.map((start) => join(root, start));
  while (queue.length > 0 && results.length < limit) {
    const directory = queue.shift()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      state.visited += 1;
      if (state.visited > MAX_SCAN_ENTRIES) {
        state.truncated = true;
        return results;
      }
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        queue.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        const relativePath = normalizeRelativePath(relative(root, path));
        if (accept(relativePath, info.size)) results.push({ relativePath, bytes: info.size });
        if (results.length >= limit) {
          state.truncated = true;
          return results;
        }
      } catch {
        // A concurrently removed inventory entry is simply omitted.
      }
    }
  }
  return results;
}

function evaluateUseCase(
  manifest: (typeof COMFY_LAB_MANIFEST)[number],
  installation: InstallationResult,
  inventory: InventoryResult,
  probe: ProbeResult,
): ComfyLabUseCaseView {
  const requirements = manifest.requirements.map((requirement) => (
    evaluateRequirement(requirement, inventory, probe)
  ));
  const missingRequired = requirements.filter((item) => item.required && !item.available);
  const readiness: ComfyLabReadiness = missingRequired.length === 0
    ? 'ready'
    : installation.found || probe.reachable || requirements.some((item) => item.available)
      ? 'partial'
      : 'missing';
  const baseReason = readiness === 'ready'
    ? 'Tous les prérequis déclarés sont détectés.'
    : readiness === 'partial'
      ? `À compléter : ${missingRequired.map((item) => item.label).join(', ')}.`
      : 'Installation et prérequis locaux non détectés.';
  const readinessReason = probe.cpuFallback && readiness !== 'missing'
    ? `${baseReason} Présence technique uniquement : le préflight de recette doit encore valider RAM/VRAM. En fallback CPU, ce parcours peut être indisponible, pas seulement lent.`
    : baseReason;
  return { ...manifest, readiness, readinessReason, requirements };
}

function evaluateRequirement(
  requirement: ComfyLabManifestRequirement,
  inventory: InventoryResult,
  probe: ProbeResult,
): ComfyLabRequirementView {
  const candidates = requirement.kind === 'model'
    ? inventory.models.map((item) => item.relativePath)
    : requirement.kind === 'template'
      ? inventory.templates.map((item) => item.relativePath)
      : probe.nodes;
  const patterns = requirement.patterns.map((pattern) => pattern.toLocaleLowerCase('en-US'));
  const matches = candidates
    .filter((candidate) => {
      const normalized = candidate.toLocaleLowerCase('en-US');
      return patterns.some((pattern) => normalized.includes(pattern));
    })
    .slice(0, MAX_MATCHES_PER_REQUIREMENT);
  return {
    ...requirement,
    available: matches.length > 0,
    matches,
    source: requirement.kind === 'node'
      ? probe.reachable ? 'loopback' : 'loopback-unavailable'
      : 'disk',
  };
}

async function fetchBoundedJson(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  assertProbeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error('réponse locale trop volumineuse');
    }
    if (!response.body) throw new Error('réponse locale vide');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let reading = true;
    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('réponse locale trop volumineuse');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function buildPlan(snapshot: ComfyLabSnapshot, useCase: ComfyLabUseCaseView): string {
  const missing = useCase.requirements.filter((requirement) => !requirement.available);
  const detected = useCase.requirements.filter((requirement) => requirement.available);
  return [
    `# Plan ComfyUI — ${useCase.title}`,
    '',
    `État : ${useCase.readiness.toUpperCase()} — ${useCase.readinessReason}`,
    `Livrable : ${useCase.deliverable}`,
    `Installation : ${snapshot.installation.found ? 'détectée' : 'non détectée'}`,
    `Sonde : ${snapshot.probe.state} (${snapshot.probe.url})`,
    '',
    '## Détecté',
    ...(detected.length ? detected.map((item) => `- ${item.label}: ${item.matches.join(', ')}`) : ['- Aucun prérequis déclaré détecté.']),
    '',
    '## À compléter manuellement',
    ...(missing.length ? missing.map((item) => `- ${item.label}`) : ['- Aucun prérequis manquant.']),
    '',
    '## Étapes',
    ...useCase.manualSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Coûts et droits',
    `- API : ${useCase.cost.api}`,
    `- Calcul : ${useCase.cost.compute}`,
    `- Stockage : ${useCase.cost.storage}`,
    `- Licence : ${useCase.license}`,
    '',
    '## Limites',
    ...useCase.limits.map((limit) => `- ${limit}`),
    '',
    '> Ce plan ne télécharge rien, n’installe rien et n’exécute aucun workflow.',
  ].join('\n');
}

function assertProbeUrl(input: string): void {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  const privateHost = host === '127.0.0.1' || host === 'localhost' || host === '::1'
    || host === 'darkstar' || host.endsWith('.local')
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\.)/.test(host);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost))) {
    throw new Error('la sonde ComfyUI doit utiliser HTTPS ou un endpoint HTTP privé explicitement configuré');
  }
}

function nestedString(value: unknown, parent: string, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[parent];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return undefined;
  const candidate = (nested as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate.slice(0, 100) : undefined;
}

function firstDevice(value: unknown): { name: string; type: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const devices = (value as Record<string, unknown>).devices;
  if (!Array.isArray(devices)) return undefined;
  for (const item of devices.slice(0, 16)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.type !== 'string') continue;
    return {
      name: record.name.replace(/\s+/gu, ' ').slice(0, 120),
      type: record.type.replace(/\s+/gu, ' ').slice(0, 80),
    };
  }
  return undefined;
}

function safePort(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_PORT);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : DEFAULT_PORT;
}

function clampTimeout(value: number): number {
  return Math.max(250, Math.min(3_000, Math.round(value)));
}

function normalizeRelativePath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').slice(0, 500);
}
