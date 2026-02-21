/**
 * Security Audit Tool
 *
 * Automated security auditing for Code Buddy deployments.
 * Identifies vulnerabilities, misconfigurations, and security risks.
 *
 * Inspired by OpenClaw's security audit system.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AuditCategory =
  | 'authentication'
  | 'authorization'
  | 'network'
  | 'filesystem'
  | 'browser'
  | 'plugins'
  | 'channels'
  | 'tools'
  | 'credentials'
  | 'configuration';

export interface AuditFinding {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  details?: Record<string, unknown>;
}

export interface AuditResult {
  timestamp: Date;
  duration: number;
  findings: AuditFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  passed: boolean;
  deepScan: boolean;
}

export interface SecurityAuditConfig {
  /** Code Buddy config path */
  configPath: string;
  /** Credentials path */
  credentialsPath: string;
  /** Plugins path */
  pluginsPath: string;
  /** Sessions path */
  sessionsPath: string;
  /** Check network bindings */
  checkNetwork: boolean;
  /** Check browser config */
  checkBrowser: boolean;
  /** Check file permissions */
  checkPermissions: boolean;
}

export const DEFAULT_SECURITY_AUDIT_CONFIG: SecurityAuditConfig = {
  configPath: path.join(homedir(), '.codebuddy'),
  credentialsPath: path.join(homedir(), '.codebuddy', 'credentials'),
  pluginsPath: path.join(homedir(), '.codebuddy', 'plugins'),
  sessionsPath: path.join(homedir(), '.codebuddy', 'sessions'),
  checkNetwork: true,
  checkBrowser: true,
  checkPermissions: true,
};

// ============================================================================
// Security Auditor
// ============================================================================

export class SecurityAuditor {
  private config: SecurityAuditConfig;
  private findings: AuditFinding[] = [];
  private findingId = 0;

  constructor(config: Partial<SecurityAuditConfig> = {}) {
    this.config = { ...DEFAULT_SECURITY_AUDIT_CONFIG, ...config };
  }

  /**
   * Run a full security audit
   */
  async audit(deep: boolean = false): Promise<AuditResult> {
    const startTime = Date.now();
    this.findings = [];
    this.findingId = 0;

    // Run all checks
    await this.checkAuthentication();
    await this.checkAuthorization();
    await this.checkCredentials();
    await this.checkFilePermissions();
    await this.checkConfiguration();
    await this.checkPlugins();
    await this.checkChannels();
    await this.checkTools();

    if (this.config.checkNetwork) {
      await this.checkNetwork();
    }

    if (this.config.checkBrowser) {
      await this.checkBrowser();
    }

    if (deep) {
      await this.deepScan();
    }

    // Always run agent-specific checks (OpenClaw-inspired)
    await this.checkAgentSecurity();

    const duration = Date.now() - startTime;

    // Calculate summary
    const summary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      total: this.findings.length,
    };

    for (const finding of this.findings) {
      summary[finding.severity]++;
    }

