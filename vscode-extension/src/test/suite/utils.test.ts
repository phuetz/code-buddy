import * as assert from 'assert';
import { getNonce, escapeHtml, sanitizeForWebview } from '../../utils/webview-security';
import { validateAIConfig, getDefaultModel, getDefaultBaseUrl } from '../../utils/config-validator';

suite('Webview Security Utils', () => {
  test('getNonce should return 32 character string', () => {
    const nonce = getNonce();
    assert.strictEqual(nonce.length, 32);
    assert.ok(/^[A-Za-z0-9]+$/.test(nonce), 'Nonce should be alphanumeric');
  });

  test('getNonce should return unique values', () => {
    const nonce1 = getNonce();
    const nonce2 = getNonce();
    assert.notStrictEqual(nonce1, nonce2, 'Nonces should be unique');
  });

  test('escapeHtml should escape special characters', () => {
    assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
    assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
    assert.strictEqual(escapeHtml('"quotes"'), '&quot;quotes&quot;');
    assert.strictEqual(escapeHtml("'apostrophe'"), '&#039;apostrophe&#039;');
  });

  test('escapeHtml should handle empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
  });

  test('sanitizeForWebview should convert newlines to br', () => {
    const result = sanitizeForWebview('line1\nline2');
    assert.ok(result.includes('<br>'));
  });

  test('sanitizeForWebview should convert tabs to spaces', () => {
    const result = sanitizeForWebview('a\tb');
    assert.ok(result.includes('&nbsp;'));
  });
});

suite('Config Validator', () => {
  test('validateAIConfig should validate correct config', () => {
    const result = validateAIConfig({
      provider: 'grok',
      apiKey: 'xai-test-key',
      model: 'grok-3',
    });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  test('validateAIConfig should reject invalid provider', () => {
    const result = validateAIConfig({
      provider: 'invalid',
      apiKey: 'test-key',
      model: 'test',
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid provider')));
  });

  test('validateAIConfig should require API key for non-Ollama', () => {
    const result = validateAIConfig({
      provider: 'grok',
      apiKey: '',
      model: 'grok-3',
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('API key is required')));
  });

  test('validateAIConfig should not require API key for Ollama', () => {
    const result = validateAIConfig({
      provider: 'ollama',
      apiKey: '',
      model: 'llama3.2',
    });
    assert.strictEqual(result.valid, true);
  });

  test('validateAIConfig should warn about API key format', () => {
    const result = validateAIConfig({
      provider: 'grok',
      apiKey: 'wrong-format',
      model: 'grok-3',
    });
    assert.ok(result.warnings.some(w => w.includes('xai-')));
  });

  test('validateAIConfig should validate base URL', () => {
    const result = validateAIConfig({
      provider: 'grok',
      apiKey: 'xai-test',
      model: 'grok-3',
      baseUrl: 'not-a-url',
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid base URL')));
  });

  test('getDefaultModel should return correct defaults', () => {
    assert.strictEqual(getDefaultModel('grok'), 'grok-3-latest');
    assert.strictEqual(getDefaultModel('claude'), 'claude-sonnet-5-5');
    assert.strictEqual(getDefaultModel('openai'), 'gpt-4o');
    assert.strictEqual(getDefaultModel('ollama'), 'llama3.2');
  });

  test('getDefaultBaseUrl should return correct defaults', () => {
    assert.strictEqual(getDefaultBaseUrl('grok'), 'https://api.x.ai/v1');
    assert.strictEqual(getDefaultBaseUrl('claude'), 'https://api.anthropic.com/v1');
    assert.strictEqual(getDefaultBaseUrl('openai'), 'https://api.openai.com/v1');
    assert.strictEqual(getDefaultBaseUrl('ollama'), 'http://localhost:11434/v1');
  });
});
