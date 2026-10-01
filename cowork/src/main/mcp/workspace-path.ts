import path from 'path';
import fs from 'fs/promises';
import { realpathSync } from 'fs';

export function resolveContainedPath(workspaceDir: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Absolute paths not allowed: ${filePath}`);
  }
  const fullPath = path.resolve(workspaceDir, filePath);
  if (
    !fullPath.startsWith(path.resolve(workspaceDir) + path.sep) &&
    fullPath !== path.resolve(workspaceDir)
  ) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  // Also check realpath if the file/parent exists to prevent symlink escape
  try {
    const realFullPath = realpathSync(fullPath);
    const realWorkspaceDir = realpathSync(workspaceDir);
    if (
      !realFullPath.startsWith(realWorkspaceDir + path.sep) &&
      realFullPath !== realWorkspaceDir
    ) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    // If exact file doesn't exist, check realpath of its dirname
    try {
        const dirPath = path.dirname(fullPath);
        const realDirPath = realpathSync(dirPath);
        const realWorkspaceDir = realpathSync(workspaceDir);
        if (
            !realDirPath.startsWith(realWorkspaceDir + path.sep) &&
            realDirPath !== realWorkspaceDir
        ) {
            throw new Error(`Path traversal detected: ${filePath}`);
        }
    } catch(err2: any) {
        if (err2.code !== 'ENOENT') {
            throw err2;
        }
    }
  }

  return fullPath;
}

export async function readContainedFile(workspaceDir: string, filePath: string): Promise<string> {
  const fullPath = resolveContainedPath(workspaceDir, filePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (error: unknown) {
    throw new Error(
      `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
