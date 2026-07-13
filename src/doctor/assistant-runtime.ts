import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';

export const ASSISTANT_REPAIR_SERVICES = [
  'buddy-vision-brain',
  'buddy-sense',
  'buddy-vision-eye',
  'lisa-telegram',
  'codebuddy-pocket-tts',
  'codebuddy-cowork-runtime',
  'codebuddy-ollama-gpu',
] as const;

export type AssistantRepairService = (typeof ASSISTANT_REPAIR_SERVICES)[number];
export type AssistantOrganStatus = 'healthy' | 'unhealthy' | 'unknown';
export type AssistantDoctorStatus = 'healthy' | 'degraded';

export interface AssistantOrganProbe {
  id:
    | 'brain'
    | 'sensory-bridge'
    | 'pocket-tts'
    | 'cowork-cdp'
    | 'ollama-local'
    | 'buddy-sense'
    | 'vision-eye'
    | 'telegram';
  label: string;
  source: 'http' | 'tcp' | 'systemd-user';
  status: AssistantOrganStatus;
  detail: string;
  latencyMs: number;
  repairService?: AssistantRepairService;
}

export interface AssistantRepairAttempt {
  service: AssistantRepairService;
  result: 'restarted' | 'failed';
}

export type AssistantRepairSkipReason =
  | 'cooldown'
  | 'global-rate-limit'
  | 'per-run-limit'
  | 'service-not-loaded'
  | 'service-state-unknown'
  | 'repair-state-unavailable'
  | 'unsupported-platform';

export interface AssistantRepairSkip {
  service: AssistantRepairService;
  reason: AssistantRepairSkipReason;
  cooldownRemainingMs?: number;
}

export interface AssistantRuntimeDoctorReport {
  kind: 'assistant_runtime_doctor';
  generatedAt: string;
  status: AssistantDoctorStatus;
  summary: {
    healthy: number;
    unhealthy: number;
    unknown: number;
    total: number;
  };
  probes: AssistantOrganProbe[];
  repair: {
    requested: boolean;
    candidates: AssistantRepairService[];
    attempts: AssistantRepairAttempt[];
    skipped: AssistantRepairSkip[];
    policy: {
      cooldownMs: number;
      maxPerRun: number;
      maxPerWindow: number;
      windowMs: number;
    };
  };
}

export interface UserServiceController {
  getActiveState(
    service: AssistantRepairService,
    timeoutMs: number,
  ): Promise<'active' | 'inactive' | 'failed' | 'unknown'>;
  isLoaded(service: AssistantRepairService, timeoutMs: number): Promise<boolean | null>;
  restart(service: AssistantRepairService, timeoutMs: number): Promise<boolean>;
}

export interface AssistantRepairState {
  version: 1;
  attempts: Array<{ service: AssistantRepairService; attemptedAt: number }>;
}

export interface AssistantRepairStateStore {
  read(): Promise<AssistantRepairState>;
  write(state: AssistantRepairState): Promise<void>;
}

interface HttpResponseLike {
  ok: boolean;
  status: number;
}

export interface AssistantRuntimeDoctorDependencies {
  fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<HttpResponseLike>;
  tcpProbe?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  services?: UserServiceController;
  repairStateStore?: AssistantRepairStateStore;
  now?: () => number;
  platform?: NodeJS.Platform;
}

