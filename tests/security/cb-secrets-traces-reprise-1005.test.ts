/**
 * Reprise CB-SECRETS-TRACES-1005 (contre-revue DeepSeek) : mot de passe dans une URL,
 * Basic auth, artefacts de run, variables d'environnement réalistes, casse.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearRememberedSecrets, scrubSecrets } from '../../src/security/secret-scrubber.js';
import * as scrubber from '../../src/security/secret-scrubber.js';
import { RunStore } from '../../src/observability/run-store.js';
import { SessionStore, type Session } from '../../src/persistence/session-store.js';
import { exportSessionShareHtml } from '../../src/export/session-share.js';

const PG = 'postgres://app:S3cr3tPassw0rd@db.internal:5432/prod';
const HTTPS = 'https://deploy:hunter2hunter2@git.example.com/org/repo.git';
const BASIC = 'Authorization: Basic dXNlcjpzdXBlcnNlY3JldHBhc3M=';

describe('mot de passe dans une URL, Basic auth, casse', () => {
  it.each([
    [PG, 'S3cr3tPassw0rd'],
    [HTTPS, 'hunter2hunter2'],
    ['redis://:onlypassword123@cache:6379', 'onlypassword123'],
    [BASIC, 'dXNlcjpzdXBlcnNlY3JldHBhc3M='],
    ['authorization: basic dXNlcjpzdXBlcnNlY3JldHBhc3M=', 'dXNlcjpzdXBlcnNlY3JldHBhc3M='],
    ['curl -H "Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM="', 'YWRtaW46cGFzc3dvcmQxMjM='],
    ['bearer abcdefghijklmnopqrstuvwxyz012345', 'abcdefghijklmnopqrstuvwxyz012345'],
    ['XAI-abcdefghijklmnopqrstuvwxyz0123456789ABCD', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'],
  ])('%s est masqué', (text, secret) => {
    // ÉCHOUE sur e5a19166a : ces formes passaient en clair.
    const out = scrubSecrets(`log: ${text} end`);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED:');
  });

  it('l\'hôte et l\'utilisateur de l\'URL restent lisibles', () => {
    expect(scrubSecrets(PG)).toBe('postgres://app:[REDACTED:url_password]@db.internal:5432/prod');
  });

  it.each([
    'https://example.com/path?x=1',
    'http://localhost:3000/api',
    'git clone git@github.com:phuetz/code-buddy.git',
    'ssh://git@github.com/org/repo.git',
    'Basic usage of the tool is documented',
    'Basic information about the project',
    'see http://host:8080/a@b',
    'mailto:user@example.com',
  ])('%s n\'est pas modifié', (text) => {
    expect(scrubSecrets(text)).toBe(text);
  });
});

describe('surfaces d\'écriture', () => {
  let tmp = '';
  let prevHome: string | undefined;
  let prevSessions: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sec-reprise-'));
    prevHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = path.join(tmp, 'home');
    prevSessions = process.env.CODEBUDDY_SESSIONS_DIR;
    process.env.CODEBUDDY_SESSIONS_DIR = path.join(tmp, 'sessions');
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = prevHome;
    if (prevSessions === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = prevSessions;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('events.jsonl, summary.json et artefacts de run sans mot de passe d\'URL ni Basic', async () => {
    const store = new RunStore(path.join(tmp, 'runs'));
    const runId = store.startRun(`deploy to ${PG}`, { source: 'cli' } as never);
    store.emit(runId, { type: 'error', data: { message: `failed ${HTTPS} ${BASIC}` } } as never);
    const artifact = store.saveArtifact(runId, 'commands.log', `$ curl -H "${BASIC}" ${PG}\nBearer ${'z'.repeat(40)}\n`);
    await store.flushRun(runId);
    store.endRun(runId, 'failed');
    await store.whenStreamsClosed();
    const dir = path.join(tmp, 'runs', runId);
    const everything = [
      fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'),
      fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'),
      fs.readFileSync(artifact, 'utf8'),
    ].join('\n');
    // ÉCHOUE sur e5a19166a : l'artefact n'était pas nettoyé, les URL non plus.
    for (const secret of ['S3cr3tPassw0rd', 'hunter2hunter2', 'dXNlcjpzdXBlcnNlY3JldHBhc3M=', 'z'.repeat(40)]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('session enregistrée et export session-share sans mot de passe d\'URL', async () => {
    const session = {
      id: 'sec-reprise',
      name: 's',
      workingDirectory: '/workspace/demo',
      model: 'm',
      createdAt: new Date('2026-10-06T08:00:00Z'),
      lastAccessedAt: new Date('2026-10-06T08:01:00Z'),
      metadata: { tokenCount: 1, totalCost: 0 },
      messages: [{ type: 'user', content: `connect with ${PG} and ${BASIC}`, timestamp: '2026-10-06T08:00:00Z' }],
    } as unknown as Session;
    const store = new SessionStore({ useSQLite: false });
    await store.saveSession(session);
    const files: string[] = [];
    const walk = (d: string) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
    walk(path.join(tmp, 'sessions'));
    const saved = files.filter((f) => f.includes('sec-reprise')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(saved).not.toBe('');
    expect(saved).not.toContain('S3cr3tPassw0rd');
    const html = exportSessionShareHtml(session, [], {});
    expect(html).not.toContain('S3cr3tPassw0rd');
    expect(html).not.toContain('dXNlcjpzdXBlcnNlY3JldHBhc3M=');
  });
});

describe('variables d\'environnement sensibles', () => {
  const names = ['MY_SECRET_KEY', 'AWS_SECRET_KEY', 'DISCORD_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'DB_PASSWORD'];
  afterEach(() => {
    for (const n of names) delete process.env[n];
    clearRememberedSecrets();
  });

  it.each(names)('%s : la valeur opaque est masquée', (name) => {
    const value = `opaque-${name.toLowerCase()}-0123456789ab`;
    process.env[name] = value;
    // ÉCHOUE sur e5a19166a : ces noms n'étaient pas reconnus.
    expect(scrubSecrets(`value is ${value}`)).not.toContain(value);
  });

  it('un jeton roté à longueur constante est quand même masqué (cache invalidé)', () => {
    process.env.DISCORD_TOKEN = 'rotation-token-AAAAAAAAAAAA';
    expect(scrubSecrets('x rotation-token-AAAAAAAAAAAA')).not.toContain('AAAAAAAAAAAA');
    process.env.DISCORD_TOKEN = 'rotation-token-BBBBBBBBBBBB';
    // ÉCHOUE sur e5a19166a : l'empreinte ne comparait que les longueurs.
    expect(scrubSecrets('y rotation-token-BBBBBBBBBBBB')).not.toContain('BBBBBBBBBBBB');
  });

  it('rememberSecretValue n\'existe plus (protection annoncée mais jamais branchée)', () => {
    expect((scrubber as Record<string, unknown>).rememberSecretValue).toBeUndefined();
  });
});
