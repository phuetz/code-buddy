import { randomBytes as nodeRandomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { commandExists as hostCommandExists } from '../../utils/command-exists.js';
import { logger } from '../../utils/logger.js';
import {
  authAppSource,
  databaseClientSource,
  dbReadme,
  defaultIndexCss,
  dockerComposeYaml,
  INIT_MIGRATION_VERSION,
  localInitSql,
  mergeEnvExample,
  mergeGitignore,
  migrationRelativePath,
  signInPageSource,
  signOutPageSource,
  signUpPageSource,
  supabaseInitSql,
  wireMainTsx,
} from './artifacts.js';
import { assertProjectName } from './project-name.js';
import {
  ProvisionError,
  type PlannedFile,
  type ProvisionDeps,
  type ProvisionOptions,
  type ProvisionPlan,
  type ProvisionTarget,
} from './types.js';

export const DEFAULT_TOKEN_ENV = 'SUPABASE_ACCESS_TOKEN';
export const FALLBACK_TOKEN_ENV = 'CODEBUDDY_SUPABASE_ACCESS_TOKEN';
export const DEFAULT_SUPABASE_CLI = 'supabase';

const FORBIDDEN_ROOTS = new Set([
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/var',
  '/dev',
  '/proc',
  '/sys',
  '/run',
  '/boot',
]);

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function resolveDeps(partial?: Partial<ProvisionDeps>): ProvisionDeps {
  return {
    commandExists: partial?.commandExists ?? ((command) => hostCommandExists(command)),
    env: partial?.env ?? process.env,
    now: partial?.now ?? (() => new Date()),
    randomBytes: partial?.randomBytes ?? nodeRandomBytes,
  };
}

export function resolveAccessToken(
  env: NodeJS.ProcessEnv,
  tokenEnvVar = DEFAULT_TOKEN_ENV,
): { present: boolean; envVar: string } {
  const names = [tokenEnvVar, FALLBACK_TOKEN_ENV];
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') {
      return { present: true, envVar: name };
    }
  }
  return { present: false, envVar: tokenEnvVar };
}

function assertSafeProjectDir(projectDir: string): string {
  if (!path.isAbsolute(projectDir)) {
    throw new ProvisionError('UNSAFE_DIR', 'projectDir must be an absolute path');
  }
  const resolved = path.resolve(projectDir);
  const parsed = path.parse(resolved);
  if (FORBIDDEN_ROOTS.has(resolved) || resolved === parsed.root) {
    throw new ProvisionError('UNSAFE_DIR', `Refusing to provision into system path: ${resolved}`);
  }
  return resolved;
}

function localEnvLocalContent(password: string, jwtSecret: string): string {
  return [
    'VITE_DB_TARGET=local',
    'VITE_DATABASE_URL=http://127.0.0.1:3001',
    'VITE_ANON_KEY=local-dev-anon',
    'POSTGRES_USER=app',
    `POSTGRES_PASSWORD=${password}`,
    'POSTGRES_DB=app',
    'POSTGRES_PORT=5432',
    'POSTGREST_PORT=3001',
    `PGRST_DB_URI=postgres://app:${encodeURIComponent(password)}@postgres:5432/app`,
    `PGRST_JWT_SECRET=${jwtSecret}`,
    '',
  ].join('\n');
}

function supabaseEnvLocalContent(): string {
  return [
    'VITE_DB_TARGET=supabase',
    'VITE_DATABASE_URL=',
    'VITE_ANON_KEY=',
    '',
  ].join('\n');
}

function file(
  relativePath: string,
  content: string,
  extra?: { secret?: boolean; executable?: boolean; action?: 'create' | 'update' },
): PlannedFile {
  if (extra?.secret) {
    return { path: relativePath, action: extra.action ?? 'create', secret: true };
  }
  return {
    path: relativePath,
    action: extra?.action ?? 'create',
    content,
    ...(extra?.executable ? { executable: true } : {}),
  };
}

