import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  SecurityAuditor,
  SecurityAuditConfig,
  AuditResult,
  AuditFinding,
  DEFAULT_SECURITY_AUDIT_CONFIG,
  getSecurityAuditor,
  resetSecurityAuditor,
} from '../../src/security/security-audit.js';

// Store original env vars and restore after each test
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  resetSecurityAuditor();
});

afterEach(() => {
  process.env = originalEnv;
});

/**
 * Create an auditor that skips network/browser/permission checks
 * unless explicitly testing those features.
 */
function createMinimalAuditor(overrides: Partial<SecurityAuditConfig> = {}): SecurityAuditor {
  return new SecurityAuditor({
    configPath: '/tmp/test-audit-config',
    credentialsPath: '/tmp/test-audit-creds',
    pluginsPath: '/tmp/test-audit-plugins',
    sessionsPath: '/tmp/test-audit-sessions',
    checkNetwork: false,
    checkBrowser: false,
    checkPermissions: false,
    ...overrides,
  });
}

/**
 * Helper to find a finding by partial title match
 */
function findByTitle(findings: AuditFinding[], partial: string): AuditFinding | undefined {
  return findings.find(f => f.title.toLowerCase().includes(partial.toLowerCase()));
}

/**
 * Helper to find findings by category
 */
function findByCategory(findings: AuditFinding[], category: string): AuditFinding[] {
  return findings.filter(f => f.category === category);
}

// ==========================================================================
// Basic audit execution
// ==========================================================================

describe('SecurityAuditor - basic audit', () => {
  it('should return an AuditResult with correct structure', async () => {
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    expect(result).toHaveProperty('timestamp');
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result).toHaveProperty('duration');
    expect(typeof result.duration).toBe('number');
    expect(result).toHaveProperty('findings');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('deepScan');
  });

  it('should set deepScan to false for regular audit', async () => {
    const auditor = createMinimalAuditor();
    const result = await auditor.audit(false);
    expect(result.deepScan).toBe(false);
  });

  it('should set deepScan to true for deep audit', async () => {
    const auditor = createMinimalAuditor();
    const result = await auditor.audit(true);
    expect(result.deepScan).toBe(true);
  });

  it('should calculate duration in milliseconds', async () => {
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThan(10000); // should not take 10s
  });

  it('should assign sequential IDs to findings', async () => {
    const auditor = createMinimalAuditor();
    // Set an env so we get some findings
    delete process.env.JWT_SECRET;
    const result = await auditor.audit();

    const ids = result.findings.map(f => f.id);
    // All IDs should start with SEC-
    expect(ids.every(id => id.startsWith('SEC-'))).toBe(true);
    // IDs should be unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should reset findings between audit runs', async () => {
    const auditor = createMinimalAuditor();
    delete process.env.JWT_SECRET;

    const result1 = await auditor.audit();
    const count1 = result1.findings.length;

    const result2 = await auditor.audit();
    const count2 = result2.findings.length;

    // Both runs should produce the same findings count
    expect(count1).toBe(count2);
    // IDs should restart from SEC-1
    expect(result2.findings[0]?.id).toBe('SEC-1');
  });
});

// ==========================================================================
// Summary calculation
// ==========================================================================

describe('SecurityAuditor - summary', () => {
  it('should correctly count findings by severity', async () => {
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const { summary, findings } = result;
    expect(summary.total).toBe(findings.length);
    expect(summary.critical).toBe(findings.filter(f => f.severity === 'critical').length);
    expect(summary.high).toBe(findings.filter(f => f.severity === 'high').length);
    expect(summary.medium).toBe(findings.filter(f => f.severity === 'medium').length);
    expect(summary.low).toBe(findings.filter(f => f.severity === 'low').length);
    expect(summary.info).toBe(findings.filter(f => f.severity === 'info').length);
  });

  it('should pass when no critical or high findings', async () => {
    // Set up a clean environment (no YOLO, has JWT, etc.)
    process.env.JWT_SECRET = 'a-very-long-secret-that-is-at-least-32-chars-long-yes';
    process.env.YOLO_MODE = 'false';
    delete process.env.SECURITY_MODE;
    delete process.env.DM_POLICY;
    delete process.env.CHROME_REMOTE_DEBUGGING_PORT;
    delete process.env.DEBUG;

    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    // Filter only the findings that are critical or high
    const criticalOrHigh = result.findings.filter(
      f => f.severity === 'critical' || f.severity === 'high'
    );

    if (criticalOrHigh.length === 0) {
      expect(result.passed).toBe(true);
    }
  });

  it('should fail when critical findings exist', async () => {
    process.env.YOLO_MODE = 'true';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    expect(result.summary.critical).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });
});

