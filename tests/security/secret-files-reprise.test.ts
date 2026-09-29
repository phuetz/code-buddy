import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = await vi.hoisted(async () => {
  const { join, normalize } = await import('node:path');
  const root = normalize(join(process.cwd(), '_qa', 'securite-reprise'));
  const home = join(root, 'home');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home, previousHome, previousUserProfile };
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkSecretFileAccess, classifySecretPath, SECRET_SEARCH_EXCLUDE_GLOBS } from '../../src/security/secret-files.js';
import { JsonQueryTool } from '../../src/tools/json-query-tool.js';
import { FileSearchTool } from '../../src/tools/file-search-tool.js';
import { CsvAnalyzeTool } from '../../src/tools/csv-analyze-tool.js';
import { ArchiveTool } from '../../src/tools/archive-tool.js';
import { DocumentTool } from '../../src/tools/document-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';
import { findCredentialPathInCommand } from '../../src/tools/bash/command-validator.js';
import { applyPatchOps, parsePatch } from '../../src/tools/apply-patch.js';
import { WorkspaceReadTool } from '../../src/tools/workspace-tools.js';
import { SQLTool } from '../../src/tools/sql-tool.js';

const work = path.join(qa.root, 'work');
const cb = path.join(qa.home, '.codebuddy');
const oauth = path.join(cb, 'codex-auth.json');
const aws = path.join(qa.home, '.aws', 'credentials');
const fake = 'FAKE-SECRET-SECU-REPRISE';
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  write(oauth, JSON.stringify({ access_token: fake }));
  write(aws, `key,value\naws,${fake}\n`);
  write(path.join(cb, 'secret.csv'), `key,value\ntoken,${fake}\n`);
  write(path.join(work, '.env'), `KEY=${fake}\n`);
  write(path.join(work, '.env.example'), 'KEY=example\n');
  write(path.join(work, 'notes.txt'), 'ordinary searchable text\n');
  write(path.join(cb, 'skill-signing', 'key.pem'), `PRIVATE ${fake}\n`);
  if (process.platform !== 'win32') fs.symlinkSync(cb, path.join(qa.home, '.CodeBuddy'), 'dir');
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
  if (qa.previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previousUserProfile;
});

describe('reprise des lecteurs autonomes', () => {
  it('utilise le même HOME fictif pour os.homedir sur chaque plateforme', () => {
    expect(process.env.USERPROFILE).toBe(qa.home);
  });

  it.skipIf(process.platform === 'win32')('résout la variante de casse du dossier Code Buddy vers le même jeton fictif', () => {
    expect(fs.realpathSync(path.join(qa.home, '.CodeBuddy'))).toBe(fs.realpathSync(cb));
  });

  it('json_query refuse le jeton OAuth mais lit un JSON ordinaire', async () => {
    expect((await new JsonQueryTool().execute({ file: oauth, path: 'access_token' })).success).toBe(false);
    const ordinary = path.join(work, 'data.json');
    write(ordinary, '{"answer":42}');
    expect((await new JsonQueryTool().execute({ file: ordinary, path: 'answer' })).success).toBe(true);
  });

  it('file_search saute les identifiants sous un dossier arbitraire', async () => {
    const result = await new FileSearchTool().execute({ root: qa.home, pattern: fake });
    expect(result.success).toBe(true);
    expect((result.data as { matches: unknown[] }).matches).toEqual([]);
  });

  it('csv_analyze refuse les identifiants AWS mais préserve un CSV ordinaire', async () => {
    expect((await new CsvAnalyzeTool().execute({ path: aws })).success).toBe(false);
    const ordinary = path.join(work, 'sample.csv');
    write(ordinary, 'name,value\nA,1\n');
    expect((await new CsvAnalyzeTool().execute({ path: ordinary })).success).toBe(true);
  });

  it('le VFS refuse lecture texte et binaire du jeton', async () => {
    await expect(UnifiedVfsRouter.Instance.readFile(oauth)).rejects.toThrow();
    await expect(UnifiedVfsRouter.Instance.readFileBuffer(oauth)).rejects.toThrow();
  });

  it('archive.create refuse un secret direct ou enfoui dans un dossier', async () => {
    const archive = new ArchiveTool();
    expect((await archive.create([oauth], { outputPath: path.join(work, 'oauth.zip') })).success).toBe(false);
    expect((await archive.create([cb], { outputPath: path.join(work, 'home.zip') })).success).toBe(false);
    expect((await archive.create([path.join(work, 'notes.txt')], { outputPath: path.join(work, 'notes.zip') })).success).toBe(true);
  });

  it('document refuse un CSV classé secret sous le HOME', async () => {
    expect((await new DocumentTool().readDocument(path.join(cb, 'secret.csv'))).success).toBe(false);
    write(path.join(work, 'secret.csv'), `service,token\nexample,${fake}\n`);
    expect((await new DocumentTool().readDocument(path.join(work, 'secret.csv'))).success).toBe(false);
  });

  it('workspace_read refuse un .env dans un dépôt configuré', async () => {
    const tool = new WorkspaceReadTool({ workspaceProvider: () => ({
      configPath: path.join(work, 'workspace.json'),
      repos: [{ name: 'project', path: work }],
    }) });
    expect((await tool.execute({ repo: 'project', path: '.env' })).success).toBe(false);
    expect((await tool.execute({ repo: 'project', path: 'notes.txt' })).success).toBe(true);
  });

  it('sql refuse une base privée sous .codebuddy avant ouverture SQLite', async () => {
    const db = path.join(cb, 'history.db');
    const { default: Database } = await import('better-sqlite3');
    const fixture = new Database(db);
    fixture.exec(`CREATE TABLE secrets (value TEXT); INSERT INTO secrets VALUES ('${fake}')`);
    fixture.close();
    const result = await new SQLTool().execute({ action: 'query', database: db, query: 'SELECT * FROM secrets' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('credential/secret');
    const ordinaryDb = path.join(work, 'data.db');
    const ordinary = new Database(ordinaryDb);
    ordinary.exec('CREATE TABLE items (value TEXT); INSERT INTO items VALUES (\'ok\')');
    ordinary.close();
    expect((await new SQLTool().execute({ action: 'query', database: ordinaryDb, query: 'SELECT * FROM items' })).success).toBe(true);
  });

  it('apply_patch ne renomme pas un .env en texte lisible', async () => {
    const patch = `*** Begin Patch\n*** Update File: .env\n*** Move to: stolen.txt\n@@\n KEY=${fake}\n*** End Patch`;
    const result = applyPatchOps(parsePatch(patch), work);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(work, 'stolen.txt'))).toBe(false);
  });
});

