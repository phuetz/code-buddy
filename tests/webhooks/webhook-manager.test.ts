import { WebhookManager } from '../../src/webhooks/webhook-manager.js';
import { createHmac } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('WebhookManager', () => {
  let mgr: WebhookManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'webhook-test-'));
    mgr = new WebhookManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should register a webhook with an ID', () => {
    const hook = mgr.register('test-hook', 'Deploy {{body.repo}}');
    expect(hook.id).toBeDefined();
    expect(hook.name).toBe('test-hook');
    expect(hook.agentMessage).toBe('Deploy {{body.repo}}');
    expect(hook.enabled).toBe(true);
  });

  it('should list all webhooks', () => {
    mgr.register('hook1', 'msg1');
    mgr.register('hook2', 'msg2');
    expect(mgr.list()).toHaveLength(2);
  });

  it('should get webhook by ID', () => {
    const hook = mgr.register('hook1', 'msg1');
    expect(mgr.get(hook.id)).toEqual(hook);
  });

  it('should return undefined for unknown ID', () => {
    expect(mgr.get('nonexistent')).toBeUndefined();
  });

  it('should remove a webhook', () => {
    const hook = mgr.register('hook1', 'msg1');
    expect(mgr.remove(hook.id)).toBe(true);
    expect(mgr.get(hook.id)).toBeUndefined();
    expect(mgr.list()).toHaveLength(0);
  });

  it('should return false when removing unknown webhook', () => {
    expect(mgr.remove('nonexistent')).toBe(false);
  });

  it('should toggle enabled flag', () => {
    const hook = mgr.register('hook1', 'msg1');
    expect(mgr.setEnabled(hook.id, false)).toBe(true);
    expect(mgr.get(hook.id)!.enabled).toBe(false);
    expect(mgr.setEnabled(hook.id, true)).toBe(true);
    expect(mgr.get(hook.id)!.enabled).toBe(true);
  });

  it('should return false when setting enabled on unknown webhook', () => {
    expect(mgr.setEnabled('nonexistent', true)).toBe(false);
  });

  it('should resolve template placeholders in processPayload', () => {
    const hook = mgr.register('hook1', 'Deploy {{body.repo}} branch {{body.branch}}');
    const result = mgr.processPayload(hook.id, { repo: 'my-app', branch: 'main' });
    expect(result).toEqual({ message: 'Deploy my-app branch main' });
  });

  it('should resolve nested template placeholders', () => {
    const hook = mgr.register('hook1', 'Repo: {{body.repo.name}} by {{body.repo.owner}}');
    const result = mgr.processPayload(hook.id, {
      repo: { name: 'my-app', owner: 'alice' },
    });
    expect(result).toEqual({ message: 'Repo: my-app by alice' });
  });

  it('should leave unresolved placeholders as-is', () => {
    const hook = mgr.register('hook1', 'Deploy {{body.missing}}');
    const result = mgr.processPayload(hook.id, {});
    expect(result).toEqual({ message: 'Deploy {{body.missing}}' });
  });

  it('should return error for unknown webhook ID', () => {
    const result = mgr.processPayload('nonexistent', {});
    expect(result).toEqual({ error: 'Webhook not found' });
  });

  it('should return error for disabled webhook', () => {
    const hook = mgr.register('hook1', 'msg');
    mgr.setEnabled(hook.id, false);
    const result = mgr.processPayload(hook.id, {});
    expect(result).toEqual({ error: 'Webhook is disabled' });
  });

  it('should reject missing signature when secret is set', () => {
    const hook = mgr.register('hook1', 'msg', 'my-secret');
    const result = mgr.processPayload(hook.id, {});
    expect(result).toEqual({ error: 'Missing signature' });
  });

  it('should reject invalid signature', () => {
    const hook = mgr.register('hook1', 'msg', 'my-secret');
    const result = mgr.processPayload(hook.id, { data: 'test' }, 'badsig');
    expect(result).toEqual({ error: 'Invalid signature' });
  });

  it('should accept valid HMAC signature', () => {
    const secret = 'my-secret';
    const hook = mgr.register('hook1', 'Got {{body.data}}', secret);
    const body = { data: 'hello' };
    const payload = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update(payload).digest('hex');
    const result = mgr.processPayload(hook.id, body, signature);
    expect(result).toEqual({ message: 'Got hello' });
  });

  it('should persist and reload webhooks', () => {
    const hook = mgr.register('hook1', 'msg1', 'secret1');
    const mgr2 = new WebhookManager(tempDir);
    const loaded = mgr2.get(hook.id);
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('hook1');
    expect(loaded!.secret).toBe('secret1');
  });
});
