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

export function registerCommandRunnerIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  runner: CommandRunner,
  webContentsGetter: () => Pick<WebContents, 'send'> | null | undefined,
): void {
  ipcMain.handle(COMMAND_CHANNELS.run, async (_event, input: CommandRunInput) => {
    return runner.runCommand(input, (output) => {
      webContentsGetter()?.send(COMMAND_CHANNELS.output, output);
    });
  });

  // Install/build step: streams output like `run` but only resolves once the
  // process exits, so the renderer can gate the dev-server start on a clean
  // `npm install` (App Studio G1 — real install/build before preview).
  ipcMain.handle(COMMAND_CHANNELS.runToEnd, async (_event, input: CommandRunInput) => {
    return runner.runToCompletion(input, (output) => {
      webContentsGetter()?.send(COMMAND_CHANNELS.output, output);
    });
  });

  ipcMain.handle(COMMAND_CHANNELS.kill, async (_event, id: string) => {
    return runner.kill(id);
  });
}
