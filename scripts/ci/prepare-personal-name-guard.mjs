/** Supply the public-source guard with a private, runner-local exclusion file. */
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
const firstName = author?.split('<', 1)[0]?.trim().split(/\s+/u)[0];
if (!firstName || firstName.length < 3) {
  throw new Error('package.json author must provide a name for the public-source guard');
}
if (!process.env.GITHUB_ENV) {
  throw new Error('GITHUB_ENV is required to configure the public-source guard');
}

const directory = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'codebuddy-name-guard-'));
const listPath = join(directory, 'excluded-names.txt');
writeFileSync(listPath, `${firstName}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
appendFileSync(process.env.GITHUB_ENV, `CODEBUDDY_EXCLUDED_NAMES_FILE=${listPath}\n`);
