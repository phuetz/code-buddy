import * as readline from 'readline';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  getValidationConfigForGuide,
  validateProviderKey,
  type ProviderOnboardingConfig,
} from './provider-onboarding.js';

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
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  ollama: '',
  lmstudio: '',
};

export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  chatgpt: 'gpt-5.6-sol',
  grok: 'grok-3',
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o',
  ollama: 'llama3',
  lmstudio: 'default',
};

export const PROVIDER_AUTH_MODE: Record<string, OnboardingAuthMode> = {
  chatgpt: 'oauth',
  grok: 'api-key',
  claude: 'api-key',
  gemini: 'api-key',
  openai: 'api-key',
  openrouter: 'api-key',
  ollama: 'local',
  lmstudio: 'local',
};

export const PROVIDER_GUIDES: OnboardingProviderGuide[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT subscription (OAuth)',
    authMode: 'oauth',
    envVar: '',
    defaultModel: 'gpt-5.6-sol',
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
    id: 'openai',
    label: 'OpenAI API key',
    authMode: 'api-key',
    envVar: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
    verifyCommand: 'buddy doctor',
    help: 'Set OPENAI_API_KEY (https://platform.openai.com/api-keys).',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter API key',
    authMode: 'api-key',
    envVar: 'OPENROUTER_API_KEY',
    defaultModel: 'openai/gpt-4o',
    baseURL: 'https://openrouter.ai/api/v1',
    verifyCommand: 'buddy doctor',
    help: 'Set OPENROUTER_API_KEY (https://openrouter.ai/keys).',
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
      defaultModel: 'gpt-5.6-sol',
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

/**
 * Capture an API key and verify it against the provider's `/models` endpoint
 * before we persist it (Hermes parity: a bad key is rejected here, not saved to
 * silently break the first chat). Up to 3 attempts. On a connectivity error
 * (not an auth rejection) the last-entered key can be kept and verified later,
 * so a transient network blip doesn't discard an otherwise-good key.
 */
async function captureAndValidateKey(
  rl: readline.Interface,
  guide: OnboardingProviderGuide,
  config?: ProviderOnboardingConfig
): Promise<{ apiKey: string; verified: boolean; models?: string[] }> {
  const maxAttempts = 3;
  let lastKey = '';
  let lastErrorWasAuth = true;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const key = await askSecret(rl, `Enter your ${guide.envVar} (or press Enter to set it later)`);
    if (!key) break;
    lastKey = key;
    if (!config) {
      // No known validation endpoint — accept as entered, can't probe.
      return { apiKey: key, verified: false };
    }
    console.log('  Validating…');
    const result = await validateProviderKey(config, key);
    if (result.valid) {
      console.log(`  ✓ Key verified — ${guide.label} reachable.`);
      return { apiKey: key, verified: true, ...(result.models ? { models: result.models } : {}) };
    }
    lastErrorWasAuth = (result.error ?? '').toLowerCase().includes('invalid api key');
    const left = maxAttempts - attempt;
    console.log(`  ✗ ${result.error}`);
    if (left > 0) {
      console.log(`  Try again (${left} attempt${left === 1 ? '' : 's'} left), or press Enter to skip.`);
    }
  }
  // Exhausted/skipped. If the failure was connectivity (not a rejected key),
  // offer to keep the entered key and verify on the next run.
  if (lastKey && !lastErrorWasAuth) {
    const keep = (await ask(rl, 'Could not reach the provider. Save this key anyway and verify later? (y/N)', 'n'))
      .toLowerCase();
    if (keep === 'y' || keep === 'yes') {
      return { apiKey: lastKey, verified: false };
    }
  }
  return { apiKey: '', verified: false };
}

/**
 * Pick a model. When the provider handed us a real model list (from the
 * validation probe), choose from it; otherwise fall back to free-text entry.
 */
