import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-13`;
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  process.env.HOME = `${root}/home`;
  process.env.USERPROFILE = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, oldHome, oldUserProfile };
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';
import { wirePeerToolBridge, unwirePeerToolBridge } from '../../src/fleet/peer-tool-bridge.js';
import { dispatchPeerRequest, _resetPeerRpcForTests } from '../../src/server/websocket/peer-rpc.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import { getToolRegistry } from '../../src/tools/registry.js';
import { GitTool } from '../../src/tools/git-tool.js';
import { runProtectedWorkspaceCommand } from '../../src/security/git-secret-process-boundary.js';
import { TestRunnerTool } from '../../src/tools/test-runner-tool.js';
import { BuildProjectTool } from '../../src/tools/build-project-tool.js';
import { InteractiveBashTool } from '../../src/tools/interactive-bash.js';
import { AppServerTool } from '../../src/tools/app-server-tool.js';

const workspace = path.join(qa.root, 'workspace');
const nested = path.join(workspace, 'vendor', 'sub');
const renameRepo = path.join(qa.root, 'rename');
const secret = 'FAKE-NESTED-REGLE-13';

function gitExe(): string {
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Git absent du PATH du banc');
}

const gitPath = gitExe();
const oldPath = process.env.PATH;
function git(cwd: string, ...args: string[]): string {
  return execFileSync(gitPath, ['-C', cwd, ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: qa.home, USERPROFILE: qa.home, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

beforeAll(() => {
  process.env.PATH = [path.dirname(gitPath), oldPath].filter(Boolean).join(path.delimiter);
  fs.mkdirSync(qa.home, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(qa.root, 'outside.txt'), 'PUBLIC_OUTSIDE\n');
  git(workspace, 'init', '-q');
  git(workspace, 'config', 'user.name', 'Essai');
  git(workspace, 'config', 'user.email', 'essai@example.invalid');
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'bonjour\n');
  fs.writeFileSync(path.join(workspace, 'code.ts'), 'export const valeur = 1;\n');
  fs.writeFileSync(path.join(workspace, '.env.example'), 'PUBLIC=example\n');
  git(workspace, 'add', 'notes.txt', 'code.ts', '.env.example');
  git(workspace, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'public');
  fs.writeFileSync(path.join(workspace, 'code.ts'), 'export const valeur = 2;\n');
  git(nested, 'init', '-q');
  fs.writeFileSync(path.join(nested, '.env'), `NESTED_TOKEN=${secret}\n`);
  git(nested, 'add', '.env');
  git(nested, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'secret fictif');
  fs.cpSync(path.join(nested, '.git', 'objects'), path.join(nested, 'object-copy'), { recursive: true });
  fs.mkdirSync(renameRepo, { recursive: true });
  git(renameRepo, 'init', '-q');
  const renameLines = Array.from({ length: 30 }, (_, index) =>
    index === 15 ? `TOKEN=${secret}` : `PUBLIC_${index}=example`);
  fs.writeFileSync(path.join(renameRepo, '.env'), renameLines.join('\n') + '\n');
  git(renameRepo, 'add', '.env');
  git(renameRepo, '-c', 'user.name=Essai', '-c', 'user.email=essai@example.invalid', 'commit', '-qm', 'avant renommage');
  fs.renameSync(path.join(renameRepo, '.env'), path.join(renameRepo, 'notes.txt'));
  fs.appendFileSync(path.join(renameRepo, 'notes.txt'), 'PUBLIC_31=example\n');
  git(renameRepo, 'add', '--all');
  ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
});

afterAll(() => {
  unwirePeerToolBridge();
  _resetPeerRpcForTests();
  vi.restoreAllMocks();
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.oldHome;
  if (qa.oldUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.oldUserProfile;
  if (oldPath === undefined) delete process.env.PATH;
  else process.env.PATH = oldPath;
  delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
  delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
});

describe('règle générale sur les secrets suivis', () => {
  it('refuse les scripts npm de test et de build avant leur lancement', async () => {
    const marker = path.join(nested, 'npm-executed.txt');
    fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({
      scripts: {
        test: 'node -e "require(\'fs\').writeFileSync(\'npm-executed.txt\',require(\'fs\').readFileSync(\'.env\'))"',
        build: 'node -e "require(\'fs\').writeFileSync(\'npm-executed.txt\',require(\'fs\').readFileSync(\'.env\'))"',
      },
    }));
    try {
      for (const result of [
        await new TestRunnerTool().execute({ root: nested }),
        await new BuildProjectTool().execute({ root: nested }),
      ]) {
        expect(result.success).toBe(false);
        expect(JSON.stringify(result)).not.toContain(secret);
        expect(fs.existsSync(marker)).toBe(false);
      }
    } finally {
      fs.rmSync(path.join(nested, 'package.json'), { force: true });
      fs.rmSync(marker, { force: true });
    }
  });

  it('refuse aussi le terminal interactif avant la création d’une session', async () => {
    const result = await new InteractiveBashTool(null).executeInteractive('cat .env', { cwd: nested });
    expect(result.sessionId).toBe('');
    expect(result.output).toMatch(/blocked|refus/i);
    expect(result.output).not.toContain(secret);
  });

  it('refuse le serveur applicatif avant tout processus en arrière-plan', async () => {
    const marker = path.join(nested, 'server-executed.txt');
    const command = `"${process.execPath}" -e "require('fs').writeFileSync('server-executed.txt',require('fs').readFileSync('.env'))"`;
    const result = await new AppServerTool().start({
      command, cwd: nested, url: 'http://127.0.0.1:59612/', timeoutMs: 1000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credential\/secret/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  const attacks: Array<[string, (oid: string) => string]> = [
    ['1 dash', () => 'dash -c "git show > leak.txt"'],
    ['2 sh -e -c', () => 'sh -e -c "git show > leak.txt"'],
    ['3 time', () => 'time git show > leak.txt'],
    ['3 eval', () => 'eval "git show" > leak.txt'],
    ['4 taskset', () => 'taskset -c 0 git show > leak.txt'],
    ['5 xargs', () => 'printf "git show > leak.txt\\n" | xargs -I{} sh -c {}'],
    ['6 cat-file par OID', (oid) => `git cat-file -p ${oid} > leak.txt`],
    ['7 cat-file batch', (oid) => `printf '%s\\n' ${oid} | git cat-file --batch > leak.txt`],
    ['8 unpack-file', (oid) => `git unpack-file ${oid}`],
    ['9 Python subprocess', () => `python3 -c 'import subprocess;open("leak.txt","wb").write(subprocess.check_output(["git","show"]))'`],
    ['10 Python objet brut', (oid) => `python3 -c 'import zlib;open("leak.txt","wb").write(zlib.decompress(open(".git/objects/${oid.slice(0, 2)}/${oid.slice(2)}","rb").read()))'`],
    ['11 Git absolu', (oid) => `${gitPath} cat-file -p ${oid} > leak.txt`],
    ['12 alias Git', () => `git -c alias.s='!git show' s > leak.txt`],
    ['13 checkout-index', () => 'git checkout-index --prefix=out/ -- .env'],
    ['14 objets alternatifs', (oid) => `GIT_OBJECT_DIRECTORY=object-copy git cat-file -p ${oid} > leak.txt`],
    ['15 find objets', () => 'find .git/objects -type f -exec cat {} \\; > leak.txt'],
  ];

  it.each(attacks)('refuse avant spawn attaque Grok %s', async (_label, makeCommand) => {
    const oid = git(nested, 'rev-parse', 'HEAD:.env').trim();
    const command = makeCommand(oid);
    fs.rmSync(path.join(nested, 'leak.txt'), { force: true });
    fs.rmSync(path.join(nested, 'out'), { recursive: true, force: true });
    const before = fs.readdirSync(nested).sort();
    const boundary = runProtectedWorkspaceCommand(command, nested);
    expect(boundary).toMatchObject({ success: false });
    const result = await new BashTool().execute(command, 3_000, nested);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fs.existsSync(path.join(nested, 'leak.txt'))).toBe(false);
    expect(fs.existsSync(path.join(nested, 'out', '.env'))).toBe(false);
    expect(fs.readdirSync(nested).sort()).toEqual(before);
  });

  it('conserve les métadonnées et le diff public par le parent', async () => {
    for (const command of ['git status', 'git log -1 --oneline', 'git diff -- code.ts', 'cat .env.example']) {
      const result = await new BashTool().execute(command, 3_000, workspace);
      expect(result.success, command).toBe(true);
      expect(result.output).not.toContain(secret);
      if (command === 'git diff -- code.ts') expect(result.output).toContain('valeur = 2');
      if (command === 'cat .env.example') expect(result.output).toContain('PUBLIC=example');
    }
    expect((await new BashTool().execute('cat ../outside.txt', 3_000, workspace)).success).toBe(false);
  });

  it('laisse obtenir l’OID comme métadonnée sans rendre le blob lisible', async () => {
    const oid = git(nested, 'rev-parse', 'HEAD:.env').trim();
    const metadata = await new BashTool().execute('git rev-parse HEAD:.env', 3_000, nested);
    expect(metadata.success).toBe(true);
    expect(metadata.output).toContain(oid);
    const bytes = await new BashTool().execute(`git cat-file -p ${oid}`, 3_000, nested);
    expect(bytes.success).toBe(false);
    expect(JSON.stringify(bytes)).not.toContain(secret);
  });

  it('refuse la lecture directe et la lecture par lien d’un objet Git', async () => {
    const oid = git(nested, 'rev-parse', 'HEAD:.env').trim();
    const object = path.join(nested, '.git', 'objects', oid.slice(0, 2), oid.slice(2));
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const direct = await registry.execute('read_file', { path: object }, { cwd: nested });
    expect(direct.success).toBe(false);
    const link = path.join(nested, 'public-object-link');
    try {
      fs.symlinkSync(object, link, 'file');
    } catch (error) {
      if (process.platform === 'win32' &&
        ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }
    try {
      const linked = await registry.execute('read_file', { path: link }, { cwd: nested });
      expect(linked.success).toBe(false);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  it.each([
    'g\\it -C vendor/sub show > _nested.txt',
    '\\g\\i\\t -C vendor/sub show > _nested.txt',
    'gi\\t -C vendor/sub show > _nested.txt',
    'g\\i\\t -C vendor/sub show > _nested.txt',
    'env g\\it -C vendor/sub show > _nested.txt',
  ])('B12 : le shell échappé ne peut ni copier ni faire relire le blob : %s', async (command) => {
    const leak = path.join(workspace, '_nested.txt');
    fs.rmSync(leak, { force: true });
    const shell = await new BashTool().execute(command, 3_000, workspace);
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const read = fs.existsSync(leak)
      ? await registry.execute('read_file', { path: leak }, { cwd: workspace })
      : { output: '' };
    expect(JSON.stringify({ shell, read })).not.toContain(secret);
    expect(read.output).not.toContain(secret);
  });

  it('B12 : le pont pair ne rend pas une copie littérale, y compris en recherche', async () => {
    const copied = path.join(workspace, '_peer-copy.txt');
    fs.writeFileSync(copied, `NESTED_TOKEN=${secret}\n`);
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const localRead = await registry.execute('read_file', { path: copied }, { cwd: workspace });
    expect(JSON.stringify(localRead)).not.toContain(secret);
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = workspace;
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file,list_directory,search';
    vi.spyOn(getToolRegistry(), 'isFleetSafe').mockReturnValue(true);
    vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({ decision: 'allow', reason: 'Allowed' });
    _resetPeerRpcForTests();
    wirePeerToolBridge();
    const ctx = { connectionId: 'fake-peer', scopes: ['*'], traceId: 'fake-trace', depth: 0 };
    const oid = git(nested, 'rev-parse', 'HEAD:.env').trim();
    const objectPath = path.join('vendor', 'sub', '.git', 'objects', oid.slice(0, 2), oid.slice(2));
    const objectRead = await dispatchPeerRequest({
      id: 'object', method: 'peer.tool.invoke',
      params: { tool: 'view_file', args: { file_path: objectPath } },
    }, ctx);
    expect(objectRead.ok).toBe(false);
    for (const [tool, args] of [
      ['view_file', { file_path: '_peer-copy.txt' }],
      ['search', { query: secret, path: '.' }],
    ] as const) {
      const result = await dispatchPeerRequest({ id: tool, method: 'peer.tool.invoke', params: { tool, args } }, ctx);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    const chunks: string[] = [];
    const streamed = await dispatchPeerRequest({
      id: 'stream', method: 'peer.tool.invoke.stream',
      params: { tool: 'view_file', args: { file_path: '_peer-copy.txt' } },
    }, { ...ctx, emitChunk: (chunk: string) => { chunks.push(chunk); } });
    expect(JSON.stringify({ streamed, chunks })).not.toContain(secret);
  });

  it('un diff ne contenant que le secret est vide et reste une commande réussie', async () => {
    fs.writeFileSync(path.join(nested, '.env'), 'NESTED_TOKEN=FAKE-NESTED-SECOND-13\n');
    const result = await new BashTool().execute('git diff', 3_000, nested);
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('FAKE-NESTED-SECOND-13');
    expect(result.output).not.toContain('NESTED_TOKEN=');
  });

  it('omet un renommage dont l’ancien chemin était secret', async () => {
    expect(git(renameRepo, 'diff', '--cached', '--name-status')).toMatch(/^R\d+\s+\.env\s+notes\.txt/m);
    const result = await new BashTool().execute('git diff --cached', 3_000, renameRepo);
    expect(result.success).toBe(true);
    expect(result.output).not.toContain(secret);
    expect(result.output).not.toContain('TOKEN=');
  });

  it('les mutations Git explicites passent par l’outil parent sans toucher au secret', async () => {
    const before = fs.readFileSync(path.join(nested, '.env'), 'utf8');
    const tool = new GitTool(workspace);
    expect((await tool.add(['code.ts'])).success).toBe(true);
    expect((await tool.commit('modifier le code public')).success).toBe(true);
    expect(fs.readFileSync(path.join(nested, '.env'), 'utf8')).toBe(before);
    expect(git(workspace, 'show', 'HEAD:code.ts')).toContain('valeur = 2');
  });
});
