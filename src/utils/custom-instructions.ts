import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';

export function loadCustomInstructions(workingDirectory: string = process.cwd()): string | null {
  try {
    const instructionsPath = path.join(workingDirectory, '.codebuddy', 'GROK.md');

    if (!fs.existsSync(instructionsPath)) {
      return null;
    }

    const customInstructions = fs.readFileSync(instructionsPath, 'utf-8');
    return customInstructions.trim();
  } catch (error) {
    logger.warn('Failed to load custom instructions', { error: String(error) });
    return null;
  }
}