export interface AssistantRuntimeDoctorOptions {
  repair?: boolean;
  probeTimeoutMs?: number;
  serviceTimeoutMs?: number;
  cooldownMs?: number;
  maxRepairsPerRun?: number;
  repairWindowMs?: number;
  maxRepairsPerWindow?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 1_200;
const DEFAULT_SERVICE_TIMEOUT_MS = 3_000;
const DEFAULT_REPAIR_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_MAX_REPAIRS_PER_RUN = 3;
const DEFAULT_REPAIR_WINDOW_MS = 60 * 60_000;
const DEFAULT_MAX_REPAIRS_PER_WINDOW = 6;
const MAX_REPAIR_STATE_BYTES = 64 * 1024;
const MAX_REPAIR_STATE_ATTEMPTS = 128;
const REPAIR_PRIORITY: readonly AssistantRepairService[] = [
  'codebuddy-ollama-gpu',
  'buddy-vision-brain',
  'codebuddy-pocket-tts',
  'buddy-sense',
  'buddy-vision-eye',
  'lisa-telegram',
  'codebuddy-cowork-runtime',
];

const HTTP_PROBES = [
  {
    id: 'brain',
    label: 'Brain',
    url: 'http://127.0.0.1:3055/api/health/ready',
    service: 'buddy-vision-brain',
  },
  {
    id: 'pocket-tts',
    label: 'Pocket TTS',
    url: 'http://127.0.0.1:8766/health',
    service: 'codebuddy-pocket-tts',
  },
  {
    id: 'cowork-cdp',
    label: 'Cowork CDP',
    url: 'http://127.0.0.1:9222/json/version',
    service: 'codebuddy-cowork-runtime',
  },
  {
    id: 'ollama-local',
    label: 'Ollama local',
    url: 'http://127.0.0.1:11435/api/version',
    service: 'codebuddy-ollama-gpu',
  },
] as const satisfies ReadonlyArray<{
  id: AssistantOrganProbe['id'];
  label: string;
  url: string;
  service: AssistantRepairService;
}>;

const SYSTEMD_PROBES = [
  { id: 'buddy-sense', label: 'Buddy Sense', service: 'buddy-sense' },
  { id: 'vision-eye', label: 'Vision eye', service: 'buddy-vision-eye' },
  { id: 'telegram', label: 'Telegram', service: 'lisa-telegram' },
] as const satisfies ReadonlyArray<{
  id: AssistantOrganProbe['id'];
  label: string;
  service: AssistantRepairService;
}>;

const allowedServiceSet = new Set<string>(ASSISTANT_REPAIR_SERVICES);

export function isAssistantRepairService(value: string): value is AssistantRepairService {
  return allowedServiceSet.has(value);
}

class BoundedProbeTimeout extends Error {}

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value as number)));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new BoundedProbeTimeout());
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function elapsedMs(startedAt: number, now: () => number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof BoundedProbeTimeout) return true;
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

async function probeHttp(
  spec: (typeof HTTP_PROBES)[number],
  fetchImpl: NonNullable<AssistantRuntimeDoctorDependencies['fetchImpl']>,
  timeoutMs: number,
  now: () => number,
): Promise<AssistantOrganProbe> {
  const startedAt = now();
  const controller = new AbortController();
  try {
    const response = await withTimeout(
      fetchImpl(spec.url, { signal: controller.signal }),
      timeoutMs,
      () => controller.abort(),
    );
    return {
      id: spec.id,
      label: spec.label,
      source: 'http',
      status: response.ok ? 'healthy' : 'unhealthy',
      detail: response.ok ? 'http-ok' : `http-${response.status}`,
      latencyMs: elapsedMs(startedAt, now),
      repairService: spec.service,
    };
  } catch (error) {
    return {
      id: spec.id,
      label: spec.label,
      source: 'http',
      status: 'unhealthy',
      detail: isTimeoutError(error) ? 'timeout' : 'unreachable',
      latencyMs: elapsedMs(startedAt, now),
      repairService: spec.service,
    };
  }
}

async function defaultTcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function probeSensoryBridge(
  tcpProbe: NonNullable<AssistantRuntimeDoctorDependencies['tcpProbe']>,
  timeoutMs: number,
  now: () => number,
): Promise<AssistantOrganProbe> {
  const startedAt = now();
  try {
    const connected = await withTimeout(tcpProbe('127.0.0.1', 8129, timeoutMs), timeoutMs);
    return {
      id: 'sensory-bridge',
      label: 'Sensory bridge',
      source: 'tcp',
      status: connected ? 'healthy' : 'unhealthy',
      detail: connected ? 'tcp-open' : 'unreachable',
      latencyMs: elapsedMs(startedAt, now),
      repairService: 'buddy-vision-brain',
    };
  } catch (error) {
    return {
      id: 'sensory-bridge',
      label: 'Sensory bridge',
      source: 'tcp',
      status: 'unhealthy',
      detail: isTimeoutError(error) ? 'timeout' : 'unreachable',
      latencyMs: elapsedMs(startedAt, now),
      repairService: 'buddy-vision-brain',
    };
  }
}

interface SystemctlResult {
  ok: boolean;
  stdout: string;
}

function systemctlEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG']) {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

