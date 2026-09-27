/** Read-only, evidence-based view of the code and services serving this process. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPT_INS = [
  'CODEBUDDY_COMPANION_CORE', 'CODEBUDDY_COMPANION_RELATIONAL',
  'CODEBUDDY_MOBILE_PWA', 'CODEBUDDY_FLEET_ROOMS', 'CODEBUDDY_SENSORY',
  'CODEBUDDY_SENSORY_CAMERA', 'CODEBUDDY_SENSORY_SCREEN',
  'CODEBUDDY_SENSORY_SPEAK', 'CODEBUDDY_SENSORY_RULES',
  'CODEBUDDY_REMINDERS', 'CODEBUDDY_SCHEDULE_TICKS',
  'CODEBUDDY_DOMAIN_EVENTS', 'CODEBUDDY_COMPANION_PROACTIVE',
  'CODEBUDDY_COMPANION_PRESENCE', 'CODEBUDDY_LISA_SELFIE_REFILL',
  'CODEBUDDY_PROVIDER_FALLBACK', 'CODEBUDDY_SELF_IMPROVEMENT',
  'CODEBUDDY_COLLECTIVE_MEMORY', 'CODEBUDDY_WORLD_MODEL',
  'CODEBUDDY_AI_SCIENTIST', 'CODEBUDDY_INTENTS',
] as const;

export interface EffectiveCall {
  provider: string;
  model: string | null;
  observedAt: string;
  scope: 'process' | 'profile';
}

let lastCallInProcess: EffectiveCall | null = null;

export interface RuntimeStatus {
  execution: {
    installationPath: string;
    codePath: string;
    kind: 'compiled' | 'source' | 'unknown';
    version: string | null;
    revision: string | null;
    revisionOrigin: string | null;
    sourceDirtyAtBuild: boolean | null;
    verified: boolean;
  };
  repository: {
    path: string | null;
    revision: string | null;
    dirty: boolean | null;
    mainRef: string | null;
    mainAheadBy: number | null;
  };
  lastEffectiveCall: EffectiveCall | null;
  services: Array<{
    name: string;
    state: 'active' | 'inactive' | 'unknown';
    version: string | null;
    revision: string | null;
  }>;
  servicesObservation: 'systemd-user' | 'unavailable';
  environmentEnabled: string[];
  alerts: string[];
}

function safeJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function safeVersion(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(value) ? value : null;
}

function safeRevision(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{7,64}$/i.test(value) ? value.toLowerCase() : null;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Same bounded dist-tree digest as the build manifest; no symlinks or map files. */
function distDigest(root: string): { value: string; fileCount: number } | null {
  try {
    const canonicalRoot = realpathSync(root);
    const dist = join(root, 'dist');
    if (lstatSync(dist).isSymbolicLink()) return null;
    const canonicalDist = realpathSync(dist);
    if (!within(canonicalRoot, canonicalDist)) return null;
    const files: string[] = [];
    let entries = 0;
    let bytes = 0;
    const walk = (dir: string, rel = ''): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (++entries > 40_000 || entry.isSymbolicLink()) throw new Error('unverifiable dist');
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), name);
        else if (entry.isFile() && !entry.name.endsWith('.js.map') && name !== 'package.json') {
          if (++bytes > 512 * 1024 * 1024) throw new Error('unverifiable dist');
          files.push(name);
        }
      }
    };
    walk(canonicalDist);
    if (files.length > 20_000) return null;
    const hash = createHash('sha256');
    let total = 0;
    for (const name of files) {
      const path = join(canonicalDist, ...name.split('/'));
      const size = statSync(path).size;
      total += size;
      if (total > 512 * 1024 * 1024) return null;
      const content = readFileSync(path);
      if (content.length !== size) return null;
      hash.update(name).update('\0').update(content).update('\0');
    }
    return { value: hash.digest('hex'), fileCount: files.length };
  } catch { return null; }
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
      cwd, encoding: 'utf8', timeout: 1_500, maxBuffer: 1024 * 1024,
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

type GitReader = (cwd: string, args: string[]) => string | null;

function repositoryAt(path: string, runGit: GitReader): boolean {
  return record(safeJson(join(path, 'package.json')))?.name === '@phuetz/code-buddy'
    && runGit(path, ['rev-parse', '--show-toplevel']) === realpathSync(path);
}

function profilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBUDDY_HOME?.trim() || env.GROK_HOME?.trim() || join(homedir(), '.codebuddy');
}

/** Called only after a provider returns a successful response or a stream chunk. */
function safeModel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
    && /^[a-z0-9][a-z0-9._/+:-]*$/i.test(value) && !value.includes('://')
    && !value.toLowerCase().startsWith('sk-');
}

export function recordEffectiveCall(call: { provider: string; model: string | null }, profile = profilePath()): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(call.provider)) return;
  const observed: EffectiveCall = { provider: call.provider,
    model: safeModel(call.model) ? call.model : null, observedAt: new Date().toISOString(), scope: 'process' };
  lastCallInProcess = observed;
  try {
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    const target = join(profile, 'runtime-last-call.json');
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ provider: observed.provider, model: observed.model,
      observedAt: observed.observedAt }), { mode: 0o600 });
    renameSync(temporary, target);
  } catch { /* Observability must never fail a completed LLM call. */ }
}

