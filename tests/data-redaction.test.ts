/**
 * Data Redaction Engine Tests
 */

import {
  DataRedactionEngine,
  getDataRedactionEngine,
  resetDataRedactionEngine,
  redactSecrets,
  containsSecrets,
} from '../src/security/data-redaction.js';

describe('DataRedactionEngine', () => {
  let engine: DataRedactionEngine;

  beforeEach(() => {
    resetDataRedactionEngine();
    engine = new DataRedactionEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('API Key Detection', () => {
    it('should redact OpenAI API keys', () => {
      const text = 'My API key is sk-1234567890abcdefghijklmnop';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:OPENAI_KEY]');
      expect(result.redacted).not.toContain('sk-1234567890');
      expect(result.redactions.length).toBeGreaterThan(0);
      expect(result.redactions[0].category).toBe('api_key');
    });

    it('should redact Anthropic API keys', () => {
      const text = 'Using key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:ANTHROPIC_KEY]');
      expect(result.redactions[0].severity).toBe('critical');
    });

    it('should redact xAI/Grok API keys', () => {
      const text = 'My key is xai-abcdefghijklmnopqrstuvwxyz1234';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:XAI_KEY]');
    });

    it('should redact AWS access keys', () => {
      const text = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:AWS_ACCESS_KEY]');
    });

    it('should redact Google API keys', () => {
      const text = 'Google key: AIzaSyC1234567890abcdefghijklmnopqrstuv';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:GOOGLE_KEY]');
    });

    it('should redact GitHub tokens', () => {
      const text = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const result = engine.redact(text);

      // ghp_ matches GITHUB_TOKEN pattern (gh[pousr]_)
      expect(result.redacted).toContain('[REDACTED:GITHUB_TOKEN]');
    });

    it('should redact Stripe keys', () => {
      const text = 'sk_live_FAKE_TEST_KEY_DO_NOT_USE_xxxxxx';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:STRIPE_KEY]');
    });
  });

  describe('Token Detection', () => {
    it('should redact JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const text = `Bearer ${jwt}`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:JWT]');
      expect(result.redactions[0].category).toBe('token');
    });

    it('should redact Bearer tokens', () => {
      const text = 'Authorization: Bearer abc123def456ghi789jkl012mno345pqr678';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:TOKEN]');
    });

    it('should redact Basic auth headers', () => {
      const text = 'Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM0NTY3ODk=';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:AUTH]');
    });
  });

  describe('Private Key Detection', () => {
    it('should redact RSA private keys', () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF0PEmLgGY0Y
-----END RSA PRIVATE KEY-----`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:RSA_PRIVATE_KEY]');
      expect(result.redactions[0].severity).toBe('critical');
    });

    it('should redact SSH private keys', () => {
      const text = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAA
-----END OPENSSH PRIVATE KEY-----`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:SSH_PRIVATE_KEY]');
    });
  });

  describe('Connection String Detection', () => {
    it('should redact PostgreSQL connection strings', () => {
      const text = 'DATABASE_URL=postgres://user:password123@localhost:5432/mydb';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:POSTGRES_URL]');
    });

    it('should redact MongoDB connection strings', () => {
      const text = 'MONGO_URI=mongodb+srv://admin:secretpass@cluster.mongodb.net/db';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:MONGODB_URL]');
    });

    it('should redact MySQL connection strings', () => {
      const text = 'mysql://root:mysecretpw@localhost:3306/database';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:MYSQL_URL]');
    });
  });

  describe('PII Detection', () => {
    it('should redact credit card numbers', () => {
      const text = 'Card: 4111111111111111';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:CREDIT_CARD]');
      expect(result.redactions[0].category).toBe('financial');
    });

    it('should redact SSN', () => {
      const text = 'SSN: 123-45-6789';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:SSN]');
      expect(result.redactions[0].category).toBe('pii');
    });
  });

  describe('Environment Variable Detection', () => {
    it('should redact password environment variables', () => {
      const text = 'PASSWORD=mysupersecretpassword123';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:ENV_SECRET]');
    });

    it('should redact secret environment variables', () => {
      const text = 'SECRET=mysupersecretvalue123456';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:ENV_SECRET]');
    });
  });

  describe('High Entropy String Detection', () => {
    it('should redact high-entropy strings', () => {
      // High entropy random string
      const text = 'Token: aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5';
      const result = engine.redact(text);

      // Should detect as high entropy or pattern match
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it('should not redact low-entropy strings', () => {
      const text = 'This is a normal sentence with aaaaaaaaaaaaaaaa';
      const result = engine.redact(text);

      // Low entropy repeated chars should not trigger
      const highEntropyRedactions = result.redactions.filter(
        r => r.pattern === 'High Entropy String'
      );
      expect(highEntropyRedactions.length).toBe(0);
    });
  });

  describe('Object Redaction', () => {
    it('should redact secrets in objects', () => {
      const obj = {
        name: 'test',
        apiKey: 'sk-1234567890abcdefghijklmnop',
        config: {
          password: 'secretpassword123456',
        },
      };

      const result = engine.redactObject(obj);

      expect(result.apiKey).toContain('[REDACTED');
      expect(result.config.password).toBe('[REDACTED]');
    });

    it('should redact arrays in objects', () => {
      const obj = {
        items: ['sk-abc123456789012345678901', 'normal-value'],
      };

      const result = engine.redactObject(obj);

      expect(result.items[0]).toContain('[REDACTED');
      expect(result.items[1]).toBe('normal-value');
    });
  });

  describe('Whitelist', () => {
    it('should not redact whitelisted values', () => {
      engine.addToWhitelist('test-key');
      const text = 'API_KEY=test-key-12345678901234567890';
      const result = engine.redact(text);

      expect(result.redactions.length).toBe(0);
    });
  });

  describe('Custom Patterns', () => {
    it('should support custom patterns', () => {
      engine.addPattern({
        name: 'Custom Secret',
        pattern: /CUSTOM_[A-Z0-9]{10}/g,
        replacement: '[REDACTED:CUSTOM]',
        category: 'custom',
        severity: 'high',
      });

      const text = 'Value: CUSTOM_ABC1234567';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:CUSTOM]');
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', () => {
      const text = `
        API_KEY=sk-1234567890abcdefghijklmnop
        PASSWORD=secret123456789
        Card: 4111111111111111
      `;
      const result = engine.redact(text);

      expect(result.stats.totalRedactions).toBeGreaterThanOrEqual(3);
      expect(result.stats.bySeverity.critical).toBeGreaterThan(0);
    });
  });

  describe('Enable/Disable', () => {
    it('should not redact when disabled', () => {
      engine.setEnabled(false);
      const text = 'sk-1234567890abcdefghijklmnop';
      const result = engine.redact(text);

      expect(result.redacted).toBe(text);
      expect(result.redactions.length).toBe(0);
    });

    it('should redact when re-enabled', () => {
      engine.setEnabled(false);
      engine.setEnabled(true);
      const text = 'sk-1234567890abcdefghijklmnop';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED');
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const instance1 = getDataRedactionEngine();
      const instance2 = getDataRedactionEngine();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getDataRedactionEngine();
      resetDataRedactionEngine();
      const instance2 = getDataRedactionEngine();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Utility Functions', () => {
    it('redactSecrets should work', () => {
      const result = redactSecrets('Key: sk-1234567890abcdefghijklmnop');
      expect(result).toContain('[REDACTED');
    });

    it('containsSecrets should detect secrets', () => {
      expect(containsSecrets('sk-1234567890abcdefghijklmnop')).toBe(true);
      expect(containsSecrets('normal text')).toBe(false);
    });
  });
});