// ==========================================================================
// Authentication checks
// ==========================================================================

describe('SecurityAuditor - authentication', () => {
  it('should flag missing JWT_SECRET', async () => {
    delete process.env.JWT_SECRET;
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Missing JWT_SECRET');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.category).toBe('authentication');
  });

  it('should flag short JWT_SECRET', async () => {
    process.env.JWT_SECRET = 'short';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Weak JWT_SECRET');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should not flag a long JWT_SECRET', async () => {
    process.env.JWT_SECRET = 'this-is-a-very-long-jwt-secret-that-is-at-least-32-characters';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'JWT_SECRET');
    // No findings about JWT_SECRET
    expect(finding).toBeUndefined();
  });

  it('should flag short API keys', async () => {
    process.env.GROK_API_KEY = 'tiny';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Potentially weak GROK_API_KEY');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should flag test/demo API keys', async () => {
    process.env.OPENAI_API_KEY = 'test-key-1234567890abcdef';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Test API key');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should flag demo keys', async () => {
    process.env.ANTHROPIC_API_KEY = 'demo-abcdefghijklmnopqrstuvwxyz';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Test API key');
    expect(finding).toBeDefined();
  });

  it('should check all sensitive env vars', async () => {
    // Set all to short values to trigger findings
    process.env.GROK_API_KEY = 'short';
    process.env.OPENAI_API_KEY = 'short';
    process.env.ANTHROPIC_API_KEY = 'short';
    process.env.ELEVENLABS_API_KEY = 'short';
    process.env.JWT_SECRET = 'short';

    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const authFindings = findByCategory(result.findings, 'authentication');
    // Should have findings for multiple keys
    expect(authFindings.length).toBeGreaterThanOrEqual(5);
  });
});

// ==========================================================================
// Authorization checks
// ==========================================================================

describe('SecurityAuditor - authorization', () => {
  it('should flag YOLO_MODE=true as critical', async () => {
    process.env.YOLO_MODE = 'true';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'YOLO mode');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
    expect(finding!.category).toBe('authorization');
  });

  it('should not flag YOLO_MODE=false', async () => {
    process.env.YOLO_MODE = 'false';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'YOLO mode');
    expect(finding).toBeUndefined();
  });

  it('should flag full-auto security mode as high', async () => {
    process.env.SECURITY_MODE = 'full-auto';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Full-auto security mode');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should not flag suggest security mode', async () => {
    process.env.SECURITY_MODE = 'suggest';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Full-auto');
    expect(finding).toBeUndefined();
  });

  it('should flag high cost limit', async () => {
    process.env.MAX_COST = '$100';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'High cost limit');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should not flag reasonable cost limit', async () => {
    process.env.MAX_COST = '$10';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'High cost limit');
    expect(finding).toBeUndefined();
  });
});

// ==========================================================================
// Credentials checks
// ==========================================================================

