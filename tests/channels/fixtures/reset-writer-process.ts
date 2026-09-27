/**
 * A second process that writes one turn while a messaging reset runs in the
 * test process. It loads the product writer first, writes `ready`, waits for
 * `go`, writes `started`, then calls the writer and writes `done` with what
 * happened: `written` when its turn is on disk, otherwise the reason.
 *
 * Usage: node --import tsx reset-writer-process.ts <session|companion> <sessionKey> <signalDir> <text>
 */
import fs from 'node:fs';
import path from 'node:path';

const [mode, sessionKey, signalDir, text] = process.argv.slice(2) as [string, string, string, string];
const mark = (name: string, body = '1'): void => fs.writeFileSync(path.join(signalDir, name), body);

const storeModule = await import('../../../src/persistence/session-store.js');
const history = await import('../../../src/companion/channel-history.js');

mark('ready');
while (!fs.existsSync(path.join(signalDir, 'go'))) await new Promise((resolve) => setTimeout(resolve, 5));
mark('started');
try {
  if (mode === 'session') {
    const store = new storeModule.SessionStore({ useSQLite: false });
    (store as unknown as { currentSessionId: string }).currentSessionId = sessionKey;
    await store.addMessageToCurrentSession({ type: 'user', content: text, timestamp: new Date() });
    const saved = await store.loadSession(sessionKey);
    mark('done', saved?.messages.some((message) => message.content === text) ? 'written' : 'not-on-disk');
  } else {
    history.rememberCompanionChannelTurn(sessionKey, 'encore', text, process.env);
    const file = history.resolveChannelHistoryFile(sessionKey, process.env);
    mark('done', fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(text) ? 'written' : 'not-on-disk');
  }
} catch (err) {
  mark('done', `refused: ${err instanceof Error ? err.message : String(err)}`);
}
