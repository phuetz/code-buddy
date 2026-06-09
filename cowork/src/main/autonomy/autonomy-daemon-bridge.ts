/**
 * AutonomyDaemonBridge — pilot the always-on autonomous fleet daemon from Cowork.
 *
 * Complements the read-only `autonomy.snapshot` queue view with the lifecycle
 * controls the CLI already has (`buddy autonomy install|uninstall|service|run`):
 *
 * - service status / start / stop / restart via the core `ServiceInstaller`
 *   (systemd user unit / launchd plist / Task Scheduler task `codebuddy-autonomy`)
 * - install / uninstall of the always-on service (artifact executor by default;
 *   the `agent` executor stays fail-closed behind an explicit workspace, exactly
 *   like the CLI)
 * - one-shot "run a tick now" by shelling out to the built CLI (`autonomy run
 *   --json`), so GUI ticks share the CLI code path instead of forking logic
 * - the free-first model-tier ladder (local → network → paid) with per-rung
 *   choice previews from the core decision module
 *
 * @module main/autonomy/autonomy-daemon-bridge
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import os from 'os';
import * as path from 'path';
import { loadCoreModule, resolveCoreEntry } from '../utils/core-loader';

export const AUTONOMY_SERVICE_NAME = 'codebuddy-autonomy';

const DEFAULT_MODEL = 'qwen2.5:7b-instruct';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';
const DEFAULT_INTERVAL_MS = 60000;
const RUN_TICK_TIMEOUT_MS = 180_000;

export type AutonomyServiceAction = 'start' | 'stop' | 'restart';

export interface AutonomyServiceStatus {
  installed: boolean;
  running: boolean;
  platform: string;
}

export interface AutonomyDaemonStatusReview {
  ok: boolean;
  error?: string;
  serviceName: string;
  service: AutonomyServiceStatus | null;
  queueDir: string;
  manageCommand: string;
}

export interface AutonomyServiceControlReview {
  ok: boolean;
  error?: string;
  action: AutonomyServiceAction;
  service: AutonomyServiceStatus | null;
}

export interface AutonomyServiceInstallOptions {
  dir?: string;
  model?: string;
  ollamaUrl?: string;
  intervalMs?: number;
  /** 'agent' edits files and is fail-closed: it requires `workspace`. */
  executor?: 'artifact' | 'agent';
  workspace?: string;
}

export interface AutonomyServiceInstallReview {
  ok: boolean;
  error?: string;
  servicePath?: string;
  platform?: string;
  instructions?: string;
  queueDir?: string;
  model?: string;
  executor?: 'artifact' | 'agent';
}

export interface AutonomyTickReview {
  ok: boolean;
  error?: string;
  ticks?: number;
  outcomes?: Record<string, number>;
  stoppedReason?: string;
  output?: string;
}

export interface AutonomyModelTierRung {
  tier: 'local' | 'network' | 'escalated';
  model: string;
  baseUrl?: string;
  paid: boolean;
  configured: boolean;
  reason?: string;
}

export interface AutonomyModelTierReview {
  ok: boolean;
  error?: string;
  ladder: AutonomyModelTierRung[];
  /** The model a basic autonomous tick would use right now. */
  currentChoice?: { model: string; tier: string; paid: boolean; reason: string };
}

interface CoreServiceInstaller {
  install(): Promise<{
    success: boolean;
    servicePath: string;
    platform: string;
    instructions?: string;
    error?: string;
  }>;
  uninstall(): Promise<{ success: boolean; servicePath: string; platform: string; error?: string }>;
  status(): Promise<AutonomyServiceStatus>;
  control(action: AutonomyServiceAction): Promise<{
    success: boolean;
    action: AutonomyServiceAction;
    platform: string;
    error?: string;
  }>;
}

interface CoreServiceInstallerModule {
  ServiceInstaller: new (config?: Record<string, unknown>) => CoreServiceInstaller;
}

interface CoreModelTierModule {
  resolveModelTierConfig: (env?: NodeJS.ProcessEnv) => {
    localModel: string;
    localBaseUrl: string;
    networkModels?: Array<{ model: string; baseUrl: string; label?: string }>;
    escalationModel?: string;
  };
  chooseAutonomousModel: (
    config: unknown,
    signal?: { escalate?: boolean; failures?: number },
  ) => { model: string; baseUrl?: string; tier: string; paid: boolean; reason: string };
}

function defaultQueueDir(): string {
  return process.env.CODEBUDDY_FLEET_COLAB_DIR || path.join(os.homedir(), '.codebuddy', 'fleet');
}

