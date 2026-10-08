"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const webview_security_1 = require("../../utils/webview-security");
const config_validator_1 = require("../../utils/config-validator");
suite('Webview Security Utils', () => {
    test('getNonce should return 32 character string', () => {
        const nonce = (0, webview_security_1.getNonce)();
        assert.strictEqual(nonce.length, 32);
        assert.ok(/^[A-Za-z0-9]+$/.test(nonce), 'Nonce should be alphanumeric');
    });
    test('getNonce should return unique values', () => {
        const nonce1 = (0, webview_security_1.getNonce)();
        const nonce2 = (0, webview_security_1.getNonce)();
        assert.notStrictEqual(nonce1, nonce2, 'Nonces should be unique');
    });
    test('escapeHtml should escape special characters', () => {
        assert.strictEqual((0, webview_security_1.escapeHtml)('<script>'), '&lt;script&gt;');
        assert.strictEqual((0, webview_security_1.escapeHtml)('a & b'), 'a &amp; b');
        assert.strictEqual((0, webview_security_1.escapeHtml)('"quotes"'), '&quot;quotes&quot;');
        assert.strictEqual((0, webview_security_1.escapeHtml)("'apostrophe'"), '&#039;apostrophe&#039;');
    });
    test('escapeHtml should handle empty string', () => {
        assert.strictEqual((0, webview_security_1.escapeHtml)(''), '');
    });
    test('sanitizeForWebview should convert newlines to br', () => {
        const result = (0, webview_security_1.sanitizeForWebview)('line1\nline2');
        assert.ok(result.includes('<br>'));
    });
    test('sanitizeForWebview should convert tabs to spaces', () => {
        const result = (0, webview_security_1.sanitizeForWebview)('a\tb');
        assert.ok(result.includes('&nbsp;'));
    });
});
suite('Config Validator', () => {
    test('validateAIConfig should validate correct config', () => {
        const result = (0, config_validator_1.validateAIConfig)({
            provider: 'grok',
            apiKey: 'xai-test-key',
            model: 'grok-3',
        });
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.errors.length, 0);
    });
    test('validateAIConfig should reject invalid provider', () => {
        const result = (0, config_validator_1.validateAIConfig)({
            provider: 'invalid',
            apiKey: 'test-key',
            model: 'test',
        });
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('Invalid provider')));
    });
    test('validateAIConfig should require API key for non-Ollama', () => {
        const result = (0, config_validator_1.validateAIConfig)({
            provider: 'grok',
            apiKey: '',
            model: 'grok-3',
        });
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('API key is required')));
    });
    test('validateAIConfig should not require API key for Ollama', () => {
        const result = (0, config_validator_1.validateAIConfig)({
            provider: 'ollama',
            apiKey: '',
            model: 'llama3.2',
        });
        assert.strictEqual(result.valid, true);
    });
    test('validateAIConfig should warn about API key format', () => {
        const result = (0, config_validator_1.validateAIConfig)({
            provider: 'grok',
            apiKey: 'wrong-format',
            model: 'grok-3',
        });
        assert.ok(result.warnings.some(w => w.includes('xai-')));
    });
    test('validateAIConfig should validate base URL', () => {
        const result = (0, config_validator_1.validateAIConfig)({
            provider: 'grok',
            apiKey: 'xai-test',
            model: 'grok-3',
            baseUrl: 'not-a-url',
        });
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('Invalid base URL')));
    });
    test('getDefaultModel should return correct defaults', () => {
        assert.strictEqual((0, config_validator_1.getDefaultModel)('grok'), 'grok-3-latest');
        assert.strictEqual((0, config_validator_1.getDefaultModel)('claude'), 'claude-sonnet-5-5');
        assert.strictEqual((0, config_validator_1.getDefaultModel)('openai'), 'gpt-4o');
        assert.strictEqual((0, config_validator_1.getDefaultModel)('ollama'), 'llama3.2');
    });
    test('getDefaultBaseUrl should return correct defaults', () => {
        assert.strictEqual((0, config_validator_1.getDefaultBaseUrl)('grok'), 'https://api.x.ai/v1');
        assert.strictEqual((0, config_validator_1.getDefaultBaseUrl)('claude'), 'https://api.anthropic.com/v1');
        assert.strictEqual((0, config_validator_1.getDefaultBaseUrl)('openai'), 'https://api.openai.com/v1');
        assert.strictEqual((0, config_validator_1.getDefaultBaseUrl)('ollama'), 'http://localhost:11434/v1');
    });
});
//# sourceMappingURL=utils.test.js.map