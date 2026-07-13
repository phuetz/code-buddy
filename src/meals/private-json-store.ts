import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

export class MealStoreCorruptionError extends Error {
  constructor(public readonly filePath: string, message: string) {
    super(message);
    this.name = 'MealStoreCorruptionError';
  }
}

export class MealStorePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MealStorePersistenceError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function enforcePrivateDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new MealStorePersistenceError(`Refusing non-regular private meal directory: ${directory}`);
  }
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
}

async function enforcePrivateFile(filePath: string): Promise<void> {
  const info = await fs.lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new MealStorePersistenceError(`Refusing non-regular private meal file: ${filePath}`);
  }
  if (process.platform !== 'win32') await fs.chmod(filePath, 0o600);
}

export async function readPrivateMealJson<T>(
  filePath: string,
  label: string,
  parse: (value: unknown) => T | null,
): Promise<T | null> {
  let raw: string;
  try {
    await enforcePrivateFile(filePath);
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new MealStorePersistenceError(`Unable to read ${label}: ${errorMessage(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    logger.warn(`[meals] ${label} contains invalid JSON`, { filePath });
    throw new MealStoreCorruptionError(filePath, `${label} contains invalid JSON: ${errorMessage(error)}`);
  }
  const parsed = parse(value);
  if (parsed === null) {
    logger.warn(`[meals] ${label} has an invalid schema`, { filePath });
    throw new MealStoreCorruptionError(filePath, `${label} has an invalid or unsupported schema.`);
  }
  return parsed;
}

export async function writePrivateMealJson(
  filePath: string,
  label: string,
  value: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  const temporary = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    await enforcePrivateDirectory(directory);
    try {
      await enforcePrivateFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await fs.rename(temporary, filePath);
    await enforcePrivateFile(filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof MealStorePersistenceError) throw error;
    throw new MealStorePersistenceError(`Unable to persist ${label}: ${errorMessage(error)}`);
  }
}
