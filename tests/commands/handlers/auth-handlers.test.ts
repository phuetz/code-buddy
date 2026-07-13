/**
 * Phase d.23 — tests for /login, /logout, /whoami slash command handlers.
 * The handlers wrap codex-oauth — we mock the module and assert the
 * dispatch + the rendered output for each branch.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const oauthMock = vi.hoisted(() => ({
  loginInteractive: vi.fn(),
  clearCodexCredentials: vi.fn(),
  getChatGptAuth: vi.fn(),
  hasCodexCredentials: vi.fn(),
  getCodexAuthFilePath: vi.fn(() => '/tmp/codex-auth.json'),
}));

const modelMock = vi.hoisted(() => ({
  CHATGPT_OAUTH_DEFAULT_MODEL: 'gpt-5.6-sol',
  CHATGPT_OAUTH_SAFE_FALLBACK_MODEL: 'gpt-5.5',
  discoverChatGptModels: vi.fn(async () => ({ models: [], fetchedAt: 1 })),
  selectChatGptOAuthModel: vi.fn(() => 'gpt-5.6-sol'),
}));

vi.mock('../../../src/providers/codex-oauth.js', () => oauthMock);
vi.mock('../../../src/providers/chatgpt-models.js', () => modelMock);

import {
  handleLogin,
  handleLogout,
  handleWhoami,
} from '../../../src/commands/handlers/auth-handlers.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleLogin', () => {
  it('rejects unknown providers', async () => {
    const result = await handleLogin(['gemini-x']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toMatch(/Unknown provider/);
    expect(oauthMock.loginInteractive).not.toHaveBeenCalled();
  });

  it('runs the OAuth flow and shows email + plan on success', async () => {
    oauthMock.loginInteractive.mockResolvedValueOnce({
      access_token: 'tok',
      email: 'patrice@example.com',
      plan_type: 'plus',
      account_id: 'acct_1',
      is_fedramp: false,
    });

    const result = await handleLogin(['chatgpt']);
    expect(result.entry?.content).toContain('✅ Authenticated successfully');
    expect(result.entry?.content).toContain('patrice@example.com');
    expect(result.entry?.content).toContain('plus');
    expect(result.entry?.content).toContain('gpt-5.6-sol');
    expect(result.entry?.content).not.toContain('acct_1');
    expect(oauthMock.loginInteractive).toHaveBeenCalledTimes(1);
  });

  it('reports the error message on flow failure', async () => {
    oauthMock.loginInteractive.mockRejectedValueOnce(new Error('Login timed out after 5 minutes'));
    const result = await handleLogin([]);
    expect(result.entry?.content).toContain('❌ Login failed');
    expect(result.entry?.content).toContain('timed out');
  });

  it('treats no-arg /login as chatgpt (default provider)', async () => {
    oauthMock.loginInteractive.mockResolvedValueOnce({
      access_token: 't',
      email: undefined,
      plan_type: undefined,
      account_id: undefined,
      is_fedramp: false,
    });
    await handleLogin([]);
    expect(oauthMock.loginInteractive).toHaveBeenCalledTimes(1);
  });
});

describe('handleLogout', () => {
  it('says already-logged-out when no credentials on disk', async () => {
    oauthMock.hasCodexCredentials.mockReturnValueOnce(false);
    const result = await handleLogout(['chatgpt']);
    expect(result.entry?.content).toContain('already logged out');
    expect(oauthMock.clearCodexCredentials).not.toHaveBeenCalled();
  });

  it('clears credentials when present and confirms', async () => {
    oauthMock.hasCodexCredentials.mockReturnValueOnce(true);
    const result = await handleLogout(['chatgpt']);
    expect(oauthMock.clearCodexCredentials).toHaveBeenCalledTimes(1);
    expect(result.entry?.content).toContain('✅ ChatGPT credentials cleared');
  });
});

describe('handleWhoami', () => {
  it('says not connected when no credentials', async () => {
    oauthMock.hasCodexCredentials.mockReturnValueOnce(false);
    const result = await handleWhoami();
    expect(result.entry?.content).toContain('not connected');
  });

  it('shows email + plan when authenticated', async () => {
    oauthMock.hasCodexCredentials.mockReturnValueOnce(true);
    oauthMock.getChatGptAuth.mockResolvedValueOnce({
      access_token: 't',
      email: 'patrice@example.com',
      plan_type: 'plus',
      account_id: 'acct_1',
      is_fedramp: true,
    });
    const result = await handleWhoami();
    expect(result.entry?.content).toContain('connected');
    expect(result.entry?.content).toContain('patrice@example.com');
    expect(result.entry?.content).toContain('plus');
    expect(result.entry?.content).toContain('FedRAMP');
  });

  it('warns when credential file is unreadable', async () => {
    oauthMock.hasCodexCredentials.mockReturnValueOnce(true);
    oauthMock.getChatGptAuth.mockResolvedValueOnce(null);
    const result = await handleWhoami();
    expect(result.entry?.content).toMatch(/unreadable/);
  });
});
