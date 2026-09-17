import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import ts from 'typescript';
import { getTemplateEngine, resetTemplateEngine } from '../../src/templates/project-scaffolding.js';
import {
  formatProvisionPlan,
  provisionDbAuth,
  typecheckProvisionedProject,
  ProvisionError,
} from '../../src/templates/db-auth/index.js';
import { databaseClientSource } from '../../src/templates/db-auth/artifacts.js';
import { registerProvisionCommands } from '../../src/commands/cli/provision-command.js';

type GeneratedAuthClient = {
  getSession: () => { accessToken: string; user: { id: string; email: string } } | null;
  fetchOwnProfile: () => Promise<{ id: string; display_name: string | null; created_at: string } | null>;
};

const SESSION_KEY = 'cb.auth.session';
const savedViteEnv: Record<string, string | undefined> = {};
const VITE_KEYS = ['VITE_DB_TARGET', 'VITE_DATABASE_URL', 'VITE_ANON_KEY'] as const;

let tmpDir: string | undefined;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-db-auth-'));
  return tmpDir;
}

function localDeps(overrides?: { commandExists?: (cmd: string) => Promise<boolean> }) {
  return {
    commandExists: overrides?.commandExists ?? (async () => {
      throw new Error('commandExists must not be called for the local target');
    }),
    env: { PATH: '/nonexistent' },
    now: () => new Date('2026-09-17T12:00:00Z'),
    randomBytes: (size: number) => Buffer.alloc(size, 7),
  };
}

function supabaseDeps(opts: { hasCli: boolean; token?: string }) {
  const env: NodeJS.ProcessEnv = { PATH: '/nonexistent' };
  if (opts.token !== undefined) {
    env.SUPABASE_ACCESS_TOKEN = opts.token;
  }
  return {
    commandExists: async (cmd: string) => cmd === 'supabase' && opts.hasCli,
    env,
    now: () => new Date('2026-09-17T12:00:00Z'),
    randomBytes: (size: number) => Buffer.alloc(size, 9),
  };
}

afterEach(async () => {
  resetTemplateEngine();
  for (const key of VITE_KEYS) {
    if (savedViteEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedViteEnv[key];
    }
    delete savedViteEnv[key];
  }
  delete (globalThis as { localStorage?: unknown }).localStorage;
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    tmpDir = undefined;
  }
});

function setViteEnv(values: { target: 'local' | 'supabase'; url: string; anonKey?: string }): void {
  for (const key of VITE_KEYS) {
    if (!(key in savedViteEnv)) {
      savedViteEnv[key] = process.env[key];
    }
  }
  process.env.VITE_DB_TARGET = values.target;
  process.env.VITE_DATABASE_URL = values.url;
  if (values.anonKey !== undefined) {
    process.env.VITE_ANON_KEY = values.anonKey;
  } else {
    delete process.env.VITE_ANON_KEY;
  }
}

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  return store;
}