describe('SecurityAuditor - credentials', () => {
  let tmpCredDir: string;

  beforeEach(async () => {
    tmpCredDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-creds-'));
  });

  afterEach(async () => {
    await fs.rm(tmpCredDir, { recursive: true, force: true });
  });

  it('should flag insecure credentials directory permissions', async () => {
    // Set world-readable permissions
    await fs.chmod(tmpCredDir, 0o755);

    const auditor = createMinimalAuditor({ credentialsPath: tmpCredDir });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Insecure credentials directory');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.category).toBe('credentials');
  });

  it('should not flag secure credentials directory permissions', async () => {
    await fs.chmod(tmpCredDir, 0o700);

    const auditor = createMinimalAuditor({ credentialsPath: tmpCredDir });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Insecure credentials directory');
    expect(finding).toBeUndefined();
  });

  it('should handle non-existent credentials directory gracefully', async () => {
    const auditor = createMinimalAuditor({
      credentialsPath: '/tmp/definitely-nonexistent-dir-12345',
    });
    const result = await auditor.audit();
    // Should not throw, and should not have a credentials directory finding
    const finding = findByTitle(result.findings, 'Insecure credentials directory');
    expect(finding).toBeUndefined();
  });
});

// ==========================================================================
// File permission checks
// ==========================================================================

describe('SecurityAuditor - file permissions', () => {
  let tmpConfigDir: string;
  let tmpSessionsDir: string;
  let tmpPluginsDir: string;

  beforeEach(async () => {
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-config-'));
    tmpSessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-sessions-'));
    tmpPluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-plugins-'));
  });

  afterEach(async () => {
    await fs.rm(tmpConfigDir, { recursive: true, force: true });
    await fs.rm(tmpSessionsDir, { recursive: true, force: true });
    await fs.rm(tmpPluginsDir, { recursive: true, force: true });
  });

  it('should flag world-readable config directory', async () => {
    await fs.chmod(tmpConfigDir, 0o755);

    const auditor = createMinimalAuditor({
      configPath: tmpConfigDir,
      checkPermissions: true,
    });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Insecure directory permissions');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
    expect(finding!.category).toBe('filesystem');
  });

  it('should not flag properly secured directories', async () => {
    await fs.chmod(tmpConfigDir, 0o700);
    await fs.chmod(tmpSessionsDir, 0o700);
    await fs.chmod(tmpPluginsDir, 0o700);

    const auditor = createMinimalAuditor({
      configPath: tmpConfigDir,
      sessionsPath: tmpSessionsDir,
      pluginsPath: tmpPluginsDir,
      checkPermissions: true,
    });
    const result = await auditor.audit();

    const fsFindings = findByCategory(result.findings, 'filesystem');
    expect(fsFindings).toHaveLength(0);
  });

  it('should skip permission checks when disabled', async () => {
    await fs.chmod(tmpConfigDir, 0o777);

    const auditor = createMinimalAuditor({
      configPath: tmpConfigDir,
      checkPermissions: false,
    });
    const result = await auditor.audit();

    const fsFindings = findByCategory(result.findings, 'filesystem');
    expect(fsFindings).toHaveLength(0);
  });
});

// ==========================================================================
// Configuration checks
// ==========================================================================

describe('SecurityAuditor - configuration', () => {
  it('should flag DEBUG mode', async () => {
    process.env.DEBUG = 'true';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Debug mode');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('low');
    expect(finding!.category).toBe('configuration');
  });

  it('should flag development NODE_ENV', async () => {
    process.env.NODE_ENV = 'development';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Debug mode');
    expect(finding).toBeDefined();
  });

  it('should flag verbose logging', async () => {
    process.env.VERBOSE = 'true';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Verbose logging');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('low');
  });

  it('should flag debug log level', async () => {
    process.env.LOG_LEVEL = 'debug';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Verbose logging');
    expect(finding).toBeDefined();
  });

  it('should not flag production settings', async () => {
    delete process.env.DEBUG;
    delete process.env.VERBOSE;
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'warn';

    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const configFindings = findByCategory(result.findings, 'configuration');
    expect(configFindings).toHaveLength(0);
  });
});

// ==========================================================================
// Plugin checks
// ==========================================================================

