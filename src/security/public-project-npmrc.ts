/** Narrow exception for workspace traversal; direct reads remain protected. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function isPublicNpmrcContent(content: string): boolean {
  if (content.includes('\uFFFD') || content.includes('\0')) return false;
  return content.split(/\r?\n/).every((line) => {
    const entry = line.trim();
    if (!entry) return true;
    if (entry.startsWith('#')) {
      return !/(?:auth|token|secret|pass(?:word)?|pwd|api|bearer|cookie|session|private|credential|key)/i.test(entry) &&
        !/[A-Za-z0-9+/_=-]{24,}/.test(entry);
    }
    return /^(?:engine-strict|package-lock|save-exact|legacy-peer-deps|audit|fund|progress|update-notifier)=(?:true|false)$/i.test(entry) ||
      /^registry=https:\/\/registry\.npmjs\.org\/?$/i.test(entry);
  });
}

export function isPublicProjectNpmrc(file: string): boolean {
  if (path.basename(file).toLowerCase() !== '.npmrc') return false;
  try {
    const real = fs.realpathSync(file);
    const home = path.resolve(os.homedir());
    if (real === home || real.startsWith(home + path.sep)) return false;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 16_384) return false;
    return isPublicNpmrcContent(fs.readFileSync(file, 'utf8'));
  } catch { return false; }
}