export function getLastEffectiveCall(profile = profilePath()): EffectiveCall | null {
  try {
    const file = join(profile, 'runtime-last-call.json');
    if (statSync(file).size > 1_024) return null;
    const value = record(safeJson(file));
    if (!value || typeof value.provider !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value.provider) ||
      (value.model !== null && !safeModel(value.model)) ||
      typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))) return null;
    return { provider: value.provider, model: value.model as string | null,
      observedAt: value.observedAt, scope: 'profile' };
  } catch { return null; }
}

export function getCurrentProcessEffectiveCall(): EffectiveCall | null {
  return lastCallInProcess;
}

function knownServices(): Pick<RuntimeStatus, 'services' | 'servicesObservation'> {
  if (process.platform !== 'linux') return { services: [], servicesObservation: 'unavailable' };
  try {
    const output = execFileSync('systemctl', [
      '--user', 'list-units', '--all', '--type=service', '--type=timer',
      '--plain', '--no-legend', '--no-pager',
    ], { encoding: 'utf8', timeout: 1_500, maxBuffer: 256 * 1024, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'] });
    const services = output.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
      .filter((cols) => /^(?:codebuddy|lisa|buddy-sense|buddy-vision|buddy-memory)(?:-[a-z0-9-]+)?\.(?:service|timer)$/.test(cols[0] ?? ''))
      .map((cols) => ({
        name: cols[0]!, state: cols[3] === 'running' || cols[3] === 'waiting' ? 'active' as const
          : cols[2] === 'active' ? 'active' as const : 'inactive' as const,
        version: null as string | null, revision: null as string | null,
      }));
    const active = services.filter((unit) => unit.state === 'active' && unit.name.endsWith('.service')).slice(0, 8);
    if (active.length > 0) {
      try {
        const details = execFileSync('systemctl', [
          '--user', 'show', ...active.map((unit) => unit.name),
          '--property=Id', '--property=MainPID', '--no-pager',
        ], { encoding: 'utf8', timeout: 1_000, maxBuffer: 8 * 1024,
          windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const pids = new Map<string, string>();
        for (const block of details.split(/\r?\n\s*\r?\n/)) {
          const name = block.match(/^Id=([^\r\n]+)$/m)?.[1];
          const pid = block.match(/^MainPID=([^\r\n]+)$/m)?.[1];
          if (name && pid) pids.set(name, pid);
        }
        for (const service of active) {
          const identity = activeServiceIdentity(pids.get(service.name));
          service.version = identity?.version ?? null;
          service.revision = identity?.revision ?? null;
        }
      } catch { /* unit list remains observed, versions remain unknown */ }
    }
    return { services, servicesObservation: 'systemd-user' };
  } catch { return { services: [], servicesObservation: 'unavailable' }; }
}

function activeServiceIdentity(rawPid: string | undefined): Pick<RuntimeStatus['execution'], 'version' | 'revision'> | null {
  try {
    if (!rawPid || !/^[1-9]\d{0,9}$/.test(rawPid)) return null;
    const proc = `/proc/${rawPid}`;
    const args = readFileSync(join(proc, 'cmdline')).toString('utf8').split('\0');
    const cwd = readlinkSync(join(proc, 'cwd'));
    const codeArg = args.find((arg) => /(?:^|\/)(?:dist\/index\.js|src\/index\.ts)$/.test(arg));
    if (!codeArg) return null;
    const codePath = resolve(cwd, codeArg);
    const root = resolve(dirname(codePath), '..');
    if (record(safeJson(join(root, 'package.json')))?.name !== '@phuetz/code-buddy') return null;
    const execution = collectRuntimeStatus({ root, codePath, includeServices: false, repositoryRoot: root }).execution;
    return { version: execution.version, revision: execution.revision };
  } catch { return null; }
}

export function collectRuntimeStatus(options: {
  root?: string; codePath?: string; repositoryRoot?: string;
  env?: NodeJS.ProcessEnv; includeServices?: boolean; selfServer?: boolean;
  runGit?: GitReader;
  observeServices?: () => Pick<RuntimeStatus, 'services' | 'servicesObservation'>;
} = {}): RuntimeStatus {
  const codePath = options.codePath ?? fileURLToPath(import.meta.url);
  const root = resolve(options.root ?? join(dirname(codePath), '..', '..'));
  const env = options.env ?? process.env;
  const runGit = options.runGit ?? git;
  const pkg = record(safeJson(join(root, 'package.json')));
  const version = pkg?.name === '@phuetz/code-buddy' ? safeVersion(pkg.version) : null;
  const kind = within(join(root, 'dist'), codePath) ? 'compiled'
    : within(join(root, 'src'), codePath) ? 'source' : 'unknown';
  const execution: RuntimeStatus['execution'] = {
    installationPath: root, codePath, kind, version,
    revision: null, revisionOrigin: null, sourceDirtyAtBuild: null, verified: false,
  };
  const alerts: string[] = [];
  if (kind === 'compiled') {
    const manifest = record(safeJson(join(root, 'codebuddy-runtime.json')));
    const digest = record(manifest?.distDigest);
    const runtime = record(manifest?.runtime);
    const observed = distDigest(root);
    const core = record(manifest?.corePackage);
    const valid = manifest?.schemaVersion === 2 && core?.name === '@phuetz/code-buddy'
      && core.version === version && digest?.algorithm === 'sha256'
      && digest.scope === 'dist-tree-code-without-maps-v1'
      && runtime?.kind === 'codebuddy-core' && runtime.compiled === true
      && runtime.moduleFormat === 'esm' && runtime.distPath === 'dist'
      && runtime.entrypoint === 'dist/desktop/codebuddy-engine-adapter.js'
      && digest.value === observed?.value && digest.fileCount === observed?.fileCount;
    if (valid) {
      execution.verified = true;
      execution.revision = safeRevision(manifest?.sourceRevision);
      execution.revisionOrigin = typeof manifest?.sourceRevisionOrigin === 'string'
        && /^(?:git|env:[A-Z][A-Z0-9_]{0,63})$/.test(manifest.sourceRevisionOrigin)
        ? `build-manifest:${manifest.sourceRevisionOrigin}` : null;
      execution.sourceDirtyAtBuild = typeof manifest?.sourceDirty === 'boolean' ? manifest.sourceDirty : null;
    } else alerts.push('compiled-code-unverified');
  } else if (kind === 'source' && version) {
    execution.revision = safeRevision(runGit(root, ['rev-parse', 'HEAD']));
    execution.revisionOrigin = execution.revision ? 'repository-head' : null;
    execution.verified = execution.revision !== null;
  }

  let repositoryPath: string | null = null;
  for (const candidate of [options.repositoryRoot, process.cwd(), root]) {
    if (!candidate) continue;
    try { if (repositoryAt(candidate, runGit)) { repositoryPath = realpathSync(candidate); break; } } catch { /* unknown */ }
  }
  const repository: RuntimeStatus['repository'] = {
    path: repositoryPath, revision: null, dirty: null, mainRef: null, mainAheadBy: null,
  };
  if (repositoryPath) {
    repository.revision = safeRevision(runGit(repositoryPath, ['rev-parse', 'HEAD']));
    const state = runGit(repositoryPath, ['status', '--porcelain=v1', '--untracked-files=normal']);
    repository.dirty = state === null ? null : state.length > 0;
    if (kind === 'source' && repositoryPath === root && repository.dirty !== false) {
      execution.verified = false;
    }
    if (execution.revision && repository.revision && execution.revision !== repository.revision) {
      alerts.push('execution-differs-from-repository');
    }
    if (repository.dirty) alerts.push('repository-dirty');
    repository.mainRef = runGit(repositoryPath, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main']) !== null
      ? 'origin/main'
      : runGit(repositoryPath, ['show-ref', '--verify', '--quiet', 'refs/heads/main']) !== null ? 'main' : null;
    if (execution.revision && repository.mainRef) {
      const count = runGit(repositoryPath, ['rev-list', '--count', `${execution.revision}..${repository.mainRef}`]);
      repository.mainAheadBy = count !== null && /^\d+$/.test(count) ? Number(count) : null;
      if (repository.mainAheadBy && runGit(repositoryPath, ['merge-base', '--is-ancestor', execution.revision, repository.mainRef]) !== null) {
        alerts.push('execution-behind-main');
      }
    }
  }
  if (execution.sourceDirtyAtBuild) alerts.push('source-dirty-at-build');
  const serviceEvidence = options.includeServices === false
    ? { services: [], servicesObservation: 'unavailable' as const }
    : options.observeServices?.() ?? knownServices();
  for (const service of serviceEvidence.services) {
    if (service.state === 'active' && service.revision && repository.revision && service.revision !== repository.revision) {
      alerts.push(`service-revision-mismatch:${service.name}`);
    }
  }
  if (options.selfServer) serviceEvidence.services.unshift({
    name: 'server (this process)', state: 'active', version: execution.version, revision: execution.revision,
  });
  return {
    execution, repository,
    lastEffectiveCall: getLastEffectiveCall(profilePath(env)),
    ...serviceEvidence,
    environmentEnabled: OPT_INS.filter((key) => env[key] === 'true'),
    alerts,
  };
}

let cachedServerStatus: { at: number; value: RuntimeStatus } | null = null;
/** A short cache keeps the unauthenticated health route bounded under polling. */
export function getServerRuntimeStatus(): RuntimeStatus {
  if (cachedServerStatus && Date.now() - cachedServerStatus.at < 5_000) {
    return { ...cachedServerStatus.value, lastEffectiveCall: getCurrentProcessEffectiveCall() };
  }
  const value = collectRuntimeStatus({ selfServer: true });
  value.lastEffectiveCall = getCurrentProcessEffectiveCall();
  cachedServerStatus = { at: Date.now(), value };
  return value;
}