describe('SecurityAuditor - plugins', () => {
  let tmpPluginsDir: string;

  beforeEach(async () => {
    tmpPluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-plugins-'));
  });

  afterEach(async () => {
    await fs.rm(tmpPluginsDir, { recursive: true, force: true });
  });

  it('should report installed plugins as info', async () => {
    // Create a plugin directory
    const pluginDir = path.join(tmpPluginsDir, 'my-plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'package.json'), '{}');

    const auditor = createMinimalAuditor({ pluginsPath: tmpPluginsDir });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Custom plugins installed');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.category).toBe('plugins');
  });

  it('should flag plugins without package.json', async () => {
    const pluginDir = path.join(tmpPluginsDir, 'sketchy-plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    // No package.json
    await fs.writeFile(path.join(pluginDir, 'index.js'), 'module.exports = {}');

    const auditor = createMinimalAuditor({ pluginsPath: tmpPluginsDir });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Plugin missing package.json');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should not flag empty plugins directory', async () => {
    const auditor = createMinimalAuditor({ pluginsPath: tmpPluginsDir });
    const result = await auditor.audit();

    const pluginFindings = findByCategory(result.findings, 'plugins');
    expect(pluginFindings).toHaveLength(0);
  });

  it('should handle non-existent plugins directory', async () => {
    const auditor = createMinimalAuditor({
      pluginsPath: '/tmp/nonexistent-plugins-dir-xyz',
    });
    const result = await auditor.audit();
    // Should not throw
    const pluginFindings = findByCategory(result.findings, 'plugins');
    expect(pluginFindings).toHaveLength(0);
  });
});

// ==========================================================================
// Channel checks
// ==========================================================================

describe('SecurityAuditor - channels', () => {
  it('should flag open DM policy as high', async () => {
    process.env.DM_POLICY = 'open';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Open DM policy');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.category).toBe('channels');
  });

  it('should not flag pairing DM policy', async () => {
    process.env.DM_POLICY = 'pairing';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Open DM policy');
    expect(finding).toBeUndefined();
  });

  it('should report configured channel tokens as info', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'some-token-that-is-long-enough';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'telegram bot token configured');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
  });

  it('should report Discord token as info', async () => {
    process.env.DISCORD_BOT_TOKEN = 'discord-token-long-enough-value';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'discord bot token configured');
    expect(finding).toBeDefined();
  });

  it('should report Slack token as info', async () => {
    process.env.SLACK_BOT_TOKEN = 'slack-token-that-is-long-enough';
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'slack bot token configured');
    expect(finding).toBeDefined();
  });
});

// ==========================================================================
// Browser checks
// ==========================================================================

describe('SecurityAuditor - browser', () => {
  it('should flag Chrome remote debugging port', async () => {
    process.env.CHROME_REMOTE_DEBUGGING_PORT = '9222';
    const auditor = createMinimalAuditor({ checkBrowser: true });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Chrome remote debugging');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
    expect(finding!.category).toBe('browser');
  });

  it('should flag non-localhost CDP URL', async () => {
    process.env.CDP_URL = 'http://192.168.1.100:9222';
    const auditor = createMinimalAuditor({ checkBrowser: true });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Remote CDP URL');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should not flag localhost CDP URL', async () => {
    process.env.CDP_URL = 'http://localhost:9222';
    const auditor = createMinimalAuditor({ checkBrowser: true });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Remote CDP URL');
    expect(finding).toBeUndefined();
  });

  it('should not flag 127.0.0.1 CDP URL', async () => {
    process.env.CDP_URL = 'http://127.0.0.1:9222';
    const auditor = createMinimalAuditor({ checkBrowser: true });
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Remote CDP URL');
    expect(finding).toBeUndefined();
  });

  it('should skip browser checks when disabled', async () => {
    process.env.CHROME_REMOTE_DEBUGGING_PORT = '9222';
    const auditor = createMinimalAuditor({ checkBrowser: false });
    const result = await auditor.audit();

    const browserFindings = findByCategory(result.findings, 'browser');
    expect(browserFindings).toHaveLength(0);
  });
});

// ==========================================================================
// Tool checks
// ==========================================================================

describe('SecurityAuditor - tools', () => {
  it('should always include tool review info finding', async () => {
    const auditor = createMinimalAuditor();
    const result = await auditor.audit();

    const finding = findByTitle(result.findings, 'Review tool allowlist');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.category).toBe('tools');
  });
});

