/**
 * IPC registration for the App Studio command runner.
 *
 * The runner is not a sandbox. The integrator must pass only workspace-confined
 * `cwd` values and can add core command validation before calling this handler.
 *
 * @module main/studio/command-runner-ipc
 */

import type { IpcMain, WebContents } from 'electron';
import type { CommandRunner, CommandRunInput } from './command-runner.js';

export const COMMAND_CHANNELS = {
  run: 'studio.cmd.run',
  runToEnd: 'studio.cmd.runToEnd',
  kill: 'studio.cmd.kill',
  output: 'studio.cmd.output',
} as const;

/**
 * Préparation d'une commande par le processus principal : refuse un dossier
 * hors des espaces de confiance et fournit l'environnement (liste blanche +
 * secrets du projet). Le renderer ne choisit jamais l'environnement.
 */
export type CommandPrepare = (cwd: string) => Promise<{ ok: true; env: NodeJS.ProcessEnv } | { ok: false; error: string }>;

async function prepared(
  input: unknown,
  prepare: CommandPrepare | undefined,
): Promise<{ ok: true; input: CommandRunInput } | { ok: false; error: string }> {
  const raw = (input ?? {}) as Partial<Record<keyof CommandRunInput, unknown>>;
  const clean: CommandRunInput = {
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    command: typeof raw.command === 'string' ? raw.command : '',
    id: typeof raw.id === 'string' ? raw.id : '',
  };
  if (!prepare) return { ok: true, input: clean };
  const res = await prepare(clean.cwd).catch((error: unknown) => ({ ok: false as const, error: String(error) }));
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, input: { ...clean, env: res.env } };
}

export function registerCommandRunnerIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  runner: CommandRunner,
  webContentsGetter: () => Pick<WebContents, 'send'> | null | undefined,
  prepare?: CommandPrepare,
): void {
  ipcMain.handle(COMMAND_CHANNELS.run, async (_event, rawInput: unknown) => {
    const ready = await prepared(rawInput, prepare);
    if (!ready.ok) return ready;
    const input = ready.input;
    return runner.runCommand(input, (output) => {
      webContentsGetter()?.send(COMMAND_CHANNELS.output, output);
    });
  });

  // Install/build step: streams output like `run` but only resolves once the
  // process exits, so the renderer can gate the dev-server start on a clean
  // `npm install` (App Studio G1 — real install/build before preview).
  ipcMain.handle(COMMAND_CHANNELS.runToEnd, async (_event, rawInput: unknown) => {
    const ready = await prepared(rawInput, prepare);
    if (!ready.ok) return ready;
    const input = ready.input;
    return runner.runToCompletion(input, (output) => {
      webContentsGetter()?.send(COMMAND_CHANNELS.output, output);
    });
  });

  ipcMain.handle(COMMAND_CHANNELS.kill, async (_event, id: string) => {
    return runner.kill(id);
  });
}
