import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { getOllamaBaseUrl } from '../utils/ollama-url.js';

export interface OllamaStatus {
  baseUrl: string;
  reachable: boolean;
  version: string | null;
  models: string[];
  error: string | null;
}

export interface OllamaUpdatePlan {
  supported: boolean;
  platform: NodeJS.Platform;
  repoRoot: string;
  scriptPath: string;
  scriptUrl: string;
  command?: string;
  args?: string[];
  message: string;
}

export function normalizeOllamaBaseUrl(rawUrl?: string): string {
  const value = (rawUrl || getOllamaBaseUrl()).trim();
  const withoutV1 = value.replace(/\/v1\/?$/, '');
  return withoutV1.replace(/\/+$/, '');
}

export async function fetchOllamaStatus(baseUrl?: string): Promise<OllamaStatus> {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const apiBase = `${normalizedBaseUrl}/api`;

  try {
    const [versionResponse, tagsResponse] = await Promise.all([
      fetch(`${apiBase}/version`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${apiBase}/tags`, { signal: AbortSignal.timeout(5000) }),
    ]);

    const versionJson = (await versionResponse.json()) as { version?: unknown };
    const tagsJson = (await tagsResponse.json()) as { models?: Array<{ name?: unknown }> };

    return {
      baseUrl: normalizedBaseUrl,
      reachable: versionResponse.ok && tagsResponse.ok,
      version: typeof versionJson.version === 'string' ? versionJson.version : null,
      models: Array.isArray(tagsJson.models)
        ? tagsJson.models
            .map((model) => (typeof model.name === 'string' ? model.name : null))
            .filter((name): name is string => Boolean(name))
        : [],
      error: versionResponse.ok && tagsResponse.ok ? null : `HTTP ${versionResponse.status}/${tagsResponse.status}`,
    };
  } catch (error) {
    return {
      baseUrl: normalizedBaseUrl,
      reachable: false,
      version: null,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildOllamaUpdatePlan(options: {
  platform?: NodeJS.Platform;
  repoRoot: string;
  scriptUrl?: string;
}): OllamaUpdatePlan {
  const platform = options.platform ?? process.platform;
  const repoRoot = resolve(options.repoRoot);
  const scriptPath = resolve(repoRoot, 'scripts', 'update-ollama-windows.ps1');
  const scriptUrl = options.scriptUrl ?? 'https://ollama.com/install.ps1';
  const supported = platform === 'win32';

  if (!supported) {
    return {
      supported,
      platform,
      repoRoot,
      scriptPath,
      scriptUrl,
      message: 'Ollama update automation is implemented for Windows. Use the official install script on this platform.',
    };
  }

  const command = 'powershell';
  const args = [
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-InstallerScriptUrl',
    scriptUrl,
  ];

  return {
    supported,
    platform,
    repoRoot,
    scriptPath,
    scriptUrl,
    command,
    args,
    message: `Windows update script ready: ${scriptPath}`,
  };
}

export async function runOllamaUpdatePlan(plan: OllamaUpdatePlan): Promise<void> {
  if (!plan.supported || !plan.command || !plan.args) {
    throw new Error(plan.message);
  }
  if (!existsSync(plan.scriptPath)) {
    throw new Error(`Missing Ollama update script: ${plan.scriptPath}`);
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(plan.command!, plan.args!, {
      stdio: 'inherit',
      cwd: plan.repoRoot,
      shell: false,
    });

    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Ollama update script exited with code ${code ?? 'unknown'}`));
    });
  });
}