// ==========================================================================
// Auto-fix
// ==========================================================================

describe('SecurityAuditor - fix', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-fix-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should fix file permission findings', async () => {
    const dirPath = path.join(tmpDir, 'fixme');
    await fs.mkdir(dirPath);
    await fs.chmod(dirPath, 0o755);

    // Create a mock audit result with a fixable finding
    const mockResult: AuditResult = {
      timestamp: new Date(),
      duration: 100,
      findings: [
        {
          id: 'SEC-1',
          category: 'filesystem',
          severity: 'medium',
          title: 'Insecure directory permissions',
          description: 'Test',
          impact: 'Test',
          recommendation: 'Test',
          details: { path: dirPath, expected: '700' },
        },
      ],
      summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0, total: 1 },
      passed: true,
      deepScan: false,
    };

    const auditor = createMinimalAuditor();
    const fixResult = await auditor.fix(mockResult);

    expect(fixResult.fixed).toBe(1);
    expect(fixResult.errors).toHaveLength(0);

    // Verify the permissions were changed
    const stats = await fs.stat(dirPath);
    expect(stats.mode & 0o777).toBe(0o700);
  });

  it('should report errors for non-fixable paths', async () => {
    const mockResult: AuditResult = {
      timestamp: new Date(),
      duration: 100,
      findings: [
        {
          id: 'SEC-1',
          category: 'filesystem',
          severity: 'medium',
          title: 'Test',
          description: 'Test',
          impact: 'Test',
          recommendation: 'Test',
          details: { path: '/definitely/nonexistent/path', expected: '700' },
        },
      ],
      summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0, total: 1 },
      passed: true,
      deepScan: false,
    };

    const auditor = createMinimalAuditor();
    const fixResult = await auditor.fix(mockResult);

    expect(fixResult.fixed).toBe(0);
    expect(fixResult.errors.length).toBeGreaterThan(0);
  });

  it('should skip findings without path details', async () => {
    const mockResult: AuditResult = {
      timestamp: new Date(),
      duration: 100,
      findings: [
        {
          id: 'SEC-1',
          category: 'authorization',
          severity: 'critical',
          title: 'YOLO mode',
          description: 'Test',
          impact: 'Test',
          recommendation: 'Test',
          // No details.path
        },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0, total: 1 },
      passed: false,
      deepScan: false,
    };

    const auditor = createMinimalAuditor();
    const fixResult = await auditor.fix(mockResult);

    expect(fixResult.fixed).toBe(0);
    expect(fixResult.errors).toHaveLength(0);
  });

  it('should only fix filesystem and credentials category findings', async () => {
    const mockResult: AuditResult = {
      timestamp: new Date(),
      duration: 100,
      findings: [
        {
          id: 'SEC-1',
          category: 'authorization',
          severity: 'critical',
          title: 'Test',
          description: 'Test',
          impact: 'Test',
          recommendation: 'Test',
          details: { path: '/some/path', expected: '700' },
        },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0, total: 1 },
      passed: false,
      deepScan: false,
    };

    const auditor = createMinimalAuditor();
    const fixResult = await auditor.fix(mockResult);

    // Should not attempt to fix non-filesystem/credentials findings
    expect(fixResult.fixed).toBe(0);
  });
});

// ==========================================================================
// formatResult
// ==========================================================================

