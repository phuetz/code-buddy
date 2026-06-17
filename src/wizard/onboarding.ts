import * as readline from 'readline';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface OnboardingResult {
  provider: string;
  apiKey: string;
  model: string;
  ttsEnabled: boolean;
  ttsProvider?: string;
  authMode?: OnboardingAuthMode;
  recommendedNextCommands?: string[];
}

export type OnboardingAuthMode = 'oauth' | 'api-key' | 'local';

export interface OnboardingProviderGuide {
  id: string;
  label: string;
  authMode: OnboardingAuthMode;
  envVar: string;
  defaultModel: string;
  /** Inference base URL — persisted so the chosen provider resolves on the
   *  next run (the provider strategy in client.ts is picked from baseURL). */
  baseURL?: string;
  setupCommand?: string;
  verifyCommand: string;
  help: string;
}

export interface OnboardingPhase {
  id: string;
  title: string;
  hermesPhase: string;
  codeBuddyAction: string;
  successCheck: string;
}

export const PROVIDER_ENV_MAP: Record<string, string> = {
  chatgpt: '',
  grok: 'GROK_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: '',
  lmstudio: '',
};

export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  chatgpt: 'gpt-5.5',
  grok: 'grok-3',
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3',
  lmstudio: 'default',
};

export const PROVIDER_AUTH_MODE: Record<string, OnboardingAuthMode> = {
  chatgpt: 'oauth',
  grok: 'api-key',
  claude: 'api-key',
  gemini: 'api-key',
  ollama: 'local',
  lmstudio: 'local',
};

export const PROVIDER_GUIDES: OnboardingProviderGuide[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT subscription (OAuth)',
    authMode: 'oauth',
    envVar: '',
    defaultModel: 'gpt-5.5',
    setupCommand: 'buddy login',
    verifyCommand: 'buddy whoami',
    help: 'One browser login unlocks the ChatGPT-backed Codex route; no OPENAI_API_KEY is required.',
  },
  {
    id: 'grok',
    label: 'Grok / xAI API key',
    authMode: 'api-key',
    envVar: 'GROK_API_KEY',
    defaultModel: 'grok-3',
    baseURL: 'https://api.x.ai/v1',
    verifyCommand: 'buddy doctor',
    help: 'Set GROK_API_KEY in your shell or secret manager.',
  },
  {
    id: 'claude',
    label: 'Anthropic Claude API key',
    authMode: 'api-key',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    baseURL: 'https://api.anthropic.com/v1',
    verifyCommand: 'buddy doctor',
    help: 'Set ANTHROPIC_API_KEY in your shell or secret manager.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini API key',
    authMode: 'api-key',
    envVar: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    verifyCommand: 'buddy doctor',
    help: 'Set GEMINI_API_KEY in your shell or secret manager.',
  },
  {
    id: 'ollama',
    label: 'Ollama local model',
    authMode: 'local',
    envVar: '',
    defaultModel: 'llama3',
    baseURL: 'http://localhost:11434/v1',
    setupCommand: 'ollama serve',
    verifyCommand: 'curl http://localhost:11434/api/tags',
    help: 'Run Ollama locally and pull the model you selected.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio local server',
    authMode: 'local',
    envVar: '',
    defaultModel: 'default',
    baseURL: 'http://localhost:1234/v1',
    verifyCommand: 'curl http://localhost:1234/v1/models',
    help: 'Start the LM Studio local server before launching Code Buddy.',
  },
];

export const ONBOARDING_PHASES: OnboardingPhase[] = [
  {
    id: 'install',
    title: 'Install and diagnose',
    hermesPhase: 'Install Hermes Agent, then run doctor when anything looks off.',
    codeBuddyAction: 'Install Code Buddy, then run buddy doctor.',
    successCheck: 'doctor reports Node.js and core dependencies as usable.',
  },
  {
    id: 'provider',
    title: 'Choose provider and authenticate',
    hermesPhase: 'Choose a provider; the fastest path is hermes setup --portal.',
    codeBuddyAction: 'Prefer buddy login for ChatGPT OAuth, or configure an API/local provider.',
    successCheck: 'buddy whoami or buddy doctor confirms the selected credential source.',
  },
  {
    id: 'first-chat',
    title: 'Run a verifiable first chat',
    hermesPhase: 'Start the CLI/TUI and ask a specific prompt with observable success.',
    codeBuddyAction: 'Run buddy with a repo summary prompt.',
    successCheck: 'the answer names files or tools from the current workspace.',
  },
  {
    id: 'session-resume',
    title: 'Verify session resume',
    hermesPhase: 'Run --continue before moving to advanced workflows.',
    codeBuddyAction: 'Run buddy --continue or buddy session list.',
    successCheck: 'the previous session is visible and resumable.',
  },
  {
    id: 'next-layer',
    title: 'Add the next layer',
    hermesPhase: 'Only after base chat works, add tools, skills, gateway, MCP, voice, or sandboxing.',
    codeBuddyAction: 'Pick one: buddy --init, buddy server, buddy skills, Cowork, Fleet, companion, or sandbox mode.',
    successCheck: 'the selected layer has a doctor/status command or a focused smoke prompt.',
  },
];

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
      const selectedIdx = idx >= 0 && idx < choices.length ? idx : defaultIdx;
      resolve(choices[selectedIdx] ?? choices[0] ?? '');
    });
  });
}

