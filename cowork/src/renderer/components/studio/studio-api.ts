import type { StudioTemplateId } from './utils/studio-intent.js';
import type { TreeNode } from './utils/file-tree-model.js';

export type StudioResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface StudioDevStartRequest {
  cwd: string;
  command: string;
  url: string;
  timeoutMs?: number;
}

export interface StudioDevStartResult {
  pid: number;
  origin: string;
  url: string;
}

export interface StudioDevServerInstance extends StudioDevStartResult {
  command: string;
  cwd: string;
  state: 'running' | 'dead' | 'unknown';
  startedAt: string;
  updatedAt: string;
}

export interface StudioDevStatus {
  instances: StudioDevServerInstance[];
  raw: string;
}

export interface StudioDevLogs {
  pid: number;
  output: string;
  lines: string[];
}

export interface DevServerApi {
  start(request: StudioDevStartRequest): Promise<StudioResult<StudioDevStartResult>>;
  stop(pid: number): Promise<StudioResult<{ pid: number; output: string }>>;
  status(): Promise<StudioResult<StudioDevStatus>>;
  logs(pid: number, lines?: number): Promise<StudioResult<StudioDevLogs>>;
}

export interface FilesApi {
  list(root: string): Promise<StudioResult<TreeNode[]>>;
  read(root: string, path: string): Promise<StudioResult<{ path: string; content: string }>>;
  write(root: string, path: string, content: string): Promise<StudioResult<{ path: string }>>;
  create(root: string, path: string): Promise<StudioResult<{ path: string }>>;
  rename(root: string, from: string, to: string): Promise<StudioResult<{ from: string; to: string }>>;
  delete(root: string, path: string): Promise<StudioResult<{ path: string }>>;
}

export interface CommandOutputEvent {
  id: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  timestamp: string;
}

export interface CommandsApi {
  run(request: { cwd: string; command: string; id: string }): Promise<StudioResult<{ id: string; pid: number }>>;
  kill(id: string): Promise<StudioResult<{ id: string; killed: boolean }>>;
  onOutput?: (listener: (event: CommandOutputEvent) => void) => () => void;
}

export interface StudioTemplateCard {
  id: StudioTemplateId;
  label: string;
  description: string;
}

export interface ScaffoldApi {
  list(): Promise<StudioTemplateCard[]>;
  generate(request: {
    template: StudioTemplateId;
    targetDir: string;
    vars?: Record<string, string | boolean>;
    designSystem?: string;
  }): Promise<StudioResult<{ projectDir: string; files: string[] }>>;
}

export interface AppStudioApis {
  devServer: DevServerApi;
  files: FilesApi;
  commands: CommandsApi;
  scaffold: ScaffoldApi;
}