function manageCommandFor(platform: string): string {
  switch (platform) {
    case 'darwin':
      return `launchctl list ${AUTONOMY_SERVICE_NAME}`;
    case 'win32':
      return `schtasks /query /tn "${AUTONOMY_SERVICE_NAME}"`;
    default:
      return `systemctl --user status ${AUTONOMY_SERVICE_NAME}`;
  }
}

async function loadServiceInstaller(): Promise<CoreServiceInstaller | null> {
  const mod = await loadCoreModule<CoreServiceInstallerModule>('daemon/service-installer.js');
  if (!mod?.ServiceInstaller) return null;
  return new mod.ServiceInstaller({ serviceName: AUTONOMY_SERVICE_NAME });
}

/**
 * Resolve a node-compatible executable for running the built CLI (and for the
 * service's ExecStart). Inside Electron, `process.execPath` is the Electron
 * binary — it runs as plain node only with `ELECTRON_RUN_AS_NODE=1`, which the
 * caller must add to the child/service environment when `electronAsNode` is set.
 */
export function resolveNodeBinary(): { execPath: string; electronAsNode: boolean } | null {
  if (!process.versions.electron) {
    return { execPath: process.execPath, electronAsNode: false };
  }
  const probe = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, probe);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return { execPath: candidate, electronAsNode: false };
    } catch {
      /* keep looking */
    }
  }
  return { execPath: process.execPath, electronAsNode: true };
}

export async function getAutonomyDaemonStatusForReview(): Promise<AutonomyDaemonStatusReview> {
  const queueDir = defaultQueueDir();
  try {
    const installer = await loadServiceInstaller();
    if (!installer) {
      return {
        ok: false,
        error: 'Core service-installer module is unavailable (build the core dist first).',
        serviceName: AUTONOMY_SERVICE_NAME,
        service: null,
        queueDir,
        manageCommand: manageCommandFor(process.platform),
      };
    }
    const service = await installer.status();
    return {
      ok: true,
      serviceName: AUTONOMY_SERVICE_NAME,
      service,
      queueDir,
      manageCommand: manageCommandFor(service.platform),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      serviceName: AUTONOMY_SERVICE_NAME,
      service: null,
      queueDir,
      manageCommand: manageCommandFor(process.platform),
    };
  }
}

export async function controlAutonomyServiceForReview(
  action: AutonomyServiceAction,
): Promise<AutonomyServiceControlReview> {
  if (action !== 'start' && action !== 'stop' && action !== 'restart') {
    return { ok: false, error: `Invalid action: ${String(action)}`, action, service: null };
  }
  try {
    const installer = await loadServiceInstaller();
    if (!installer) {
      return { ok: false, error: 'Core service-installer module is unavailable.', action, service: null };
    }
    const result = await installer.control(action);
    const service = await installer.status();
    return result.success
      ? { ok: true, action, service }
      : { ok: false, error: result.error ?? `Failed to ${action} the service`, action, service };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), action, service: null };
  }
}

