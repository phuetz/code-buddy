/**
 * Authentication slash command handlers — Phase d.23.
 *
 * - `/login chatgpt` — opens the browser, runs the OAuth Authorization
 *   Code + PKCE flow against `auth.openai.com`, persists tokens to
 *   `~/.codebuddy/codex-auth.json`, displays email/plan.
 * - `/logout chatgpt` — wipes the credential file.
 * - `/whoami` — shows the current ChatGPT auth state (email, plan,
 *   FedRAMP marker) or "Anonymous".
 *
 * `chatgpt` is the only provider routed here; other providers (Gemini,
 * Anthropic) use API-key env vars and don't need a login command.
 */

import { ChatEntry } from '../../agent/codebuddy-agent.js';
import type { CommandHandlerResult } from './branch-handlers.js';
import {
  loginInteractive,
  clearCodexCredentials,
  getChatGptAuth,
  hasCodexCredentials,
  getCodexAuthFilePath,
} from '../../providers/codex-oauth.js';
import {
  CHATGPT_OAUTH_DEFAULT_MODEL,
  CHATGPT_OAUTH_SAFE_FALLBACK_MODEL,
  discoverChatGptModels,
  selectChatGptOAuthModel,
} from '../../providers/chatgpt-models.js';

function makeEntry(content: string): ChatEntry {
  return {
    type: 'assistant',
    content,
    timestamp: new Date(),
  };
}

function describeProvider(args: string[]): 'chatgpt' | 'unknown' {
  const raw = (args[0] ?? 'chatgpt').toLowerCase().trim();
  if (raw === '' || raw === 'chatgpt' || raw === 'codex' || raw === 'openai') {
    return 'chatgpt';
  }
  return 'unknown';
}

async function appendModelStatus(
  lines: string[],
  auth: NonNullable<Awaited<ReturnType<typeof getChatGptAuth>>>,
): Promise<void> {
  const catalog = await discoverChatGptModels(auth);
  const model = selectChatGptOAuthModel(CHATGPT_OAUTH_DEFAULT_MODEL, catalog);
  lines.push(`   Model:   ${model}`);
  if (!catalog) {
    lines.push(`   Discovery unavailable; safe fallback: ${CHATGPT_OAUTH_SAFE_FALLBACK_MODEL}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// /login [provider]
// ─────────────────────────────────────────────────────────────────────

export async function handleLogin(args: string[]): Promise<CommandHandlerResult> {
  const provider = describeProvider(args);
  const lines: string[] = [];

  if (provider !== 'chatgpt') {
    lines.push(`Unknown provider: "${args[0]}". Only \`chatgpt\` is supported.`);
    lines.push('Other providers (Gemini, Anthropic, Grok) authenticate via API key env vars.');
    return { handled: true, entry: makeEntry(lines.join('\n')) };
  }

  lines.push('🔐 ChatGPT login');
  lines.push('='.repeat(50));
  lines.push('Opening your browser to https://auth.openai.com/oauth/authorize ...');
  lines.push('Sign in with your ChatGPT account, then return to this terminal.');
  lines.push('');

  try {
    const auth = await loginInteractive();
    lines.push('✅ Authenticated successfully');
    if (auth.email) lines.push(`   Account: ${auth.email}`);
    if (auth.plan_type) lines.push(`   Plan:    ${auth.plan_type}`);
    if (auth.is_fedramp) lines.push(`   FedRAMP: yes`);
    await appendModelStatus(lines, auth);
    lines.push('');
    lines.push(`Tokens stored at: ${getCodexAuthFilePath()}`);
    lines.push(`Use ${CHATGPT_OAUTH_DEFAULT_MODEL} or another model exposed by your ChatGPT account.`);
  } catch (err) {
    lines.push('❌ Login failed');
    lines.push(`   ${err instanceof Error ? err.message : String(err)}`);
    lines.push('');
    lines.push('Run `/login chatgpt` again to retry.');
  }

  return { handled: true, entry: makeEntry(lines.join('\n')) };
}

// ─────────────────────────────────────────────────────────────────────
// /logout [provider]
// ─────────────────────────────────────────────────────────────────────

export async function handleLogout(args: string[]): Promise<CommandHandlerResult> {
  const provider = describeProvider(args);
  const lines: string[] = [];

  if (provider !== 'chatgpt') {
    lines.push(`Unknown provider: "${args[0]}". Only \`chatgpt\` is supported.`);
    return { handled: true, entry: makeEntry(lines.join('\n')) };
  }

  if (!hasCodexCredentials()) {
    lines.push('No ChatGPT credentials on disk — already logged out.');
    return { handled: true, entry: makeEntry(lines.join('\n')) };
  }

  clearCodexCredentials();
  lines.push('✅ ChatGPT credentials cleared');
  lines.push(`   Removed: ${getCodexAuthFilePath()}`);
  lines.push('Run `/login chatgpt` to authenticate again.');

  return { handled: true, entry: makeEntry(lines.join('\n')) };
}

// ─────────────────────────────────────────────────────────────────────
// /whoami
// ─────────────────────────────────────────────────────────────────────

export async function handleWhoami(): Promise<CommandHandlerResult> {
  const lines: string[] = [];
  lines.push('Authentication status');
  lines.push('='.repeat(50));

  if (!hasCodexCredentials()) {
    lines.push('ChatGPT: not connected (run `/login chatgpt`)');
    return { handled: true, entry: makeEntry(lines.join('\n')) };
  }

  try {
    const auth = await getChatGptAuth();
    if (!auth) {
      lines.push('ChatGPT: token unreadable (file present but no access_token).');
      lines.push('  Try `/logout chatgpt` then `/login chatgpt`.');
      return { handled: true, entry: makeEntry(lines.join('\n')) };
    }
    lines.push('ChatGPT: ✅ connected');
    if (auth.email) lines.push(`  Account: ${auth.email}`);
    if (auth.plan_type) lines.push(`  Plan:    ${auth.plan_type}`);
    if (auth.is_fedramp) lines.push(`  FedRAMP: yes`);
    await appendModelStatus(lines, auth);
  } catch (err) {
    lines.push('ChatGPT: ⚠️  error reading credentials');
    lines.push(`  ${err instanceof Error ? err.message : String(err)}`);
  }

  return { handled: true, entry: makeEntry(lines.join('\n')) };
}
