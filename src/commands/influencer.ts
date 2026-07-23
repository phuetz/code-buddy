import { spawn } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INFLUENCER_DIR = join(REPO_ROOT, 'scripts', 'influencer');

export function createInfluencerCommand(): Command {
  const command = new Command('influencer').description(
    'Influencer & book-trailer media pipeline (scripts/influencer)'
  );

  command
    .command('list')
    .description('List influencer Python scripts')
    .action(async () => {
      const entries = await readdir(INFLUENCER_DIR, { withFileTypes: true });
      const scripts = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.py'))
        .sort((left, right) => left.name.localeCompare(right.name));

      for (const script of scripts) {
        const source = await readFile(join(INFLUENCER_DIR, script.name), 'utf8');
        const description = firstDocstringLine(source);
        console.log(description ? `${script.name} — ${description}` : script.name);
      }
    });

  command
    .command('short <subjects...>')
    .description('Generate influencer shorts for one or more subjects')
    .action(async (subjects: string[]) => {
      await runPython('make-influencer-batch.py', subjects);
    });

  command
    .command('broll')
    .description('Generate the B-roll batch')
    .action(async () => {
      await runPython('broll-batch.py');
    });

  command
    .command('clips')
    .description('Generate the Lisa clip batch')
    .action(async () => {
      await runPython('lisa-clip-batch.py');
    });

  command
    .command('readme')
    .description('Show the influencer pipeline README')
    .action(async () => {
      console.log(await readFile(join(INFLUENCER_DIR, 'README.md'), 'utf8'));
    });

  return command;
}

function firstDocstringLine(source: string): string {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  let index = lines[0]?.startsWith('#!') ? 1 : 0;

  while (index < lines.length && /^\s*(?:#.*)?$/.test(lines[index] ?? '')) {
    index += 1;
  }

  const firstLine = lines[index]?.trimStart() ?? '';
  const delimiter = firstLine.startsWith('"""')
    ? '"""'
    : firstLine.startsWith("'''")
      ? "'''"
      : undefined;
  if (!delimiter) return '';

  const openingText = firstLine.slice(delimiter.length).split(delimiter, 1)[0]?.trim();
  if (openingText) return openingText;

  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index]?.split(delimiter, 1)[0]?.trim();
    if (line) return line;
  }
  return '';
}

function runPython(scriptName: string, args: string[] = []): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('python3', [join('scripts', 'influencer', scriptName), ...args], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });

    child.once('error', rejectRun);
    child.once('close', (code) => {
      process.exitCode = code ?? 1;
      resolveRun();
    });
  });
}