describe('classification et shell', () => {
  it.each([aws, path.join(qa.home, '.ssh', 'config'), path.join(qa.home, '.docker', 'config.json')])('classe %s comme secret', (file) => {
    expect(checkSecretFileAccess(file, 'read').secret).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('distingue les deux fichiers Unix /etc/shadow et /etc/passwd sans les lire', () => {
    expect(classifySecretPath('/etc/shadow').secret).toBe(true);
    expect(classifySecretPath('/etc/passwd').secret).toBe(false);
  });

  it.each([
    'cat .env', 'cat ./.env', 'cat id_rsa',
    `cat ${path.join(work, '.env')}`,
    'cat ~/.codebuddy/codex-auth\\.json',
    'cat ~/.codebuddy/codex"-auth.json"',
    'awk 1 ~/.codebuddy/codex-a\'\'uth.json',
    'grep -r FAKE ~/.codebuddy/skill-signing',
    'grep -r FAKE ~/.CodeBuddy/skill-signing',
  ])('refuse le chemin statique %s', (command) => {
    expect(findCredentialPathInCommand(command)).not.toBeNull();
  });

  it('refuse aussi sous Windows les échappements POSIX et les variantes de casse', () => {
    expect(findCredentialPathInCommand('cat ~/.codebuddy/codex-auth\\.json', 'win32')).not.toBeNull();
    expect(findCredentialPathInCommand('grep -r FAKE ~/.CodeBuddy/skill-signing', 'win32')).not.toBeNull();
  });

  it('conserve les lectures de configuration publique et la copie de modèle', () => {
    write(path.join(cb, 'settings.json'), '{}');
    expect(findCredentialPathInCommand('cat ~/.codebuddy/settings.json')).toBeNull();
    expect(findCredentialPathInCommand('cp .env.example .env')).toBeNull();
    expect(findCredentialPathInCommand('ls ~/.codebuddy')).toBeNull();
  });

  it('garde les modèles .env cherchables et exclut tous les PEM de la recherche', () => {
    expect(classifySecretPath(path.join(work, '.env.example')).secret).toBe(false);
    expect(SECRET_SEARCH_EXCLUDE_GLOBS).not.toContain('!.env.*');
    expect(SECRET_SEARCH_EXCLUDE_GLOBS).toContain('!*.pem');
    expect(classifySecretPath(path.join(work, 'cert.pem')).secret).toBe(false);
    expect(classifySecretPath(path.join(cb, 'skill-signing', 'key.pem')).secret).toBe(true);
  });
});
