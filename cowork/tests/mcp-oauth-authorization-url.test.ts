import { describe, it, expect, vi } from 'vitest';
import { CoworkMcpOAuthProvider } from '../src/main/mcp/mcp-oauth';

describe('CoworkMcpOAuthProvider - openExternal validation', () => {
  it('allows safe https and loopback http URLs', () => {
    const openExternal = vi.fn();
    const provider = new CoworkMcpOAuthProvider({ openExternal });

    provider.redirectToAuthorization(new URL('https://auth.example.com/authorize?x=1'));
    expect(openExternal).toHaveBeenCalledWith('https://auth.example.com/authorize?x=1');

    provider.redirectToAuthorization(new URL('http://127.0.0.1:9000/a'));
    expect(openExternal).toHaveBeenCalledWith('http://127.0.0.1:9000/a');

    provider.redirectToAuthorization(new URL('http://localhost:9000/a'));
    expect(openExternal).toHaveBeenCalledWith('http://localhost:9000/a');

    provider.redirectToAuthorization(new URL('http://[::1]:9000/a'));
    expect(openExternal).toHaveBeenCalledWith('http://[::1]:9000/a');
  });

  it('rejects forbidden schemes and URLs with credentials', () => {
    const openExternal = vi.fn();
    const provider = new CoworkMcpOAuthProvider({ openExternal });

    const badUrls = [
      'file:///etc/passwd',
      'smb://evil/share',
      'ms-msdt://x',
      'javascript:alert(1)',
      'http://auth.example.com/a',
      'https://user:pw@auth.example.com/'
    ];

    for (const badUrl of badUrls) {
      expect(() => provider.redirectToAuthorization(new URL(badUrl))).toThrow(/URL d'autorisation OAuth refusée/);
      expect(openExternal).not.toHaveBeenCalled();
    }
  });
});
