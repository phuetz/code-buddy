/**
 * Tests for Environment Variable Schema & Validation
 *
 * Covers:
 * - Schema completeness (known env vars are defined)
 * - Validation logic (missing required, invalid types, out-of-range)
 * - Default values
 * - Sensitive value masking
 * - getEnvSummary() output format
 */

import {
  ENV_SCHEMA,
  EnvVarDef,
  validateEnv,
  getEnvSummary,
  maskValue,
  getEnvDef,
} from '../../src/config/env-schema';

describe('ENV_SCHEMA', () => {
  it('should define all well-known environment variables', () => {
    const names = ENV_SCHEMA.map(d => d.name);

    // Core
    expect(names).toContain('GROK_API_KEY');
    expect(names).toContain('GROK_BASE_URL');
    expect(names).toContain('GROK_MODEL');
    expect(names).toContain('YOLO_MODE');
    expect(names).toContain('MAX_COST');
    expect(names).toContain('MORPH_API_KEY');
    expect(names).toContain('CODEBUDDY_MAX_TOKENS');
    expect(names).toContain('GROK_FORCE_TOOLS');
    expect(names).toContain('GROK_CONVERT_TOOL_MESSAGES');

    // Provider
    expect(names).toContain('OPENAI_API_KEY');
    expect(names).toContain('ANTHROPIC_API_KEY');
    expect(names).toContain('GOOGLE_API_KEY');
    expect(names).toContain('GEMINI_API_KEY');
    expect(names).toContain('ELEVENLABS_API_KEY');

    // Search
    expect(names).toContain('BRAVE_API_KEY');
    expect(names).toContain('EXA_API_KEY');
    expect(names).toContain('PERPLEXITY_API_KEY');
    expect(names).toContain('OPENROUTER_API_KEY');
    expect(names).toContain('PERPLEXITY_MODEL');

    // Server
    expect(names).toContain('PORT');
    expect(names).toContain('HOST');
    expect(names).toContain('JWT_EXPIRATION');

    // Security
    expect(names).toContain('JWT_SECRET');
    expect(names).toContain('SECURITY_MODE');

    // Debug
    expect(names).toContain('DEBUG');
    expect(names).toContain('GROK_DEBUG');
    expect(names).toContain('CACHE_TRACE');
    expect(names).toContain('PERF_TIMING');
    expect(names).toContain('LOG_LEVEL');

    // Voice
    expect(names).toContain('PICOVOICE_ACCESS_KEY');

    // Display
    expect(names).toContain('NO_COLOR');
  });

  it('should have no duplicate names', () => {
    const names = ENV_SCHEMA.map(d => d.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it('should have valid types for every entry', () => {
    for (const def of ENV_SCHEMA) {
      expect(['string', 'number', 'boolean']).toContain(def.type);
    }
  });

  it('should have a description for every entry', () => {
    for (const def of ENV_SCHEMA) {
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('should have a category for every entry', () => {
    const validCategories = [
      'core', 'provider', 'server', 'security', 'debug',
      'voice', 'search', 'cache', 'metrics', 'display',
    ];
    for (const def of ENV_SCHEMA) {
      expect(validCategories).toContain(def.category);
    }
  });

  it('should mark API keys as sensitive', () => {
    const apiKeyVars = ENV_SCHEMA.filter(d => d.name.endsWith('_API_KEY') || d.name.endsWith('_KEY'));
    for (const def of apiKeyVars) {
      // Only actual key variables, not paths
      if (def.type === 'string' && !def.name.includes('PATH')) {
        expect(def.sensitive).toBe(true);
      }
    }
  });

  it('should mark GROK_API_KEY as required', () => {
    const grokKey = ENV_SCHEMA.find(d => d.name === 'GROK_API_KEY');
    expect(grokKey?.required).toBe(true);
  });
});

describe('getEnvDef', () => {
  it('should return definition for known variable', () => {
    const def = getEnvDef('GROK_API_KEY');
    expect(def).toBeDefined();
    expect(def!.name).toBe('GROK_API_KEY');
    expect(def!.sensitive).toBe(true);
  });

  it('should return undefined for unknown variable', () => {
    expect(getEnvDef('TOTALLY_FAKE_VAR')).toBeUndefined();
  });
});

describe('validateEnv', () => {
  it('should report error when required variables are missing', () => {
    const env: Record<string, string | undefined> = {};
    const result = validateEnv(env);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('GROK_API_KEY'))).toBe(true);
  });

  it('should pass when required variables are set', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test-key-12345',
    };
    const result = validateEnv(env);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should warn on invalid number type', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
      MAX_COST: 'not-a-number',
    };
    const result = validateEnv(env);
    expect(result.warnings.some(w => w.includes('MAX_COST') && w.includes('number'))).toBe(true);
  });

  it('should warn on number below minimum', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
      PORT: '0',
    };
    const result = validateEnv(env);
    expect(result.warnings.some(w => w.includes('PORT') && w.includes('minimum'))).toBe(true);
  });

  it('should warn on number above maximum', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
      PORT: '99999',
    };
    const result = validateEnv(env);
    expect(result.warnings.some(w => w.includes('PORT') && w.includes('maximum'))).toBe(true);
  });

  it('should warn on invalid boolean value', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
      YOLO_MODE: 'yes-please',
    };
    const result = validateEnv(env);
    expect(result.warnings.some(w => w.includes('YOLO_MODE') && w.includes('boolean'))).toBe(true);
  });

  it('should accept valid boolean values', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
      YOLO_MODE: 'true',
      DEBUG: 'true',
    };
    const result = validateEnv(env);
    expect(result.warnings.filter(w => w.includes('YOLO_MODE'))).toHaveLength(0);
  });

  it('should warn on string pattern mismatch', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
      SECURITY_MODE: 'ultra-secure',
    };
    const result = validateEnv(env);
    expect(result.warnings.some(w => w.includes('SECURITY_MODE') && w.includes('pattern'))).toBe(true);
  });

  it('should pass valid pattern matches', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
      SECURITY_MODE: 'auto-edit',
      LOG_LEVEL: 'debug',
    };
    const result = validateEnv(env);
    expect(result.warnings.filter(w => w.includes('SECURITY_MODE'))).toHaveLength(0);
    expect(result.warnings.filter(w => w.includes('LOG_LEVEL'))).toHaveLength(0);
  });

  it('should skip validation for unset optional variables', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: 'xai-test',
    };
    const result = validateEnv(env);
    expect(result.valid).toBe(true);
    // Should not have warnings about unset optional vars
    expect(result.warnings.filter(w => w.includes('MORPH_API_KEY'))).toHaveLength(0);
  });

  it('should handle empty string as unset for required vars', () => {
    const env: Record<string, string | undefined> = {
      GROK_API_KEY: '',
    };
    const result = validateEnv(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('GROK_API_KEY'))).toBe(true);
  });
});

