import * as readline from 'readline';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface OnboardingResult {
  provider: string;
  apiKey: string;
  model: string;
  ttsEnabled: boolean;
  ttsProvider?: string;
}

export const PROVIDER_ENV_MAP: Record<string, string> = {
  grok: 'GROK_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  chatgpt: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: '',
  lmstudio: '',
};

export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  grok: 'grok-3',
  claude: 'claude-sonnet-4-20250514',
  chatgpt: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3',
  lmstudio: 'default',
};

const PROVIDERS = ['grok', 'claude', 'chatgpt', 'gemini', 'ollama', 'lmstudio'];
const TTS_PROVIDERS = ['edge-tts', 'espeak', 'audioreader'];

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askChoice(rl: readline.Interface, question: string, choices: string[], defaultIdx: number): Promise<string> {
  return new Promise((resolve) => {
    console.log(`\n  ${question}`);
    choices.forEach((c, i) => console.log(`    ${i + 1}. ${c}${i === defaultIdx ? ' (default)' : ''}`));
    rl.question(`  Choice [${defaultIdx + 1}]: `, (answer) => {
      const idx = parseInt(answer) - 1;
      resolve(choices[idx >= 0 && idx < choices.length ? idx : defaultIdx]);
    });
  });
}

export function writeConfig(configDir: string, result: OnboardingResult): void {
  mkdirSync(configDir, { recursive: true });
  const config: Record<string, unknown> = {
    provider: result.provider,
    model: result.model,
    ttsEnabled: result.ttsEnabled,
  };
  if (result.ttsProvider) {
    config.ttsProvider = result.ttsProvider;
  }
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

export async function runOnboarding(): Promise<OnboardingResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║     Welcome to Code Buddy Setup!     ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log('  This wizard will help you configure Code Buddy.');
    console.log('');

    // 1. Provider selection
    const provider = await askChoice(rl, 'Which AI provider do you want to use?', PROVIDERS, 0);

    // 2. API Key
    const envVar = PROVIDER_ENV_MAP[provider];
    let apiKey = '';
    if (envVar) {
      console.log(`\n  You will need to set ${envVar} in your environment.`);
      apiKey = await ask(rl, `Enter your API key (or press Enter to set ${envVar} later)`);
    } else {
      console.log(`\n  No API key needed for ${provider} (local provider).`);
    }

    // 3. Model selection
    const defaultModel = PROVIDER_DEFAULT_MODEL[provider];
    const model = await ask(rl, 'Which model do you want to use?', defaultModel);

    // 4. TTS setup
    const ttsAnswer = await ask(rl, 'Enable text-to-speech? (y/n)', 'n');
    const ttsEnabled = ttsAnswer.toLowerCase() === 'y' || ttsAnswer.toLowerCase() === 'yes';
    let ttsProvider: string | undefined;
    if (ttsEnabled) {
      ttsProvider = await askChoice(rl, 'Which TTS provider?', TTS_PROVIDERS, 0);
    }

    const result: OnboardingResult = { provider, apiKey, model, ttsEnabled, ttsProvider };

    // 5. Write config
    const configDir = join(process.cwd(), '.codebuddy');
    writeConfig(configDir, result);

    // 6. Summary
    console.log('');
    console.log('  Setup complete! Configuration saved to .codebuddy/config.json');
    console.log('');
    console.log(`  Provider:  ${provider}`);
    console.log(`  Model:     ${model}`);
    if (ttsEnabled && ttsProvider) {
      console.log(`  TTS:       ${ttsProvider}`);
    }
    if (envVar && !apiKey) {
      console.log('');
      console.log(`  Remember to set ${envVar} in your environment before using Code Buddy.`);
    }
    console.log('');

    return result;
  } finally {
    rl.close();
  }
}
