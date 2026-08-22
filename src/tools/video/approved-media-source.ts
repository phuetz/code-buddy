/** Read an immutable, digest-pinned image from an explicitly approved root. */

import { createHash } from 'crypto';
import { constants, promises as fs } from 'fs';
import path from 'path';

export interface ApprovedImageSource {
  bytes: Buffer;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  realPath: string;
  sha256: string;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function detectImageContentType(bytes: Buffer): ApprovedImageSource['contentType'] | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export async function loadApprovedImageSource(
  filename: string,
  approvedRoot: string,
  expectedSha256: string,
  maximumBytes = 25 * 1024 * 1024,
): Promise<ApprovedImageSource> {
  if (!path.isAbsolute(filename) || !path.isAbsolute(approvedRoot)) {
    throw new Error('Approved image source and root must be absolute paths');
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error('Approved image source requires a lowercase SHA-256 digest');
  }
  const root = await fs.realpath(approvedRoot);
  const sourceLstat = await fs.lstat(filename);
  if (sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) {
    throw new Error('Approved image source must be a regular non-symlink file');
  }
  const realPath = await fs.realpath(filename);
  if (!isInsideRoot(root, realPath)) {
    throw new Error('Approved image source escapes the configured asset root');
  }

  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
      throw new Error(`Approved image source size must be between 1 and ${maximumBytes} bytes`);
    }
    const bytes = await handle.readFile();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== expectedSha256) throw new Error('Approved image source digest does not match the plan');
    const contentType = detectImageContentType(bytes);
    if (!contentType) throw new Error('Approved image source has an unsupported file signature');
    return { bytes, contentType, realPath, sha256 };
  } finally {
    await handle.close();
  }
}