describe('maskValue', () => {
  it('should mask short values completely', () => {
    expect(maskValue('abc')).toBe('****');
    expect(maskValue('12345678')).toBe('****');
  });

  it('should show first and last 4 chars of longer values', () => {
    const masked = maskValue('xai-abcdef1234567890');
    expect(masked).toBe('xai-****7890');
    expect(masked).not.toContain('abcdef');
  });

  it('should handle exactly 9-char values', () => {
    const masked = maskValue('123456789');
    expect(masked).toBe('1234****6789');
  });
});

describe('getEnvSummary', () => {
  it('should return a formatted string with header', () => {
    const summary = getEnvSummary({});
    expect(summary).toContain('Code Buddy Environment Configuration');
    expect(summary).toContain('='.repeat(50));
  });

  it('should include category sections', () => {
    const summary = getEnvSummary({});
    expect(summary).toContain('[Core]');
    expect(summary).toContain('[Provider API Keys]');
    expect(summary).toContain('[Server]');
    expect(summary).toContain('[Security]');
    expect(summary).toContain('[Debug & Logging]');
  });

  it('should show defaults for unset variables', () => {
    const summary = getEnvSummary({});
    expect(summary).toContain('(default:');
  });

  it('should show (not set) for optional vars without defaults', () => {
    const summary = getEnvSummary({});
    expect(summary).toContain('(not set)');
  });

  it('should mask sensitive values that are set', () => {
    const summary = getEnvSummary({
      GROK_API_KEY: 'xai-super-secret-key-1234',
    });
    expect(summary).not.toContain('xai-super-secret-key-1234');
    expect(summary).toContain('xai-****1234');
  });

  it('should show non-sensitive values in clear text', () => {
    const summary = getEnvSummary({
      GROK_API_KEY: 'xai-test',
      GROK_MODEL: 'grok-3-latest',
    });
    expect(summary).toContain('grok-3-latest');
  });

  it('should mark set variables with *', () => {
    const summary = getEnvSummary({
      GROK_API_KEY: 'xai-test',
      GROK_MODEL: 'grok-3-latest',
    });
    // Set vars get * prefix
    expect(summary).toContain('* GROK_MODEL=grok-3-latest');
  });

  it('should show set count in footer', () => {
    const summary = getEnvSummary({
      GROK_API_KEY: 'xai-test',
      GROK_MODEL: 'grok-3',
    });
    expect(summary).toContain(`2/${ENV_SCHEMA.length} variables set`);
  });

  it('should include validation errors in output', () => {
    const summary = getEnvSummary({});
    // GROK_API_KEY is required, so should show error
    expect(summary).toContain('Errors:');
    expect(summary).toContain('GROK_API_KEY');
  });

  it('should include validation warnings in output', () => {
    const summary = getEnvSummary({
      GROK_API_KEY: 'xai-test',
      MAX_COST: 'abc',
    });
    expect(summary).toContain('Warnings:');
    expect(summary).toContain('MAX_COST');
  });

  it('should include legend', () => {
    const summary = getEnvSummary({});
    expect(summary).toContain('Legend:');
    expect(summary).toContain('[required]');
  });

  it('should show [required] tag for required variables', () => {
    const summary = getEnvSummary({});
    // GROK_API_KEY line should have [required]
    const lines = summary.split('\n');
    const apiKeyLine = lines.find(l => l.includes('GROK_API_KEY') && !l.includes('Errors'));
    expect(apiKeyLine).toContain('[required]');
  });
});

