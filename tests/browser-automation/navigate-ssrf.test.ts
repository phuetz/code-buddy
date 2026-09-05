/**
 * Security regression: the direct `navigate` action must apply the same SSRF
 * guard that batch-mode navigation does (browser-tool.ts). Previously a direct
 * navigate bypassed the guard entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigateSpy = vi.fn().mockResolvedValue(undefined);

// Stub the manager so no real browser / Playwright is loaded.
vi.mock('../../src/browser-automation/browser-manager.js', () => ({
  getBrowserManager: () => ({
    navigate: navigateSpy,
    getTitle: vi.fn().mockResolvedValue('Title'),
  }),
  BrowserManager: class {},
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { BrowserTool } from '../../src/browser-automation/browser-tool.js';

describe('navigate SSRF guard (parity with batch-mode)', () => {
  beforeEach(() => navigateSpy.mockClear());

  // Covers the signed-shift regression: every private range whose first octet
  // is >= 128 (169.254, 172.16, 192.168) previously bypassed the guard.
  it.each([
    ['loopback', 'http://127.0.0.1:8080/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['RFC1918 192.168', 'http://192.168.1.1/'],
    ['RFC1918 172.16/12', 'http://172.16.5.5/'],
    ['RFC1918 10/8', 'http://10.0.0.5/'],
    ['IPv6 loopback standard', 'http://[::1]:8080/'],
    ['IPv6 loopback bypass (leading zeros)', 'http://[::0001]:8080/'],
    ['IPv6 loopback bypass (uncompressed)', 'http://[0:0:0:0:0:0:0:1]:8080/'],
    ['IPv6 unspecified', 'http://[::]:8080/'],
    ['IPv6 ULA', 'http://[fc00::1]:8080/'],
    ['IPv6 link-local', 'http://[fe80::1]:8080/'],
    ['IPv6 site-local', 'http://[fec0::1]:8080/'],
    ['IPv6 documentation', 'http://[2001:db8::1]:8080/'],
    ['IPv6 ORCHID', 'http://[2001:10::1]:8080/'],
    ['IPv6 discard-only', 'http://[100::1]:8080/'],
  ])('blocks %s and never reaches manager.navigate', async (_label, url) => {
    const tool = new BrowserTool();
    const r = await tool.execute({ action: 'navigate', url });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/blocked/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['public 1.1.1.1', 'http://1.1.1.1/'],
    ['public 8.8.8.8', 'http://8.8.8.8/'],
    ['just outside 172.16/12', 'http://172.32.5.5/'],
  ])('allows %s through to the manager', async (_label, url) => {
    const tool = new BrowserTool();
    const r = await tool.execute({ action: 'navigate', url });
    expect(r.success).toBe(true);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  // S2 — non-http(s) schemes must NOT bypass the guard. A `file://` navigate
  // followed by get_html would otherwise read arbitrary local files (creds, keys)
  // into the model context.
  it.each([
    ['file:// local read', 'file:///home/user/.aws/credentials'],
    ['file:// etc passwd', 'file:///etc/passwd'],
    ['data: url', 'data:text/html,<script>1</script>'],
    ['about:config', 'about:config'],
    ['chrome scheme', 'chrome://settings'],
    ['ftp scheme', 'ftp://example.com/x'],
  ])('blocks non-http scheme: %s', async (_label, url) => {
    const tool = new BrowserTool();
    const r = await tool.execute({ action: 'navigate', url });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/blocked/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // S3 — an unparseable URL previously left `scheme=''` and skipped the guard.
  it('fails closed on an unparseable URL', async () => {
    const tool = new BrowserTool();
    const r = await tool.execute({ action: 'navigate', url: 'notaurl' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/blocked/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // about:blank is an inert empty page — explicitly allowed for practicality.
  it('allows about:blank', async () => {
    const tool = new BrowserTool();
    const r = await tool.execute({ action: 'navigate', url: 'about:blank' });
    expect(r.success).toBe(true);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });
});
