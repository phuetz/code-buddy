import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import {
  groupChangelogCommits,
  renderChangelogMarkdown,
  type ChangelogCommit,
} from '../git/changelog.js';
import { logger } from '../utils/logger.js';

const GIT_LOG_FORMAT = '--format=%H%x00%s%x00%b';
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export type ChangelogGitRunner = (args: readonly string[], cwd: string) => Promise<string>;

export interface ChangelogCommandDependencies {
  cwd?: string;
  runGit?: ChangelogGitRunner;
  stdout?: (content: string) => void;
}

export interface ChangelogCollectionOptions {
  since?: string;
  to?: string;
}

export type ChangelogRangeMode = 'all' | 'date' | 'ref' | 'tag';

export interface ChangelogRange {
  since: string | null;
  to: string;
  mode: ChangelogRangeMode;
}

export interface CollectedChangelogCommits {
  commits: ChangelogCommit[];
  range: ChangelogRange;
}

interface ChangelogCliOptions extends ChangelogCollectionOptions {
  json: boolean;
  out?: string;
}

class GitCommandError extends Error {
  readonly code: string | number | undefined;

  constructor(error: Error & { code?: string | number | null }, stderr: string) {
    super(stderr.trim() || error.message);
    this.name = 'GitCommandError';
    this.code = error.code ?? undefined;
  }
}

const defaultGitRunner: ChangelogGitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitCommandError(error, stderr));
          return;
        }
        resolve(stdout);
      }
    );
  });

function normalizeOption(value: string | undefined, fallback: string, label: string): string {
  const normalized = value?.trim() ?? fallback;
  if (!normalized) throw new Error(`${label} ne peut pas être vide.`);
  return normalized;
}

function validateDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Date invalide pour --since : ${value}`);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseGitLog(output: string): ChangelogCommit[] {
  if (!output) return [];
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 3 !== 0) {
    throw new Error('La sortie de `git log` est incomplète ou illisible.');
  }

  const commits: ChangelogCommit[] = [];
  for (let index = 0; index < fields.length; index += 3) {
    const hash = fields[index];
    const subject = fields[index + 1];
    const body = fields[index + 2];
    if (hash === undefined || subject === undefined || body === undefined) {
      throw new Error('La sortie de `git log` est incomplète ou illisible.');
    }
    commits.push({ hash, subject, body });
  }
  return commits;
}

async function ensureGitRepository(cwd: string, runGit: ChangelogGitRunner): Promise<void> {
  try {
    const gitDirectory = await runGit(['rev-parse', '--git-dir'], cwd);
    if (!gitDirectory.trim()) throw new Error('Répertoire Git introuvable.');
  } catch (error) {
    if (error instanceof GitCommandError && error.code === 'ENOENT') {
      throw new Error('Git est introuvable ou inaccessible sur cette machine.');
    }
    throw new Error(`Ce dossier n’est pas un dépôt Git : ${cwd}`);
  }
}

async function tryResolveCommit(
  reference: string,
  cwd: string,
  runGit: ChangelogGitRunner
): Promise<string | undefined> {
  try {
    const resolved = await runGit(
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${reference}^{commit}`],
      cwd
    );
    return resolved.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function repositoryHasCommits(cwd: string, runGit: ChangelogGitRunner): Promise<boolean> {
  const output = await runGit(['rev-list', '--max-count=1', '--all'], cwd);
  return output.trim().length > 0;
}

