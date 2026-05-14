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
  hasCodeBuddyCodexCredentials: vi.fn(),
  hasCodexCredentials: vi.fn(),
  getActiveCodexAuthFilePath: vi.fn(() => null),
  getCodexAuthFilePath: vi.fn(() => '/tmp/codex-auth.json'),
  getSharedCodexAuthFilePath: vi.fn(() => '/tmp/shared-codex-auth.json'),
}));

vi.mock('../../../src/providers/codex-oauth.js', () => oauthMock);

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
    oauthMock.hasCodeBuddyCodexCredentials.mockReturnValueOnce(true);
    oauthMock.getActiveCodexAuthFilePath.mockReturnValueOnce(null);
    const result = await handleLogout(['chatgpt']);
    expect(oauthMock.clearCodexCredentials).toHaveBeenCalledTimes(1);
    expect(result.entry?.content).toContain('✅ Code Buddy ChatGPT credentials cleared');
  });

  it('does not delete shared Codex credentials when only shared auth is active', async () => {
    oauthMock.hasCodexCredentials.mockReturnValueOnce(true);
    oauthMock.hasCodeBuddyCodexCredentials.mockReturnValueOnce(false);
    oauthMock.getActiveCodexAuthFilePath.mockReturnValueOnce('/tmp/shared-codex-auth.json');
    const result = await handleLogout(['chatgpt']);
    expect(oauthMock.clearCodexCredentials).not.toHaveBeenCalled();
    expect(result.entry?.content).toContain('Shared Codex ChatGPT credentials are still available');
    expect(result.entry?.content).toContain('/tmp/shared-codex-auth.json');
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
