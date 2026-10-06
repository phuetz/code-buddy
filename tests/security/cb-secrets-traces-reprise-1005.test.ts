/**
 * Reprise CB-SECRETS-TRACES-1005 (contre-revue DeepSeek) : mot de passe dans une URL,
 * Basic auth, artefacts de run, variables d'environnement réalistes, casse.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearRememberedSecrets, scrubSecrets, stringifyScrubbed } from '../../src/security/secret-scrubber.js';
import * as scrubber from '../../src/security/secret-scrubber.js';
import { auditLogger } from '../../src/security/audit-logger.js';
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

describe('r2 : le JSON sérialisé doit rester du JSON (régression du motif d\'URL)', () => {
  const URLS = [
    'https://api.example.com',
    'https://api.example.com/v1/items?id=3',
    'http://localhost:8080',
    'http://localhost:8080/health',
    'https://user:hunter2hunter2@git.example.com/org/repo.git',
    'postgres://app:S3cr3tPassw0rd@db.internal:5432/prod',
    'redis://:onlypassword123@cache:6379',
    'git@github.com:phuetz/code-buddy.git',
    'ssh://git@github.com/org/repo.git',
    'mailto:dev@example.com',
  ];
  const OTHERS = ['@scope/pkg', 'a@b.c', '@types/node@20.1.0', 'name: x', 'C:\\\\Users\\\\x', 'say "hi"', '', '{"nested":"@scope/pkg"}'];

  it('JSON.parse(stringifyScrubbed(objet)) réussit toujours (échantillon systématique + graine fixe)', () => {
    let seed = 20261006;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
    const objects: unknown[] = [];
    for (const u of URLS) for (const o of OTHERS) {
      objects.push({ url: u, package: o });
      objects.push({ a: o, url: u, b: o });
      objects.push({ type: 'tool_call', data: { args: { command: `curl ${u} -o out`, pkg: o }, urls: [u, o] } });
    }
    for (let i = 0; i < 400; i++) {
      objects.push({ k1: pick(URLS) + pick(['', ' ', '"', ',', '/x']), k2: pick(OTHERS), n: [pick(URLS), pick(OTHERS), pick(URLS)], s: `${pick(OTHERS)} ${pick(URLS)} ${pick(OTHERS)}` });
    }
    expect(objects.length).toBeGreaterThan(600);
    for (const obj of objects) {
      const out = stringifyScrubbed(obj);
      expect(() => JSON.parse(out), out).not.toThrow();
    }
  });

  it('la valeur parsée garde la même forme (mêmes clés) et masque encore le mot de passe', () => {
    const parsed = JSON.parse(stringifyScrubbed({ url: 'https://api.example.com', package: '@scope/pkg', db: 'postgres://app:S3cr3tPassw0rd@db:5432/p' }));
    expect(Object.keys(parsed)).toEqual(['url', 'package', 'db']);
    expect(parsed.url).toBe('https://api.example.com');
    expect(parsed.package).toBe('@scope/pkg');
    expect(parsed.db).toBe('postgres://app:[REDACTED:url_password]@db:5432/p');
  });

  it('un events.jsonl scrubbé se recharge de bout en bout, sans événement perdu', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sec-r2-'));
    try {
      const store = new RunStore(path.join(tmp, 'runs'));
      const runId = store.startRun('deploy', { source: 'cli' } as never);
      store.emit(runId, { type: 'tool_call', data: { toolName: 'web_fetch', args: { url: 'https://api.example.com', package: '@scope/pkg' } } } as never);
      store.emit(runId, { type: 'tool_result', data: { output: 'ok postgres://app:S3cr3tPassw0rd@db:5432/p and a@b.c', success: true } } as never);
      store.emit(runId, { type: 'error', data: { message: 'failed https://x.example.com","y":"@scope/pkg' } } as never);
      await store.flushRun(runId);
      store.endRun(runId, 'completed');
      await store.whenStreamsClosed();
      const raw = fs.readFileSync(path.join(tmp, 'runs', runId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
      const parsed = raw.map((l) => JSON.parse(l));
      expect(parsed.length).toBeGreaterThanOrEqual(5);
      expect(raw.join('\n')).not.toContain('S3cr3tPassw0rd');
      const reloaded = new RunStore(path.join(tmp, 'runs')).getEvents(runId);
      expect(reloaded.length).toBe(parsed.length);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('r2 : noms d\'environnement en _KEY / _PASS', () => {
  const secretNames = ['OPENAI_KEY', 'ANTHROPIC_KEY', 'SIGNING_KEY', 'MASTER_KEY', 'DB_PASS', 'SMTP_PASS'];
  const publicNames = ['STRIPE_PUBLISHABLE_KEY', 'APP_PUBLIC_KEY', 'SORT_KEY', 'CACHE_KEY'];
  afterEach(() => {
    for (const n of [...secretNames, ...publicNames]) delete process.env[n];
    clearRememberedSecrets();
  });

  it.each(secretNames)('%s : valeur masquée', (name) => {
    const value = `opaque-${name.toLowerCase()}-0123456789`;
    process.env[name] = value;
    // ÉCHOUE sur e2f70ae63 : ces noms n'étaient pas reconnus.
    expect(scrubSecrets(`v=${value}`)).not.toContain(value);
  });

  it.each(publicNames)('%s : valeur publique non masquée (exclusion)', (name) => {
    const value = `public-${name.toLowerCase()}-0123456789`;
    process.env[name] = value;
    expect(scrubSecrets(`v=${value}`)).toBe(`v=${value}`);
  });
});

describe('r3 : on masque les VALEURS avant JSON.stringify (propriété sur les vrais chemins d\'écriture)', () => {
  // Alphabet hostile : tous les délimiteurs qui ont fait osciller le motif d'URL (hors / ? # espaces, delimiteurs d'URL).
  const ALPHABET = "abcXYZ019-_.~!$&*+=;,'\"\\{}[]<>`@:";
  const makePasswords = (n: number): string[] => {
    let seed = 6102026;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const out: string[] = [];
    while (out.length < n) {
      const len = 6 + Math.floor(rnd() * 9);
      let pw = '';
      for (let i = 0; i < len; i++) pw += ALPHABET[Math.floor(rnd() * ALPHABET.length)]!;
      // un mot de passe fait d'au moins 3 caractères alphanumériques, qui ne se termine pas par '@' ni ':' seul
      if ((pw.match(/[A-Za-z0-9]/g) ?? []).length >= 3 && !pw.endsWith('@')) out.push(pw);
    }
    return out;
  };
  const PASSWORDS = makePasswords(250);
  const urlWith = (pw: string, scheme = 'postgres') => `${scheme}://svc:${pw}@db.internal:5432/app`;
  // Un mot de passe « survit » si sa valeur complète est encore lisible dans la sortie.
  const survives = (out: string, pw: string) => out.includes(pw);

  it('texte brut : aucun mot de passe d\'URL aléatoire ne survit', () => {
    for (const pw of PASSWORDS) {
      // ÉCHOUE sur a0b785426 : les mots de passe contenant , ' " \ { } [ ] < > ` repassaient en clair.
      expect(survives(scrubSecrets(`connect ${urlWith(pw)} now`), pw), pw).toBe(false);
    }
  });

  it('events.jsonl (vrai RunStore) : JSON valide ET aucun mot de passe ne survit', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sec-r3-'));
    try {
      const store = new RunStore(path.join(tmp, 'runs'));
      const runId = store.startRun('r3', { source: 'cli' } as never);
      for (const pw of PASSWORDS) {
        store.emit(runId, { type: 'tool_call', data: { toolName: 'bash', args: { command: `psql ${urlWith(pw)} -c 'select 1'`, nested: { a: { b: { c: { d: { e: { f: { g: urlWith(pw, 'https') } } } } } } } } } } as never);
      }
      await store.flushRun(runId);
      store.endRun(runId, 'completed');
      await store.whenStreamsClosed();
      const lines = fs.readFileSync(path.join(tmp, 'runs', runId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(PASSWORDS.length);
      for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
      const parsed = lines.map((l) => JSON.stringify(JSON.parse(l)));
      for (const pw of PASSWORDS) {
        const raw = lines.join('\n');
        const decoded = parsed.join('\n');
        expect(survives(raw, pw) || survives(decoded, pw), pw).toBe(false);
        // la valeur décodée (après JSON.parse) ne doit pas non plus contenir le mot de passe
        expect(survives(lines.map((l) => JSON.parse(l)).map((e) => JSON.stringify(e.data)).join('\n').replace(/\\\\/g, '\\').replace(/\\"/g, '"'), pw), pw).toBe(false);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('audit-*.jsonl (vrai AuditLogger) : JSON valide ET aucun mot de passe ne survit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sec-r3-audit-'));
    try {
      auditLogger.init({ logDir: dir, sessionId: 'r3' });
      for (const pw of PASSWORDS.slice(0, 120)) {
        auditLogger.log({ action: 'bash_execute', decision: 'allow', source: 'test', target: urlWith(pw), details: `ran ${urlWith(pw, 'redis')}` } as never);
      }
      const lines = fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
      expect(lines.length).toBeGreaterThanOrEqual(120);
      for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
      const decoded = lines.map((l) => { const o = JSON.parse(l); return `${o.target}\n${o.details}`; }).join('\n');
      for (const pw of PASSWORDS.slice(0, 120)) {
        expect(survives(decoded, pw), pw).toBe(false);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('session enregistrée : JSON valide ET aucun mot de passe ne survit', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sec-r3-sess-'));
    const prev = process.env.CODEBUDDY_SESSIONS_DIR;
    process.env.CODEBUDDY_SESSIONS_DIR = path.join(tmp, 'sessions');
    try {
      const pws = PASSWORDS.slice(0, 60);
      const session = {
        id: 'r3-session', name: 's', workingDirectory: '/workspace/demo', model: 'm',
        createdAt: new Date('2026-10-06T08:00:00Z'), lastAccessedAt: new Date('2026-10-06T08:01:00Z'),
        metadata: { tokenCount: 1, totalCost: 0 },
        messages: pws.map((pw) => ({ type: 'user', content: `use ${urlWith(pw)}`, timestamp: '2026-10-06T08:00:00Z' })),
      } as unknown as Session;
      await new SessionStore({ useSQLite: false }).saveSession(session);
      const files: string[] = [];
      const walk = (d: string) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
      walk(path.join(tmp, 'sessions'));
      const f = files.find((x) => x.includes('r3-session'))!;
      const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
      const text = JSON.stringify(obj.messages.map((m: { content: string }) => m.content));
      const decoded = obj.messages.map((m: { content: string }) => m.content).join('\n');
      for (const pw of pws) expect(survives(decoded, pw) || survives(text, pw), pw).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR; else process.env.CODEBUDDY_SESSIONS_DIR = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('une URL sans identifiants, un chemin avec @ et un paquet scopé ne sont pas modifiés', () => {
    for (const t of ['https://api.example.com', 'http://localhost:8080/a@b.com', 'https://x.io/p?e=u@v.org', '@scope/pkg', 'git@github.com:o/r.git']) {
      expect(scrubSecrets(t)).toBe(t);
    }
  });
});
