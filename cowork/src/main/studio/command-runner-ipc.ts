/**
 * IPC registration for the App Studio command runner.
 *
 * The runner is not a sandbox. The integrator must pass only workspace-confined
 * `cwd` values and can add core command validation before calling this handler.
 *
 * @module main/studio/command-runner-ipc
 */

import type { IpcMain, WebContents } from 'electron';
import type { CommandOutputEvent, CommandRunner, CommandRunInput } from './command-runner.js';

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
export type CommandPrepare = (
  cwd: string,
) => Promise<
  | {
      ok: true;
      env: NodeJS.ProcessEnv;
      /** Masque les secrets du projet dans chaque ligne affichée au terminal. */
      redact?: (line: string) => Promise<string>;
    }
  | { ok: false; error: string }
>;

/**
 * Relais des lignes vers le renderer, masquées une à une DANS L'ORDRE
 * (chaîne de promesses) ; une ligne impossible à masquer n'est pas relayée.
 */
function outputRelay(
  webContentsGetter: () => Pick<WebContents, 'send'> | null | undefined,
  redact: ((line: string) => Promise<string>) | undefined,
): { send: (output: CommandOutputEvent) => void; drained: () => Promise<void> } {
  let chain: Promise<void> = Promise.resolve();
  return {
    send: (output) => {
      if (!redact) {
        webContentsGetter()?.send(COMMAND_CHANNELS.output, output);
        return;
      }
      chain = chain.then(async () => {
        const line = await redact(output.line).catch(() => null);
        if (line !== null) webContentsGetter()?.send(COMMAND_CHANNELS.output, { ...output, line });
      });
    },
    drained: () => chain,
  };
}

async function prepared(
  input: unknown,
  prepare: CommandPrepare | undefined,
): Promise<{ ok: true; input: CommandRunInput; redact?: (line: string) => Promise<string> } | { ok: false; error: string }> {
  const raw = (input ?? {}) as Partial<Record<keyof CommandRunInput, unknown>>;
  const clean: CommandRunInput = {
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    command: typeof raw.command === 'string' ? raw.command : '',
    id: typeof raw.id === 'string' ? raw.id : '',
  };
  if (!prepare) return { ok: true, input: clean };
  const res = await prepare(clean.cwd).catch((error: unknown) => ({ ok: false as const, error: String(error) }));
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, input: { ...clean, env: res.env }, ...(res.redact ? { redact: res.redact } : {}) };
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
    const relay = outputRelay(webContentsGetter, ready.redact);
    return runner.runCommand(ready.input, relay.send);
  });

  // Install/build step: streams output like `run` but only resolves once the
  // process exits, so the renderer can gate the dev-server start on a clean
  // `npm install` (App Studio G1 — real install/build before preview).
  ipcMain.handle(COMMAND_CHANNELS.runToEnd, async (_event, rawInput: unknown) => {
    const ready = await prepared(rawInput, prepare);
    if (!ready.ok) return ready;
    const relay = outputRelay(webContentsGetter, ready.redact);
    const result = await runner.runToCompletion(ready.input, relay.send);
    await relay.drained();
    return result;
  });

  ipcMain.handle(COMMAND_CHANNELS.kill, async (_event, id: string) => {
    return runner.kill(id);
  });
}
