/**
 * Crash Recovery — detect and offer recovery from unclean shutdowns.
 *
 * Works alongside the existing CrashHandler (crash-handler.ts) which saves
 * crash context to ~/.codebuddy/recovery/. This module reads that data at
 * startup and offers the user a chance to resume.
 */

import { readFile, readdir, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';

export interface RecoveryInfo {
  sessionId: string;
  timestamp: string;
  messageCount: number;
  lastUserMessage: string;
  crashReason?: string;
  attempts: number;
}

/** The crash handler writes to ~/.codebuddy/recovery/ */
const RECOVERY_DIR = join(homedir(), '.codebuddy', 'recovery');

/** Maximum number of failed recovery attempts before we stop offering recovery. */
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Record a new recovery attempt in latest.json.
 * Called by the CLI before it tries to resume from a crash so that
 * repeated crash-on-resume cycles eventually break the loop.
 */
export async function recordRecoveryAttempt(): Promise<number> {
  const recoveryDir = RECOVERY_DIR;
  if (!existsSync(recoveryDir)) return 0;
  const latestFile = join(recoveryDir, 'latest.json');
  if (!existsSync(latestFile)) return 0;
  try {
    const content = await readFile(latestFile, 'utf-8');
    const data = JSON.parse(content);
    data.attempts = (typeof data.attempts === 'number' ? data.attempts : 0) + 1;
    await writeFile(latestFile, JSON.stringify(data, null, 2), 'utf-8');
    return data.attempts;
  } catch (err) {
    logger.debug(`Failed to record recovery attempt: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/**
 * Check if there's a pending crash recovery.
 * Returns recovery info if found, null otherwise.
 */
export async function checkCrashRecovery(_cwd: string = process.cwd()): Promise<RecoveryInfo | null> {
  // Check the global recovery dir (where CrashHandler writes)
  const recoveryDir = RECOVERY_DIR;
  if (!existsSync(recoveryDir)) return null;

  try {
    // First try the "latest.json" quick-check file written by CrashHandler
    const latestFile = join(recoveryDir, 'latest.json');
    if (existsSync(latestFile)) {
      const latestContent = await readFile(latestFile, 'utf-8');
      const latestData = JSON.parse(latestContent);

      // Only offer recovery for crashes within the last hour
      const age = Date.now() - new Date(latestData.timestamp).getTime();
      if (age > 3600000) {
        return null;
      }

      // Break the recovery loop after MAX_RECOVERY_ATTEMPTS failures:
      // if the user repeatedly resumes and immediately re-crashes (e.g. the
      // recovered state itself is what triggers the crash), each attempt
      // bumps the counter. Past the threshold we refuse to offer recovery
      // and leave a visible warning so the user knows why and starts a
      // fresh session instead of fighting an infinite loop.
      const attempts = typeof latestData.attempts === 'number' ? latestData.attempts : 0;
      if (attempts >= MAX_RECOVERY_ATTEMPTS) {
        logger.warn(
          `Crash recovery disabled after ${attempts} failed attempts — start a fresh session. ` +
          `Clear ~/.codebuddy/recovery/latest.json manually if you want to retry.`,
        );
        return null;
      }

      // Try to load the full crash context for more detail
      let messageCount = 0;
      let lastUserMessage = '';

      if (latestData.recoveryFilePath && existsSync(latestData.recoveryFilePath)) {
        try {
          const crashContent = await readFile(latestData.recoveryFilePath, 'utf-8');
          const crashData = JSON.parse(crashContent);
          const messages = crashData.lastMessages || [];
          messageCount = messages.length;

          // Find the last user message
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
              lastUserMessage = messages[i].content || '';
              break;
            }
          }
        } catch {
          // Crash context file may be corrupted; use what we have
        }
      }

      return {
        sessionId: latestData.sessionId || 'unknown',
        timestamp: latestData.timestamp || new Date().toISOString(),
        messageCount,
        lastUserMessage: lastUserMessage.substring(0, 500),
        crashReason: latestData.reason || undefined,
        attempts,
      };
    }

    // Fallback: scan for crash_*.json files
    const files = await readdir(recoveryDir);
    const recoveryFiles = files
      .filter(f => f.startsWith('crash_') && f.endsWith('.json'))
      .sort();
    if (recoveryFiles.length === 0) return null;

    // Get the most recent recovery file
    const latest = recoveryFiles.pop()!;
    const content = await readFile(join(recoveryDir, latest), 'utf-8');
    const data = JSON.parse(content);

    // Only offer recovery for crashes within the last hour
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age > 3600000) {
      return null;
    }

    const messages = data.lastMessages || [];
    let lastUserMessage = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessage = messages[i].content || '';
        break;
      }
    }

    return {
      sessionId: data.sessionId || 'unknown',
      timestamp: data.timestamp || new Date().toISOString(),
      messageCount: messages.length,
      lastUserMessage: lastUserMessage.substring(0, 500),
      crashReason: data.error?.message || undefined,
      attempts: typeof data.attempts === 'number' ? data.attempts : 0,
    };
  } catch (err) {
    logger.debug(`Failed to read recovery info: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Clear recovery files after successful resume or user decline.
 */
export async function clearRecoveryFiles(): Promise<void> {
  const recoveryDir = RECOVERY_DIR;
  if (!existsSync(recoveryDir)) return;

  try {
    // Remove latest.json
    const latestFile = join(recoveryDir, 'latest.json');
    if (existsSync(latestFile)) {
      await rm(latestFile);
    }

    // Clean up crash_*.json files older than 1 hour
    const files = await readdir(recoveryDir);
    const oneHourAgo = Date.now() - 3600000;
    for (const file of files) {
      if (file.startsWith('crash_') && file.endsWith('.json')) {
        const filePath = join(recoveryDir, file);
        try {
          const { stat } = await import('fs/promises');
          const fileStat = await stat(filePath);
          if (fileStat.mtimeMs < oneHourAgo) {
            await rm(filePath);
            logger.debug(`Removed old crash file: ${file}`);
          }
        } catch {
          // Skip files that can't be stat'd or removed
        }
      }
    }

    logger.debug('Recovery files cleared');
  } catch (err) {
    logger.debug(`Failed to clear recovery files: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Save a recovery checkpoint (call periodically during session).
 * This supplements the CrashHandler by keeping a lightweight checkpoint
 * that includes the session ID and message count.
 */
export async function saveRecoveryCheckpoint(
  _cwd: string,
  sessionId: string,
  messageCount: number,
  lastUserMessage: string,
): Promise<void> {
  const recoveryDir = RECOVERY_DIR;
  try {
    if (!existsSync(recoveryDir)) {
      await mkdir(recoveryDir, { recursive: true });
    }

    const data = {
      sessionId,
      timestamp: new Date().toISOString(),
      messageCount,
      lastUserMessage: lastUserMessage.substring(0, 500),
    };

    await writeFile(
      join(recoveryDir, `recovery-${sessionId}.json`),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
  } catch (err) {
    logger.debug(`Failed to save recovery checkpoint: ${err instanceof Error ? err.message : String(err)}`);
  }
}