async function selectModel(
  rl: readline.Interface,
  guide: OnboardingProviderGuide,
  availableModels?: string[]
): Promise<string> {
  const models = (availableModels ?? []).filter(Boolean);
  if (models.length === 0) {
    return ask(rl, 'Which model do you want to use?', guide.defaultModel);
  }
  const CUSTOM = '✏️  Enter a custom model id…';
  const MAX_SHOWN = 30;
  const shown = models.slice(0, MAX_SHOWN);
  if (models.length > MAX_SHOWN) {
    console.log(
      `\n  (${models.length} models available; showing the first ${MAX_SHOWN} — pick "custom" to type any id.)`
    );
  }
  const choices = [...shown, CUSTOM];
  const defaultIdx = shown.indexOf(guide.defaultModel) >= 0 ? shown.indexOf(guide.defaultModel) : 0;
  const picked = await askChoice(rl, 'Which model do you want to use?', choices, defaultIdx);
  if (picked === CUSTOM) {
    return ask(rl, 'Enter the model id', guide.defaultModel);
  }
  return picked;
}

/**
 * A light "what's enabled now / add later" capability snapshot for the closing
 * summary — the Hermes-style reassurance that the agent is ready, derived from
 * env vars actually present. Kept deliberately minimal (getting-started scope).
 */
function renderCapabilitiesFooter(): string {
  const has = (vars: string[]): boolean => vars.some((v) => Boolean(process.env[v]));
  const webSearch = has(['BRAVE_API_KEY', 'EXA_API_KEY', 'PERPLEXITY_API_KEY', 'TAVILY_API_KEY']);
  return [
    '  Capabilities:',
    '    ✓ Code tools — file edit, shell, search',
    '    ✓ Text-to-speech (edge-tts, offline fallback)',
    webSearch
      ? '    ✓ Web search'
      : '    ○ Web search — add BRAVE_API_KEY or EXA_API_KEY to enable',
  ].join('\n');
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
    const validationConfig = getValidationConfigForGuide(provider);

    // 2. Authentication — captured AND verified inline so you leave the wizard
    //    ready to chat. A rejected key never gets persisted; a successful probe
    //    also hands us the provider's real model list for step 3.
    const envVar = guide.envVar;
    let apiKey = '';
    let oauthDone = false;
    let verified = false;
    let availableModels: string[] | undefined;
    if (guide.authMode === 'oauth') {
      const doNow = (await ask(rl, 'Sign in with your ChatGPT account now? (Y/n)', 'y')).toLowerCase();
      if (doNow === 'y' || doNow === 'yes') {
        try {
          const { loginInteractive } = await import('../providers/codex-oauth.js');
          rl.pause();
          const auth = await loginInteractive();
          rl.resume();
          oauthDone = true;
          verified = true;
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
      const captured = await captureAndValidateKey(rl, guide, validationConfig);
      apiKey = captured.apiKey;
      verified = captured.verified;
      availableModels = captured.models;
    } else if (guide.authMode === 'local' && validationConfig) {
      // Local providers: probe connectivity and list installed models. This is
      // the real round-trip for the free path (no key required).
      console.log(`\n  Checking ${guide.label}…`);
      const probe = await validateProviderKey(validationConfig, '');
      if (probe.valid) {
        verified = true;
        availableModels = probe.models;
        console.log(`  ✓ ${guide.label} is running (${probe.models?.length ?? 0} model(s) available).`);
      } else {
        console.log(`  ⚠️ Could not reach ${guide.label}: ${probe.error}`);
        console.log(`  ${guide.help}`);
      }
    } else {
      console.log(`\n  ${guide.help}`);
    }

    // 3. Model selection — from the real list when the probe gave us one.
    const model = await selectModel(rl, guide, availableModels);

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
    const ready = verified || (guide.authMode === 'api-key' && Boolean(apiKey));
    console.log('');
    console.log(`  ${ready ? 'Setup complete — you\'re ready to go!' : 'Setup saved.'}`);
    console.log('');
    console.log(`  Provider:  ${provider}`);
    console.log(`  Auth:      ${guide.authMode}${oauthDone ? ' (signed in)' : guide.authMode === 'api-key' && apiKey ? ' (key saved)' : ''}`);
    console.log(`  Model:     ${model}`);
    if (ttsEnabled && ttsProvider) {
      console.log(`  TTS:       ${ttsProvider}`);
    }
    if (verified) {
      const modelNote = availableModels?.includes(model) ? `, model ${model} available` : '';
      console.log('');
      console.log(`  ✓ Verified — ${provider} reachable${modelNote}.`);
    }
    console.log('');
    console.log(renderCapabilitiesFooter());
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