/** Read a secret without echoing it (masks keystrokes with '*'). The captured
 *  value is always correct regardless of echo; masking is cosmetic, and falls
 *  back to a visible prompt if the terminal doesn't support muting. */
function askSecret(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    const rlAny = rl as unknown as { _writeToOutput?: (s: string) => void };
    const original = rlAny._writeToOutput?.bind(rl);
    let muted = false;
    if (typeof original === 'function') {
      rlAny._writeToOutput = (str: string) => {
        if (!muted || /[\r\n]/.test(str)) original(str);
        else original('*'.repeat(str.length || 1));
      };
    }
    rl.question(`  ${question}: `, (answer) => {
      if (typeof original === 'function') rlAny._writeToOutput = original;
      resolve(answer.trim());
    });
    muted = true;
  });
}

/**
 * Persist the chosen provider so the session works now AND on the next run:
 *   - provider + baseURL + model → `~/.codebuddy/user-settings.json`
 *     (loadBaseURL/loadModel read it; the provider strategy is picked from baseURL).
 *   - an entered API key → encrypted credential store (never plaintext in settings),
 *     plus `process.env[envVar]` so the current process resolves immediately.
 *   - ollama → default `OLLAMA_HOST` so auto-detection picks it up.
 * All writes are best-effort; the wizard summary still prints on failure.
 */
export async function persistProviderSelection(
  guide: OnboardingProviderGuide,
  model: string,
  apiKey: string
): Promise<void> {
  try {
    const { getSettingsManager } = await import('../utils/settings-manager.js');
    getSettingsManager().saveUserSettings({
      provider: guide.id,
      defaultModel: model,
      model,
      ...(guide.baseURL ? { baseURL: guide.baseURL } : {}),
    });
  } catch { /* non-fatal */ }

  if (guide.authMode === 'api-key' && apiKey) {
    try {
      const { getCredentialManager } = await import('../security/credential-manager.js');
      getCredentialManager().setApiKey(apiKey);
    } catch { /* non-fatal */ }
    if (guide.envVar) process.env[guide.envVar] = apiKey;
  }

  if (guide.id === 'ollama' && !process.env.OLLAMA_HOST) {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
  }
}