async function execSystemctlUser(args: string[], timeoutMs: number): Promise<SystemctlResult> {
  if (process.platform !== 'linux') return { ok: false, stdout: '' };
  return await new Promise<SystemctlResult>((resolve) => {
    execFile(
      'systemctl',
      ['--user', ...args],
      {
        encoding: 'utf8',
        env: systemctlEnvironment(),
        maxBuffer: 8 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout) => {
        resolve({ ok: error === null, stdout: String(stdout).trim() });
      },
    );
  });
}

class SystemdUserServiceController implements UserServiceController {
  async getActiveState(
    service: AssistantRepairService,
    timeoutMs: number,
  ): Promise<'active' | 'inactive' | 'failed' | 'unknown'> {
    if (!isAssistantRepairService(service)) return 'unknown';
    const result = await execSystemctlUser(['is-active', `${service}.service`], timeoutMs);
    if (result.stdout === 'active') return 'active';
    if (result.stdout === 'inactive') return 'inactive';
    if (result.stdout === 'failed') return 'failed';
    return 'unknown';
  }

  async isLoaded(service: AssistantRepairService, timeoutMs: number): Promise<boolean | null> {
    if (!isAssistantRepairService(service)) return null;
    const result = await execSystemctlUser(
      ['show', '--property=LoadState', '--value', `${service}.service`],
      timeoutMs,
    );
    if (result.stdout === 'loaded') return true;
    if (result.stdout === 'not-found' || result.stdout === 'masked') return false;
    return result.ok ? false : null;
  }

  async restart(service: AssistantRepairService, timeoutMs: number): Promise<boolean> {
    if (!isAssistantRepairService(service)) return false;
    const result = await execSystemctlUser(['restart', `${service}.service`], timeoutMs);
    return result.ok;
  }
}

async function probeSystemdService(
  spec: (typeof SYSTEMD_PROBES)[number],
  services: UserServiceController,
  timeoutMs: number,
  now: () => number,
): Promise<AssistantOrganProbe> {
  const startedAt = now();
  const state = await withTimeout(
    services.getActiveState(spec.service, timeoutMs),
    timeoutMs,
  ).catch(() => 'unknown' as const);
  return {
    id: spec.id,
    label: spec.label,
    source: 'systemd-user',
    status: state === 'active' ? 'healthy' : state === 'unknown' ? 'unknown' : 'unhealthy',
    detail: `systemd-${state}`,
    latencyMs: elapsedMs(startedAt, now),
    repairService: spec.service,
  };
}

function emptyRepairState(): AssistantRepairState {
  return { version: 1, attempts: [] };
}

function parseRepairState(raw: string): AssistantRepairState {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1) {
    throw new Error('invalid repair state');
  }
  if (!('attempts' in parsed) || !Array.isArray(parsed.attempts)) {
    throw new Error('invalid repair state');
  }
  if (parsed.attempts.length > MAX_REPAIR_STATE_ATTEMPTS) {
    throw new Error('repair state is too large');
  }

  const attempts: AssistantRepairState['attempts'] = [];
  for (const entry of parsed.attempts) {
    if (!entry || typeof entry !== 'object') throw new Error('invalid repair state');
    const service = 'service' in entry ? String(entry.service) : '';
    const attemptedAt = 'attemptedAt' in entry ? Number(entry.attemptedAt) : Number.NaN;
    if (!isAssistantRepairService(service) || !Number.isFinite(attemptedAt) || attemptedAt < 0) {
      throw new Error('invalid repair state');
    }
    attempts.push({ service, attemptedAt });
  }
  return { version: 1, attempts };
}

class FileAssistantRepairStateStore implements AssistantRepairStateStore {
  private readonly filePath = getCodeBuddyPath('assistant-doctor-repairs.json');

  async read(): Promise<AssistantRepairState> {
    try {
      const info = await stat(this.filePath);
      if (info.size > MAX_REPAIR_STATE_BYTES) throw new Error('repair state is too large');
      return parseRepairState(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        String(error.code) === 'ENOENT'
      ) {
        return emptyRepairState();
      }
      throw new Error('repair state unavailable');
    }
  }

  async write(state: AssistantRepairState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, this.filePath);
  }
}

function repairCandidates(probes: AssistantOrganProbe[]): AssistantRepairService[] {
  const candidates = new Set<AssistantRepairService>();
  for (const probe of probes) {
    if (probe.status === 'unhealthy' && probe.repairService) {
      candidates.add(probe.repairService);
    }
  }
  return [...candidates].sort(
    (left, right) => REPAIR_PRIORITY.indexOf(left) - REPAIR_PRIORITY.indexOf(right),
  );
}

