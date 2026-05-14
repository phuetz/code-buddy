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
import { detectProviderFromEnv, type DetectedProvider } from './provider-detector.js';

// ============================================================================
// Types
// ============================================================================

export interface SetupConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  provider?: DetectedProvider['provider'];
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
  const detectedProvider = detectProviderFromEnv();

  console.log('\n' + '='.repeat(60));
  console.log('  Code Buddy - Interactive Setup');
  console.log('='.repeat(60) + '\n');

  console.log('Welcome to Code Buddy! Let\'s configure your settings.\n');

  // Step 1: API Key
  console.log('Step 1/4: API Key Configuration');
  console.log('--------------------------------');
  console.log('Code Buddy can use ChatGPT login, xAI/Grok, OpenAI, Gemini, Anthropic, or a local provider.');
  console.log('xAI/Grok API keys are stored in ~/.codebuddy/user-settings.json when entered here.\n');

  if (detectedProvider && detectedProvider.provider !== 'grok') {
    config.provider = detectedProvider.provider;
    console.log(`Existing provider detected: ${detectedProvider.provider}`);
    if (detectedProvider.provider === 'chatgpt') {
      console.log('Using your ChatGPT login; no API key will be stored by setup.');
    } else {
      console.log('Using provider credentials from your environment.');
    }
    rl.close();
  } else {
    const existingKey = detectedProvider?.apiKey || process.env.GROK_API_KEY || loadExistingApiKey();
    if (existingKey) {
      const masked = existingKey.slice(0, 8) + '...' + existingKey.slice(-4);
      console.log(`Existing xAI/Grok API key found: ${masked}`);
      const useExisting = await question(rl, 'Use existing key? (Y/n): ');
      if (useExisting.toLowerCase() !== 'n') {
        config.apiKey = existingKey;
        config.provider = 'grok';
      }
    }

    if (!config.apiKey) {
      rl.close();
      config.apiKey = await questionHidden('Enter your xAI/Grok API key: ');
      const rl2 = createInterface();

      if (config.apiKey) {
        config.provider = 'grok';
      } else {
        console.log('No API key provided. You can set credentials later with:');
        console.log('  buddy login chatgpt');
        console.log('  export GROK_API_KEY=your-key');
        console.log('  or another provider API key such as OPENAI_API_KEY / GEMINI_API_KEY\n');
      }

      rl2.close();
    } else {
      rl.close();
    }
  }

  const rl3 = createInterface();
  const defaultBaseURL = detectedProvider?.baseURL || 'https://api.x.ai/v1';
  const modelChoices = getModelChoices(detectedProvider);

  // Step 2: Base URL
  console.log('\nStep 2/4: API Base URL');
  console.log('----------------------');
  console.log(`Default: ${defaultBaseURL}`);
  console.log('For local models (LM Studio, Ollama), use: http://localhost:1234/v1\n');

  const baseURL = await question(rl3, 'Base URL (press Enter for default): ');
  if (baseURL) {
    config.baseURL = baseURL;
  }

  // Step 3: Model
  console.log('\nStep 3/4: Default Model');
  console.log('-----------------------');
  console.log('Available models:');
  console.log(`  1. ${modelChoices[0].model} (${modelChoices[0].label})`);
  console.log(`  2. ${modelChoices[1].model} (${modelChoices[1].label})`);
  console.log(`  3. ${modelChoices[2].model} (${modelChoices[2].label})`);
  console.log('  4. Custom model name\n');

  const modelChoice = await question(rl3, `Select model (1-4, or press Enter for ${modelChoices[0].model}): `);

  switch (modelChoice) {
    case '1':
    case '':
      config.model = modelChoices[0].model;
      break;
    case '2':
      config.model = modelChoices[1].model;
      break;
    case '3':
      config.model = modelChoices[2].model;
      break;
    case '4':
      config.model = await question(rl3, 'Enter custom model name: ');
      break;
    default:
      if (modelChoice) {
        config.model = modelChoice;
      } else {
        config.model = modelChoices[0].model;
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

function getModelChoices(provider?: DetectedProvider | null): Array<{ model: string; label: string }> {
  const defaultModel = provider?.defaultModel;

  switch (provider?.provider) {
    case 'chatgpt':
      return [
        { model: defaultModel || 'gpt-5.5', label: 'ChatGPT Pro default' },
        { model: 'gpt-5.4', label: 'frontier coding' },
        { model: 'gpt-5.4-mini', label: 'fast secondary model' },
      ];
    case 'openai':
      return [
        { model: defaultModel || 'gpt-4o', label: 'OpenAI default' },
        { model: 'gpt-4o-mini', label: 'fast OpenAI model' },
        { model: 'gpt-4.1', label: 'larger OpenAI model' },
      ];
    case 'gemini':
      return [
        { model: defaultModel || 'gemini-2.5-flash', label: 'Gemini default' },
        { model: 'gemini-2.5-pro', label: 'larger Gemini model' },
        { model: 'gemini-2.0-flash', label: 'fast Gemini model' },
      ];
    case 'anthropic':
      return [
        { model: defaultModel || 'claude-sonnet-4-20250514', label: 'Anthropic default' },
        { model: 'claude-opus-4-20250514', label: 'larger Claude model' },
        { model: 'claude-3-5-haiku-20241022', label: 'fast Claude model' },
      ];
    case 'ollama':
      return [
        { model: defaultModel || 'qwen2.5-coder:7b', label: 'local default' },
        { model: 'llama3.2', label: 'local general model' },
        { model: 'codellama', label: 'local code model' },
      ];
    default:
      return [
        { model: defaultModel || 'grok-3-latest', label: 'xAI capable model' },
        { model: 'grok-4-latest', label: 'latest xAI model' },
        { model: 'grok-code-fast-1', label: 'fast code generation' },
      ];
  }
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

    console.log('  Provider: ' + (config.provider || 'grok'));
    console.log('  API Key: ' + (config.apiKey ? 'Saved' : config.provider ? 'Using detected credentials' : 'Not set'));
    console.log('  Base URL: ' + (config.baseURL || 'provider default'));
    console.log('  Model: ' + (config.model || 'provider default'));
    console.log('  Theme: ' + (config.theme || 'default'));
  } catch (error) {
    logger.error('Failed to save configuration:', error as Error);
  }
}

/**
 * Check if setup is needed (no API key configured)
 */
export function needsSetup(): boolean {
  if (detectProviderFromEnv()) {
    return false;
  }

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