function nextSteps(target: ProvisionTarget, apply: boolean): string[] {
  if (!apply) {
    return [
      'Re-run with --apply to write these files (still no remote project, still no docker start).',
      'Keys are never printed; .env.local is gitignored.',
    ];
  }
  if (target === 'supabase') {
    return [
      'Create the hosted project yourself (dashboard). This command never creates it.',
      'Put VITE_DATABASE_URL and VITE_ANON_KEY in .env.local.',
      'Apply supabase/migrations/0001_init.sql with your supabase CLI or the SQL editor.',
    ];
  }
  return [
    'docker compose up -d  (not started by this command)',
    'npm run dev — sign-up / sign-in / sign-out pages are mounted from src/auth/AuthApp.tsx',
  ];
}

export async function buildProvisionPlan(options: ProvisionOptions): Promise<ProvisionPlan> {
  const target = options.target;
  if (target !== 'supabase' && target !== 'local') {
    throw new ProvisionError('INVALID_TARGET', 'target must be supabase or local');
  }

  const projectName = assertProjectName(options.projectName);
  const projectDir = assertSafeProjectDir(options.projectDir);
  const deps = resolveDeps(options.deps);
  const apply = options.apply === true;
  const cliName = options.supabaseCli ?? DEFAULT_SUPABASE_CLI;
  const tokenEnvVar = options.tokenEnvVar ?? DEFAULT_TOKEN_ENV;

  if (target === 'supabase') {
    const token = resolveAccessToken(deps.env, tokenEnvVar);
    if (!token.present) {
      throw new ProvisionError(
        'MISSING_TOKEN',
        `Supabase access token missing. Set ${tokenEnvVar} (or ${FALLBACK_TOKEN_ENV}) in the environment; do not pass the value on the command line.`,
      );
    }
    const hasCli = await deps.commandExists(cliName);
    if (!hasCli) {
      throw new ProvisionError(
        'MISSING_CLI',
        `Supabase CLI "${cliName}" was not found on PATH. Install it locally; Code Buddy will not download it or create a remote project.`,
      );
    }
  }

  const migrationPath = migrationRelativePath(target);
  const migrationAbs = path.join(projectDir, ...migrationPath.split('/'));
  if (await pathExists(migrationAbs)) {
    throw new ProvisionError(
      'MIGRATION_APPLIED',
      `Migration ${INIT_MIGRATION_VERSION} already present at ${migrationPath}`,
    );
  }

  const existingGitignore = await readText(path.join(projectDir, '.gitignore'));
  const existingEnvExample = await readText(path.join(projectDir, '.env.example'));
  const existingMain = await readText(path.join(projectDir, 'src', 'main.tsx'));
  const existingCss = await readText(path.join(projectDir, 'src', 'index.css'));

  const files: PlannedFile[] = [
    file(migrationPath, target === 'supabase' ? supabaseInitSql() : localInitSql()),
    file('src/lib/database.ts', databaseClientSource()),
    file('src/auth/AuthApp.tsx', authAppSource()),
    file('src/auth/pages/SignIn.tsx', signInPageSource()),
    file('src/auth/pages/SignUp.tsx', signUpPageSource()),
    file('src/auth/pages/SignOut.tsx', signOutPageSource()),
    file('src/auth/README.md', dbReadme(target)),
    file('src/main.tsx', wireMainTsx(existingMain), {
      action: existingMain ? 'update' : 'create',
    }),
    file('.gitignore', mergeGitignore(existingGitignore), {
      action: existingGitignore ? 'update' : 'create',
    }),
    file('.env.example', mergeEnvExample(existingEnvExample, target), {
      action: existingEnvExample ? 'update' : 'create',
    }),
    file('.env.local', '', { secret: true }),
  ];

  if (!existingCss) {
    files.push(file('src/index.css', defaultIndexCss()));
  }

  if (target === 'local') {
    files.push(file('docker-compose.yml', dockerComposeYaml()));
    files.push(file('db/README.md', dbReadme('local')));
  } else {
    files.push(file('supabase/README.md', dbReadme('supabase')));
  }

  const warnings: string[] = [];
  if (target === 'supabase') {
    warnings.push('No remote Supabase project will be created. Token is used only as a presence check.');
  } else {
    warnings.push('Local compose file is written; containers are not started.');
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    target,
    projectName,
    projectDir,
    files,
    migrations: [{ version: INIT_MIGRATION_VERSION, path: migrationPath, status: 'pending' }],
    warnings,
    nextSteps: nextSteps(target, apply),
    written: false,
  };
}

