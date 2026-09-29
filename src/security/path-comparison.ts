import path from 'node:path';

/** Case handling for security path comparisons, including simulated platforms. */
export function foldPathCase(value: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value;
}

function normalized(value: string, platform: NodeJS.Platform): string {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return foldPathCase(paths.normalize(value), platform);
}

export function isSamePath(candidate: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  return normalized(candidate, platform) === normalized(root, platform);
}

export function isPathInside(candidate: string, root: string, platform: NodeJS.Platform = process.platform): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const a = normalized(candidate, platform);
  const b = normalized(root, platform);
  return a === b || a.startsWith(b.endsWith(paths.sep) ? b : b + paths.sep);
}
