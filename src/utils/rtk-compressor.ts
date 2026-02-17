/**
 * RTK (Rust Token Killer) Output Compressor
 *
 * Integrates with the RTK CLI binary to compress shell output 60-90%
 * via format-aware parsing (strips ANSI, deduplicates whitespace, removes noise).
 * Falls back gracefully when RTK is not installed.
 *
 * @see https://github.com/rtk-ai/rtk
 */

import { execSync, spawnSync } from 'child_process';
import { logger } from './logger.js';

// Cache RTK availability check
let rtkAvailable: boolean | null = null;

/**
 * Check if the RTK binary is available on the system
 */
export function isRTKAvailable(): boolean {
  if (rtkAvailable !== null) return rtkAvailable;

  try {
    execSync('which rtk', { stdio: 'ignore' });
    rtkAvailable = true;
  } catch {
    rtkAvailable = false;
  }

  return rtkAvailable;
}

/**
 * Reset the cached availability check (useful for testing)
 */
export function resetRTKCache(): void {
  rtkAvailable = null;
}

export interface RTKCompressOptions {
  /** Output format hint for RTK (e.g., 'json', 'log', 'csv') */
  format?: string;
}

/**
 * Compress output using RTK binary via stdin pipe.
 * Returns original output unchanged if RTK is unavailable or fails.
 */
export function compressWithRTK(output: string, options?: RTKCompressOptions): string {
  if (!isRTKAvailable()) {
    return output;
  }

  try {
    const args = ['compress', '--stdin'];
    if (options?.format) {
      args.push('--format', options.format);
    }

    const result = spawnSync('rtk', args, {
      input: output,
      encoding: 'utf-8',
      timeout: 10000, // 10s timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (result.status === 0 && result.stdout) {
      return result.stdout;
    }

    // Non-zero exit or no output — fall back to original
    if (result.stderr) {
      logger.debug('RTK compression warning', { stderr: result.stderr.substring(0, 200) });
    }
    return output;
  } catch (error) {
    logger.debug('RTK compression failed, using original output', {
      error: error instanceof Error ? error.message : String(error),
    });
    return output;
  }
}

export interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
}

/**
 * Estimate compression stats between original and compressed output.
 * Uses a simple whitespace-split token approximation.
 */
export function getCompressionStats(original: string, compressed: string): CompressionStats {
  const originalTokens = estimateTokens(original);
  const compressedTokens = estimateTokens(compressed);
  const ratio = originalTokens > 0 ? 1 - (compressedTokens / originalTokens) : 0;

  return { originalTokens, compressedTokens, ratio };
}

/**
 * Rough token count estimate (~4 chars per token, similar to GPT tokenizer average)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
