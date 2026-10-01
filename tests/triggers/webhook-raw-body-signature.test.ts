import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../src/triggers/webhook-trigger.js';
import crypto from 'crypto';

describe('verifyWebhookSignature', () => {
  it('should verify signature using rawBody for GitHub', () => {
    const secret = 'my-secret';
    // Raw JSON string where JSON.stringify of parsed object would differ
    const rawBody = '{ "a" : "<b>", "n":1 }';

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const signature = `sha256=${hmac.digest('hex')}`;

    const headers = { 'x-hub-signature-256': signature };

    // Simulate what body would be after express.json()
    const parsedBody = { a: '<b>', n: 1 };

    // Test the verification with rawBody
    const isValid = verifyWebhookSignature('github', headers, parsedBody, secret, rawBody);
    expect(isValid).toBe(true);
  });

  it('should verify signature using rawBody for Slack (urlencoded)', () => {
    const secret = 'slack-secret';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = 'command=%2Ftest&text=hello+world';

    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(sigBasestring);
    const signature = `v0=${hmac.digest('hex')}`;

    const headers = {
      'x-slack-signature': signature,
      'x-slack-request-timestamp': timestamp
    };

    // Simulate what body would be after express.urlencoded()
    const parsedBody = { command: '/test', text: 'hello world' };

    // Verify valid signature
    const isValid = verifyWebhookSignature('slack', headers, parsedBody, secret, rawBody);
    expect(isValid).toBe(true);

    // Verify invalid signature
    const isInvalid = verifyWebhookSignature('slack', headers, parsedBody, secret, rawBody + '1');
    expect(isInvalid).toBe(false);
  });
});