export async function installAutonomyServiceForReview(
  options: AutonomyServiceInstallOptions = {},
): Promise<AutonomyServiceInstallReview> {
  const executor = options.executor ?? 'artifact';
  if (executor !== 'artifact' && executor !== 'agent') {
    return { ok: false, error: `Invalid executor "${String(executor)}" (use artifact|agent).` };
  }
  // Same fail-closed rule as `buddy autonomy install`: the file-editing executor
  // never installs without an explicit bounded workspace.
  if (executor === 'agent' && !options.workspace?.trim()) {
    return { ok: false, error: 'The "agent" executor requires an explicit workspace directory (fail-closed).' };
  }

  const script = resolveCoreEntry();
  if (!script) {
    return { ok: false, error: 'Built Code Buddy CLI not found (run `npm run build` in the core repo first).' };
  }
  const node = resolveNodeBinary();
  if (!node) {
    return { ok: false, error: 'No node-compatible executable found to run the service.' };
  }

  try {
    const mod = await loadCoreModule<CoreServiceInstallerModule>('daemon/service-installer.js');
    if (!mod?.ServiceInstaller) {
      return { ok: false, error: 'Core service-installer module is unavailable.' };
    }

    const dir = options.dir?.trim() || defaultQueueDir();
    const outputDir = path.join(dir, 'out');
    const model = options.model?.trim() || DEFAULT_MODEL;
    const intervalMs = options.intervalMs && options.intervalMs > 0 ? options.intervalMs : DEFAULT_INTERVAL_MS;
    fs.mkdirSync(dir, { recursive: true });

    const agentEnv: Record<string, string> = {};
    if (executor === 'agent') {
      const workspace = path.resolve(options.workspace!.trim());
      fs.mkdirSync(workspace, { recursive: true });
      agentEnv.CODEBUDDY_AUTONOMY_EXECUTOR = 'agent';
      agentEnv.CODEBUDDY_AUTONOMY_WORKSPACE_ROOT = workspace;
    }

    const installer = new mod.ServiceInstaller({
      serviceName: AUTONOMY_SERVICE_NAME,
      displayName: 'Code Buddy Autonomy',
      description: 'Code Buddy autonomous fleet daemon (local-first, event-driven)',
      execPath: node.execPath,
      args: [script, 'autonomy', 'run', '--watch', '--dir', dir, '--output-dir', outputDir, '--interval', String(intervalMs)],
      workingDirectory: dir,
      env: {
        HOME: os.homedir(),
        CODEBUDDY_LOCAL_MODEL: model,
        OLLAMA_BASE_URL: options.ollamaUrl?.trim() || DEFAULT_OLLAMA_URL,
        CODEBUDDY_FLEET_COLAB_DIR: dir,
        ...(node.electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        ...agentEnv,
      },
    });
    const result = await installer.install();
    if (!result.success) {
      return { ok: false, error: result.error ?? 'Service install failed.' };
    }
    return {
      ok: true,
      servicePath: result.servicePath,
      platform: result.platform,
      ...(result.instructions ? { instructions: result.instructions } : {}),
      queueDir: dir,
      model,
      executor,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function uninstallAutonomyServiceForReview(): Promise<AutonomyServiceInstallReview> {
  try {
    const installer = await loadServiceInstaller();
    if (!installer) {
      return { ok: false, error: 'Core service-installer module is unavailable.' };
    }
    const result = await installer.uninstall();
    return result.success
      ? { ok: true, servicePath: result.servicePath, platform: result.platform }
      : { ok: false, error: result.error ?? 'Service uninstall failed.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run exactly one autonomous tick through the real CLI (`autonomy run --json`),
 * so a GUI tick exercises the same claim → model-ladder → executor path the
 * daemon uses. Returns the parsed DaemonRunSummary.
 */
export async function runAutonomyTickForReview(dir?: string): Promise<AutonomyTickReview> {
  const script = resolveCoreEntry();
  if (!script) {
    return { ok: false, error: 'Built Code Buddy CLI not found (run `npm run build` in the core repo first).' };
  }
  const node = resolveNodeBinary();
  if (!node) {
    return { ok: false, error: 'No node-compatible executable found to run the CLI.' };
  }

  const args = [script, 'autonomy', 'run', '--json', ...(dir?.trim() ? ['--dir', dir.trim()] : [])];
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        node.execPath,
        args,
        {
          timeout: RUN_TICK_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, ...(node.electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        },
        (error, out, errOut) => {
          if (error) reject(new Error(`${error.message}${errOut ? `\n${errOut.slice(0, 2000)}` : ''}`));
          else resolve(out);
        },
      );
    });
    return parseTickSummary(stdout);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function parseTickSummary(stdout: string): AutonomyTickReview {
  const summary = extractJsonObject(stdout);
  if (!summary) {
    return { ok: false, error: 'Could not parse the tick summary from CLI output.', output: stdout.slice(0, 2000) };
  }
  const record = summary as { ticks?: number; outcomes?: Record<string, number>; stoppedReason?: string };
  return {
    ok: true,
    ...(typeof record.ticks === 'number' ? { ticks: record.ticks } : {}),
    ...(record.outcomes ? { outcomes: record.outcomes } : {}),
    ...(typeof record.stoppedReason === 'string' ? { stoppedReason: record.stoppedReason } : {}),
  };
}

function extractJsonObject(raw: string): unknown | null {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    /* mixed log + JSON output — fall through to a bounded scan */
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function getAutonomyModelTierForReview(): Promise<AutonomyModelTierReview> {
  try {
    const mod = await loadCoreModule<CoreModelTierModule>('agent/model-tier.js');
    if (!mod?.resolveModelTierConfig || !mod.chooseAutonomousModel) {
      return { ok: false, error: 'Core model-tier module is unavailable.', ladder: [] };
    }
    const config = mod.resolveModelTierConfig();
    const ladder: AutonomyModelTierRung[] = [
      {
        tier: 'local',
        model: config.localModel,
        baseUrl: config.localBaseUrl,
        paid: false,
        configured: true,
      },
      ...(config.networkModels ?? []).map((net) => ({
        tier: 'network' as const,
        model: net.model,
        baseUrl: net.baseUrl,
        paid: false,
        configured: true,
      })),
      {
        tier: 'escalated',
        model: config.escalationModel ?? '(not configured — never escalates to paid)',
        paid: true,
        configured: Boolean(config.escalationModel),
      },
    ];
    const current = mod.chooseAutonomousModel(config);
    return {
      ok: true,
      ladder,
      currentChoice: {
        model: current.model,
        tier: current.tier,
        paid: current.paid,
        reason: current.reason,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ladder: [] };
  }
}