export function writeConfig(configDir: string, result: OnboardingResult): void {
  mkdirSync(configDir, { recursive: true });
  const authMode = result.authMode ?? getProviderGuide(result.provider).authMode;
  const recommendedNextCommands =
    result.recommendedNextCommands ?? buildRecommendedNextCommands(result);
  const config: Record<string, unknown> = {
    provider: result.provider,
    model: result.model,
    authMode,
    ttsEnabled: result.ttsEnabled,
    onboarding: {
      version: 1,
      phases: ONBOARDING_PHASES.map((phase) => phase.id),
      recommendedNextCommands,
    },
  };
  if (result.ttsProvider) {
    config.ttsProvider = result.ttsProvider;
  }
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

export function getProviderGuide(provider: string): OnboardingProviderGuide {
  return (
    PROVIDER_GUIDES.find((guide) => guide.id === provider)
    ?? PROVIDER_GUIDES.find((guide) => guide.id === 'chatgpt')
    ?? {
      id: 'chatgpt',
      label: 'ChatGPT subscription (OAuth)',
      authMode: 'oauth',
      envVar: '',
      defaultModel: 'gpt-5.5',
      setupCommand: 'buddy login',
      verifyCommand: 'buddy whoami',
      help: 'Use ChatGPT OAuth.',
    }
  );
}

export function buildRecommendedNextCommands(result: Pick<OnboardingResult, 'provider' | 'model' | 'apiKey'>): string[] {
  const guide = getProviderGuide(result.provider);
  const commands: string[] = [];

  if (guide.authMode === 'oauth') {
    commands.push(guide.setupCommand ?? 'buddy login');
    commands.push(guide.verifyCommand);
  } else if (guide.authMode === 'api-key' && guide.envVar && !result.apiKey) {
    commands.push(`export ${guide.envVar}=<your_api_key>`);
    commands.push(guide.verifyCommand);
  } else if (guide.authMode === 'local') {
    if (guide.setupCommand) commands.push(guide.setupCommand);
    commands.push(guide.verifyCommand);
  } else {
    commands.push(guide.verifyCommand);
  }

  commands.push(`buddy --model ${result.model} -p "Summarize this repo in 5 bullets and name the main entry point."`);
  commands.push('buddy --continue');
  commands.push('buddy --init');
  return Array.from(new Set(commands));
}

export function renderOnboardingRoadmap(result?: Pick<OnboardingResult, 'provider' | 'model' | 'apiKey'>): string {
  const nextCommands = result ? buildRecommendedNextCommands(result) : [];
  const lines: string[] = [
    '  Hermes-style onboarding phases:',
    ...ONBOARDING_PHASES.map((phase, index) =>
      `    ${index + 1}. ${phase.title} — ${phase.codeBuddyAction}`
    ),
  ];
  if (nextCommands.length) {
    lines.push('', '  Recommended next commands:');
    nextCommands.forEach((command) => lines.push(`    ${command}`));
  }
  return lines.join('\n');
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
    console.log(renderOnboardingRoadmap());
    console.log('');

    // 1. Provider selection
    const provider = await askChoice(
      rl,
      'Which AI provider do you want to use?',
      PROVIDER_GUIDES.map((guide) => `${guide.id} — ${guide.label}`),
      0
    ).then((choice) => choice.split(/\s+—\s+/)[0] ?? choice);
    const guide = getProviderGuide(provider);

    // 2. Model selection (needed before we persist the provider).
    const model = await ask(rl, 'Which model do you want to use?', guide.defaultModel);

    // 3. Authentication — captured inline so you leave the wizard ready to chat.
    const envVar = guide.envVar;
    let apiKey = '';
    let oauthDone = false;
    if (guide.authMode === 'oauth') {
      const doNow = (await ask(rl, 'Sign in with your ChatGPT account now? (Y/n)', 'y')).toLowerCase();
      if (doNow === 'y' || doNow === 'yes') {
        try {
          const { loginInteractive } = await import('../providers/codex-oauth.js');
          rl.pause();
          const auth = await loginInteractive();
          rl.resume();
          oauthDone = true;
          console.log(`\n  ✅ Signed in${auth.email ? ` as ${auth.email}` : ''}.`);
        } catch (err) {
          try { rl.resume(); } catch { /* ignore */ }
          console.log(`\n  ⚠️ Sign-in didn't complete (${err instanceof Error ? err.message : String(err)}).`);
          console.log(`  Finish later with: ${guide.setupCommand ?? 'buddy login'}`);
        }
      } else {
        console.log(`  No problem — run \`${guide.setupCommand ?? 'buddy login'}\` when you're ready.`);
      }
    } else if (guide.authMode === 'api-key' && envVar) {
      console.log(`\n  ${guide.help}`);
      apiKey = await askSecret(rl, `Enter your ${envVar} (or press Enter to set it later)`);
    } else {
      console.log(`\n  ${guide.help}`);
    }

    // 4. TTS setup
    const ttsAnswer = await ask(rl, 'Enable text-to-speech? (y/n)', 'n');
    const ttsEnabled = ttsAnswer.toLowerCase() === 'y' || ttsAnswer.toLowerCase() === 'yes';
    let ttsProvider: string | undefined;
    if (ttsEnabled) {
      ttsProvider = await askChoice(rl, 'Which TTS provider?', TTS_PROVIDERS, 0);
    }

    // 5. Persist credentials + provider so the session works now and next run.
    await persistProviderSelection(guide, model, apiKey);

    const result: OnboardingResult = {
      provider,
      apiKey,
      model,
      ttsEnabled,
      authMode: guide.authMode,
      recommendedNextCommands: buildRecommendedNextCommands({ provider, apiKey, model }),
      ...(ttsProvider ? { ttsProvider } : {}),
    };

    // 6. Write project config
    writeConfig(join(process.cwd(), '.codebuddy'), result);

    // 7. Summary
    const ready =
      oauthDone ||
      (guide.authMode === 'api-key' && Boolean(apiKey)) ||
      guide.authMode === 'local';
    console.log('');
    console.log(`  ${ready ? 'Setup complete — you\'re ready to go!' : 'Setup saved.'}`);
    console.log('');
    console.log(`  Provider:  ${provider}`);
    console.log(`  Auth:      ${guide.authMode}${oauthDone ? ' (signed in)' : guide.authMode === 'api-key' && apiKey ? ' (key saved)' : ''}`);
    console.log(`  Model:     ${model}`);
    if (ttsEnabled && ttsProvider) {
      console.log(`  TTS:       ${ttsProvider}`);
    }
    if (guide.authMode === 'oauth' && !oauthDone) {
      console.log('');
      console.log(`  Next: run \`${guide.setupCommand ?? 'buddy login'}\` to finish signing in.`);
    } else if (guide.authMode === 'api-key' && !apiKey && envVar) {
      console.log('');
      console.log(`  Next: set ${envVar} in your environment (or re-run \`buddy onboard\`).`);
    } else if (guide.authMode === 'local') {
      console.log('');
      console.log(`  Next: make sure your local server is running (${guide.setupCommand ?? guide.verifyCommand}).`);
    }
    console.log('');
    console.log(renderOnboardingRoadmap(result));
    console.log('');

    return result;
  } finally {
    rl.close();
  }
}
