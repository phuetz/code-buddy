import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { BrowserOperatorRuntimeBridge } from '../browser/browser-operator-runtime-bridge';
import type { ProjectManager } from '../project/project-manager';
import {
  BROWSER_OPERATOR_RUNTIME_CHANNELS,
  type BrowserOperatorOwnedInput,
  type BrowserOperatorPrepareInput,
  type BrowserOperatorStartInput,
} from '../../shared/browser-operator-runtime-types';

export interface BrowserOperatorRuntimeIpcOptions {
  getProjectManager: () => ProjectManager | null;
  bridge?: BrowserOperatorRuntimeBridge;
}

/** Register the review → approve → execute Browser Operator IPC lifecycle. */
export function registerBrowserOperatorRuntimeIpcHandlers(
  options: BrowserOperatorRuntimeIpcOptions,
): BrowserOperatorRuntimeBridge {
  const senders = new Map<number, WebContents>();
  const bridge = options.bridge ?? new BrowserOperatorRuntimeBridge({
    getWorkspaceRoot: () => options.getProjectManager()?.getActive()?.workspacePath,
    sendEvent: (rendererId, event) => {
      const sender = senders.get(rendererId);
      if (sender && !sender.isDestroyed()) {
        sender.send(BROWSER_OPERATOR_RUNTIME_CHANNELS.event, event);
      }
    },
  });

  const rendererId = (event: IpcMainInvokeEvent): number => {
    senders.set(event.sender.id, event.sender);
    return event.sender.id;
  };

  ipcMain.handle(BROWSER_OPERATOR_RUNTIME_CHANNELS.prepare, async (event, input?: BrowserOperatorPrepareInput) =>
    bridge.prepare(rendererId(event), input));
  ipcMain.handle(BROWSER_OPERATOR_RUNTIME_CHANNELS.start, async (event, input?: BrowserOperatorStartInput) =>
    bridge.start(rendererId(event), input));
  ipcMain.handle(BROWSER_OPERATOR_RUNTIME_CHANNELS.stop, async (event, input?: BrowserOperatorOwnedInput) =>
    bridge.stop(rendererId(event), input));
  ipcMain.handle(BROWSER_OPERATOR_RUNTIME_CHANNELS.status, async (event, input?: BrowserOperatorOwnedInput) =>
    bridge.status(rendererId(event), input));
  ipcMain.handle(BROWSER_OPERATOR_RUNTIME_CHANNELS.list, async (event, ownerSessionId?: string) =>
    bridge.list(rendererId(event), ownerSessionId));

  return bridge;
}