async function repairUnhealthyServices(input: {
  candidates: AssistantRepairService[];
  services: UserServiceController;
  stateStore: AssistantRepairStateStore;
  now: () => number;
  platform: NodeJS.Platform;
  operationTimeoutMs: number;
  serviceTimeoutMs: number;
  cooldownMs: number;
  maxPerRun: number;
  windowMs: number;
  maxPerWindow: number;
}): Promise<{ attempts: AssistantRepairAttempt[]; skipped: AssistantRepairSkip[] }> {
  const attempts: AssistantRepairAttempt[] = [];
  const skipped: AssistantRepairSkip[] = [];

  if (input.platform !== 'linux') {
    return {
      attempts,
      skipped: input.candidates.map((service) => ({ service, reason: 'unsupported-platform' })),
    };
  }

  let state: AssistantRepairState;
  try {
    state = await withTimeout(input.stateStore.read(), input.operationTimeoutMs);
  } catch {
    return {
      attempts,
      skipped: input.candidates.map((service) => ({
        service,
        reason: 'repair-state-unavailable',
      })),
    };
  }

  for (const service of input.candidates) {
    if (!isAssistantRepairService(service)) continue;
    if (attempts.length >= input.maxPerRun) {
      skipped.push({ service, reason: 'per-run-limit' });
      continue;
    }

    const now = input.now();
    const recentAttempts = state.attempts.filter(
      (attempt) => now - attempt.attemptedAt < input.windowMs,
    );
    if (recentAttempts.length >= input.maxPerWindow) {
      skipped.push({ service, reason: 'global-rate-limit' });
      continue;
    }

    const latestForService = recentAttempts
      .filter((attempt) => attempt.service === service)
      .reduce((latest, attempt) => Math.max(latest, attempt.attemptedAt), -1);
    const elapsedSinceLatest = Math.max(0, now - latestForService);
    if (latestForService >= 0 && elapsedSinceLatest < input.cooldownMs) {
      skipped.push({
        service,
        reason: 'cooldown',
        cooldownRemainingMs: input.cooldownMs - elapsedSinceLatest,
      });
      continue;
    }

    const loaded = await withTimeout(
      input.services.isLoaded(service, input.serviceTimeoutMs),
      input.serviceTimeoutMs,
    ).catch(() => null);
    if (loaded === false) {
      skipped.push({ service, reason: 'service-not-loaded' });
      continue;
    }
    if (loaded === null) {
      skipped.push({ service, reason: 'service-state-unknown' });
      continue;
    }

    const nextState: AssistantRepairState = {
      version: 1,
      attempts: [...recentAttempts, { service, attemptedAt: now }],
    };
    try {
      // Reserve the attempt before mutating systemd. If persistence is not
      // available, fail closed so repeated CLI calls cannot bypass the limits.
      await withTimeout(input.stateStore.write(nextState), input.operationTimeoutMs);
      state = nextState;
    } catch {
      skipped.push({ service, reason: 'repair-state-unavailable' });
      break;
    }

    const restarted = await withTimeout(
      input.services.restart(service, input.serviceTimeoutMs),
      input.serviceTimeoutMs,
    ).catch(() => false);
    attempts.push({ service, result: restarted ? 'restarted' : 'failed' });
  }

  return { attempts, skipped };
}

