import fs from 'fs';
import os from 'os';
import path from 'path';

export type HermesPortalToolKey = 'web' | 'image_gen' | 'tts' | 'browser' | 'modal';

export interface HermesPortalToolStatus {
  key: HermesPortalToolKey;
  label: string;
  partner: string;
  configured: boolean;
  managedByNous: boolean;
  currentProvider: string | null;
  credentialEnv: string[];
  notes: string[];
}

export interface HermesPortalStatus {
  kind: 'hermes_portal_status';
  schemaVersion: 1;
  generatedAt: string;
  officialSource: {
    repository: string;
    inspectedCommit: string;
    sourceFiles: string[];
  };
  portal: {
    defaultPortalUrl: string;
    subscriptionUrl: string;
    docsUrl: string;
    portalBaseUrl: string;
    inferenceBaseUrl: string;
    authFilePath: string;
    authFilePresent: boolean;
    credentialPresent: boolean;
    credentialSources: string[];
    loggedIn: boolean;
    toolGatewayUrl: string | null;
    toolGatewayConfigured: boolean;
    selectedInferenceProvider: string | null;
    selectedModel: string | null;
    selectedViaNous: boolean;
  };
  toolGateway: {
    tools: HermesPortalToolStatus[];
    configuredCount: number;
    managedByNousCount: number;
    notConfiguredCount: number;
  };
  notes: string[];
}

export interface HermesPortalStatusOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  homeDir?: string;
}

const DEFAULT_PORTAL_URL = 'https://portal.nousresearch.com';
const DEFAULT_INFERENCE_URL = 'https://inference-api.nousresearch.com/v1';
const SUBSCRIPTION_URL = 'https://portal.nousresearch.com/manage-subscription';
const DOCS_URL = 'https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-gateway';

const NOUS_CREDENTIAL_ENVS = [
  'CODEBUDDY_NOUS_ACCESS_TOKEN',
  'CODEBUDDY_NOUS_API_KEY',
  'NOUS_ACCESS_TOKEN',
  'NOUS_PORTAL_ACCESS_TOKEN',
  'NOUS_API_KEY',
] as const;

function envValue(env: NodeJS.ProcessEnv, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function presentEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(env[key]?.trim()));
}

function readJsonIfPresent(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function hasTokenLikeField(value: Record<string, unknown> | null): boolean {
  if (!value) return false;
  return ['access_token', 'refresh_token', 'invoke_jwt', 'api_key'].some((key) => {
    const field = value[key];
    return typeof field === 'string' && field.trim().length > 0;
  });
}

function normalizedManagedToolSet(env: NodeJS.ProcessEnv): Set<string> | 'all' {
  const raw = envValue(env, 'CODEBUDDY_NOUS_MANAGED_TOOLS', 'NOUS_MANAGED_TOOLS');
  if (!raw) return 'all';
  const values = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.includes('all') || values.includes('*')) return 'all';
  return new Set(values);
}

function isManagedByNous(
  key: HermesPortalToolKey,
  env: NodeJS.ProcessEnv,
  credentialPresent: boolean,
  toolGatewayConfigured: boolean,
): boolean {
  if (!credentialPresent || !toolGatewayConfigured) return false;
  const managed = normalizedManagedToolSet(env);
  return managed === 'all' || managed.has(key);
}

function buildToolStatus(
  key: HermesPortalToolKey,
  label: string,
  partner: string,
  directProvider: string | null,
  credentialEnv: string[],
  managedByNous: boolean,
  notes: string[] = [],
): HermesPortalToolStatus {
  return {
    key,
    label,
    partner,
    configured: managedByNous || directProvider !== null,
    managedByNous,
    currentProvider: managedByNous ? 'Nous Portal Tool Gateway' : directProvider,
    credentialEnv,
    notes,
  };
}

