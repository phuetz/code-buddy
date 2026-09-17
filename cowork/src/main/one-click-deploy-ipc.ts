/**
 * IPC for the Cowork « Déployer » action (Cloudflare Pages / Netlify).
 * Defaults to dry-run; live upload only when the renderer passes apply:true.
 */

import type { IpcMain } from 'electron';
import {
  runOneClickDeploy,
} from '../../../src/deploy/one-click-engine.js';
import type { OneClickReport, OneClickRunRequest } from '../../../src/deploy/one-click-types.js';

export const ONE_CLICK_DEPLOY_CHANNEL = 'oneClickDeploy.run' as const;

export type OneClickDeployIpcRequest = {
  projectRoot: string;
  apply?: boolean;
  dryRun?: boolean;
};

export function registerOneClickDeployIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  run: (request: OneClickRunRequest) => Promise<OneClickReport> = runOneClickDeploy,
): void {
  ipcMain.handle(
    ONE_CLICK_DEPLOY_CHANNEL,
    async (_event, request: OneClickDeployIpcRequest): Promise<OneClickReport> => {
      const projectRoot = typeof request?.projectRoot === 'string' ? request.projectRoot : '';
      if (!projectRoot) {
        return {
          ok: false,
          dryRun: true,
          projectRoot: '',
          durationMs: 0,
          steps: [],
          rollback: {
            supported: false,
            summary: 'No project root.',
            commands: [],
          },
          error: 'No project root. Open a project or pass a directory.',
        };
      }
      const apply = request.apply === true && request.dryRun !== true;
      return run({ projectRoot, apply, dryRun: !apply });
    },
  );
}
