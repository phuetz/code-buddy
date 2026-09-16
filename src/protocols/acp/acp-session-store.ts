import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withSessionLock } from '../../persistence/session-lock.js';
import { logger } from '../../utils/logger.js';
import { readJsonAtomic, writeJsonAtomic } from '../../utils/atomic-write.js';

export interface AcpPersistedSession {
  sessionId: string;
  cwd: string;
  title?: string;
  history: unknown[];
  mcpServers?: unknown;
  updatedAt: string;
}

export interface AcpSessionStoreConfig {
  storeDir?: string;
}

/**
 * Atomic replace with a short retry: on Windows a rename onto a file that
 * another handle still has open (a concurrent `load`, an indexer) fails with
 * EPERM/EBUSY for a few milliseconds instead of succeeding as on POSIX.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const delaysMs = [10, 25, 50, 100, 200];
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const delay = delaysMs[attempt];
      if ((code !== 'EPERM' && code !== 'EBUSY') || delay === undefined) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export class AcpSessionStore {
  private readonly dir: string;

  constructor(config: AcpSessionStoreConfig = {}) {
    this.dir = config.storeDir ?? this.defaultDir();
    this.ensureDir();
  }

  async save(session: AcpPersistedSession): Promise<void> {
    const file = this.fileFor(session.sessionId);
    await withSessionLock(file, async () => {
      await this.writeUnlocked(session);
    });
  }

  async load(sessionId: string): Promise<AcpPersistedSession | null> {
    const file = this.fileFor(sessionId);
    if (!fs.existsSync(file)) return null;
    try {
      return await readJsonAtomic<AcpPersistedSession | null>(file, null, {
        mode: 0o600,
        isValid: (value): value is AcpPersistedSession => Boolean(
          value && typeof value === 'object' && !Array.isArray(value) &&
          typeof (value as AcpPersistedSession).sessionId === 'string',
        ),
      });
    } catch (err) {
      logger.warn?.('[acp-session-store] failed to read session', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const file = this.fileFor(sessionId);
    await withSessionLock(file, async () => {
      if (fs.existsSync(file)) {
        await fs.promises.unlink(file);
      }
    });
  }

  async listAll(): Promise<AcpPersistedSession[]> {
    if (!fs.existsSync(this.dir)) return [];
    const files = await fs.promises.readdir(this.dir);
    const sessions: AcpPersistedSession[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const sessionId = f.slice(0, -5);
      const s = await this.load(sessionId);
      if (s) sessions.push(s);
    }
    return sessions;
  }

  private async writeUnlocked(session: AcpPersistedSession): Promise<void> {
    const file = this.fileFor(session.sessionId);
    await writeJsonAtomic(file, session, { mode: 0o600 });
  }

  private fileFor(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private defaultDir(): string {
    const home = os.homedir();
    return path.join(home, '.codebuddy', 'acp-sessions');
  }
}
