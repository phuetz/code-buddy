import { randomUUID } from 'crypto';
import { lstat, mkdir, open, rename, stat, unlink } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import type { MeetingNotesResult } from './types.js';

export interface MeetingOutputTargets {
  markdown: string;
  json: string;
}

export interface MeetingOutputWriteOptions {
  /** Existing reports are preserved unless the caller explicitly opts in. */
  overwrite?: boolean;
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'meeting-notes';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve a CLI-style output target: prefix, explicit .md/.json path, or existing directory. */
export async function resolveMeetingOutputTargets(
  output: string,
  result: MeetingNotesResult,
): Promise<MeetingOutputTargets> {
  const absolute = resolve(output);
  let prefix: string;
  if (await isDirectory(absolute)) {
    prefix = join(absolute, slug(result.notes.title));
  } else {
    const extension = extname(absolute).toLocaleLowerCase();
    prefix = extension === '.md' || extension === '.json'
      ? absolute.slice(0, -extension.length)
      : absolute;
  }
  return { markdown: `${prefix}.md`, json: `${prefix}.json` };
}

async function writeExclusivePair(
  targets: MeetingOutputTargets,
  result: MeetingNotesResult,
): Promise<void> {
  const opened: Array<{ path: string; handle: Awaited<ReturnType<typeof open>> }> = [];
  try {
    // Reserve both final paths before writing either payload. `wx` refuses
    // regular files and symlinks alike, preventing an agent from replacing an
    // unrelated workspace file through a crafted output prefix.
    opened.push({
      path: targets.markdown,
      handle: await open(targets.markdown, 'wx', 0o600),
    });
    opened.push({
      path: targets.json,
      handle: await open(targets.json, 'wx', 0o600),
    });
    await Promise.all([
      opened[0]!.handle.writeFile(result.markdown, 'utf8'),
      opened[1]!.handle.writeFile(`${result.json}\n`, 'utf8'),
    ]);
    await Promise.all(opened.map(({ handle }) => handle.sync()));
  } catch (error) {
    await Promise.all(opened.map(({ handle }) => handle.close().catch(() => undefined)));
    await Promise.all(opened.map(({ path }) => unlink(path).catch(() => undefined)));
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
    if (code === 'EEXIST') {
      throw new Error('Meeting report target already exists; choose another prefix or use --force from the CLI');
    }
    throw error;
  } finally {
    await Promise.all(opened.map(({ handle }) => handle.close().catch(() => undefined)));
  }
}

interface PreparedReplacement {
  target: string;
  temporary: string;
  backup: string;
  hadOriginal: boolean;
  published: boolean;
}

async function prepareReplacement(path: string, payload: string): Promise<PreparedReplacement> {
  const id = randomUUID();
  const temporary = join(dirname(path), `.${String(process.pid)}.${id}.meeting.tmp`);
  const backup = join(dirname(path), `.${String(process.pid)}.${id}.meeting.bak`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(payload, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    let hadOriginal = false;
    try {
      const existing = await lstat(path);
      if (existing.isDirectory()) throw new Error(`Meeting report target is a directory: ${path}`);
      hadOriginal = true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
      if (code !== 'ENOENT') throw error;
    }
    return { target: path, temporary, backup, hadOriginal, published: false };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function replacePairWithRollback(
  targets: MeetingOutputTargets,
  result: MeetingNotesResult,
): Promise<void> {
  const prepared: PreparedReplacement[] = [];
  let committed = false;
  try {
    prepared.push(await prepareReplacement(targets.markdown, result.markdown));
    prepared.push(await prepareReplacement(targets.json, `${result.json}\n`));

    for (const item of prepared) {
      if (item.hadOriginal) await rename(item.target, item.backup);
    }
    for (const item of prepared) {
      await rename(item.temporary, item.target);
      item.published = true;
    }
    committed = true;
  } catch (error) {
    // Restore the complete old pair on any failure after publication starts.
    for (const item of [...prepared].reverse()) {
      if (item.published) await unlink(item.target).catch(() => undefined);
      if (item.hadOriginal) {
        await rename(item.backup, item.target).catch(() => undefined);
      }
      await unlink(item.temporary).catch(() => undefined);
    }
    throw error;
  }
  if (committed) {
    await Promise.all(
      prepared
        .filter((item) => item.hadOriginal)
        .map((item) => unlink(item.backup).catch(() => undefined)),
    );
  }
}

/** Write the Markdown and JSON representations together without overwriting by default. */
export async function writeMeetingOutputReports(
  output: string,
  result: MeetingNotesResult,
  options: MeetingOutputWriteOptions = {},
): Promise<MeetingOutputTargets> {
  const targets = await resolveMeetingOutputTargets(output, result);
  await Promise.all([
    mkdir(dirname(targets.markdown), { recursive: true }),
    mkdir(dirname(targets.json), { recursive: true }),
  ]);
  if (options.overwrite) {
    await replacePairWithRollback(targets, result);
  } else {
    await writeExclusivePair(targets, result);
  }
  return targets;
}
