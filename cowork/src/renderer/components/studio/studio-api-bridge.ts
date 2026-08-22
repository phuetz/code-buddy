/**
 * Bridges the preload-exposed `window.electronAPI.studio` surface to the typed
 * API contracts (studio-api.ts) that AppStudioView / useAppStudio consume.
 *
 * The preload keeps its return types as `unknown` (matching the science /
 * checkpoint namespaces); this bridge normalizes each result into the
 * `StudioResult` discriminated union and adapts the one shape mismatch: the
 * main `studio.files.read` handler returns the file content as `data` while the
 * renderer expects `{ path, content }`.
 *
 * @module renderer/components/studio/studio-api-bridge
 */

import type {
  AppStudioApis,
  StudioDevLogs,
  StudioDevStartResult,
  StudioDevStatus,
  StudioResult,
  StudioTemplateCard,
} from './studio-api.js';
import type { TreeNode } from './utils/file-tree-model.js';

function asResult<T>(raw: unknown): StudioResult<T> {
  const record = raw as { ok?: unknown; data?: unknown; error?: unknown } | null | undefined;
  if (record && record.ok === true) {
    return { ok: true, data: record.data as T };
  }
  const error = record && typeof record.error === 'string' ? record.error : 'App Studio operation failed';
  return { ok: false, error };
}

/**
 * Build the four App Studio API objects from the preload bridge. Returns
 * `undefined` when the preload namespace is unavailable (e.g. rendered outside
 * Electron), which keeps AppStudioView on its no-op empty state.
 */
export function createStudioApis(): AppStudioApis | undefined {
  const studio = window.electronAPI?.studio;
  if (!studio) return undefined;

  const apis: AppStudioApis = {
    devServer: {
      start: async (request) => asResult<StudioDevStartResult>(await studio.devServer.start(request)),
      stop: async (pid) => asResult<{ pid: number; output: string }>(await studio.devServer.stop(pid)),
      status: async () => asResult<StudioDevStatus>(await studio.devServer.status()),
      logs: async (pid, lines) => asResult<StudioDevLogs>(await studio.devServer.logs(pid, lines)),
    },
    files: {
      list: async (root) => asResult<TreeNode[]>(await studio.files.list(root)),
      read: async (root, path) => {
        const raw = asResult<string>(await studio.files.read(root, path));
        return raw.ok ? { ok: true, data: { path, content: raw.data } } : raw;
      },
      write: async (root, path, content) =>
        asResult<{ path: string }>(await studio.files.write(root, path, content)),
      create: async (root, path) => asResult<{ path: string }>(await studio.files.create(root, path)),
      rename: async (root, from, to) =>
        asResult<{ from: string; to: string }>(await studio.files.rename(root, from, to)),
      delete: async (root, path) => asResult<{ path: string }>(await studio.files.delete(root, path)),
    },
    commands: {
      run: async (request) => asResult<{ id: string; pid: number }>(await studio.commands.run(request)),
      runToEnd: async (request) =>
        asResult<{ id: string; code: number | null }>(await studio.commands.runToEnd(request)),
      kill: async (id) => asResult<{ id: string; killed: boolean }>(await studio.commands.kill(id)),
      onOutput: (listener) => studio.commands.onOutput(listener),
    },
    scaffold: {
      list: async () => {
        const raw = await studio.scaffold.list();
        return Array.isArray(raw) ? (raw as StudioTemplateCard[]) : [];
      },
      generate: async (request) =>
        asResult<{ projectDir: string; files: string[] }>(await studio.scaffold.generate(request)),
    },
  };
  return apis;
}
