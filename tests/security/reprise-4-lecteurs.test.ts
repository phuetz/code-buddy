import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const path = await import('node:path');
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  const home = path.join(process.cwd(), '_qa', 'securite-reprise-4', 'home');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { home, previousHome, previousProfile };
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { generateDocument } from '../../src/tools/document-generator.js';
import { MarkdownConvertTool } from '../../src/tools/markdown-convert.js';
import { scanFileForSecrets, scanForSecrets } from '../../src/security/secrets-detector.js';
import { TodoScanTool } from '../../src/tools/todo-scan-tool.js';
import { restoreSessionHistory } from '../../src/persistence/session-history.js';
import { SessionStore } from '../../src/persistence/session-store.js';
import { checkSecretFileAccess } from '../../src/security/secret-files.js';
import type { ChatEntry } from '../../src/agent/types.js';

const fakeToken = 'FAKE-OAUTH-REVUE-4-259';
let work: string;
let tokenPath: string;

beforeAll(() => {
  expect(path.normalize(os.homedir())).toBe(path.normalize(qa.home));
  fs.mkdirSync(path.join(qa.home, '.codebuddy', 'sessions'), { recursive: true });
  tokenPath = path.join(qa.home, '.codebuddy', 'codex-auth.json');
  fs.writeFileSync(tokenPath, `{"access_token":"${fakeToken}"}\n`);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-reprise-4-readers-'));
  fs.symlinkSync(tokenPath, path.join(work, 'evil.png'));
  fs.writeFileSync(path.join(work, 'notes.txt'), 'TODO: ordinaire\n');
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(path.dirname(qa.home), { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousProfile;
});

describe('lecteurs directs et reprise de session', () => {
  it('generate_document ne place pas un jeton lié comme image dans un DOCX', async () => {
    const outputPath = path.join(work, 'rapport.docx');
    const result = await generateDocument({ type: 'docx', title: 'Essai', content: '![](evil.png)', outputPath });
    if (result.success) {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(outputPath);
      for (const entry of zip.getEntries()) {
        expect(entry.getData().toString('utf8')).not.toContain(fakeToken);
      }
    }
    expect(result.embeddedImages ?? []).toEqual([]);
  });

  it('markdown_convert refuse un jeton avant de lancer le sidecar et accepte un document ordinaire', async () => {
    const spawnFn = vi.fn((_bin: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(fs.readFileSync(args[0]!, 'utf8')));
        child.emit('close', 0);
      });
      return child;
    }) as unknown as typeof import('node:child_process').spawn;
    const tool = new MarkdownConvertTool({ spawnFn });
    const denied = await tool.convert({ source: tokenPath });
    expect(denied.success).toBe(false);
    expect(JSON.stringify(denied)).not.toContain(fakeToken);
    expect(spawnFn).not.toHaveBeenCalled();
    const ordinary = await tool.convert({ source: path.join(work, 'notes.txt') });
    expect(ordinary.success).toBe(true);
    expect(ordinary.output).toContain('TODO: ordinaire');
  });

  it('scan_secrets ne lit pas un fichier classé secret, même par appel direct', async () => {
    const localSecret = path.join(work, 'secrets.json');
    const content = 'api_key=sk-1234567890123456789012345678901234567890\n';
    fs.writeFileSync(localSecret, content);
    expect(scanFileForSecrets(localSecret)).toEqual([]);
    expect(await scanForSecrets(localSecret)).toEqual([]);
    const ordinary = path.join(work, 'source.ts');
    fs.writeFileSync(ordinary, content);
    expect(scanFileForSecrets(ordinary).length).toBeGreaterThan(0);
  });

  it('todo_scan ne copie pas le jeton dans data depuis le HOME fictif', async () => {
    const result = await new TodoScanTool().execute({ root: path.join(qa.home, '.codebuddy'), markers: ['access_token'] });
    expect(result.success).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain(fakeToken);
  });

  it('la reprise ne transmet pas data au fournisseur et la session brute est classée secrète', async () => {
    const call = { id: 'call-reprise-4', type: 'function' as const, function: { name: 'todo_scan', arguments: '{}' } };
    const entries: ChatEntry[] = [
      { type: 'tool_call', content: '', timestamp: new Date(), toolCall: call },
      { type: 'tool_result', content: 'Found 1 todo markers', timestamp: new Date(), toolCall: call,
        toolResult: { success: true, output: 'Found 1 todo markers', data: { byType: { access_token: [{ text: fakeToken }] } } } },
    ];
    const restored = restoreSessionHistory(entries);
    expect(JSON.stringify(restored)).not.toContain(fakeToken);
    const sessionsDir = path.join(qa.home, '.codebuddy', 'sessions');
    const previousDir = process.env.CODEBUDDY_SESSIONS_DIR;
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    try {
      const store = new SessionStore({ useSQLite: false, encryptionKeyPath: path.join(sessionsDir, 'key') });
      const session = await store.createSession('fictive');
      for (const entry of entries) await store.addMessageToCurrentSession(entry);
      const raw = fs.readFileSync(path.join(sessionsDir, `${session.id}.json`), 'utf8');
      expect(raw).toContain(fakeToken);
      expect(checkSecretFileAccess(path.join(sessionsDir, `${session.id}.json`), 'read').secret).toBe(true);
      const loaded = await store.loadSession(session.id);
      const resumed = restoreSessionHistory(store.convertMessagesToChatEntries(loaded!.messages));
      expect(JSON.stringify(resumed)).not.toContain(fakeToken);
    } finally {
      if (previousDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
      else process.env.CODEBUDDY_SESSIONS_DIR = previousDir;
    }
  });

  it('generate_document ne remplace pas un jeton via une destination DOCX liée', async () => {
    const credential = path.join(qa.home, '.codebuddy', 'oauth-copy.json');
    fs.writeFileSync(credential, fakeToken);
    const outputPath = path.join(work, 'sortie.docx');
    fs.symlinkSync(credential, outputPath);
    const result = await generateDocument({ type: 'docx', title: 'Essai', content: '# Sans image', outputPath });
    expect(result.success).toBe(false);
    expect(fs.readFileSync(credential, 'utf8')).toBe(fakeToken);
  });
});
