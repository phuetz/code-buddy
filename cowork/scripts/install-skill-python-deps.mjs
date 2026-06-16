// Installs the bundled document-skill Python deps (python-pptx, openpyxl,
// python-docx, …) into the platform's bundled Python runtime at
// cowork/resources/python/<platform>, so the .claude/skills/{pptx,docx,xlsx,pdf}
// scripts run offline inside the packaged app.
//
// Run at build time (before electron-builder packages) or manually:
//   node scripts/install-skill-python-deps.mjs
//
// No-ops cleanly if the bundled Python for the current platform isn't present
// (the skills then fall back to a system Python on PATH).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coworkRoot = path.resolve(__dirname, '..');

const platform =
  process.platform === 'darwin'
    ? `darwin-${process.arch}`
    : process.platform === 'win32'
      ? 'win-x64'
      : 'linux-x64';

const pyDir = path.join(coworkRoot, 'resources', 'python', platform);
const python =
  process.platform === 'win32'
    ? path.join(pyDir, 'python.exe')
    : path.join(pyDir, 'bin', 'python3');
const requirements = path.join(coworkRoot, 'resources', 'python', 'requirements-skills.txt');

if (!existsSync(python)) {
  console.warn(
    `[skill-python] bundled Python not found at ${python} — skipping. ` +
      `Document skills will require a system Python with the libs in requirements-skills.txt.`,
  );
  process.exit(0);
}

console.log(`[skill-python] installing document-skill deps into ${python}`);
try {
  execFileSync(
    python,
    ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', '-r', requirements],
    { stdio: 'inherit' },
  );
  console.log('[skill-python] done.');
} catch (err) {
  console.error('[skill-python] pip install failed:', err?.message ?? err);
  process.exit(1);
}
