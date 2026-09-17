/**
 * One-click web publish: build → check output → wrangler/netlify CLI.
 *
 * Default is dry-run (plan only, nothing uploaded). Official CLIs are used
 * when already present; this module never downloads or installs them.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import { loadOneClickConfig, resolveInside, sanitizeProjectName } from './one-click-config.js';
import { redactSecrets, resolveFirstSecret } from './one-click-tokens.js';
import {
  CLOUDFLARE_TOKEN_VARS,
  NETLIFY_TOKEN_VARS,
  type OneClickDeps,
  type OneClickDeployConfig,
  type OneClickExecFile,
  type OneClickFs,
  type OneClickReport,
  type OneClickRollback,
  type OneClickRunRequest,
  type OneClickStep,
  type OneClickTarget,
} from './one-click-types.js';

const execFileAsync = promisify(execFileCb);

const CLI_CANDIDATES: Record<OneClickTarget, string[]> = {
  'cloudflare-pages': ['wrangler'],
  netlify: ['netlify', 'netlify-cli'],
};

function defaultFs(): OneClickFs {
  return {
    readFile: (filePath, encoding) => nodeFs.readFile(filePath, encoding),
    stat: (filePath) => nodeFs.stat(filePath),
    mkdir: (dirPath, options) => nodeFs.mkdir(dirPath, options).then(() => undefined),
    appendFile: (filePath, data) => nodeFs.appendFile(filePath, data),
    realpath: (filePath) => nodeFs.realpath(filePath),
  };
}

function defaultExecFile(): OneClickExecFile {
  return async (file, args, options) => {
    try {
      const result = await execFileAsync(file, [...args], {
        cwd: options?.cwd,
        env: options?.env as NodeJS.ProcessEnv | undefined,
        timeout: options?.timeout ?? 15 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), code: 0 };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: String(err.stdout ?? ''),
        stderr: String(err.stderr ?? err.message ?? ''),
        code: typeof err.code === 'number' ? err.code : 1,
      };
    }
  };
}

function whichCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'where' : 'which';
}

function npmCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function defaultWhich(
  command: string,
  execFile: OneClickExecFile,
  platform: NodeJS.Platform,
): Promise<string | null> {
  try {
    const result = await execFile(whichCommand(platform), [command]);
    if (result.code !== 0) return null;
    const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

async function detectCli(
  projectRoot: string,
  target: OneClickTarget,
  fsImpl: OneClickFs,
  whichFn: (command: string) => Promise<string | null>,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const binDir = path.join(projectRoot, 'node_modules', '.bin');
  for (const name of CLI_CANDIDATES[target]) {
    const local = path.join(binDir, platform === 'win32' ? `${name}.cmd` : name);
    try {
      const st = await fsImpl.stat(local);
      if (st.isFile()) return local;
    } catch {
      /* absent */
    }
    const found = await whichFn(name);
    if (found) return found;
  }
  return null;
}

function missingCliMessage(target: OneClickTarget): string {
  if (target === 'cloudflare-pages') {
    return 'wrangler is not installed. Install Cloudflare Wrangler locally in the project (npm i -D wrangler) — Code Buddy will not download or install it.';
  }
  return 'netlify CLI is not installed. Install it locally in the project (npm i -D netlify-cli) — Code Buddy will not download or install it.';
}

function missingTokenMessage(target: OneClickTarget): string {
  if (target === 'cloudflare-pages') {
    return 'Missing Cloudflare token. Set CLOUDFLARE_API_TOKEN (or CF_API_TOKEN) in the environment or `buddy secrets set CLOUDFLARE_API_TOKEN <value>`. The value is never written to the project.';
  }
  return 'Missing Netlify token. Set NETLIFY_AUTH_TOKEN in the environment or `buddy secrets set NETLIFY_AUTH_TOKEN <value>`. The value is never written to the project.';
}

function tokenNames(target: OneClickTarget): readonly string[] {
  return target === 'cloudflare-pages' ? CLOUDFLARE_TOKEN_VARS : NETLIFY_TOKEN_VARS;
}

export function buildUploadArgs(
  target: OneClickTarget,
  config: OneClickDeployConfig,
  outputDir: string,
): { file: string; args: string[]; envExtras: Record<string, string> } {
  const envExtras: Record<string, string> = {};
  if (target === 'cloudflare-pages') {
    const name = sanitizeProjectName(config.projectName || 'site');
    const args = ['pages', 'deploy', outputDir, '--project-name', name, '--commit-dirty=true'];
    if (config.accountId) envExtras.CLOUDFLARE_ACCOUNT_ID = config.accountId;
    return { file: 'wrangler', args, envExtras };
  }
  const args = ['deploy', '--dir', outputDir, '--prod', '--json'];
  if (config.siteId) envExtras.NETLIFY_SITE_ID = config.siteId;
  return { file: 'netlify', args, envExtras };
}