function directWebProvider(env: NodeJS.ProcessEnv): { provider: string | null; keys: string[]; notes: string[] } {
  const keys = presentEnvKeys(env, ['FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'PERPLEXITY_API_KEY', 'SERPER_API_KEY']);
  if (env.FIRECRAWL_API_KEY?.trim()) {
    return { provider: 'Firecrawl direct', keys, notes: [] };
  }
  if (keys.length > 0) {
    return { provider: 'Code Buddy web search direct', keys, notes: ['Firecrawl is not configured, but web search credentials are present.'] };
  }
  return { provider: 'Code Buddy DuckDuckGo fallback', keys, notes: ['Fallback web search is available without a vendor key.'] };
}

function directImageProvider(env: NodeJS.ProcessEnv): { provider: string | null; keys: string[]; notes: string[] } {
  const keys = presentEnvKeys(env, ['FAL_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'CODEBUDDY_IMAGE_API_KEY']);
  if (env.FAL_KEY?.trim()) return { provider: 'FAL direct', keys, notes: [] };
  if (env.CODEBUDDY_IMAGE_API_KEY?.trim()) return { provider: 'Code Buddy image provider override', keys, notes: [] };
  if (env.XAI_API_KEY?.trim()) return { provider: 'xAI image direct', keys, notes: [] };
  if (env.OPENAI_API_KEY?.trim()) return { provider: 'OpenAI image direct', keys, notes: [] };
  return { provider: null, keys, notes: [] };
}

function directTtsProvider(env: NodeJS.ProcessEnv): { provider: string | null; keys: string[]; notes: string[] } {
  const keys = presentEnvKeys(env, ['OPENAI_API_KEY', 'CODEBUDDY_TTS_PROVIDER', 'CODEBUDDY_AUDIOREADER_URL']);
  if (env.CODEBUDDY_TTS_PROVIDER?.trim()) return { provider: env.CODEBUDDY_TTS_PROVIDER.trim(), keys, notes: [] };
  if (env.CODEBUDDY_AUDIOREADER_URL?.trim()) return { provider: 'AudioReader local service', keys, notes: [] };
  if (env.OPENAI_API_KEY?.trim()) return { provider: 'OpenAI TTS direct', keys, notes: [] };
  if (process.platform === 'win32') return { provider: 'Windows SAPI local', keys, notes: ['Local system TTS is available on Windows.'] };
  if (process.platform === 'darwin') return { provider: 'macOS say local', keys, notes: ['Local system TTS is available on macOS.'] };
  return { provider: null, keys, notes: ['Install edge-tts or espeak for local TTS without cloud credentials.'] };
}

function directBrowserProvider(env: NodeJS.ProcessEnv): { provider: string | null; keys: string[]; notes: string[] } {
  const keys = presentEnvKeys(env, ['BROWSER_USE_API_KEY', 'BROWSERBASE_API_KEY', 'CODEBUDDY_BROWSER_CDP_URL']);
  if (env.BROWSER_USE_API_KEY?.trim()) return { provider: 'Browser Use direct', keys, notes: [] };
  if (env.BROWSERBASE_API_KEY?.trim()) return { provider: 'Browserbase direct', keys, notes: [] };
  if (env.CODEBUDDY_BROWSER_CDP_URL?.trim()) return { provider: 'Local CDP browser', keys, notes: [] };
  return { provider: 'Local Playwright browser', keys, notes: ['Code Buddy has a local Playwright-backed browser tool.'] };
}

function directModalProvider(env: NodeJS.ProcessEnv): { provider: string | null; keys: string[]; notes: string[] } {
  const keys = presentEnvKeys(env, ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'CODEBUDDY_MODAL_TOKEN']);
  if ((env.MODAL_TOKEN_ID?.trim() && env.MODAL_TOKEN_SECRET?.trim()) || env.CODEBUDDY_MODAL_TOKEN?.trim()) {
    return { provider: 'Modal direct', keys, notes: [] };
  }
  return { provider: null, keys, notes: ['Modal is optional in the upstream Hermes portal surface.'] };
}

export function buildHermesPortalStatus(options: HermesPortalStatusOptions = {}): HermesPortalStatus {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const portalBaseUrl = envValue(env, 'CODEBUDDY_NOUS_PORTAL_URL', 'NOUS_PORTAL_BASE_URL') ?? DEFAULT_PORTAL_URL;
  const inferenceBaseUrl = envValue(env, 'CODEBUDDY_NOUS_INFERENCE_BASE_URL', 'NOUS_INFERENCE_BASE_URL') ?? DEFAULT_INFERENCE_URL;
  const authFilePath = envValue(env, 'CODEBUDDY_NOUS_AUTH_FILE')
    ?? path.join(homeDir, '.codebuddy', 'nous_auth.json');
  const authFile = readJsonIfPresent(authFilePath);
  const authFilePresent = authFile !== null;
  const envCredentialSources = presentEnvKeys(env, NOUS_CREDENTIAL_ENVS);
  const credentialSources = [
    ...envCredentialSources,
    ...(hasTokenLikeField(authFile) ? [authFilePath] : []),
  ];
  const credentialPresent = credentialSources.length > 0;
  const toolGatewayUrl = envValue(env, 'CODEBUDDY_NOUS_TOOL_GATEWAY_URL', 'NOUS_TOOL_GATEWAY_URL');
  const explicitGatewayEnabled = ['1', 'true', 'yes', 'on'].includes(
    (envValue(env, 'CODEBUDDY_NOUS_TOOL_GATEWAY', 'NOUS_TOOL_GATEWAY') ?? '').toLowerCase(),
  );
  const toolGatewayConfigured = Boolean(toolGatewayUrl) || explicitGatewayEnabled;
  const selectedInferenceProvider = envValue(env, 'CODEBUDDY_PROVIDER', 'GROK_PROVIDER', 'AI_PROVIDER');
  const selectedModel = envValue(env, 'CODEBUDDY_MODEL', 'GROK_MODEL', 'OPENAI_MODEL');
  const explicitNousInferenceUrl = envValue(env, 'CODEBUDDY_NOUS_INFERENCE_BASE_URL', 'NOUS_INFERENCE_BASE_URL');
  const selectedViaNous = /nous/i.test(selectedInferenceProvider ?? '')
    || Boolean(explicitNousInferenceUrl && /nous/i.test(inferenceBaseUrl));

  const web = directWebProvider(env);
  const image = directImageProvider(env);
  const tts = directTtsProvider(env);
  const browser = directBrowserProvider(env);
  const modal = directModalProvider(env);

  const tools = [
    buildToolStatus('web', 'Web search & extract', 'Firecrawl', web.provider, web.keys, isManagedByNous('web', env, credentialPresent, toolGatewayConfigured), web.notes),
    buildToolStatus('image_gen', 'Image generation', 'FAL / image providers', image.provider, image.keys, isManagedByNous('image_gen', env, credentialPresent, toolGatewayConfigured), image.notes),
    buildToolStatus('tts', 'Text-to-speech', 'OpenAI TTS / local TTS', tts.provider, tts.keys, isManagedByNous('tts', env, credentialPresent, toolGatewayConfigured), tts.notes),
    buildToolStatus('browser', 'Browser automation', 'Browser Use / local Playwright', browser.provider, browser.keys, isManagedByNous('browser', env, credentialPresent, toolGatewayConfigured), browser.notes),
    buildToolStatus('modal', 'Cloud terminal', 'Modal', modal.provider, modal.keys, isManagedByNous('modal', env, credentialPresent, toolGatewayConfigured), modal.notes),
  ];

  return {
    kind: 'hermes_portal_status',
    schemaVersion: 1,
    generatedAt,
    officialSource: {
      repository: 'https://github.com/NousResearch/hermes-agent',
      inspectedCommit: '5921d667',
      sourceFiles: [
        'hermes_cli/portal_cli.py',
        'hermes_cli/auth.py',
        'tools/managed_tool_gateway.py',
      ],
    },
    portal: {
      defaultPortalUrl: DEFAULT_PORTAL_URL,
      subscriptionUrl: SUBSCRIPTION_URL,
      docsUrl: DOCS_URL,
      portalBaseUrl,
      inferenceBaseUrl,
      authFilePath,
      authFilePresent,
      credentialPresent,
      credentialSources,
      loggedIn: credentialPresent,
      toolGatewayUrl,
      toolGatewayConfigured,
      selectedInferenceProvider,
      selectedModel,
      selectedViaNous,
    },
    toolGateway: {
      tools,
      configuredCount: tools.filter((tool) => tool.configured).length,
      managedByNousCount: tools.filter((tool) => tool.managedByNous).length,
      notConfiguredCount: tools.filter((tool) => !tool.configured).length,
    },
    notes: [
      'This is a local readiness/status surface, not an OAuth device-code implementation.',
      'Secrets are intentionally reported only by source name/path, never by value.',
      'Nous-managed routing requires a Nous credential plus CODEBUDDY_NOUS_TOOL_GATEWAY_URL/NOUS_TOOL_GATEWAY_URL or CODEBUDDY_NOUS_TOOL_GATEWAY=1.',
    ],
  };
}

export function renderHermesPortalStatus(status: HermesPortalStatus): string {
  const lines = [
    'Hermes Nous Portal status:',
    `  Auth: ${status.portal.loggedIn ? 'logged in/configured' : 'not configured'}`,
    `  Portal: ${status.portal.portalBaseUrl}`,
    `  Inference API: ${status.portal.inferenceBaseUrl}`,
    `  Tool Gateway: ${status.portal.toolGatewayConfigured ? status.portal.toolGatewayUrl ?? 'enabled by env flag' : 'not configured'}`,
    `  Inference provider: ${status.portal.selectedInferenceProvider ?? 'not selected'}${status.portal.selectedViaNous ? ' (Nous)' : ''}`,
    '',
    'Tool Gateway catalog:',
  ];

  for (const tool of status.toolGateway.tools) {
    const state = tool.managedByNous
      ? 'via Nous Portal'
      : tool.currentProvider ?? 'not configured';
    const readinessFlags = `configured=${tool.configured ? 'yes' : 'no'}, viaNous=${tool.managedByNous ? 'yes' : 'no'}`;
    lines.push(`  ${tool.label.padEnd(22)} ${tool.partner.padEnd(28)} ${state} | ${readinessFlags}`);
  }

  lines.push('');
  lines.push(`Manage subscription: ${status.portal.subscriptionUrl}`);
  lines.push(`Docs: ${status.portal.docsUrl}`);
  return lines.join('\n');
}