export async function runAssistantRuntimeDoctor(
  options: AssistantRuntimeDoctorOptions = {},
  dependencies: AssistantRuntimeDoctorDependencies = {},
): Promise<AssistantRuntimeDoctorReport> {
  const now = dependencies.now ?? Date.now;
  const fetchImpl = dependencies.fetchImpl ?? ((url, init) => fetch(url, init));
  const tcpProbe = dependencies.tcpProbe ?? defaultTcpProbe;
  const services = dependencies.services ?? new SystemdUserServiceController();
  const stateStore = dependencies.repairStateStore ?? new FileAssistantRepairStateStore();
  const platform = dependencies.platform ?? process.platform;
  const probeTimeoutMs = boundedNumber(
    options.probeTimeoutMs,
    DEFAULT_PROBE_TIMEOUT_MS,
    50,
    10_000,
  );
  const serviceTimeoutMs = boundedNumber(
    options.serviceTimeoutMs,
    DEFAULT_SERVICE_TIMEOUT_MS,
    100,
    10_000,
  );
  const cooldownMs = boundedNumber(
    options.cooldownMs,
    DEFAULT_REPAIR_COOLDOWN_MS,
    DEFAULT_REPAIR_COOLDOWN_MS,
    24 * 60 * 60_000,
  );
  const maxPerRun = boundedNumber(
    options.maxRepairsPerRun,
    DEFAULT_MAX_REPAIRS_PER_RUN,
    1,
    DEFAULT_MAX_REPAIRS_PER_RUN,
  );
  const windowMs = boundedNumber(
    options.repairWindowMs,
    DEFAULT_REPAIR_WINDOW_MS,
    DEFAULT_REPAIR_WINDOW_MS,
    24 * 60 * 60_000,
  );
  const maxPerWindow = boundedNumber(
    options.maxRepairsPerWindow,
    DEFAULT_MAX_REPAIRS_PER_WINDOW,
    1,
    DEFAULT_MAX_REPAIRS_PER_WINDOW,
  );

  const probes = await Promise.all([
    ...HTTP_PROBES.map((spec) => probeHttp(spec, fetchImpl, probeTimeoutMs, now)),
    probeSensoryBridge(tcpProbe, probeTimeoutMs, now),
    ...SYSTEMD_PROBES.map((spec) =>
      probeSystemdService(spec, services, serviceTimeoutMs, now),
    ),
  ]);
  const candidates = repairCandidates(probes);
  const repairResult = options.repair
    ? await repairUnhealthyServices({
        candidates,
        services,
        stateStore,
        now,
        platform,
        operationTimeoutMs: serviceTimeoutMs,
        serviceTimeoutMs,
        cooldownMs,
        maxPerRun,
        windowMs,
        maxPerWindow,
      })
    : { attempts: [], skipped: [] };

  const summary = {
    healthy: probes.filter((probe) => probe.status === 'healthy').length,
    unhealthy: probes.filter((probe) => probe.status === 'unhealthy').length,
    unknown: probes.filter((probe) => probe.status === 'unknown').length,
    total: probes.length,
  };

  return {
    kind: 'assistant_runtime_doctor',
    generatedAt: new Date(now()).toISOString(),
    status: summary.unhealthy === 0 && summary.unknown === 0 ? 'healthy' : 'degraded',
    summary,
    probes,
    repair: {
      requested: options.repair === true,
      candidates,
      attempts: repairResult.attempts,
      skipped: repairResult.skipped,
      policy: {
        cooldownMs,
        maxPerRun,
        maxPerWindow,
        windowMs,
      },
    },
  };
}

export function formatAssistantRuntimeDoctorReport(report: AssistantRuntimeDoctorReport): string {
  const lines = ['Assistant operator doctor', ''];
  const icons: Record<AssistantOrganStatus, string> = {
    healthy: 'OK',
    unhealthy: 'FAIL',
    unknown: 'UNKNOWN',
  };

  for (const probe of report.probes) {
    lines.push(
      `  [${icons[probe.status]}] ${probe.label}: ${probe.detail} (${probe.latencyMs} ms)`,
    );
  }

  lines.push(
    '',
    `Summary: ${report.summary.healthy} healthy, ${report.summary.unhealthy} unhealthy, ` +
      `${report.summary.unknown} unknown`,
  );

  if (!report.repair.requested) {
    lines.push('Safe diagnosis only: no service was changed.');
    if (report.repair.candidates.length > 0) {
      lines.push('Run `buddy assistant doctor --repair` to restart only unhealthy user services.');
    }
    return lines.join('\n');
  }

  if (report.repair.attempts.length === 0 && report.repair.skipped.length === 0) {
    lines.push('Repair: no unhealthy repairable user service.');
    return lines.join('\n');
  }

  for (const attempt of report.repair.attempts) {
    lines.push(`Repair ${attempt.service}: ${attempt.result}`);
  }
  for (const skipped of report.repair.skipped) {
    const cooldown = skipped.cooldownRemainingMs
      ? ` (${Math.ceil(skipped.cooldownRemainingMs / 1000)} s remaining)`
      : '';
    lines.push(`Repair ${skipped.service}: skipped — ${skipped.reason}${cooldown}`);
  }
  lines.push('Re-run `buddy assistant doctor` to verify endpoint recovery.');
  return lines.join('\n');
}
