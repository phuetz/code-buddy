const mocks = vi.hoisted(() => ({ dnsLookup: vi.fn() }));
vi.mock('dns/promises', () => ({ lookup: mocks.dnsLookup }));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CloudAgentRunner, readContextFiles } from '../../src/cloud/cloud-agent-runner.js';
import { removeTestDir } from '../helpers/tmp.js';

describe('CloudAgentRunner Egress & Path Traversal', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-egress-test-'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    mocks.dnsLookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.dnsLookup.mockReset();
    removeTestDir(tmpRoot);
  });

  describe('Webhook SSRF guard', () => {
    it('fetch espionné : should not fetch private/internal SSRF URLs', async () => {
      const runner = new CloudAgentRunner();

      // We will cast runner to any to access private fireWebhook for testing
      const privateFireWebhook = (runner as any).fireWebhook.bind(runner);

      const task: any = { id: 'task1', status: 'completed', result: 'ok' };

      await privateFireWebhook('http://169.254.169.254/x', task);
      expect(fetch).not.toHaveBeenCalled();

      await privateFireWebhook('http://127.0.0.1:8080/x', task);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fetch espionné : should fetch public URL exactly once with redirect: manual', async () => {
      const runner = new CloudAgentRunner();
      const privateFireWebhook = (runner as any).fireWebhook.bind(runner);

      const task: any = { id: 'task1', status: 'completed', result: 'ok' };

      await privateFireWebhook('https://example.com/hook', task);

      expect(fetch).toHaveBeenCalledTimes(1);
      const fetchArgs = vi.mocked(fetch).mock.calls[0];
      expect(fetchArgs[0]).toBe('https://example.com/hook');
      expect(fetchArgs[1]).toMatchObject({
        method: 'POST',
        redirect: 'manual' // Check redirect manual is set
      });
    });
  });

  describe('readContextFiles path traversal', () => {
    it('readContextFiles only returns allowed files inside root', () => {
      const okFile = path.join(tmpRoot, 'ok.txt');
      fs.writeFileSync(okFile, 'content_ok');

      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-egress-out-'));
      const horsFile = path.join(outsideDir, 'hors.txt');
      fs.writeFileSync(horsFile, 'content_hors');

      // Let's create a symlink to test realpath
      const symlinkFile = path.join(tmpRoot, 'sym.txt');
      fs.symlinkSync(horsFile, symlinkFile);

      // We don't use absolute /etc/passwd in test because it might not exist on all OSes, but we can simulate path traversal

      // Assume readContextFiles is exported from cloud-agent-runner.js
      const result = readContextFiles([
        okFile, // allowed
        horsFile, // absolute outside
        path.join(tmpRoot, '../', path.basename(outsideDir), 'hors.txt'), // relative outside
        symlinkFile // symlink outside
      ], tmpRoot);

      expect(result).toContain('content_ok');
      expect(result).not.toContain('content_hors');

      removeTestDir(outsideDir);
    });
  });
});
