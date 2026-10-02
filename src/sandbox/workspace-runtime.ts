/** Read grants required by a workspace, without granting its parent directory. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifySecretPath } from '../security/secret-files.js';

const temporaries = new Map<string, string>();
process.once('exit', () => {
  for (const temporary of temporaries.values()) fs.rmSync(temporary, { recursive: true, force: true });
});

export function sessionTemporary(workspace: string): string {
  let directory = temporaries.get(workspace);
  if (!directory) {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-shell-'));
    fs.chmodSync(directory, 0o700);
    temporaries.set(workspace, directory);
  }
  return directory;
}

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

export interface WorkspaceRuntimePaths {
  readOnly: string[];
  gitDirectory?: string;
  commonDirectory?: string;
  nodeDirectory: string;
  nodeModulesDirectory?: string;
}

export function resolveWorkspaceRuntime(workspace: string): WorkspaceRuntimePaths {
  const readOnly = new Set<string>();
  const add = (target: string): string | undefined => {
    try {
      const real = fs.realpathSync(target);
      if (classifySecretPath(real).secret || real === path.parse(real).root || real === os.homedir()) return undefined;
      readOnly.add(real);
      return real;
    } catch { return undefined; }
  };
  const dotGit = path.join(workspace, '.git');
  const pointer = readText(dotGit).match(/^gitdir:\s*(.+)$/m)?.[1];
  const gitDirectory = add(pointer ? path.resolve(workspace, pointer) : dotGit);
  const commonPointer = gitDirectory ? readText(path.join(gitDirectory, 'commondir')) : '';
  const commonDirectory = gitDirectory && (commonPointer ? add(path.resolve(gitDirectory, commonPointer)) : gitDirectory);
  const seenObjects = new Set<string>();
  const visitObjects = (directory: string, depth = 0): void => {
    if (depth > 32) throw new Error('Git alternate object chain exceeds 32 levels');
    const real = add(directory);
    if (!real || seenObjects.has(real)) return;
    seenObjects.add(real);
    for (const alternate of readText(path.join(real, 'info', 'alternates')).split('\n').filter(Boolean)) {
      visitObjects(path.resolve(real, alternate), depth + 1);
    }
  };
  if (commonDirectory) visitObjects(path.join(commonDirectory, 'objects'));
  const nodeModulesDirectory = add(path.join(workspace, 'node_modules'));
  // An nvm/Volta installation also needs npm's ../lib and Corepack's modules.
  // Grant this version's prefix, never the user's home or the version manager.
  const nodeDirectory = path.dirname(fs.realpathSync(process.execPath));
  const prefix = path.dirname(nodeDirectory);
  if (!['/usr', '/usr/local', '/'].includes(prefix)) add(prefix);
  return { readOnly: [...readOnly], gitDirectory, commonDirectory, nodeDirectory, nodeModulesDirectory };
}
