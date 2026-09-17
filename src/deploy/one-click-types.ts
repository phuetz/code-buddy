/**
 * One-click static/build web publish (Cloudflare Pages + Netlify).
 *
 * Distinct from DeployTool (Fly/Railway/…) and Cowork studio2 (surge/zip).
 */

export const ONE_CLICK_TARGETS = ['cloudflare-pages', 'netlify'] as const;
export type OneClickTarget = (typeof ONE_CLICK_TARGETS)[number];

export interface OneClickDeployConfig {
  target: OneClickTarget;
  /** npm script name only (never a free shell string). */
  buildScript?: string;
  outputDir: string;
  projectName?: string;
  accountId?: string;
  siteId?: string;
  skipBuild?: boolean;
}

export interface OneClickStep {
  id: 'config' | 'tool' | 'token' | 'build' | 'output' | 'upload';
  status: 'ok' | 'planned' | 'skipped' | 'error';
  detail: string;
  command?: string;
}

export interface OneClickTokenStatus {
  envVar: string;
  present: boolean;
  source?: 'env' | 'vault';
}

export interface OneClickRollback {
  supported: boolean;
  summary: string;
  commands: string[];
  previousDeployId?: string;
}

export interface OneClickReport {
  ok: boolean;
  dryRun: boolean;
  target?: OneClickTarget;
  projectRoot: string;
  durationMs: number;
  url?: string;
  deployId?: string;
  steps: OneClickStep[];
  token?: OneClickTokenStatus;
  rollback: OneClickRollback;
  error?: string;
  /** Combined CLI output with secrets stripped. */
  log?: string;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface OneClickExecFileOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export type OneClickExecFile = (
  file: string,
  args: readonly string[],
  options?: OneClickExecFileOptions,
) => Promise<ExecFileResult>;

export interface OneClickFs {
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  stat(filePath: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  mkdir(dirPath: string, options: { recursive: boolean }): Promise<void>;
  appendFile(filePath: string, data: string): Promise<void>;
}

export interface OneClickDeps {
  execFile?: OneClickExecFile;
  which?: (command: string) => Promise<string | null>;
  fs?: OneClickFs;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  resolveToken?: (names: readonly string[]) => Promise<{
    name: string;
    value: string;
    source: 'env' | 'vault';
  } | null>;
  platform?: NodeJS.Platform;
}

export interface OneClickRunRequest {
  projectRoot: string;
  /** Live upload. Default false — simulation. */
  apply?: boolean;
  /** Explicit simulation flag; wins over apply when both are set. */
  dryRun?: boolean;
  config?: OneClickDeployConfig;
}

export const CLOUDFLARE_TOKEN_VARS = ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN'] as const;
export const NETLIFY_TOKEN_VARS = ['NETLIFY_AUTH_TOKEN'] as const;