describe('SecurityAuditor.formatResult', () => {
  it('should format a passing result', () => {
    const result: AuditResult = {
      timestamp: new Date('2025-01-01T00:00:00Z'),
      duration: 1234,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      passed: true,
      deepScan: false,
    };

    const output = SecurityAuditor.formatResult(result);
    expect(output).toContain('SECURITY AUDIT REPORT');
    expect(output).toContain('PASSED');
    expect(output).toContain('Critical: 0');
  });

  it('should format a failing result', () => {
    const result: AuditResult = {
      timestamp: new Date('2025-01-01T00:00:00Z'),
      duration: 500,
      findings: [
        {
          id: 'SEC-1',
          category: 'authorization',
          severity: 'critical',
          title: 'YOLO mode is enabled',
          description: 'Test description',
          impact: 'Test impact',
          recommendation: 'Disable YOLO',
        },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0, total: 1 },
      passed: false,
      deepScan: false,
    };

    const output = SecurityAuditor.formatResult(result);
    expect(output).toContain('FAILED');
    expect(output).toContain('Critical: 1');
    expect(output).toContain('YOLO mode is enabled');
    expect(output).toContain('Test description');
    expect(output).toContain('Test impact');
    expect(output).toContain('Disable YOLO');
    expect(output).toContain('SEC-1');
  });

  it('should sort findings by severity', () => {
    const result: AuditResult = {
      timestamp: new Date(),
      duration: 100,
      findings: [
        { id: 'SEC-1', category: 'configuration', severity: 'low', title: 'Low finding', description: '', impact: '', recommendation: '' },
        { id: 'SEC-2', category: 'authorization', severity: 'critical', title: 'Critical finding', description: '', impact: '', recommendation: '' },
        { id: 'SEC-3', category: 'authentication', severity: 'high', title: 'High finding', description: '', impact: '', recommendation: '' },
      ],
      summary: { critical: 1, high: 1, medium: 0, low: 1, info: 0, total: 3 },
      passed: false,
      deepScan: false,
    };

    const output = SecurityAuditor.formatResult(result);
    const criticalIdx = output.indexOf('Critical finding');
    const highIdx = output.indexOf('High finding');
    const lowIdx = output.indexOf('Low finding');

    expect(criticalIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('should indicate deep scan in output', () => {
    const result: AuditResult = {
      timestamp: new Date(),
      duration: 5000,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      passed: true,
      deepScan: true,
    };

    const output = SecurityAuditor.formatResult(result);
    expect(output).toContain('deep scan');
  });

  it('should include category in finding output', () => {
    const result: AuditResult = {
      timestamp: new Date(),
      duration: 100,
      findings: [
        { id: 'SEC-1', category: 'authentication', severity: 'high', title: 'Test', description: 'desc', impact: 'imp', recommendation: 'rec' },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0, total: 1 },
      passed: false,
      deepScan: false,
    };

    const output = SecurityAuditor.formatResult(result);
    expect(output).toContain('authentication');
  });
});

// ==========================================================================
// Singleton / getSecurityAuditor / resetSecurityAuditor
// ==========================================================================

describe('SecurityAuditor - singleton', () => {
  it('should return the same instance on repeated calls', () => {
    const a = getSecurityAuditor();
    const b = getSecurityAuditor();
    expect(a).toBe(b);
  });

  it('should return a new instance after reset', () => {
    const a = getSecurityAuditor();
    resetSecurityAuditor();
    const b = getSecurityAuditor();
    expect(a).not.toBe(b);
  });
});

// ==========================================================================
// Default config
// ==========================================================================

describe('DEFAULT_SECURITY_AUDIT_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_SECURITY_AUDIT_CONFIG.checkNetwork).toBe(true);
    expect(DEFAULT_SECURITY_AUDIT_CONFIG.checkBrowser).toBe(true);
    expect(DEFAULT_SECURITY_AUDIT_CONFIG.checkPermissions).toBe(true);
    expect(DEFAULT_SECURITY_AUDIT_CONFIG.configPath).toContain('.codebuddy');
    expect(DEFAULT_SECURITY_AUDIT_CONFIG.credentialsPath).toContain('credentials');
    expect(DEFAULT_SECURITY_AUDIT_CONFIG.pluginsPath).toContain('plugins');
    expect(DEFAULT_SECURITY_AUDIT_CONFIG.sessionsPath).toContain('sessions');
  });
});
