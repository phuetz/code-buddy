/** Narrow exception for workspace traversal; direct reads remain protected. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Arbitrary comments can carry short credentials without any recognizable
// keyword. Only these fixed, value-free project comments may authorize a
// child process with access to Git objects and the working tree.
const PROCESS_SAFE_COMMENTS = new Set([
  '# Cross-platform collaboration settings',
  '# Ensure platform-specific optional dependencies are handled correctly',
  '# Prevent accidental package-lock.json changes during development',
  '# When adding/removing packages, use: npm install <pkg> --save',
  '# package-lock.json should only be committed intentionally',
  '# Use exact versions to avoid cross-platform version drift',
  '# Automatically install peer dependencies',
]);

export function isPublicNpmrcContent(content: string, forProcess = false): boolean {
  if (content.includes('\uFFFD') || content.includes('\0')) return false;
  return content.split(/\r?\n/).every((line) => {
    const entry = line.trim();
    if (!entry) return true;
    if (entry.startsWith('#')) {
      return (!forProcess || PROCESS_SAFE_COMMENTS.has(entry)) &&
        !/(?:auth|token|secret|pass(?:word)?|pwd|api|bearer|cookie|session|private|credential|key)/i.test(entry) &&
        !/[A-Za-z0-9+/_=-]{24,}/.test(entry);
    }
    return /^(?:engine-strict|package-lock|save-exact|legacy-peer-deps|audit|fund|progress|update-notifier)=(?:true|false)$/i.test(entry) ||
      /^registry=https:\/\/registry\.npmjs\.org\/?$/i.test(entry);
  });
}

function isPublicNpmrcFile(file: string, forProcess: boolean): boolean {
  if (path.basename(file).toLowerCase() !== '.npmrc') return false;
  try {
    const real = fs.realpathSync(file);
    const home = path.resolve(os.homedir());
    if (real === home || real.startsWith(home + path.sep)) return false;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 16_384) return false;
    return isPublicNpmrcContent(fs.readFileSync(file, 'utf8'), forProcess);
  } catch { return false; }
}

export function isPublicProjectNpmrc(file: string): boolean {
  return isPublicNpmrcFile(file, false);
}

export function isPublicWorkspaceNpmrc(file: string): boolean {
  return isPublicNpmrcFile(file, true);
}
