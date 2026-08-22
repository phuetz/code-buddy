import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { SessionFacade } from '../agent/facades/session-facade.js';
import { getCheckpointManager } from '../checkpoints/checkpoint-manager.js';
import { exportPersistedSessionShareHtml } from '../export/session-share.js';
import { SessionStore } from '../persistence/session-store.js';
import { SessionTimeline } from '../sessions/timeline.js';
import { logger } from '../utils/logger.js';

interface ShareOptions {
  out?: string;
  last?: boolean;
  open?: boolean;
}

type ShareSessionFacade = Pick<SessionFacade, 'loadSession' | 'getSessionStore'>;

export interface ShareCommandDependencies {
  sessionFacade?: ShareSessionFacade;
  timeline?: Pick<SessionTimeline, 'list'>;
  cwd?: string;
  now?: () => Date;
  openFile?: (filePath: string) => Promise<void>;
}

function createDefaultSessionFacade(): SessionFacade {
  return new SessionFacade({
    checkpointManager: getCheckpointManager(),
    sessionStore: new SessionStore({ useSQLite: false }),
  });
}

function safeFileId(sessionId: string): string {
  const safe = sessionId
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/-+/g, '-');
  return safe || 'session';
}

async function openInBrowser(filePath: string): Promise<void> {
  const { default: open } = await import('open');
  await open(filePath, { wait: false });
}

function resolveSessionId(
  requestedId: string | undefined,
  options: ShareOptions,
  facade: ShareSessionFacade
): string {
  if (requestedId && options.last !== true) return requestedId;
  const latest = facade.getSessionStore().listSessions()[0];
  if (!latest) {
    throw new Error('Aucune session sauvegardée à partager.');
  }
  return latest.id;
}

export function createShareCommand(dependencies: ShareCommandDependencies = {}): Command {
  return new Command('share')
    .description('Exporter une session en replay HTML autonome et partageable')
    .argument('[sessionId]', 'ID de session; la plus récente par défaut')
    .option('--out <fichier.html>', 'Chemin du fichier HTML de sortie')
    .option('--last', 'Exporter explicitement la session la plus récente', false)
    .option('--open', 'Ouvrir le fichier dans le navigateur (best-effort)', false)
    .action(async (requestedId: string | undefined, options: ShareOptions) => {
      const sessionFacade = dependencies.sessionFacade ?? createDefaultSessionFacade();
      const sessionId = resolveSessionId(requestedId, options, sessionFacade);
      const html = await exportPersistedSessionShareHtml(sessionId, {
        sessionFacade,
        timeline: dependencies.timeline,
        exportedAt: dependencies.now?.(),
      });
      if (!html) {
        throw new Error(`Session introuvable : ${sessionId}`);
      }

      const cwd = dependencies.cwd ?? process.cwd();
      const outputPath = path.resolve(
        cwd,
        options.out ?? `codebuddy-session-${safeFileId(sessionId)}.html`
      );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, html, 'utf8');
      logger.info(`Session partagée : ${outputPath}`);

      if (options.open) {
        try {
          await (dependencies.openFile ?? openInBrowser)(outputPath);
        } catch (error) {
          logger.warn('[session-share] impossible d’ouvrir le navigateur', {
            outputPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
}
