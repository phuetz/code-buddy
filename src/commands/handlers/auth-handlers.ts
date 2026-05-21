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
    if (auth.account_id) lines.push(`   Account ID: ${auth.account_id}`);
    lines.push('');
    lines.push(`Tokens stored at: ${getCodexAuthFilePath()}`);
    lines.push('Use `gpt-5.5` or another supported ChatGPT model. Try a message now.');
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
    if (auth.account_id) lines.push(`  Account ID: ${auth.account_id}`);
    if (auth.is_fedramp) lines.push(`  FedRAMP: yes`);
  } catch (err) {
    lines.push('ChatGPT: ⚠️  error reading credentials');
    lines.push(`  ${err instanceof Error ? err.message : String(err)}`);
  }

  return { handled: true, entry: makeEntry(lines.join('\n')) };
}