export function parseDeployOutput(target: OneClickTarget, combined: string): { url?: string; deployId?: string } {
  const jsonMatch = combined.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const url =
        pickString(obj, ['url', 'ssl_url', 'deploy_ssl_url', 'deploy_url', 'preview_url']) ??
        undefined;
      const deployId =
        pickString(obj, ['deploy_id', 'id', 'deployment_id', 'deploymentId']) ?? undefined;
      if (url || deployId) return { url, deployId };
    } catch {
      /* fall through to regex */
    }
  }
  const url = combined.match(/https?:\/\/[^\s)'"`]+/i)?.[0]?.replace(/[.,;]+$/, '');
  const idMatch =
    combined.match(/Deployment\s+ID[:\s]+([A-Za-z0-9_-]+)/i) ||
    combined.match(/deploy[_-]?id[:\s"]+([A-Za-z0-9_-]+)/i);
  return { url, deployId: idMatch?.[1] };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function rollbackFor(
  target: OneClickTarget,
  config: OneClickDeployConfig,
  previousDeployId?: string,
): OneClickRollback {
  const name = sanitizeProjectName(config.projectName || 'site');
  if (target === 'cloudflare-pages') {
    const commands = [
      `wrangler pages deployment list --project-name ${name}`,
      previousDeployId
        ? `wrangler pages deployment rollback ${previousDeployId} --project-name ${name}`
        : `wrangler pages deployment rollback <previous-deployment-id> --project-name ${name}`,
    ];
    return {
      supported: true,
      summary:
        'Cloudflare Pages can restore a previous deployment (rollback) when wrangler supports it; otherwise redeploy the previous build directory.',
      commands,
      previousDeployId,
    };
  }
  const site = config.siteId || '<site-id>';
  const prev = previousDeployId || '<previous-deploy-id>';
  return {
    supported: true,
    summary:
      'Netlify restoreSiteDeploy republishes a previous deploy id. Keep the last successful deploy_id from the report.',
    commands: [
      `netlify api listSiteDeploys --data '{"site_id":"${site}"}'`,
      `netlify api restoreSiteDeploy --data '{"site_id":"${site}","deploy_id":"${prev}"}'`,
    ],
    previousDeployId,
  };
}

async function readPreviousDeployId(
  projectRoot: string,
  target: OneClickTarget,
  fsImpl: OneClickFs,
): Promise<string | undefined> {
  const historyPath = resolveInside(projectRoot, path.join('.codebuddy', 'deploy-history.jsonl'));
  if (!historyPath) return undefined;
  try {
    const raw = await fsImpl.readFile(historyPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const row = JSON.parse(line) as { target?: string; deployId?: string };
        if (row.target === target && typeof row.deployId === 'string' && row.deployId) {
          return row.deployId;
        }
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function appendHistory(
  projectRoot: string,
  target: OneClickTarget,
  deployId: string | undefined,
  url: string | undefined,
  fsImpl: OneClickFs,
): Promise<void> {
  const dir = resolveInside(projectRoot, '.codebuddy');
  const historyPath = dir ? path.join(dir, 'deploy-history.jsonl') : null;
  if (!dir || !historyPath) return;
  await fsImpl.mkdir(dir, { recursive: true });
  const row = JSON.stringify({
    at: new Date().toISOString(),
    target,
    deployId: deployId ?? null,
    url: url ?? null,
  });
  await fsImpl.appendFile(historyPath, `${row}\n`);
}

function fail(
  base: Omit<OneClickReport, 'ok'>,
  error: string,
  step?: OneClickStep,
): OneClickReport {
  const steps = step ? [...base.steps, step] : base.steps;
  return { ...base, ok: false, error, steps };
}

export function formatOneClickReport(report: OneClickReport): string {
  const lines: string[] = [];
  lines.push(report.dryRun ? 'One-click deploy — simulation (nothing sent)' : 'One-click deploy');
  if (report.target) lines.push(`Target: ${report.target}`);
  lines.push(`Root: ${report.projectRoot}`);
  lines.push(`Duration: ${report.durationMs} ms`);
  if (report.token) {
    lines.push(`Token: ${report.token.envVar} ${report.token.present ? 'present' : 'missing'}${report.token.source ? ` (${report.token.source})` : ''}`);
  }
  for (const step of report.steps) {
    const cmd = step.command ? ` → ${step.command}` : '';
    lines.push(`  [${step.status}] ${step.id}: ${step.detail}${cmd}`);
  }
  if (report.url) lines.push(`URL: ${report.url}`);
  if (report.deployId) lines.push(`Deployment id: ${report.deployId}`);
  if (report.error) lines.push(`Error: ${report.error}`);
  lines.push('Rollback:');
  lines.push(`  ${report.rollback.summary}`);
  for (const cmd of report.rollback.commands) {
    lines.push(`  $ ${cmd}`);
  }
  if (report.log) {
    lines.push('Log:');
    lines.push(report.log);
  }
  return lines.join('\n');
}

export async function runOneClickDeploy(
  request: OneClickRunRequest,
  deps: OneClickDeps = {},
): Promise<OneClickReport> {
  const started = (deps.now ?? Date.now)();
  const duration = (): number => Math.max(0, (deps.now ?? Date.now)() - started);
  const fsImpl = deps.fs ?? defaultFs();
  const execFile = deps.execFile ?? defaultExecFile();
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const whichFn =
    deps.which ?? ((command: string) => defaultWhich(command, execFile, platform));

  const projectRoot = path.resolve(request.projectRoot);
  const dryRun = request.dryRun === true || request.apply !== true;
  const emptyRollback: OneClickRollback = {
    supported: false,
    summary: 'Configure a target first (.codebuddy/deploy.json).',
    commands: [],
  };
  const base: Omit<OneClickReport, 'ok'> = {
    dryRun,
    projectRoot,
    durationMs: 0,
    steps: [],
    rollback: emptyRollback,
  };

  const loaded = request.config
    ? { config: request.config }
    : await loadOneClickConfig(projectRoot, fsImpl);
  if (!loaded.config) {
    base.durationMs = duration();
    return fail(base, loaded.error || 'No deploy target configured.', {
      id: 'config',
      status: 'error',
      detail: loaded.error || 'missing target',
    });
  }

  const config = loaded.config;
  base.target = config.target;
  base.steps.push({
    id: 'config',
    status: 'ok',
    detail: `target=${config.target} outputDir=${config.outputDir}`,
  });

  const previousId = await readPreviousDeployId(projectRoot, config.target, fsImpl);
  base.rollback = rollbackFor(config.target, config, previousId);

  const cliPath = await detectCli(projectRoot, config.target, fsImpl, whichFn, platform);
  if (!cliPath) {
    const message = missingCliMessage(config.target);
    logger.warn(`[one-click-deploy] missing CLI for ${config.target}`);
    base.durationMs = duration();
    return fail(base, message, { id: 'tool', status: 'error', detail: message });
  }
  base.steps.push({
    id: 'tool',
    status: 'ok',
    detail: cliPath,
  });

  const names = tokenNames(config.target);
  const token = await resolveFirstSecret(names, { env, resolveToken: deps.resolveToken });
  base.token = {
    envVar: names[0] ?? 'TOKEN',
    present: Boolean(token),
    source: token?.source,
  };
  if (!token) {
    const message = missingTokenMessage(config.target);
    logger.warn(`[one-click-deploy] missing token for ${config.target}`);
    base.durationMs = duration();
    return fail(base, message, { id: 'token', status: 'error', detail: message });
  }
  base.steps.push({
    id: 'token',
    status: 'ok',
    detail: `${token.name} present (${token.source})`,
  });

  const outputAbs = resolveInside(projectRoot, config.outputDir);
  if (!outputAbs) {
    base.durationMs = duration();
    return fail(base, `Invalid output directory "${config.outputDir}".`, {
      id: 'output',
      status: 'error',
      detail: 'path escapes project root',
    });
  }

  /*
   * Le confinement se vérifie AVANT la simulation, pas après. Un `dist` qui est
   * un lien symbolique vers un dossier extérieur — un répertoire personnel, un
   * fichier de configuration système — serait envoyé tel quel par l'outil de
   * déploiement. Si le contrôle n'a lieu qu'au moment de l'envoi réel, la
   * simulation annonce « tout va bien » sur un cas qui n'ira jamais bien : elle
   * rassure exactement là où elle devrait alerter.
   */
  try {
    const realRoot = await (fsImpl.realpath ? fsImpl.realpath(projectRoot) : nodeFs.realpath(projectRoot));
    const realOutput = await (fsImpl.realpath ? fsImpl.realpath(outputAbs) : nodeFs.realpath(outputAbs));
    const rel = path.relative(realRoot, realOutput);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      base.durationMs = duration();
      return fail(base, `Output directory "${config.outputDir}" escapes project root (symlink).`, {
        id: 'output',
        status: 'error',
        detail: 'output directory symlink escapes project root',
      });
    }
  } catch {
    // Le dossier n'existe pas encore : la construction le créera, et l'étape
    // qui suit l'envoi vérifie sa présence. Rien à confiner ici.
  }

  const uploadPlan = buildUploadArgs(config.target, config, config.outputDir);
  const uploadCommand = `${path.basename(cliPath)} ${uploadPlan.args.join(' ')}`;
  const secretsToRedact = [token.value];

  const shouldBuild = !config.skipBuild && Boolean(config.buildScript);
  if (shouldBuild && config.buildScript) {
    const buildCommand = `${npmCommand(platform)} run ${config.buildScript}`;
    if (dryRun) {
      base.steps.push({
        id: 'build',
        status: 'planned',
        detail: `would run project script "${config.buildScript}"`,
        command: buildCommand,
      });
    } else {
      const result = await execFile(npmCommand(platform), ['run', config.buildScript], {
        cwd: projectRoot,
        env,
        timeout: 15 * 60 * 1000,
      });
      const log = redactSecrets(`${result.stdout}\n${result.stderr}`.trim(), secretsToRedact);
      if (result.code !== 0) {
        logger.warn('[one-click-deploy] build failed');
        base.durationMs = duration();
        return fail(
          { ...base, log },
          `Build failed (exit ${result.code}) for script "${config.buildScript}".`,
          {
            id: 'build',
            status: 'error',
            detail: `npm run ${config.buildScript} exit ${result.code}`,
            command: buildCommand,
          },
        );
      }
      base.steps.push({
        id: 'build',
        status: 'ok',
        detail: `npm run ${config.buildScript}`,
        command: buildCommand,
      });
    }
  } else {
    base.steps.push({
      id: 'build',
      status: 'skipped',
      detail: config.skipBuild ? 'skipBuild=true' : 'no package.json build script',
    });
  }

  if (dryRun) {
    base.steps.push({
      id: 'output',
      status: 'planned',
      detail: `would require directory ${config.outputDir}`,
    });
    base.steps.push({
      id: 'upload',
      status: 'planned',
      detail: 'not sent (dry-run)',
      command: uploadCommand,
    });
    base.durationMs = duration();
    logger.info(`[one-click-deploy] dry-run ${config.target} (nothing sent)`);
    return { ...base, ok: true, durationMs: base.durationMs };
  }

  try {
    const st = await fsImpl.stat(outputAbs);
    if (!st.isDirectory()) {
      base.durationMs = duration();
      return fail(base, `Output path "${config.outputDir}" is not a directory.`, {
        id: 'output',
        status: 'error',
        detail: config.outputDir,
      });
    }
  } catch (error) {
    if ((error as { id?: string })?.id === 'output') throw error;
    base.durationMs = duration();
    return fail(base, `Output directory "${config.outputDir}" does not exist after build.`, {
      id: 'output',
      status: 'error',
      detail: config.outputDir,
    });
  }
  base.steps.push({
    id: 'output',
    status: 'ok',
    detail: config.outputDir,
  });

  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    ...uploadPlan.envExtras,
    [token.name]: token.value,
  };
  if (config.target === 'cloudflare-pages' && token.name === 'CF_API_TOKEN' && !childEnv.CLOUDFLARE_API_TOKEN) {
    childEnv.CLOUDFLARE_API_TOKEN = token.value;
  }

  const upload = await execFile(cliPath, uploadPlan.args, {
    cwd: projectRoot,
    env: childEnv,
    timeout: 15 * 60 * 1000,
  });
  const log = redactSecrets(`${upload.stdout}\n${upload.stderr}`.trim(), secretsToRedact);
  if (upload.code !== 0) {
    logger.warn('[one-click-deploy] upload failed');
    base.durationMs = duration();
    return fail(
      { ...base, log },
      `Upload failed (exit ${upload.code}).`,
      { id: 'upload', status: 'error', detail: 'CLI exited non-zero', command: uploadCommand },
    );
  }

  const parsed = parseDeployOutput(config.target, redactSecrets(`${upload.stdout}\n${upload.stderr}`, secretsToRedact));
  try {
    await appendHistory(projectRoot, config.target, parsed.deployId, parsed.url, fsImpl);
  } catch {
    /* history is best-effort */
  }

  base.steps.push({
    id: 'upload',
    status: 'ok',
    detail: parsed.url || 'uploaded',
    command: uploadCommand,
  });
  base.durationMs = duration();
  logger.info(`[one-click-deploy] ${config.target} uploaded`);
  return {
    ...base,
    ok: true,
    url: parsed.url,
    deployId: parsed.deployId,
    log,
    durationMs: base.durationMs,
  };
}
