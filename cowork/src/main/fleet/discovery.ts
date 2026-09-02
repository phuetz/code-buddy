/**
 * Fleet — cross-machine peer discovery (Fleet P6).
 *
 * Two layers, in order:
 *
 *   1. Tailscale tailnet scan via `tailscale status --json` → for
 *      every online peer, try `GET http://<ip>:3001/api/health` to
 *      detect Code Buddy. Failures are silent (most Tailscale peers
 *      won't have buddy running).
 *
 *   2. Manual config fallback: `~/.config/codebuddy/fleet-peers.yaml`
 *      with explicit `peers:` list. Always honoured even when
 *      Tailscale isn't installed.
 *
 * Output: a list of `DiscoveredPeer` records the FleetBridge can
 * convert to its persistent `PersistedPeer` shape.
 *
 * @module cowork/main/fleet/discovery
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { log, logWarn } from '../utils/logger';

export interface DiscoveredPeer {
  /** Suggested label, e.g., 'gpuNode' from Tailscale or YAML key. */
  label: string;
  /** WS URL to pair with — `ws://<ip>:3001/ws` typically. */
  url: string;
  /** Tailscale ip / hostname / 'manual' — diagnostic only. */
  source: 'tailscale' | 'manual';
  /** When set by manual config — bearer token for the WS auth. */
  apiKey?: string;
}

const TAILSCALE_BIN = process.env.TAILSCALE_BIN ?? 'tailscale';
const HEALTH_TIMEOUT_MS = 1500;
const DEFAULT_PORT = 3001;
const DEFAULT_WS_PATH = '/ws';

/**
 * Run a full discovery pass. Layered: Tailscale first, then manual
 * fallback. The two lists are merged on URL — a peer present in
 * both gets the manual config's `apiKey` preserved.
 */
export async function discoverPeers(): Promise<DiscoveredPeer[]> {
  const [tailscale, manual] = await Promise.all([
    discoverTailscale(),
    loadManualConfig(),
  ]);
  const byUrl = new Map<string, DiscoveredPeer>();
  for (const p of tailscale) byUrl.set(p.url, p);
  for (const p of manual) {
    const existing = byUrl.get(p.url);
    byUrl.set(p.url, existing ? { ...existing, ...p } : p);
  }
  return Array.from(byUrl.values());
}

/** Run `tailscale status --json` and probe each online peer's health. */
export async function discoverTailscale(): Promise<DiscoveredPeer[]> {
  const status = await runTailscaleStatus();
  if (!status) return [];
  const peers: DiscoveredPeer[] = [];
  // `Peer` is a map of node-id → { TailscaleIPs, HostName, Online, … }
  const peerMap = (status as { Peer?: Record<string, unknown> }).Peer ?? {};
  for (const [, info] of Object.entries(peerMap)) {
    const peerInfo = info as {
      TailscaleIPs?: string[];
      HostName?: string;
      DNSName?: string;
      Online?: boolean;
    };
    if (!peerInfo.Online) continue;
    const ip = (peerInfo.TailscaleIPs ?? [])[0];
    if (!ip) continue;
    const hostname = peerInfo.HostName ?? peerInfo.DNSName?.split('.')[0] ?? ip;
    const reachable = await isHealthEndpointAlive(ip, DEFAULT_PORT);
    if (!reachable) continue;
    peers.push({
      label: hostname,
      url: `ws://${ip}:${DEFAULT_PORT}${DEFAULT_WS_PATH}`,
      source: 'tailscale',
    });
  }
  return peers;
}

/** Read the optional YAML manual config. Returns [] when absent. */
export async function loadManualConfig(): Promise<DiscoveredPeer[]> {
  const configPath = manualConfigPath();
  if (!fs.existsSync(configPath)) return [];
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return parseManualYaml(raw);
  } catch (err) {
    logWarn('[fleet-discovery] failed to read manual config', {
      path: configPath,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Path to `~/.config/codebuddy/fleet-peers.yaml`. */
export function manualConfigPath(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'codebuddy',
    'fleet-peers.yaml',
  );
}

/**
 * Minimal YAML parser for the fleet-peers schema. Avoids a YAML
 * dependency for what's a flat list. Format:
 *
 *   peers:
 *     - label: gpuNode
 *       url: ws://203.0.113.11:3001/ws
 *       apiKey: optional-bearer-token
 *     - label: g7
 *       url: ws://203.0.113.12:3001/ws
 *
 * Indentation strictly 2 spaces, hyphenated lists.
 */
export function parseManualYaml(raw: string): DiscoveredPeer[] {
  const peers: DiscoveredPeer[] = [];
  const lines = raw.split(/\r?\n/);
  let inPeers = false;
  let current: Partial<DiscoveredPeer> | null = null;
  const flush = () => {
    if (current && current.url) {
      peers.push({
        label: current.label ?? new URL(current.url).hostname,
        url: current.url,
        source: 'manual',
        apiKey: current.apiKey,
      });
    }
    current = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (/^peers\s*:/.test(line)) {
      inPeers = true;
      continue;
    }
    if (!inPeers) continue;
    if (/^\s*-\s*/.test(line)) {
      flush();
      current = {};
      const after = line.replace(/^\s*-\s*/, '');
      if (after.includes(':')) parseKeyValue(after, current);
      continue;
    }
    if (current && /^\s+\S/.test(line)) {
      parseKeyValue(line.trim(), current);
    }
  }
  flush();
  return peers;
}

function parseKeyValue(text: string, target: Partial<DiscoveredPeer>): void {
  const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(text);
  if (!m) return;
  const [, key, value] = m;
  const cleanValue = value.replace(/^['"]|['"]$/g, '').trim();
  if (key === 'label') target.label = cleanValue;
  else if (key === 'url') target.url = cleanValue;
  else if (key === 'apiKey') target.apiKey = cleanValue;
}

async function runTailscaleStatus(): Promise<unknown | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(TAILSCALE_BIN, ['status', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      resolve(null);
    }, 3000);
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', () => {
      // Tailscale not installed — silent.
      clearTimeout(timer);
      resolve(null);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        if (stderr) {
          log('[fleet-discovery] tailscale status failed', { stderr: stderr.slice(0, 200) });
        }
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        logWarn('[fleet-discovery] failed to parse tailscale json', {
          err: err instanceof Error ? err.message : String(err),
        });
        resolve(null);
      }
    });
  });
}

async function isHealthEndpointAlive(host: string, port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`http://${host}:${port}/api/health`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