async function loadGeneratedAuthClient(): Promise<GeneratedAuthClient> {
  const root = tmpDir ?? await makeTmpDir();
  const file = path.join(root, `database-client-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  const js = ts.transpileModule(databaseClientSource(), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  await fs.writeFile(file, js, 'utf8');
  return import(pathToFileURL(file).href) as Promise<GeneratedAuthClient>;
}

describe('provision db-auth', () => {
  it('simulates a full overlay by default and applies a compiling local project', async () => {
    const root = await makeTmpDir();
    const generated = await getTemplateEngine().generate({
      template: 'react-ts',
      projectName: 'demo-app',
      outputDir: root,
      variables: { description: 'Auth overlay fixture' },
      skipInstall: true,
      skipGit: true,
    });
    const projectDir = generated.projectPath;

    const dry = await provisionDbAuth({
      target: 'local',
      projectDir,
      projectName: 'demo-app',
      deps: localDeps(),
    });

    expect(dry.mode).toBe('dry-run');
    expect(dry.written).toBe(false);
    expect(dry.migrations).toEqual([
      { version: '0001_init', path: 'db/migrations/0001_init.sql', status: 'pending' },
    ]);
    const plannedPaths = dry.files.map((file) => file.path);
    expect(plannedPaths).toEqual(expect.arrayContaining([
      'db/migrations/0001_init.sql',
      'src/lib/database.ts',
      'src/auth/pages/SignIn.tsx',
      'src/auth/pages/SignUp.tsx',
      'src/auth/pages/SignOut.tsx',
      'src/auth/AuthApp.tsx',
      'docker-compose.yml',
      '.env.example',
      '.env.local',
    ]));
    expect(await fs.access(path.join(projectDir, 'src/lib/database.ts')).then(() => true, () => false)).toBe(false);

    const sql = dry.files.find((file) => file.path.endsWith('0001_init.sql'))?.content ?? '';
    expect(sql).toContain('create or replace function public.sign_up');
    expect(sql).toContain('create or replace function public.get_own_profile');
    expect(sql).toContain('grant execute on function public.get_own_profile(text) to public');
    expect(sql).toContain('create table if not exists public.profiles');
    expect(sql).not.toContain('/rest/v1/profiles');

    const envExample = dry.files.find((file) => file.path === '.env.example')?.content ?? '';
    expect(envExample).toMatch(/^VITE_DB_TARGET=$/m);
    expect(envExample).toMatch(/^POSTGRES_PASSWORD=$/m);
    expect(envExample).not.toMatch(/POSTGRES_PASSWORD=.+/);

    const secretFile = dry.files.find((file) => file.path === '.env.local');
    expect(secretFile?.secret).toBe(true);
    expect(secretFile?.content).toBeUndefined();

    const printed = formatProvisionPlan(dry);
    expect(printed).toContain('Simulation (no files written)');
    expect(printed).not.toContain('POSTGRES_PASSWORD=');

    const applied = await provisionDbAuth({
      target: 'local',
      projectDir,
      projectName: 'demo-app',
      apply: true,
      deps: localDeps(),
    });
    expect(applied.written).toBe(true);
    expect(applied.mode).toBe('apply');

    const envLocal = await fs.readFile(path.join(projectDir, '.env.local'), 'utf8');
    expect(envLocal).toContain('VITE_DB_TARGET=local');
    const password = envLocal.split('\n').find((line) => line.startsWith('POSTGRES_PASSWORD='))?.slice('POSTGRES_PASSWORD='.length) ?? '';
    expect(password.length).toBeGreaterThan(8);
    expect(formatProvisionPlan(applied)).not.toContain(password);

    const gitignore = await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env.local');

    const main = await fs.readFile(path.join(projectDir, 'src/main.tsx'), 'utf8');
    expect(main).toContain("./auth/AuthApp");
    expect(main).toContain('<AuthApp />');

    const stat = await fs.stat(path.join(projectDir, '.env.local'));
    // POSIX mode bits only: Windows reports 0o666 whatever the chmod.
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o777).toBe(0o600);
    }

    const clientSource = await fs.readFile(path.join(projectDir, 'src/lib/database.ts'), 'utf8');
    expect(clientSource).toContain('/rpc/get_own_profile');
    expect(clientSource).toContain('/rest/v1/profiles');
    const authApp = await fs.readFile(path.join(projectDir, 'src/auth/AuthApp.tsx'), 'utf8');
    expect(authApp).toContain('fetchOwnProfile');

    const check = typecheckProvisionedProject(projectDir);
    expect(check.diagnostics, check.diagnostics.join('\n')).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('refuses supabase without an access token even in simulation', async () => {
    const root = await makeTmpDir();
    const projectDir = path.join(root, 'demo-app');
    await fs.mkdir(projectDir);

    await expect(
      provisionDbAuth({
        target: 'supabase',
        projectDir,
        projectName: 'demo-app',
        deps: supabaseDeps({ hasCli: true }),
      }),
    ).rejects.toMatchObject({ code: 'MISSING_TOKEN' });
  });

  it('refuses supabase when the CLI is absent', async () => {
    const root = await makeTmpDir();
    const projectDir = path.join(root, 'demo-app');
    await fs.mkdir(projectDir);
    const token = 'sbp_test_token_value_must_not_leak_1234567890';

    await expect(
      provisionDbAuth({
        target: 'supabase',
        projectDir,
        projectName: 'demo-app',
        deps: supabaseDeps({ hasCli: false, token }),
      }),
    ).rejects.toMatchObject({ code: 'MISSING_CLI' });

    try {
      await provisionDbAuth({
        target: 'supabase',
        projectDir,
        projectName: 'demo-app',
        deps: supabaseDeps({ hasCli: false, token }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ProvisionError);
      expect((error as Error).message).not.toContain(token);
    }
  });

  it('simulates supabase when CLI and token are present without creating a remote project', async () => {
    const root = await makeTmpDir();
    const projectDir = path.join(root, 'demo-app');
    await fs.mkdir(projectDir);
    const token = 'sbp_test_token_value_must_not_leak_1234567890';

    const plan = await provisionDbAuth({
      target: 'supabase',
      projectDir,
      projectName: 'demo-app',
      deps: supabaseDeps({ hasCli: true, token }),
    });

    expect(plan.mode).toBe('dry-run');
    expect(plan.written).toBe(false);
    expect(plan.migrations[0]?.path).toBe('supabase/migrations/0001_init.sql');
    const sql = plan.files.find((file) => file.path.endsWith('0001_init.sql'))?.content ?? '';
    expect(sql).toContain('references auth.users');
    expect(sql).toContain('enable row level security');
    expect(formatProvisionPlan(plan)).not.toContain(token);
    expect(plan.warnings.some((line) => /never be created/i.test(line) || /No remote/.test(line))).toBe(true);
  });

  it('rejects an already applied init migration', async () => {
    const root = await makeTmpDir();
    const projectDir = path.join(root, 'demo-app');
    const migration = path.join(projectDir, 'db/migrations/0001_init.sql');
    await fs.mkdir(path.dirname(migration), { recursive: true });
    await fs.writeFile(migration, '-- already here\n', 'utf8');

    await expect(
      provisionDbAuth({
        target: 'local',
        projectDir,
        projectName: 'demo-app',
        deps: localDeps(),
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_APPLIED' });
  });

  it('rejects an invalid project name', async () => {
    const root = await makeTmpDir();
    await expect(
      provisionDbAuth({
        target: 'local',
        projectDir: path.join(root, 'x'),
        projectName: 'My App',
        deps: localDeps(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_NAME' });

    await expect(
      provisionDbAuth({
        target: 'local',
        projectDir: path.join(root, 'x'),
        projectName: '../etc',
        deps: localDeps(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });

  it('exposes a simulation CLI that does not write', async () => {
    const root = await makeTmpDir();
    const projectDir = path.join(root, 'cli-app');
    await fs.mkdir(projectDir);

    const program = new Command();
    program.exitOverride();
    registerProvisionCommands(program);

    await program.parseAsync(
      ['provision', 'db-auth', '--target', 'local', '--dir', projectDir, '--name', 'cli-app'],
      { from: 'user' },
    );

    expect(await fs.access(path.join(projectDir, 'docker-compose.yml')).then(() => true, () => false)).toBe(false);
    expect(await fs.access(path.join(projectDir, '.env.local')).then(() => true, () => false)).toBe(false);
  });

  it('applies supabase overlay with a simulated CLI executor without network or a remote project', async () => {
    const root = await makeTmpDir();
    const projectDir = path.join(root, 'demo-app');
    await fs.mkdir(projectDir);
    const token = 'sbp_test_token_value_must_not_leak_1234567890';
    const cliCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error('network is forbidden in provision tests');
    }) as typeof fetch;

    try {
      const applied = await provisionDbAuth({
        target: 'supabase',
        projectDir,
        projectName: 'demo-app',
        apply: true,
        deps: {
          ...supabaseDeps({ hasCli: true, token }),
          commandExists: async (cmd: string) => {
            cliCalls.push(cmd);
            return cmd === 'supabase';
          },
        },
      });

      expect(applied.written).toBe(true);
      expect(applied.mode).toBe('apply');
      expect(applied.files).toHaveLength(13);
      expect(cliCalls).toEqual(['supabase']);
      expect(fetchCalls).toEqual([]);
      expect(formatProvisionPlan(applied)).not.toContain(token);

      const expectedPaths = [
        'supabase/migrations/0001_init.sql',
        'src/lib/database.ts',
        'src/auth/AuthApp.tsx',
        'src/auth/pages/SignIn.tsx',
        'src/auth/pages/SignUp.tsx',
        'src/auth/pages/SignOut.tsx',
        'src/auth/README.md',
        'src/main.tsx',
        '.gitignore',
        '.env.example',
        '.env.local',
        'src/index.css',
        'supabase/README.md',
      ];
      expect(applied.files.map((file) => file.path)).toEqual(expectedPaths);
      for (const relative of expectedPaths) {
        await fs.access(path.join(projectDir, relative));
      }

      const sql = await fs.readFile(path.join(projectDir, 'supabase/migrations/0001_init.sql'), 'utf8');
      expect(sql).toContain('references auth.users');
      expect(sql).toContain('enable row level security');
      expect(sql).toContain('create policy profiles_select_own');
      expect(sql).toContain('grant select, insert, update on table public.profiles to authenticated');
      expect(sql).toContain('create trigger on_auth_user_created');

      const envLocal = await fs.readFile(path.join(projectDir, '.env.local'), 'utf8');
      expect(envLocal).toContain('VITE_DB_TARGET=supabase');
      expect(envLocal).not.toContain(token);

      const check = typecheckProvisionedProject(projectDir);
      expect(check.diagnostics, check.diagnostics.join('\n')).toEqual([]);
      expect(check.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.skipIf(process.platform === 'win32')(
    'chmods an already-existing .env.local from world-readable to 0600',
    async () => {
      const root = await makeTmpDir();
      const projectDir = path.join(root, 'demo-app');
      await fs.mkdir(projectDir);
      const envPath = path.join(projectDir, '.env.local');
      await fs.writeFile(envPath, 'OLD_SECRET=please-overwrite\n', { encoding: 'utf8', mode: 0o644 });
      await fs.chmod(envPath, 0o644);
      expect((await fs.stat(envPath)).mode & 0o777).toBe(0o644);

      await provisionDbAuth({
        target: 'local',
        projectDir,
        projectName: 'demo-app',
        apply: true,
        deps: localDeps(),
      });

      const stat = await fs.stat(envPath);
      expect(stat.mode & 0o777).toBe(0o600);
      const body = await fs.readFile(envPath, 'utf8');
      expect(body).toContain('VITE_DB_TARGET=local');
      expect(body).not.toContain('OLD_SECRET');
    },
  );

  it('fetchOwnProfile uses PostgREST rpc locally and /rest/v1 on supabase (mocked fetch, no network)', async () => {
    const source = databaseClientSource();
    expect(source).toContain('/rpc/get_own_profile');
    expect(source).toContain('/rest/v1/profiles');
    expect(source).toContain("target === 'supabase'");

    const store = installMemoryStorage();
    store.set(
      SESSION_KEY,
      JSON.stringify({
        accessToken: 'opaque-local-session-token',
        user: { id: '11111111-1111-1111-1111-111111111111', email: 'ada@example.com' },
      }),
    );

    const calls: { url: string; method: string; body: string | null }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://') === false && url.startsWith('https://') === false) {
        throw new Error(`unexpected non-http fetch: ${url}`);
      }
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : init?.body ? JSON.stringify(init.body) : null,
      });
      if (url.endsWith('/rpc/get_own_profile')) {
        return new Response(
          JSON.stringify({
            id: '11111111-1111-1111-1111-111111111111',
            display_name: 'ada',
            created_at: '2026-09-18T00:00:00.000Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/rest/v1/profiles')) {
        return new Response(
          JSON.stringify([
            {
              id: '11111111-1111-1111-1111-111111111111',
              display_name: 'ada',
              created_at: '2026-09-18T00:00:00.000Z',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    try {
      const client = await loadGeneratedAuthClient();

      setViteEnv({ target: 'local', url: 'http://127.0.0.1:3001' });
      const localProfile = await client.fetchOwnProfile();
      expect(localProfile).toEqual({
        id: '11111111-1111-1111-1111-111111111111',
        display_name: 'ada',
        created_at: '2026-09-18T00:00:00.000Z',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('http://127.0.0.1:3001/rpc/get_own_profile');
      expect(calls[0]?.method).toBe('POST');
      expect(calls[0]?.body).toContain('opaque-local-session-token');
      expect(calls[0]?.url).not.toContain('/rest/v1/');

      store.set(
        SESSION_KEY,
        JSON.stringify({
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.supabase-test',
          user: { id: '11111111-1111-1111-1111-111111111111', email: 'ada@example.com' },
        }),
      );
      setViteEnv({
        target: 'supabase',
        url: 'https://example.supabase.invalid',
        anonKey: 'anon-test-key',
      });
      const hostedProfile = await client.fetchOwnProfile();
      expect(hostedProfile).toEqual({
        id: '11111111-1111-1111-1111-111111111111',
        display_name: 'ada',
        created_at: '2026-09-18T00:00:00.000Z',
      });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.url).toBe(
        'https://example.supabase.invalid/rest/v1/profiles?id=eq.11111111-1111-1111-1111-111111111111&select=id,display_name,created_at',
      );
      expect(calls[1]?.method).toBe('GET');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
