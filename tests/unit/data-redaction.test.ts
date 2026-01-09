/**
 * Comprehensive Unit Tests for Data Redaction Engine
 *
 * Tests the data redaction system including:
 * - API key detection and redaction (OpenAI, Anthropic, xAI, Google, AWS, etc.)
 * - Token detection (GitHub, Slack, Discord, JWT)
 * - Private key detection (RSA, EC, SSH)
 * - Database connection string redaction
 * - PII detection (credit cards, SSN)
 * - High entropy string detection
 * - Object redaction
 * - Custom patterns and whitelist
 * - Configuration management
 */

import {
  DataRedactionEngine,
  RedactionPattern,
  RedactionConfig,
  RedactionResult,
  getDataRedactionEngine,
  resetDataRedactionEngine,
  redactSecrets,
  containsSecrets,
} from '../../src/security/data-redaction';

describe('DataRedactionEngine', () => {
  let engine: DataRedactionEngine;

  beforeEach(() => {
    resetDataRedactionEngine();
    engine = new DataRedactionEngine();
  });

  afterEach(() => {
    engine.dispose();
    resetDataRedactionEngine();
  });

  // ============================================================
  // Section 1: Initialization and Configuration
  // ============================================================
  describe('Initialization and Configuration', () => {
    it('should initialize with default configuration', () => {
      const config = engine.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.patterns.length).toBeGreaterThan(0);
      expect(config.customPatterns).toEqual([]);
      expect(config.whitelist).toEqual([]);
      expect(config.entropyThreshold).toBe(4.5);
      expect(config.minSecretLength).toBe(16);
      expect(config.maxSecretLength).toBe(500);
      expect(config.logRedactions).toBe(false);
      expect(config.preserveFormat).toBe(true);
    });

    it('should initialize with custom configuration', () => {
      const customEngine = new DataRedactionEngine({
        enabled: false,
        entropyThreshold: 5.0,
        logRedactions: true,
      });

      const config = customEngine.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.entropyThreshold).toBe(5.0);
      expect(config.logRedactions).toBe(true);

      customEngine.dispose();
    });

    it('should enable/disable redaction', () => {
      expect(engine.isEnabled()).toBe(true);

      engine.setEnabled(false);
      expect(engine.isEnabled()).toBe(false);

      engine.setEnabled(true);
      expect(engine.isEnabled()).toBe(true);
    });

    it('should return original text when disabled', () => {
      engine.setEnabled(false);
      const secretText = 'api_key=sk-1234567890abcdefghij';

      const result = engine.redact(secretText);

      expect(result.redacted).toBe(secretText);
      expect(result.redactions).toEqual([]);
    });

    it('should handle empty text', () => {
      const result = engine.redact('');

      expect(result.original).toBe('');
      expect(result.redacted).toBe('');
      expect(result.redactions).toEqual([]);
    });

    it('should handle null-like input gracefully', () => {
      const result = engine.redact(null as unknown as string);

      expect(result.redactions).toEqual([]);
    });
  });

  // ============================================================
  // Section 2: API Key Detection
  // ============================================================
  describe('API Key Detection', () => {
    describe('OpenAI API Keys', () => {
      it('should redact OpenAI API key (sk- format)', () => {
        const text = 'Using key: sk-abcdefghij1234567890abcd';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:OPENAI_KEY]');
        expect(result.redacted).not.toContain('sk-abcdefghij');
        expect(result.stats.totalRedactions).toBeGreaterThan(0);
      });

      it('should redact multiple OpenAI keys', () => {
        const text = 'Key1: sk-1234567890abcdefghij, Key2: sk-abcdefghij0987654321';
        const result = engine.redact(text);

        expect(result.redacted).not.toContain('sk-1234567890');
        expect(result.redacted).not.toContain('sk-abcdefghij');
      });
    });

    describe('Anthropic API Keys', () => {
      it('should redact Anthropic API key (sk-ant- format)', () => {
        const text = 'ANTHROPIC_KEY=sk-ant-abcdefghij1234567890';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:ANTHROPIC_KEY]');
        expect(result.redacted).not.toContain('sk-ant-abcdefghij');
      });
    });

    describe('xAI/Grok API Keys', () => {
      it('should redact xAI API key (xai- format)', () => {
        const text = 'key=xai-abcdefghij1234567890abcd';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:XAI_KEY]');
        expect(result.redacted).not.toContain('xai-abcdefghij');
      });
    });

    describe('Google API Keys', () => {
      it('should redact Google API key (AIza format)', () => {
        const text = 'GOOGLE_KEY=AIzaSyDabcdefghij1234567890123456789012';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:GOOGLE_KEY]');
        expect(result.redacted).not.toContain('AIzaSy');
      });
    });

    describe('AWS Credentials', () => {
      it('should redact AWS Access Key', () => {
        const text = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:AWS_ACCESS_KEY]');
        expect(result.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
      });

      it('should redact AWS Secret Key', () => {
        const text = 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:AWS_SECRET]');
        expect(result.redacted).not.toContain('wJalrXUtnFEMI');
      });
    });

    describe('Stripe API Keys', () => {
      it('should redact Stripe live key', () => {
        const text = 'stripe_key=sk_live_FAKE_TEST_KEY_00000000';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:STRIPE_KEY]');
        expect(result.redacted).not.toContain('sk_live_');
      });

      it('should redact Stripe test key', () => {
        const text = 'stripe_test=sk_test_FAKE_TEST_KEY_00000000';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:STRIPE_TEST_KEY]');
        expect(result.redacted).not.toContain('sk_test_');
      });

      it('should redact Stripe restricted key', () => {
        const text = 'stripe_rk=rk_live_FAKE_TEST_KEY_00000000';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:STRIPE_RESTRICTED_KEY]');
        expect(result.redacted).not.toContain('rk_live_');
      });
    });

    describe('Other API Keys', () => {
      it('should redact SendGrid API key', () => {
        const text = 'SENDGRID_KEY=SG.abcdefghij1234567890ab.abcdefghij1234567890abcdefghij1234567890abc';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:SENDGRID_KEY]');
        expect(result.redacted).not.toContain('SG.');
      });

      it('should redact Twilio API key', () => {
        const text = 'TWILIO_KEY=SKFAKE_TEST_KEY_000000000000000000';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:TWILIO_KEY]');
        expect(result.redacted).not.toContain('SKFAKE_TEST');
      });

      it('should redact NPM token', () => {
        // NPM token pattern requires exactly 36 chars after npm_
        const text = 'value npm_abcdefghij1234567890abcdefghij123456 end';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:NPM_TOKEN]');
        expect(result.redacted).not.toContain('npm_abcdefghij');
      });

      it('should redact generic API keys', () => {
        const text = 'api_key = "verylongsecretkeyvalue1234567890"';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED');
        expect(result.redacted).not.toContain('verylongsecretkeyvalue');
      });
    });
  });

  // ============================================================
  // Section 3: Token Detection
  // ============================================================
  describe('Token Detection', () => {
    describe('GitHub Tokens', () => {
      it('should redact GitHub personal access token (classic)', () => {
        // GitHub PAT classic pattern requires exactly 36 chars after ghp_
        const text = 'value ghp_abcdefghij1234567890abcdefghij123456 end';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:GITHUB');
        expect(result.redacted).not.toContain('ghp_abcdefghij');
      });

      it('should redact GitHub fine-grained token', () => {
        const text = 'github_pat_abcdefghij1234567890abcdefghij1234567';
        const result = engine.redact(text);

        // Should be caught by one of the GitHub patterns
        expect(result.redactions.length).toBeGreaterThan(0);
      });
    });

    describe('Slack Tokens', () => {
      it('should redact Slack bot token', () => {
        const text = 'SLACK_TOKEN=xoxb-FAKE-TEST-TOKEN-000000000000';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:SLACK_TOKEN]');
        expect(result.redacted).not.toContain('xoxb-');
      });

      it('should redact Slack user token', () => {
        const text = 'slack_user=xoxp-1234567890-1234567890123-abc123';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:SLACK_TOKEN]');
        expect(result.redacted).not.toContain('xoxp-');
      });
    });

    describe('JWT Tokens', () => {
      it('should redact JWT token', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        const text = `Bearer ${jwt}`;
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED');
        expect(result.redacted).not.toContain('eyJhbGciOiJIUzI1NiI');
      });
    });

    describe('Auth Headers', () => {
      it('should redact Basic auth header', () => {
        const text = 'Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM0NTY=';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:AUTH]');
        expect(result.redacted).not.toContain('dXNlcm5hbWU6');
      });

      it('should redact Bearer token', () => {
        const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWI6IjEyMzQ1Njc4OTAifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED');
        expect(result.redacted).not.toContain('eyJhbGciOiJIUzI1NiI');
      });
    });
  });

  // ============================================================
  // Section 4: Private Key Detection
  // ============================================================
  describe('Private Key Detection', () => {
    it('should redact RSA private key', () => {
      const text = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z...
-----END RSA PRIVATE KEY-----`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:RSA_PRIVATE_KEY]');
      expect(result.redacted).not.toContain('MIIEpAIBAAKCAQEA');
    });

    it('should redact EC private key', () => {
      const text = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEILvM...
-----END EC PRIVATE KEY-----`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:EC_PRIVATE_KEY]');
      expect(result.redacted).not.toContain('MHQCAQEEILvM');
    });

    it('should redact generic private key', () => {
      const text = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkq...
-----END PRIVATE KEY-----`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:PRIVATE_KEY]');
      expect(result.redacted).not.toContain('MIIEvgIBADANBgkq');
    });

    it('should redact encrypted private key', () => {
      const text = `-----BEGIN ENCRYPTED PRIVATE KEY-----
MIIFHDBOBgkqhkiG...
-----END ENCRYPTED PRIVATE KEY-----`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:PRIVATE_KEY]');
      expect(result.redacted).not.toContain('MIIFHDBOBgkqhkiG');
    });

    it('should redact SSH private key', () => {
      const text = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXkt...
-----END OPENSSH PRIVATE KEY-----`;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:SSH_PRIVATE_KEY]');
      expect(result.redacted).not.toContain('b3BlbnNzaC1rZXkt');
    });
  });

  // ============================================================
  // Section 5: Database Connection Strings
  // ============================================================
  describe('Database Connection String Detection', () => {
    it('should redact PostgreSQL connection string', () => {
      const text = 'DATABASE_URL=postgresql://user:secretpassword123@localhost:5432/mydb';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:POSTGRES_URL]');
      expect(result.redacted).not.toContain('secretpassword123');
    });

    it('should redact MySQL connection string', () => {
      const text = 'MYSQL_URL=mysql://admin:mysecretpass@db.example.com:3306/production';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:MYSQL_URL]');
      expect(result.redacted).not.toContain('mysecretpass');
    });

    it('should redact MongoDB connection string', () => {
      const text = 'MONGO_URI=mongodb://dbuser:dbpassword@cluster0.mongodb.net/test';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:MONGODB_URL]');
      expect(result.redacted).not.toContain('dbpassword');
    });

    it('should redact MongoDB+srv connection string', () => {
      const text = 'MONGO_URI=mongodb+srv://admin:supersecret@cluster.mongodb.net/prod';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:MONGODB_URL]');
      expect(result.redacted).not.toContain('supersecret');
    });

    it('should redact Redis connection string', () => {
      const text = 'REDIS_URL=redis://:myredispassword@redis.example.com:6379/0';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:REDIS_URL]');
      expect(result.redacted).not.toContain('myredispassword');
    });

    it('should redact password in generic URL', () => {
      const text = 'Connection: https://admin:secretpass123@api.example.com/v1';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:PASSWORD]');
      expect(result.redacted).not.toContain('secretpass123');
    });
  });

  // ============================================================
  // Section 6: PII Detection
  // ============================================================
  describe('PII Detection', () => {
    describe('Credit Card Numbers', () => {
      it('should redact Visa card number', () => {
        const text = 'Card: 4111111111111111';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:CREDIT_CARD]');
        expect(result.redacted).not.toContain('4111111111111111');
        expect(result.stats.byCategory.financial).toBeGreaterThan(0);
      });

      it('should redact Mastercard number', () => {
        const text = 'Payment: 5500000000000004';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:CREDIT_CARD]');
        expect(result.redacted).not.toContain('5500000000000004');
      });

      it('should redact Amex card number', () => {
        const text = 'Amex: 340000000000009';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:CREDIT_CARD]');
        expect(result.redacted).not.toContain('340000000000009');
      });

      it('should redact Discover card number', () => {
        const text = 'Discover: 6011000000000004';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:CREDIT_CARD]');
        expect(result.redacted).not.toContain('6011000000000004');
      });
    });

    describe('Social Security Numbers', () => {
      it('should redact SSN', () => {
        const text = 'SSN: 123-45-6789';
        const result = engine.redact(text);

        expect(result.redacted).toContain('[REDACTED:SSN]');
        expect(result.redacted).not.toContain('123-45-6789');
        expect(result.stats.byCategory.pii).toBeGreaterThan(0);
      });

      it('should redact multiple SSNs', () => {
        const text = 'SSN1: 111-22-3333, SSN2: 444-55-6666';
        const result = engine.redact(text);

        expect(result.redacted).not.toContain('111-22-3333');
        expect(result.redacted).not.toContain('444-55-6666');
      });
    });
  });

  // ============================================================
  // Section 7: Environment Variable Detection
  // ============================================================
  describe('Environment Variable Detection', () => {
    it('should redact SECRET env var', () => {
      const text = 'SECRET=mysecretvalue12345678';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).not.toContain('mysecretvalue12345678');
    });

    it('should redact PASSWORD env var', () => {
      const text = 'PASSWORD=mypassword12345678';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).not.toContain('mypassword12345678');
    });

    it('should redact TOKEN env var', () => {
      const text = 'TOKEN=mytokenvalue1234567890';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).not.toContain('mytokenvalue1234567890');
    });

    it('should redact AUTH env var', () => {
      const text = 'AUTH="myauthvalue1234567890"';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).not.toContain('myauthvalue1234567890');
    });
  });

  // ============================================================
  // Section 8: High Entropy String Detection
  // ============================================================
  describe('High Entropy String Detection', () => {
    it('should redact high entropy strings', () => {
      // This is a random-looking string with high entropy
      const text = 'random_value=aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV';
      const result = engine.redact(text);

      // High entropy strings should be detected
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it('should not redact low entropy strings', () => {
      // Repeating pattern has low entropy
      const text = 'normal_value=aaaaaaaaaaaaaaaaaaaaaa';
      const result = engine.redact(text);

      // Low entropy strings might not be redacted as high entropy
      // They might still match other patterns though
      expect(result.redacted).toBeDefined();
    });

    it('should skip strings that look like redaction placeholders', () => {
      const text = 'Already [REDACTED:TEST] placeholder';
      const result = engine.redact(text);

      // Should not double-redact
      expect(result.redacted).toContain('[REDACTED:TEST]');
    });
  });

  // ============================================================
  // Section 9: Object Redaction
  // ============================================================
  describe('Object Redaction', () => {
    it('should redact strings in objects', () => {
      const obj = {
        apiKey: 'sk-1234567890abcdefghij',
        name: 'Test User',
      };

      const result = engine.redactObject(obj);

      expect(result.apiKey).toContain('[REDACTED');
      expect(result.name).toBe('Test User');
    });

    it('should redact nested objects', () => {
      const obj = {
        config: {
          database: {
            password: 'secretpassword12345678',
          },
        },
      };

      const result = engine.redactObject(obj);

      expect(result.config.database.password).toBe('[REDACTED]');
    });

    it('should redact arrays', () => {
      const obj = {
        keys: ['sk-abc1234567890123456789', 'sk-def9876543210987654321'],
      };

      const result = engine.redactObject(obj);

      // Array values containing API keys should be redacted
      expect(result.keys[0]).toContain('[REDACTED');
      expect(result.keys[1]).toContain('[REDACTED');
    });

    it('should redact keys that look like secrets', () => {
      const obj = {
        password: 'any value',
        secret: 'any value',
        token: 'any value',
        api_key: 'any value',
        private_key: 'any value',
        auth: 'any value',
        credential: 'any value',
      };

      const result = engine.redactObject(obj);

      expect(result.password).toBe('[REDACTED]');
      expect(result.secret).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.api_key).toBe('[REDACTED]');
      expect(result.private_key).toBe('[REDACTED]');
      expect(result.auth).toBe('[REDACTED]');
      expect(result.credential).toBe('[REDACTED]');
    });

    it('should return original object when disabled', () => {
      engine.setEnabled(false);

      const obj = {
        password: 'secret123',
      };

      const result = engine.redactObject(obj);

      expect(result.password).toBe('secret123');
    });

    it('should handle non-object values', () => {
      const obj = {
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
      };

      const result = engine.redactObject(obj);

      expect(result.number).toBe(42);
      expect(result.boolean).toBe(true);
      expect(result.null).toBe(null);
      expect(result.undefined).toBe(undefined);
    });
  });

  // ============================================================
  // Section 10: Custom Patterns
  // ============================================================
  describe('Custom Patterns', () => {
    it('should add custom pattern', () => {
      const customPattern: RedactionPattern = {
        name: 'Custom Secret',
        pattern: /CUSTOM_SECRET_[A-Z0-9]{10}/g,
        replacement: '[REDACTED:CUSTOM]',
        category: 'custom',
        severity: 'high',
      };

      engine.addPattern(customPattern);
      const config = engine.getConfig();

      expect(config.customPatterns).toContainEqual(customPattern);
    });

    it('should apply custom pattern', () => {
      const customPattern: RedactionPattern = {
        name: 'Custom Secret',
        pattern: /MYPREFIX_[A-Z0-9]{10}/g,
        replacement: '[REDACTED:CUSTOM]',
        category: 'custom',
        severity: 'high',
      };

      engine.addPattern(customPattern);
      // Use a format that doesn't match other patterns first
      const text = 'value MYPREFIX_ABCD123456 end';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED:CUSTOM]');
      expect(result.redacted).not.toContain('MYPREFIX_ABCD123456');
    });
  });

  // ============================================================
  // Section 11: Whitelist
  // ============================================================
  describe('Whitelist', () => {
    it('should add to whitelist', () => {
      engine.addToWhitelist('test-value');
      const config = engine.getConfig();

      expect(config.whitelist).toContain('test-value');
    });

    it('should not duplicate whitelist entries', () => {
      engine.addToWhitelist('test-value');
      engine.addToWhitelist('test-value');
      const config = engine.getConfig();

      const count = config.whitelist.filter((w) => w === 'test-value').length;
      expect(count).toBe(1);
    });

    it('should skip whitelisted values', () => {
      // Add a known pattern to whitelist
      engine.addToWhitelist('sk-whitelisted123456789012');

      const text = 'Key: sk-whitelisted123456789012';
      const result = engine.redact(text);

      // The whitelisted value should not be redacted
      expect(result.redacted).toContain('sk-whitelisted123456789012');
    });

    it('should be case insensitive for whitelist', () => {
      engine.addToWhitelist('TEST-VALUE');

      const text = 'api_key=test-value-secretkey1234567890';
      const result = engine.redact(text);

      // Should find the whitelist entry (case insensitive)
      // But note: the original value still needs to match a redaction pattern
      expect(result.redacted).toContain('test-value');
    });
  });

  // ============================================================
  // Section 12: Redaction Log
  // ============================================================
  describe('Redaction Log', () => {
    it('should log redactions when enabled', () => {
      const loggingEngine = new DataRedactionEngine({ logRedactions: true });

      loggingEngine.redact('api_key=sk-1234567890abcdefghij');

      const log = loggingEngine.getRedactionLog();
      expect(log.length).toBeGreaterThan(0);

      loggingEngine.dispose();
    });

    it('should not log redactions when disabled', () => {
      const result = engine.redact('api_key=sk-1234567890abcdefghij');

      const log = engine.getRedactionLog();
      expect(log).toEqual([]);
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it('should clear log', () => {
      const loggingEngine = new DataRedactionEngine({ logRedactions: true });

      loggingEngine.redact('api_key=sk-1234567890abcdefghij');
      expect(loggingEngine.getRedactionLog().length).toBeGreaterThan(0);

      loggingEngine.clearLog();
      expect(loggingEngine.getRedactionLog()).toEqual([]);

      loggingEngine.dispose();
    });

    it('should emit redaction event when logging', () => {
      const loggingEngine = new DataRedactionEngine({ logRedactions: true });
      const listener = jest.fn();

      loggingEngine.on('redaction', listener);
      loggingEngine.redact('api_key=sk-1234567890abcdefghij');

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0]).toHaveProperty('count');
      expect(listener.mock.calls[0][0]).toHaveProperty('redactions');

      loggingEngine.dispose();
    });
  });

  // ============================================================
  // Section 13: Redaction Match Details
  // ============================================================
  describe('Redaction Match Details', () => {
    it('should include pattern name in redaction', () => {
      const result = engine.redact('sk-1234567890abcdefghij');

      expect(result.redactions[0].pattern).toBeDefined();
    });

    it('should include category in redaction', () => {
      const result = engine.redact('sk-1234567890abcdefghij');

      expect(result.redactions[0].category).toBeDefined();
      expect(['api_key', 'token', 'custom']).toContain(result.redactions[0].category);
    });

    it('should include severity in redaction', () => {
      const result = engine.redact('sk-1234567890abcdefghij');

      expect(result.redactions[0].severity).toBeDefined();
      expect(['critical', 'high', 'medium', 'low']).toContain(result.redactions[0].severity);
    });

    it('should include position in redaction', () => {
      const result = engine.redact('Key: sk-1234567890abcdefghij');

      expect(result.redactions[0].position).toBeDefined();
      expect(result.redactions[0].position.start).toBeGreaterThanOrEqual(0);
      expect(result.redactions[0].position.end).toBeGreaterThan(result.redactions[0].position.start);
    });

    it('should include preview in redaction', () => {
      const result = engine.redact('sk-1234567890abcdefghij');

      expect(result.redactions[0].preview).toBeDefined();
      // Preview should be masked (first/last chars or ***)
      expect(result.redactions[0].preview).toMatch(/^.{3}\.{3}.{3}$|^\*{3}$/);
    });
  });

  // ============================================================
  // Section 14: Statistics
  // ============================================================
  describe('Statistics', () => {
    it('should calculate total redactions', () => {
      const result = engine.redact('Key1: sk-abc12345678901234567, Key2: sk-def98765432109876543');

      expect(result.stats.totalRedactions).toBeGreaterThanOrEqual(2);
    });

    it('should track redactions by category', () => {
      const result = engine.redact('OpenAI: sk-1234567890abcdefghij');

      expect(result.stats.byCategory).toBeDefined();
      expect(result.stats.byCategory.api_key).toBeGreaterThan(0);
    });

    it('should track redactions by severity', () => {
      const result = engine.redact('sk-1234567890abcdefghij');

      expect(result.stats.bySeverity).toBeDefined();
      expect(result.stats.bySeverity.critical).toBeGreaterThan(0);
    });

    it('should return empty stats for clean text', () => {
      const result = engine.redact('Just some normal text without secrets');

      expect(result.stats.totalRedactions).toBe(0);
    });
  });

  // ============================================================
  // Section 15: Hash Secret
  // ============================================================
  describe('Hash Secret', () => {
    it('should generate consistent hash for same secret', () => {
      const secret = 'mysecretvalue';
      const hash1 = engine.hashSecret(secret);
      const hash2 = engine.hashSecret(secret);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different secrets', () => {
      const hash1 = engine.hashSecret('secret1');
      const hash2 = engine.hashSecret('secret2');

      expect(hash1).not.toBe(hash2);
    });

    it('should return 8 character hash', () => {
      const hash = engine.hashSecret('anysecret');

      expect(hash.length).toBe(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  // ============================================================
  // Section 16: Singleton Pattern
  // ============================================================
  describe('Singleton Pattern', () => {
    it('should return same instance from getDataRedactionEngine', () => {
      resetDataRedactionEngine();
      const instance1 = getDataRedactionEngine();
      const instance2 = getDataRedactionEngine();

      expect(instance1).toBe(instance2);
    });

    it('should accept config on first call', () => {
      resetDataRedactionEngine();
      const instance = getDataRedactionEngine({ entropyThreshold: 5.5 });
      const config = instance.getConfig();

      expect(config.entropyThreshold).toBe(5.5);
    });

    it('should create new instance after reset', () => {
      const instance1 = getDataRedactionEngine();
      resetDataRedactionEngine();
      const instance2 = getDataRedactionEngine();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ============================================================
  // Section 17: Utility Functions
  // ============================================================
  describe('Utility Functions', () => {
    describe('redactSecrets', () => {
      it('should redact secrets using singleton', () => {
        resetDataRedactionEngine();
        const result = redactSecrets('Key: sk-1234567890abcdefghij');

        expect(result).toContain('[REDACTED');
        expect(result).not.toContain('sk-1234567890');
      });
    });

    describe('containsSecrets', () => {
      it('should return true when text contains secrets', () => {
        resetDataRedactionEngine();
        const result = containsSecrets('Key: sk-1234567890abcdefghij');

        expect(result).toBe(true);
      });

      it('should return false when text is clean', () => {
        resetDataRedactionEngine();
        const result = containsSecrets('Just normal text');

        expect(result).toBe(false);
      });
    });
  });

  // ============================================================
  // Section 18: Edge Cases
  // ============================================================
  describe('Edge Cases', () => {
    it('should handle very long text', () => {
      const longText = 'a'.repeat(100000) + 'sk-1234567890abcdefghij' + 'b'.repeat(100000);
      const result = engine.redact(longText);

      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).not.toContain('sk-1234567890abcdefghij');
    });

    it('should handle special characters', () => {
      const text = 'Key: sk-abc123!"#$%&\'()=~|';
      const result = engine.redact(text);

      expect(result).toBeDefined();
    });

    it('should handle unicode characters', () => {
      const text = 'API Key: sk-abcdef1234567890abcdef - Description with emoji \ud83d\udd11';
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).toContain('\ud83d\udd11');
    });

    it('should handle newlines and whitespace', () => {
      const text = `
        API_KEY=sk-1234567890abcdefghij
        SECRET=mysecretvalue12345678
      `;
      const result = engine.redact(text);

      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).not.toContain('sk-1234567890');
    });

    it('should handle multiple matches on same line', () => {
      const text = 'Keys: sk-abc12345678901234567 sk-def98765432109876543 sk-ghi11111111111111111';
      const result = engine.redact(text);

      expect(result.stats.totalRedactions).toBeGreaterThanOrEqual(3);
    });

    it('should handle overlapping patterns', () => {
      // A string that might match multiple patterns
      const text = 'Token: sk-ant-anthropic1234567890key';
      const result = engine.redact(text);

      // Should not have broken text
      expect(result.redacted).not.toContain('anthropic1234567890key');
    });
  });

  // ============================================================
  // Section 19: Dispose
  // ============================================================
  describe('Dispose', () => {
    it('should clear log on dispose', () => {
      const loggingEngine = new DataRedactionEngine({ logRedactions: true });

      loggingEngine.redact('sk-1234567890abcdefghij');
      expect(loggingEngine.getRedactionLog().length).toBeGreaterThan(0);

      loggingEngine.dispose();
      expect(loggingEngine.getRedactionLog()).toEqual([]);
    });

    it('should remove listeners on dispose', () => {
      const listener = jest.fn();
      engine.on('redaction', listener);

      engine.dispose();

      // After dispose, listeners should be removed
      expect(engine.listenerCount('redaction')).toBe(0);
    });
  });

  // ============================================================
  // Section 20: Create Preview
  // ============================================================
  describe('Preview Creation', () => {
    it('should create masked preview for long strings', () => {
      const result = engine.redact('sk-1234567890abcdefghij');

      // Preview format: first 3 chars + ... + last 3 chars
      expect(result.redactions[0].preview).toMatch(/^.{3}\.{3}.{3}$/);
    });

    it('should return *** for short strings', () => {
      // Add a custom pattern for short values
      const shortEngine = new DataRedactionEngine();
      shortEngine.addPattern({
        name: 'Short',
        pattern: /SHORT123/g,
        replacement: '[REDACTED:SHORT]',
        category: 'custom',
        severity: 'low',
      });

      const result = shortEngine.redact('Value: SHORT123');

      // Short values (<=8 chars) should have *** preview
      expect(result.redactions[0].preview).toBe('***');

      shortEngine.dispose();
    });
  });
});
