/**
 * Interactive Setup - Inspired by Mistral Vibe CLI
 *
 * Interactive wizard for configuring Code Buddy:
 * - API key setup
 * - Model selection
 * - Base URL configuration
 * - Theme selection
 */

import fs from 'fs';
import { logger } from "./logger.js";
import path from 'path';
import readline from 'readline';
import { getCodeBuddyHome, ensureCodeBuddyHome } from './codebuddy-home.js';

// ============================================================================
// Types
// ============================================================================

export interface SetupConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  theme?: string;
}

// ============================================================================
// Readline Utilities
// ============================================================================

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Disable echo for password input
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);

      let input = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (char: string) => {
        // Handle special characters
        if (char === '\n' || char === '\r') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          rl.close();
          console.log(); // New line after input
          resolve(input);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.stdin.setRawMode(false);
          process.exit(0);
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += char;
          process.stdout.write('*');
        }
      };

      process.stdin.on('data', onData);
    } else {
      // Non-TTY, just read normally
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

// ============================================================================
// Setup Wizard
// ============================================================================

/**
 * Run the interactive setup wizard
 */
export async function runSetup(): Promise<SetupConfig> {
  const rl = createInterface();
  const config: SetupConfig = {};

  console.log('\n' + '='.repeat(60));
  console.log('  Code Buddy - Interactive Setup');
  console.log('='.repeat(60) + '\n');

  console.log('Welcome to Code Buddy! Let\'s configure your settings.\n');

  // Step 1: API Key
  console.log('Step 1/4: API Key Configuration');
  console.log('--------------------------------');
  console.log('You need a CodeBuddy API key from https://x.ai');
  console.log('The key will be stored in ~/.codebuddy/user-settings.json\n');

  const existingKey = process.env.GROK_API_KEY || loadExistingApiKey();
  if (existingKey) {
    const masked = existingKey.slice(0, 8) + '...' + existingKey.slice(-4);
    console.log(`Existing API key found: ${masked}`);
    const useExisting = await question(rl, 'Use existing key? (Y/n): ');
    if (useExisting.toLowerCase() !== 'n') {
      config.apiKey = existingKey;
    }
  }

  if (!config.apiKey) {
    rl.close();
    config.apiKey = await questionHidden('Enter your CodeBuddy API key: ');
    const rl2 = createInterface();

    if (!config.apiKey) {
      console.log('No API key provided. You can set it later with:');
      console.log('  export GROK_API_KEY=your-key');
      console.log('  or in ~/.codebuddy/user-settings.json\n');
    }

    rl2.close();
  } else {
    rl.close();
  }

  const rl3 = createInterface();

  // Step 2: Base URL
  console.log('\nStep 2/4: API Base URL');
  console.log('----------------------');
  console.log('Default: https://api.x.ai/v1');
  console.log('For local models (LM Studio, Ollama), use: http://localhost:1234/v1\n');

  const baseURL = await question(rl3, 'Base URL (press Enter for default): ');
  if (baseURL) {
    config.baseURL = baseURL;
  }

  // Step 3: Model
  console.log('\nStep 3/4: Default Model');
  console.log('-----------------------');
  console.log('Available models:');
  console.log('  1. grok-3-latest (most capable)');
  console.log('  2. grok-4-latest (latest)');
  console.log('  3. grok-code-fast-1 (fast code generation)');
  console.log('  4. Custom model name\n');

  const modelChoice = await question(rl3, 'Select model (1-4, or press Enter for grok-3-latest): ');

  switch (modelChoice) {
    case '1':
    case '':
      config.model = 'grok-3-latest';
      break;
    case '2':
      config.model = 'grok-4-latest';
      break;
    case '3':
      config.model = 'grok-3-fast';
      break;
    case '4':
      config.model = await question(rl3, 'Enter custom model name: ');
      break;
    default:
      if (modelChoice) {
        config.model = modelChoice;
      } else {
        config.model = 'grok-3-latest';
      }
  }

  // Step 4: Theme
  console.log('\nStep 4/4: UI Theme');
  console.log('------------------');
  console.log('Available themes:');
  console.log('  1. default (balanced colors)');
  console.log('  2. dark (dark background)');
  console.log('  3. neon (vibrant colors)');
  console.log('  4. minimal (clean, simple)');
  console.log('  5. high-contrast (accessibility)\n');

  const themeChoice = await question(rl3, 'Select theme (1-5, or press Enter for default): ');

  switch (themeChoice) {
    case '1':
    case '':
      config.theme = 'default';
      break;
    case '2':
      config.theme = 'dark';
      break;
    case '3':
      config.theme = 'neon';
      break;
    case '4':
      config.theme = 'minimal';
      break;
    case '5':
      config.theme = 'high-contrast';
      break;
    default:
      config.theme = themeChoice || 'default';
  }

  rl3.close();

  // Save configuration
  console.log('\n' + '-'.repeat(60));
  console.log('Saving configuration...');

  await saveConfig(config);

  console.log('\nSetup complete! Your settings have been saved to:');
  console.log(`  ${path.join(getCodeBuddyHome(), 'user-settings.json')}\n`);

  console.log('You can now run codebuddy to start using the CLI.\n');
  console.log('Quick start:');
  console.log('  codebuddy "Hello, Code Buddy!"');
  console.log('  codebuddy --help');
  console.log('  codebuddy --list-models\n');

  return config;
}

/**
 * Load existing API key from settings
 */
function loadExistingApiKey(): string | undefined {
  try {
    const settingsPath = path.join(getCodeBuddyHome(), 'user-settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return settings.apiKey;
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

/**
 * Save configuration to user settings
 */
async function saveConfig(config: SetupConfig): Promise<void> {
  try {
    ensureCodeBuddyHome();
    const settingsPath = path.join(getCodeBuddyHome(), 'user-settings.json');

    // Load existing settings
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }

    // Update settings
    if (config.apiKey) {
      settings.apiKey = config.apiKey;
    }
    if (config.baseURL) {
      settings.baseURL = config.baseURL;
    }
    if (config.model) {
      settings.model = config.model;
    }
    if (config.theme) {
      settings.theme = config.theme;
    }

    // Save
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    console.log('  API Key: ' + (config.apiKey ? 'Saved' : 'Not set'));
    console.log('  Base URL: ' + (config.baseURL || 'https://api.x.ai/v1 (default)'));
    console.log('  Model: ' + (config.model || 'grok-3-latest'));
    console.log('  Theme: ' + (config.theme || 'default'));
  } catch (error) {
    logger.error('Failed to save configuration:', error as Error);
  }
}

/**
 * Check if setup is needed (no API key configured)
 */
export function needsSetup(): boolean {
  if (process.env.GROK_API_KEY) {
    return false;
  }

  try {
    const settingsPath = path.join(getCodeBuddyHome(), 'user-settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return !settings.apiKey;
    }
  } catch {
    // Ignore errors
  }

  return true;
}

/**
 * Get log file path
 */
export function getLogPath(): string {
  return path.join(getCodeBuddyHome(), 'codebuddy.log');
}

/**
 * Format log file info
 */
export function formatLogInfo(): string {
  const logPath = getLogPath();
  const lines: string[] = [];

  lines.push('Log File Information');
  lines.push('='.repeat(50));
  lines.push(`Path: ${logPath}`);

  if (fs.existsSync(logPath)) {
    const stats = fs.statSync(logPath);
    lines.push(`Size: ${formatBytes(stats.size)}`);
    lines.push(`Modified: ${stats.mtime.toLocaleString()}`);
  } else {
    lines.push('Status: No log file exists yet');
  }

  lines.push('\nTo view logs:');
  lines.push(`  tail -f ${logPath}`);
  lines.push(`  less ${logPath}`);

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' bytes';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