describe('schema defaults', () => {
  it('should have sensible defaults for core variables', () => {
    const model = getEnvDef('GROK_MODEL');
    expect(model?.default).toBeDefined();

    const yolo = getEnvDef('YOLO_MODE');
    expect(yolo?.default).toBe('false');

    const maxCost = getEnvDef('MAX_COST');
    expect(maxCost?.default).toBe('10');
  });

  it('should have sensible defaults for server variables', () => {
    const port = getEnvDef('PORT');
    expect(port?.default).toBe('3000');
    expect(port?.type).toBe('number');
    expect(port?.min).toBe(1);
    expect(port?.max).toBe(65535);

    const host = getEnvDef('HOST');
    expect(host?.default).toBe('0.0.0.0');
  });

  it('should have correct type for boolean env vars', () => {
    const boolVars = ['YOLO_MODE', 'GROK_FORCE_TOOLS', 'CACHE_TRACE', 'PERF_TIMING', 'NO_COLOR'];
    for (const name of boolVars) {
      const def = getEnvDef(name);
      expect(def?.type).toBe('boolean');
    }
  });

  it('should have correct type for number env vars', () => {
    const numVars = ['MAX_COST', 'PORT', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW', 'METRICS_INTERVAL'];
    for (const name of numVars) {
      const def = getEnvDef(name);
      expect(def?.type).toBe('number');
    }
  });
});