    return {
      timestamp: new Date(),
      duration,
      findings: this.findings,
      summary,
      passed: summary.critical === 0 && summary.high === 0,
      deepScan: deep,
    };
  }

  // ==========================================================================
  // Authentication Checks
  // ==========================================================================

  private async checkAuthentication(): Promise<void> {
    // Check for API keys in environment
    const sensitiveEnvVars = [
      'GROK_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'ELEVENLABS_API_KEY',
      'JWT_SECRET',
    ];

    for (const envVar of sensitiveEnvVars) {
      const value = process.env[envVar];
      if (value) {
        // Check for weak API keys
        if (value.length < 20) {
          this.addFinding({
            category: 'authentication',
            severity: 'high',
            title: `Potentially weak ${envVar}`,
            description: `The ${envVar} environment variable appears to be shorter than expected.`,
            impact: 'Weak API keys are easier to brute force.',
            recommendation: 'Use a strong, randomly generated API key.',
          });
        }

        // Check for test/demo keys
        if (/^(test|demo|fake|dummy)/i.test(value)) {
          this.addFinding({
            category: 'authentication',
            severity: 'medium',
            title: `Test API key in ${envVar}`,
            description: `The ${envVar} appears to be a test or demo key.`,
            impact: 'Test keys may have limited functionality or security.',
            recommendation: 'Use production API keys in production environments.',
          });
        }
      }
    }

    // Check JWT secret
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      this.addFinding({
        category: 'authentication',
        severity: 'high',
        title: 'Missing JWT_SECRET',
        description: 'No JWT_SECRET environment variable is set.',
        impact: 'Without a JWT secret, the API server cannot securely authenticate requests.',
        recommendation: 'Set a strong, random JWT_SECRET environment variable.',
      });
    } else if (jwtSecret.length < 32) {
      this.addFinding({
        category: 'authentication',
        severity: 'high',
        title: 'Weak JWT_SECRET',
        description: 'JWT_SECRET is shorter than 32 characters.',
        impact: 'Short secrets are vulnerable to brute force attacks.',
        recommendation: 'Use a JWT secret of at least 32 random characters.',
      });
    }
  }

  // ==========================================================================
  // Authorization Checks
  // ==========================================================================

  private async checkAuthorization(): Promise<void> {
    // Check if YOLO mode is enabled
    if (process.env.YOLO_MODE === 'true') {
      this.addFinding({
        category: 'authorization',
        severity: 'critical',
        title: 'YOLO mode is enabled',
        description: 'YOLO_MODE=true allows the agent to execute any operation without confirmation.',
        impact: 'The agent can modify or delete files, run arbitrary commands, and access sensitive data without user approval.',
        recommendation: 'Disable YOLO mode in production (unset YOLO_MODE or set to false).',
      });
    }

    // Check security mode
    const securityMode = process.env.SECURITY_MODE;
    if (securityMode === 'full-auto') {
      this.addFinding({
        category: 'authorization',
        severity: 'high',
        title: 'Full-auto security mode',
        description: 'SECURITY_MODE=full-auto allows automatic approval of all operations.',
        impact: 'Dangerous operations may be executed without user review.',
        recommendation: 'Use "suggest" or "auto-edit" mode for better security.',
      });
    }

    // Check cost limit
    const maxCost = process.env.MAX_COST;
    if (maxCost) {
      const cost = parseFloat(maxCost.replace(/[^0-9.]/g, ''));
      if (cost > 50) {
        this.addFinding({
          category: 'authorization',
          severity: 'medium',
          title: 'High cost limit',
          description: `MAX_COST is set to ${maxCost}, which is relatively high.`,
          impact: 'Runaway sessions could incur significant costs.',
          recommendation: 'Consider setting a lower cost limit for production use.',
        });
      }
    }
  }

  // ==========================================================================
  // Credentials Checks
  // ==========================================================================

  private async checkCredentials(): Promise<void> {
    // Check credentials directory permissions
    try {
      const stats = await fs.stat(this.config.credentialsPath);
      const mode = stats.mode & 0o777;

      if ((mode & 0o077) !== 0) {
        this.addFinding({
          category: 'credentials',
          severity: 'high',
          title: 'Insecure credentials directory permissions',
          description: `Credentials directory has permissions ${mode.toString(8)}, which allows group/other access.`,
          impact: 'Other users on the system may be able to read credentials.',
          recommendation: 'Run: chmod 700 ~/.codebuddy/credentials',
          details: { path: this.config.credentialsPath, mode: mode.toString(8) },
        });
      }
    } catch {
      // Directory doesn't exist, which is fine
    }

    // Check for credentials in common insecure locations
    const insecureLocations = [
      path.join(process.cwd(), '.env'),
      path.join(process.cwd(), 'credentials.json'),
      path.join(process.cwd(), 'secrets.json'),
    ];

    for (const location of insecureLocations) {
      try {
        await fs.access(location);
        this.addFinding({
          category: 'credentials',
          severity: 'medium',
          title: 'Credentials file in working directory',
          description: `Found potential credentials file: ${location}`,
          impact: 'Credentials in the working directory may be accidentally committed to version control.',
          recommendation: 'Move credentials to ~/.codebuddy/credentials/ and add to .gitignore',
          details: { path: location },
        });
      } catch {
        // File doesn't exist, which is good
      }
    }
  }

  // ==========================================================================
  // File Permission Checks
  // ==========================================================================

  private async checkFilePermissions(): Promise<void> {
    if (!this.config.checkPermissions) return;

    const pathsToCheck = [
      { path: this.config.configPath, expectedMode: 0o700 },
      { path: this.config.sessionsPath, expectedMode: 0o700 },
      { path: this.config.pluginsPath, expectedMode: 0o700 },
    ];

    for (const { path: checkPath, expectedMode } of pathsToCheck) {
      try {
        const stats = await fs.stat(checkPath);
        const mode = stats.mode & 0o777;

        if ((mode & 0o077) !== 0) {
          this.addFinding({
            category: 'filesystem',
            severity: 'medium',
            title: 'Insecure directory permissions',
            description: `${checkPath} has permissions ${mode.toString(8)}, which allows group/other access.`,
            impact: 'Other users may be able to access sensitive data.',
            recommendation: `Run: chmod ${expectedMode.toString(8)} ${checkPath}`,
            details: { path: checkPath, mode: mode.toString(8), expected: expectedMode.toString(8) },
          });
        }
      } catch {
        // Path doesn't exist
      }
    }
  }

  // ==========================================================================
  // Configuration Checks
  // ==========================================================================

  private async checkConfiguration(): Promise<void> {
    // Check for debug mode
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      this.addFinding({
        category: 'configuration',
        severity: 'low',
        title: 'Debug mode may be enabled',
        description: 'DEBUG or development NODE_ENV is set.',
        impact: 'Debug output may expose sensitive information in logs.',
        recommendation: 'Disable debug mode in production.',
      });
    }

    // Check for verbose logging
    if (process.env.VERBOSE === 'true' || process.env.LOG_LEVEL === 'debug') {
      this.addFinding({
        category: 'configuration',
        severity: 'low',
        title: 'Verbose logging enabled',
        description: 'Verbose or debug logging is enabled.',
        impact: 'Detailed logs may contain sensitive information.',
        recommendation: 'Use "info" or "warn" log level in production.',
      });
    }
  }

  // ==========================================================================
  // Plugin Checks
  // ==========================================================================

  private async checkPlugins(): Promise<void> {
    try {
      const plugins = await fs.readdir(this.config.pluginsPath);

      if (plugins.length > 0) {
        this.addFinding({
          category: 'plugins',
          severity: 'info',
          title: 'Custom plugins installed',
          description: `Found ${plugins.length} plugin(s) in the plugins directory.`,
          impact: 'Plugins run with full access to the Code Buddy environment.',
          recommendation: 'Review all plugins for security before use. Only install plugins from trusted sources.',
          details: { plugins },
        });

        // Check for plugins without package.json
        for (const plugin of plugins) {
          const pluginPath = path.join(this.config.pluginsPath, plugin);
          const packagePath = path.join(pluginPath, 'package.json');

          try {
            const stat = await fs.stat(pluginPath);
            if (stat.isDirectory()) {
              try {
                await fs.access(packagePath);
              } catch {
                this.addFinding({
                  category: 'plugins',
                  severity: 'medium',
                  title: 'Plugin missing package.json',
                  description: `Plugin "${plugin}" has no package.json file.`,
                  impact: 'Cannot verify plugin metadata or dependencies.',
                  recommendation: 'Ensure all plugins have a valid package.json.',
                  details: { plugin },
                });
              }
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Plugins directory doesn't exist
    }
  }

  // ==========================================================================
  // Channel Checks
  // ==========================================================================

  private async checkChannels(): Promise<void> {
    // Check for open DM policies
    const dmPolicyEnv = process.env.DM_POLICY;
    if (dmPolicyEnv === 'open') {
      this.addFinding({
        category: 'channels',
        severity: 'high',
        title: 'Open DM policy',
        description: 'DM_POLICY is set to "open", allowing anyone to message the bot.',
        impact: 'Unknown users can send messages to the bot, potentially executing commands.',
        recommendation: 'Use "pairing" or "allowlist" DM policy for better security.',
      });
    }

    // Check for channel credentials in environment
    const channelEnvVars = [
      'TELEGRAM_BOT_TOKEN',
      'DISCORD_BOT_TOKEN',
      'SLACK_BOT_TOKEN',
    ];

    for (const envVar of channelEnvVars) {
      if (process.env[envVar]) {
        this.addFinding({
          category: 'channels',
          severity: 'info',
          title: `${envVar.replace(/_/g, ' ').toLowerCase()} configured`,
          description: `Channel credential ${envVar} is set.`,
          impact: 'Ensure the token has appropriate permissions.',
          recommendation: 'Review channel bot permissions and limit to necessary scopes.',
        });
      }
    }
  }

  // ==========================================================================
  // Tool Checks
  // ==========================================================================

  private async checkTools(): Promise<void> {
    // Check for dangerous tools being allowed
    const dangerousTools = [
      'bash',
      'process',
      'computer_control',
      'browser',
    ];

    // This would need integration with the actual tool policy system
    this.addFinding({
      category: 'tools',
      severity: 'info',
      title: 'Review tool allowlist',
      description: 'Ensure dangerous tools are restricted appropriately.',
      impact: 'Unrestricted tool access can lead to system compromise.',
      recommendation: 'Review tool-policy.ts and configure allowlists for untrusted channels.',
    });
  }

  // ==========================================================================
  // Network Checks
  // ==========================================================================

  private async checkNetwork(): Promise<void> {
    if (!this.config.checkNetwork) return;

    // Check for open ports
    try {
      const netstat = execSync('netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000,
      });

      // Check for common Code Buddy ports
      const portsToCheck = [
        { port: 3000, name: 'API server' },
        { port: 18789, name: 'Gateway' },
        { port: 18790, name: 'A2UI server' },
      ];

      for (const { port, name } of portsToCheck) {
        if (netstat.includes(`:${port}`)) {
          // Check if bound to 0.0.0.0
          if (netstat.includes(`0.0.0.0:${port}`) || netstat.includes(`:::${port}`)) {
            this.addFinding({
              category: 'network',
              severity: 'high',
              title: `${name} bound to all interfaces`,
              description: `Port ${port} (${name}) is bound to 0.0.0.0, accessible from any network.`,
              impact: 'Remote attackers may be able to connect to the service.',
              recommendation: 'Bind to 127.0.0.1 for local-only access, or use Tailscale for secure remote access.',
              details: { port, service: name },
            });
          }
        }
      }
    } catch {
      // netstat/ss not available
    }
  }

  // ==========================================================================
  // Browser Checks
  // ==========================================================================

  private async checkBrowser(): Promise<void> {
    if (!this.config.checkBrowser) return;

    // Check for remote debugging port
    if (process.env.CHROME_REMOTE_DEBUGGING_PORT) {
      this.addFinding({
        category: 'browser',
        severity: 'high',
        title: 'Chrome remote debugging port exposed',
        description: 'CHROME_REMOTE_DEBUGGING_PORT is set, exposing browser control.',
        impact: 'Remote attackers may be able to control the browser instance.',
        recommendation: 'Only enable remote debugging when necessary and bind to localhost.',
      });
    }

    // Check for CDP URL in environment
    if (process.env.CDP_URL) {
      const cdpUrl = process.env.CDP_URL;
      if (!cdpUrl.includes('localhost') && !cdpUrl.includes('127.0.0.1')) {
        this.addFinding({
          category: 'browser',
          severity: 'medium',
          title: 'Remote CDP URL configured',
          description: 'CDP_URL points to a non-localhost address.',
          impact: 'Browser control traffic may be intercepted.',
          recommendation: 'Use localhost or secure tunnel for CDP connections.',
        });
      }
    }
  }

  // ==========================================================================
  // Deep Scan
  // ==========================================================================

  private async deepScan(): Promise<void> {
    // Check git history for leaked secrets
    try {
      const gitLog = execSync('git log --oneline -50 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 10000,
        cwd: process.cwd(),
      });

      // Check for common secret patterns in commit messages
      const secretPatterns = [
        /api[_-]?key/i,
        /secret/i,
        /password/i,
        /token/i,
        /credential/i,
      ];

      for (const pattern of secretPatterns) {
        if (pattern.test(gitLog)) {
          this.addFinding({
            category: 'credentials',
            severity: 'low',
            title: 'Potential secrets in git history',
            description: 'Commit messages may reference secrets.',
            impact: 'Secrets may have been committed to version control.',
            recommendation: 'Review git history and rotate any exposed credentials.',
          });
          break;
        }
      }
    } catch {
      // Not a git repo or git not available
    }

    // Check for .env files not in .gitignore
    try {
      const gitignore = await fs.readFile('.gitignore', 'utf-8');
      if (!gitignore.includes('.env')) {
        this.addFinding({
          category: 'credentials',
          severity: 'medium',
          title: '.env not in .gitignore',
          description: '.env file is not listed in .gitignore.',
          impact: 'Environment files with secrets may be committed.',
          recommendation: 'Add ".env*" to .gitignore.',
        });
      }
    } catch {
      // No .gitignore
    }

    // Check npm audit
    try {
      const npmAudit = execSync('npm audit --json 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: process.cwd(),
      });

      const audit = JSON.parse(npmAudit);
      if (audit.metadata?.vulnerabilities) {
        const vulns = audit.metadata.vulnerabilities;
        if (vulns.critical > 0 || vulns.high > 0) {
          this.addFinding({
            category: 'configuration',
            severity: vulns.critical > 0 ? 'critical' : 'high',
            title: 'npm vulnerabilities detected',
            description: `Found ${vulns.critical} critical and ${vulns.high} high severity npm vulnerabilities.`,
            impact: 'Vulnerable dependencies may be exploited.',
            recommendation: 'Run "npm audit fix" to address vulnerabilities.',
            details: vulns,
          });
        }
      }
    } catch {
      // npm audit failed or not available
    }
  }

  // ==========================================================================
  // Agent-Specific Checks (OpenClaw-inspired)
  // ==========================================================================

  /**
   * Checks specific to AI agent deployments:
   * - Session transcript world-readability
   * - DM pairing scope (shared vs isolated)
   * - Plugin allowlist configuration
   * - Model selection quality (non-instruction-tuned models)
   * - YOLO mode in production-like environments
   * - Webhook delivery SSRF exposure
   */
  private async checkAgentSecurity(): Promise<void> {
    // 1. Session transcripts should not be world-readable
    try {
      const sessionDir = this.config.sessionsPath;
      const stat = await fs.stat(sessionDir).catch(() => null);
      if (stat) {
        const mode = stat.mode & 0o777;
        if (mode & 0o004) { // world-readable bit
          this.addFinding({
            category: 'filesystem',
            severity: 'high',
            title: 'Session transcripts are world-readable',
            description: `${sessionDir} has mode ${mode.toString(8)}, readable by all users on this system.`,
            impact: 'Conversation history (including secrets/PII entered during sessions) is accessible to any local user.',
            recommendation: `Run: chmod 700 "${sessionDir}"`,
            details: { path: sessionDir, mode: mode.toString(8), expected: '700' },
          });
        }
      }
    } catch { /* skip */ }

    // 2. Plugin allowlist — all plugins trusted by default is risky
    try {
      const pluginDir = this.config.pluginsPath;
      const plugins = await fs.readdir(pluginDir).catch(() => []);
      if (plugins.length > 0) {
        // Check for allowlist config
        const configFile = path.join(this.config.configPath, 'config.toml');
        const configContent = await fs.readFile(configFile, 'utf-8').catch(() => '');
        const hasPluginAllowlist = /plugin_allowlist|allowed_plugins/i.test(configContent);
        if (!hasPluginAllowlist) {
          this.addFinding({
            category: 'plugins',
            severity: 'medium',
            title: 'No plugin allowlist configured',
            description: `${plugins.length} plugin(s) installed but no allowlist is configured. All plugins run with agent permissions.`,
            impact: 'Malicious or compromised plugins can execute arbitrary code with full agent access.',
            recommendation: 'Add plugin_allowlist to .codebuddy/config.toml listing explicitly trusted plugins.',
            details: { installedPlugins: plugins.length, configPath: configFile },
          });
        }
      }
    } catch { /* skip */ }

    // 3. YOLO mode detection — warn if enabled outside of isolated environments
    const yoloMode = process.env.YOLO_MODE === 'true';
    const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    if (yoloMode && !isCi) {
      this.addFinding({
        category: 'configuration',
        severity: 'high',
        title: 'YOLO mode enabled in interactive session',
        description: 'YOLO_MODE=true bypasses all confirmation prompts. Agent will auto-approve all tool executions.',
        impact: 'A malicious prompt injection or unintended command could cause irreversible damage without confirmation.',
        recommendation: 'Only enable YOLO_MODE in isolated CI/CD containers. Use --autonomy=auto-edit for interactive sessions.',
        details: { yoloMode, ci: isCi },
      });
    }

    // 4. Webhook endpoint SSRF exposure — webhooks could relay to internal services
    try {
      const configFile = path.join(this.config.configPath, 'config.toml');
      const configContent = await fs.readFile(configFile, 'utf-8').catch(() => '');
      const webhookUrls = configContent.match(/url\s*=\s*"(https?:\/\/[^"]+)"/gi) ?? [];
      for (const match of webhookUrls) {
        const url = match.match(/"(https?:\/\/[^"]+)"/)?.[1];
        if (url) {
          try {
            const { URL: NodeURL } = await import('url');
            const parsed = new NodeURL(url);
            const host = parsed.hostname;
            if (host === 'localhost' || host.startsWith('192.168.') || host.startsWith('10.') || host === '127.0.0.1') {
              this.addFinding({
                category: 'network',
                severity: 'critical',
                title: 'Webhook configured to internal host',
                description: `Webhook URL points to internal host: ${url}`,
                impact: 'Agent-triggered webhooks could be used as SSRF gadgets to access internal services.',
                recommendation: 'Use only publicly-routable webhook endpoints. Deploy a relay proxy for internal targets.',
                details: { url },
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* skip */ }

    // 5. Model quality — warn for models known to be poorly instruction-tuned
    const modelEnv = process.env.GROK_MODEL || process.env.OPENAI_MODEL || '';
    const legacyPatterns = ['gpt-3.5', 'davinci', 'curie', 'babbage', 'ada'];
    if (legacyPatterns.some(p => modelEnv.includes(p))) {
      this.addFinding({
        category: 'configuration',
        severity: 'medium',
        title: 'Legacy or poorly instruction-tuned model in use',
        description: `Model "${modelEnv}" may not reliably follow safety instructions or tool constraints.`,
        impact: 'Agent may not respect deny-listed operations or safety boundaries.',
        recommendation: 'Upgrade to a modern instruction-tuned model (gpt-4o, claude-3-5-sonnet, grok-3).',
        details: { model: modelEnv },
      });
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Auto-fix file permission findings (chmod 700/600 for sensitive paths)
   */
  async fix(result: AuditResult): Promise<{ fixed: number; errors: string[] }> {
    let fixed = 0;
    const errors: string[] = [];

    for (const finding of result.findings) {
      if (
        (finding.category === 'filesystem' || finding.category === 'credentials') &&
        finding.details?.path &&
        typeof finding.details.path === 'string' &&
        finding.details.expected
      ) {
        try {
          const targetMode = parseInt(finding.details.expected as string, 8);
          await fs.chmod(finding.details.path, targetMode);
          fixed++;
        } catch (err) {
          errors.push(`Failed to fix ${finding.details.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return { fixed, errors };
  }

  private addFinding(finding: Omit<AuditFinding, 'id'>): void {
    this.findings.push({
      ...finding,
      id: `SEC-${++this.findingId}`,
    });
  }

  /**
   * Format audit result for console output
   */
  static formatResult(result: AuditResult): string {
    const lines: string[] = [];

    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║                    SECURITY AUDIT REPORT                     ║');
    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push(`║ Time: ${result.timestamp.toISOString().padEnd(55)}║`);
    lines.push(`║ Duration: ${(result.duration / 1000).toFixed(2)}s${result.deepScan ? ' (deep scan)' : ''}`.padEnd(64) + '║');
    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ SUMMARY                                                      ║');
    lines.push(`║   Critical: ${result.summary.critical}`.padEnd(64) + '║');
    lines.push(`║   High:     ${result.summary.high}`.padEnd(64) + '║');
    lines.push(`║   Medium:   ${result.summary.medium}`.padEnd(64) + '║');
    lines.push(`║   Low:      ${result.summary.low}`.padEnd(64) + '║');
    lines.push(`║   Info:     ${result.summary.info}`.padEnd(64) + '║');
    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push(`║ Status: ${result.passed ? '✓ PASSED' : '✗ FAILED'}`.padEnd(64) + '║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    if (result.findings.length > 0) {
      lines.push('');
      lines.push('FINDINGS:');
      lines.push('');

      const severityOrder: AuditSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
      const sortedFindings = [...result.findings].sort(
        (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
      );

      for (const finding of sortedFindings) {
        const severityBadge = {
          critical: '🔴 CRITICAL',
          high: '🟠 HIGH',
          medium: '🟡 MEDIUM',
          low: '🔵 LOW',
          info: '⚪ INFO',
        }[finding.severity];

        lines.push(`[${finding.id}] ${severityBadge}`);
        lines.push(`  ${finding.title}`);
        lines.push(`  Category: ${finding.category}`);
        lines.push(`  ${finding.description}`);
        lines.push(`  Impact: ${finding.impact}`);
        lines.push(`  Recommendation: ${finding.recommendation}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let securityAuditorInstance: SecurityAuditor | null = null;

export function getSecurityAuditor(config?: Partial<SecurityAuditConfig>): SecurityAuditor {
  if (!securityAuditorInstance) {
    securityAuditorInstance = new SecurityAuditor(config);
  }
  return securityAuditorInstance;
}

export function resetSecurityAuditor(): void {
  securityAuditorInstance = null;
}

export default SecurityAuditor;