async function writePlan(plan: ProvisionPlan, secretContents: Map<string, string>): Promise<void> {
  await fs.mkdir(plan.projectDir, { recursive: true });
  for (const item of plan.files) {
    const abs = path.resolve(plan.projectDir, item.path);
    if (!abs.startsWith(`${plan.projectDir}${path.sep}`) && abs !== plan.projectDir) {
      throw new ProvisionError('UNSAFE_DIR', `Refusing to write outside projectDir: ${item.path}`);
    }
    try {
      const lst = await fs.lstat(abs);
      if (lst.isSymbolicLink()) {
        const real = await fs.realpath(abs).catch(() => null);
        const realRoot = await fs.realpath(plan.projectDir);
        if (!real || (!real.startsWith(`${realRoot}${path.sep}`) && real !== realRoot)) {
          throw new ProvisionError('UNSAFE_DIR', `Refusing to write through symlink escaping projectDir: ${item.path}`);
        }
      }
    } catch (err) {
      if (err instanceof ProvisionError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const body = item.secret ? secretContents.get(item.path) ?? '' : item.content ?? '';
    const mode = item.secret ? 0o600 : item.executable ? 0o755 : 0o644;
    await fs.writeFile(abs, body, { encoding: 'utf8', mode });
    // writeFile({ mode }) only applies to newly created files; chmod the existing case too.
    if (item.secret) {
      await fs.chmod(abs, 0o600);
    } else if (item.executable) {
      await fs.chmod(abs, 0o755);
    }
  }
}

/**
 * Plan (default) or write a database + auth overlay for a generated web project.
 * Never creates a remote project and never logs secret values.
 */
export async function provisionDbAuth(options: ProvisionOptions): Promise<ProvisionPlan> {
  const plan = await buildProvisionPlan(options);
  const secretContents = new Map<string, string>();

  if (options.apply === true) {
    const deps = resolveDeps(options.deps);
    for (const item of plan.files) {
      if (!item.secret) continue;
      if (plan.target === 'local') {
        secretContents.set(
          item.path,
          localEnvLocalContent(
            deps.randomBytes(24).toString('base64url'),
            deps.randomBytes(32).toString('base64url'),
          ),
        );
      } else {
        secretContents.set(item.path, supabaseEnvLocalContent());
      }
    }
    await writePlan(plan, secretContents);
    logger.info(`provision db-auth: wrote ${plan.files.length} files for ${plan.projectName} (${plan.target})`);
    return { ...plan, written: true };
  }

  logger.info(`provision db-auth: dry-run ${plan.files.length} files for ${plan.projectName} (${plan.target})`);
  return plan;
}

export function formatProvisionPlan(plan: ProvisionPlan): string {
  const lines: string[] = [
    plan.mode === 'dry-run'
      ? 'Simulation (no files written)'
      : `Wrote ${plan.files.length} files`,
    `Target: ${plan.target}`,
    `Project: ${plan.projectName}`,
    `Directory: ${plan.projectDir}`,
    'Migrations:',
  ];
  for (const migration of plan.migrations) {
    lines.push(`  - ${migration.path}  (${migration.status}, version ${migration.version})`);
  }
  lines.push('Files:');
  for (const item of plan.files) {
    const secretMark = item.secret ? '  [secrets omitted]' : '';
    lines.push(`  - ${item.action.padEnd(6)} ${item.path}${secretMark}`);
  }
  if (plan.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of plan.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  lines.push('Next:');
  for (const step of plan.nextSteps) {
    lines.push(`  - ${step}`);
  }
  return lines.join('\n');
}

export function assertNoSecretLeak(haystack: string, env: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 8) continue;
    if (!/(TOKEN|SECRET|PASSWORD|KEY)/i.test(key)) continue;
    if (haystack.includes(value)) {
      throw new Error(`Refusing to print secret from ${key}`);
    }
  }
}
