/** An explicit, value-free .env fixture may coexist with a usable shell. */
import fs from 'node:fs';
import path from 'node:path';

export function isPublicEnvFixtureContent(content: string, file: string): boolean {
  if (content.includes('\uFFFD') || content.includes('\0') || Buffer.byteLength(content) > 4_096) return false;
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return true;
  const inTestFixtures = path.normalize(file).split(path.sep).some((segment) =>
    ['_qa', 'tests', 'fixtures'].includes(segment.toLowerCase()));
  return lines.every((line) => {
    // Free-form comments may themselves carry an otherwise unrecognizable key.
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return false;
    const value = match[2]!.trim().replace(/^(?:'([^']*)'|"([^"]*)")$/, '$1$2');
    return value === '' || /^(?:EXAMPLE|PLACEHOLDER|DUMMY)$/i.test(value) ||
      (/^FAKE[-_][A-Za-z0-9_-]+$/.test(value) && value.length <= 48 &&
        (inTestFixtures || /[-_]FIXTURE$/.test(value))) ||
      /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) ||
      /^<(?:YOUR|FAKE|TEST|EXAMPLE)[A-Za-z0-9_ -]*>$/i.test(value);
  });
}

export function isPublicEnvFixtureFile(file: string): boolean {
  if (!/^(?:\.env(?:\..+)?|.+\.env)$/i.test(path.basename(file))) return false;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4_096) return false;
    return isPublicEnvFixtureContent(fs.readFileSync(file, 'utf8'), file);
  } catch { return false; }
}
