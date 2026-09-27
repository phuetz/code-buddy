/**
 * Bloquant n°1 de l'audit sécurité 2.3.0 : la liste blanche d'isolation
 * laissait les outils de l'agent lire ~/.codebuddy/codex-auth.json (jetons
 * OAuth) et les autres fichiers d'identifiants, sans confirmation.
 *
 * Chaque outil tente ici de lire le fichier de jeton d'un HOME ISOLÉ fabriqué
 * (_qa/securite-2-3-0/home, faux jetons) : refus attendu. Les usages
 * légitimes (config non secrète) continuent de marcher.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

const QA = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-2-3-0`;
  const home = `${root}/home`;
  const previousHome = process.env.HOME;
  // Must be set before any module computes os.homedir() at import time.
  process.env.HOME = home;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home, work: `${root}/work`, previousHome };
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  WorkspaceIsolation,
  getWorkspaceIsolation,
  resetWorkspaceIsolation,
} from '../../src/workspace/workspace-isolation.js';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { SearchTool } from '../../src/tools/search.js';
import { validateCommand } from '../../src/tools/bash/command-validator.js';
import { classifySecretPath } from '../../src/security/secret-files.js';
import { OcrExtractTool } from '../../src/tools/registry/vision-tools.js';
import {
  wirePeerToolBridge,
  unwirePeerToolBridge,
  _unwireForTests,
} from '../../src/fleet/peer-tool-bridge.js';
import {
  dispatchPeerRequest,
  _resetPeerRpcForTests,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import { getToolRegistry } from '../../src/tools/registry.js';

const FAKE_TOKEN = 'FAKE-OAUTH-TOKEN-qa-securite-2-3-0';
const HOME = QA.home;
const CB = path.join(HOME, '.codebuddy');
const TOKEN_FILE = path.join(CB, 'codex-auth.json');
const WORK = QA.work;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  fs.rmSync(QA.root, { recursive: true, force: true });
  write(TOKEN_FILE, JSON.stringify({ access_token: FAKE_TOKEN, refresh_token: FAKE_TOKEN }));
  write(path.join(CB, 'server.env'), `JWT_SECRET=${FAKE_TOKEN}\n`);
  write(path.join(CB, 'mcp-tokens.json'), JSON.stringify({ t: FAKE_TOKEN }));
  write(path.join(CB, 'xai-auth.json'), JSON.stringify({ t: FAKE_TOKEN }));
  write(path.join(CB, 'skill-signing', 'key.pem'), `-----BEGIN PRIVATE KEY-----\n${FAKE_TOKEN}\n`);
  write(path.join(CB, 'settings.json'), JSON.stringify({ model: 'qa-model' }));
  write(path.join(CB, 'provider-health.json'), JSON.stringify({ ok: true }));
  write(path.join(CB, 'models', 'buddy-memory', 'tokenizer.json'), '{"vocab":{}}');
  write(path.join(WORK, 'README.md'), `# projet\nclé publique ${FAKE_TOKEN.slice(0, 4)}\n`);
  write(path.join(WORK, 'deploy', 'prod.env'), `API_KEY=${FAKE_TOKEN}\n`);
  write(path.join(WORK, '.env.example'), 'API_KEY=\n');
  write(path.join(WORK, '.env'), `API_KEY=${FAKE_TOKEN}\n`);
  write(path.join(WORK, 'notes.md'), `mention ${FAKE_TOKEN} dans un fichier ordinaire\n`);
  fs.symlinkSync(TOKEN_FILE, path.join(WORK, 'innocent.txt'));
  fs.mkdirSync(path.join(WORK, 'cfg'), { recursive: true });
  fs.symlinkSync(TOKEN_FILE, path.join(WORK, 'cfg', 'data.json'));
});

afterAll(() => {
  fs.rmSync(QA.root, { recursive: true, force: true });
  if (QA.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = QA.previousHome;
});

afterEach(() => {
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  resetWorkspaceIsolation();
});

describe('HOME isolé', () => {
  it('le test tourne bien sur le HOME fabriqué, jamais sur le vrai', () => {
    expect(os.homedir()).toBe(HOME);
    expect(HOME).toContain(path.join('_qa', 'securite-2-3-0', 'home'));
  });
});

describe('WorkspaceIsolation — la liste de refus passe avant la liste blanche', () => {
  const iso = () => new WorkspaceIsolation({ workspaceRoot: WORK, logBlockedAccess: false });

  it.each([
    TOKEN_FILE,
    path.join(CB, 'server.env'),
    path.join(CB, 'mcp-tokens.json'),
    path.join(CB, 'xai-auth.json'),
    path.join(CB, 'skill-signing', 'key.pem'),
  ])('refuse la lecture de %s', (file) => {
    const result = iso().validatePath(file, 'test read');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('secret_file');
  });

  it.each([
    path.join(CB, 'settings.json'),
    path.join(CB, 'provider-health.json'),
    path.join(CB, 'models', 'buddy-memory', 'tokenizer.json'),
  ])('laisse lire la configuration non secrète %s', (file) => {
    expect(iso().validatePath(file, 'test read').valid).toBe(true);
  });

  it("la liste blanche système est en lecture seule : écrire dans ~/.codebuddy est refusé, /tmp reste inscriptible", () => {
    const result = iso().validatePath(path.join(CB, 'settings.json'), 'test write', 'write');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('read_only_path');
    expect(iso().validatePath(path.join(os.tmpdir(), 'qa-ecriture.txt'), 'test write', 'write').valid).toBe(true);
  });

  it('refuse le jeton même quand le workspace EST le HOME', () => {
    const homeIso = new WorkspaceIsolation({ workspaceRoot: HOME, logBlockedAccess: false });
    expect(homeIso.validatePath(TOKEN_FILE).valid).toBe(false);
    expect(homeIso.validatePath(TOKEN_FILE, 'w', 'write').valid).toBe(false);
    expect(homeIso.validatePath(path.join(CB, 'settings.json')).valid).toBe(true);
  });

  it('refuse un lien symbolique du workspace vers le jeton', () => {
    const result = iso().validatePath(path.join(WORK, 'innocent.txt'));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('secret_file');
  });

  it('refuse le jeton même avec --allow-outside (isolation désactivée)', () => {
    const off = new WorkspaceIsolation({ workspaceRoot: WORK, enabled: false, logBlockedAccess: false });
    expect(off.validatePath(TOKEN_FILE).valid).toBe(false);
    expect(off.validatePath(path.join(CB, 'settings.json')).valid).toBe(true);
  });

  it("n'autorise la lecture qu'avec le consentement explicite de l'opérateur", () => {
    process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ = 'true';
    expect(iso().validatePath(TOKEN_FILE).valid).toBe(true);
  });

  it('.env du projet : lecture refusée, modèle .env.example lisible, création autorisée', () => {
    expect(iso().validatePath(path.join(WORK, '.env')).valid).toBe(false);
    expect(iso().validatePath(path.join(WORK, '.env.example')).valid).toBe(true);
    expect(iso().validatePath(path.join(WORK, '.env'), 'create', 'write').valid).toBe(true);
  });
});

describe('view_file (TextEditorTool) sur le HOME isolé', () => {
  function editor(): TextEditorTool {
    getWorkspaceIsolation({ workspaceRoot: WORK, enabled: true });
    const tool = new TextEditorTool();
    tool.setBaseDirectory(WORK);
    return tool;
  }

  it('refuse de lire codex-auth.json et ne renvoie aucun octet du jeton', async () => {
    const result = await editor().view(TOKEN_FILE);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it('refuse de lire le jeton à travers un lien symbolique du projet', async () => {
    const result = await editor().view(path.join(WORK, 'innocent.txt'));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it('refuse le jeton même isolation coupée (repli VFS)', async () => {
    getWorkspaceIsolation({ workspaceRoot: WORK, enabled: false });
    const tool = new TextEditorTool();
    tool.setBaseDirectory(HOME);
    const result = await tool.view(TOKEN_FILE);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it('lit toujours settings.json', async () => {
    const result = await editor().view(path.join(CB, 'settings.json'));
    expect(result.success).toBe(true);
    expect(result.output).toContain('qa-model');
  });

  it("refuse d'écraser settings.json par create (liste blanche en lecture seule)", async () => {
    const result = await editor().create(path.join(CB, 'settings.json'), '{"model":"pirate"}');
    expect(result.success).toBe(false);
    expect(fs.readFileSync(path.join(CB, 'settings.json'), 'utf-8')).toContain('qa-model');
  });
});

describe('search (ripgrep) sur un projet qui contient des secrets', () => {
  it("ne renvoie aucune ligne d'un fichier secret, mais trouve le fichier ordinaire", async () => {
    const search = new SearchTool();
    search.setCurrentDirectory(WORK);
    const result = await search.search(FAKE_TOKEN, { searchType: 'text', includeHidden: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain('notes.md');
    expect(result.output).not.toContain('prod.env');
    expect(result.output).not.toMatch(/data\.json|innocent\.txt|\.env\b/);
  });
});

describe('bash : le validateur voit ~, $HOME et ${HOME}', () => {
  it.each([
    'cat ~/.codebuddy/codex-auth.json',
    'cat $HOME/.codebuddy/codex-auth.json',
    'cat "${HOME}/.codebuddy/server.env"',
    `cat ${TOKEN_FILE}`,
    'cd ~/.codebuddy && cat codex-auth.json',
    'grep -r token ~/.codebuddy',
    'cat ~/.codebuddy/*.json',
    'base64 $HOME/.codebuddy/skill-signing/key.pem',
    'cat $HOME/.ssh/id_rsa',
    'cat ${HOME}/.aws/credentials',
  ])('refuse « %s »', (command) => {
    expect(validateCommand(command).valid).toBe(false);
  });

  it.each([
    'cat ~/.codebuddy/settings.json',
    'ls ~/.codebuddy',
    'cp .env.example .env',
    'echo $HOME',
    'npm test -- tests/security',
    'git status',
  ])('laisse passer « %s »', (command) => {
    expect(validateCommand(command)).toEqual(expect.objectContaining({ valid: true }));
  });
});

describe('lecture d’images (ocr_extract)', () => {
  it('refuse de passer le jeton au moteur OCR', async () => {
    const result = await new OcrExtractTool().execute({ image_path: TOKEN_FILE });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credential\/secret file/);
  });
});

describe('peer.tool.invoke avec une racine exposée = HOME', () => {
  const ctx: PeerMethodContext = {
    connectionId: 'peer-qa',
    scopes: ['*'],
    traceId: 'trace-qa',
    depth: 0,
  };

  afterEach(() => {
    unwirePeerToolBridge();
    _unwireForTests();
    delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    delete process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST;
    vi.restoreAllMocks();
  });

  async function invoke(tool: string, args: Record<string, unknown>) {
    vi.spyOn(getToolRegistry(), 'isFleetSafe').mockReturnValue(true);
    vi.spyOn(PolicyEngine.getInstance(), 'evaluate').mockReturnValue({ decision: 'allow', reason: 'Allowed' });
    _resetPeerRpcForTests();
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = HOME;
    process.env.CODEBUDDY_PEER_TOOL_ALLOWLIST = 'view_file,search';
    wirePeerToolBridge();
    return dispatchPeerRequest({ id: `req-${tool}`, method: 'peer.tool.invoke', params: { tool, args } }, ctx);
  }

  it('view_file du jeton : refus', async () => {
    const res = await invoke('view_file', { file_path: '.codebuddy/codex-auth.json' });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(FAKE_TOKEN);
  });

  it('search ciblant le fichier du jeton : refus', async () => {
    const res = await invoke('search', { query: 'access_token', path: '.codebuddy/codex-auth.json' });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(FAKE_TOKEN);
  });

  it('view_file de settings.json : autorisé', async () => {
    const res = await invoke('view_file', { file_path: '.codebuddy/settings.json' });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res)).toContain('qa-model');
  });
});

describe('classifySecretPath — ce qui n’est pas un secret', () => {
  it.each(['keybindings.json', 'authored-tools.json', 'trusted-keys.json', 'tokenizer.json', 'provider-health.json'])(
    '%s sous ~/.codebuddy reste lisible',
    (name) => {
      expect(classifySecretPath(path.join(CB, name)).secret).toBe(false);
    },
  );
});