async function latestReachableTag(
  toHash: string,
  cwd: string,
  runGit: ChangelogGitRunner
): Promise<string | undefined> {
  try {
    const tag = await runGit(['describe', '--tags', '--abbrev=0', toHash], cwd);
    return tag.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Collect the selected Git history without mutating the repository. */
export async function collectChangelogCommits(
  options: ChangelogCollectionOptions = {},
  dependencies: Pick<ChangelogCommandDependencies, 'cwd' | 'runGit'> = {}
): Promise<CollectedChangelogCommits> {
  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const runGit = dependencies.runGit ?? defaultGitRunner;
  const to = normalizeOption(options.to, 'HEAD', '--to');

  await ensureGitRepository(cwd, runGit);

  const toHash = await tryResolveCommit(to, cwd, runGit);
  if (!toHash) {
    if (to === 'HEAD' && !(await repositoryHasCommits(cwd, runGit))) {
      return { commits: [], range: { since: null, to, mode: 'all' } };
    }
    throw new Error(`Référence Git invalide pour --to : ${to}`);
  }

  const requestedSince = options.since?.trim();
  if (options.since !== undefined && !requestedSince) {
    throw new Error('--since ne peut pas être vide.');
  }

  let range: ChangelogRange;
  let revision = toHash;
  let dateArgument: string | undefined;

  if (requestedSince && isIsoDate(requestedSince)) {
    validateDate(requestedSince);
    dateArgument = `--since=${requestedSince}`;
    range = { since: requestedSince, to, mode: 'date' };
  } else if (requestedSince) {
    const sinceHash = await tryResolveCommit(requestedSince, cwd, runGit);
    if (!sinceHash) throw new Error(`Référence Git invalide pour --since : ${requestedSince}`);
    revision = `${sinceHash}..${toHash}`;
    range = { since: requestedSince, to, mode: 'ref' };
  } else {
    const tag = await latestReachableTag(toHash, cwd, runGit);
    if (tag) {
      const sinceHash = await tryResolveCommit(tag, cwd, runGit);
      if (!sinceHash) throw new Error(`Impossible de résoudre le dernier tag Git : ${tag}`);
      revision = `${sinceHash}..${toHash}`;
      range = { since: tag, to, mode: 'tag' };
    } else {
      range = { since: null, to, mode: 'all' };
    }
  }

  const logArgs = ['log', '-z', '--no-color', GIT_LOG_FORMAT];
  if (dateArgument) logArgs.push(dateArgument);
  logArgs.push(revision, '--');
  const output = await runGit(logArgs, cwd);

  return {
    commits: parseGitLog(output),
    range,
  };
}

function noCommitsMessage(range: ChangelogRange): string {
  if (range.mode === 'all') {
    return `Aucun commit trouvé dans l’historique Git jusqu’à ${range.to}.`;
  }
  return `Aucun commit trouvé sur la plage ${range.since} → ${range.to}.`;
}

async function readExistingFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function prependOutput(filePath: string, markdown: string): Promise<void> {
  const existing = await readExistingFile(filePath);
  const content = existing ? `${markdown.trimEnd()}\n\n${existing}` : markdown;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function writeStdout(content: string, writer?: (content: string) => void): void {
  (writer ?? ((value) => process.stdout.write(value)))(`${content.trimEnd()}\n`);
}

export function createChangelogCommand(dependencies: ChangelogCommandDependencies = {}): Command {
  const command = new Command('changelog')
    .description('Générer des release notes depuis les Conventional Commits')
    .option('--since <tag|YYYY-MM-DD|ref>', 'Début exclu de la plage, ou date YYYY-MM-DD')
    .option('--to <ref>', 'Fin incluse de la plage Git', 'HEAD')
    .option('--out <CHANGELOG.md>', 'Préfixer les release notes dans ce fichier Markdown')
    .option('--json', 'Émettre la structure groupée en JSON sur stdout', false);

  command.action(async (options: ChangelogCliOptions) => {
    try {
      if (options.json && options.out) {
        throw new Error('`--json` et `--out` ne peuvent pas être utilisés ensemble.');
      }

      const collection = await collectChangelogCommits(options, dependencies);
      const changelog = groupChangelogCommits(collection.commits);
      const message = changelog.totalCommits === 0 ? noCommitsMessage(collection.range) : undefined;

      if (options.json) {
        writeStdout(
          JSON.stringify(
            {
              range: collection.range,
              ...changelog,
              ...(message ? { message } : {}),
            },
            null,
            2
          ),
          dependencies.stdout
        );
        return;
      }

      if (message) {
        writeStdout(message, dependencies.stdout);
        return;
      }

      const markdown = renderChangelogMarkdown(changelog);
      if (!options.out) {
        writeStdout(markdown, dependencies.stdout);
        return;
      }

      const cwd = path.resolve(dependencies.cwd ?? process.cwd());
      const outputPath = path.resolve(cwd, options.out);
      await prependOutput(outputPath, markdown);
      logger.info(`Changelog mis à jour : ${outputPath}`);
    } catch (error) {
      command.error(error instanceof Error ? error.message : String(error), {
        code: 'buddy.changelog',
        exitCode: 1,
      });
    }
  });

  return command;
}
