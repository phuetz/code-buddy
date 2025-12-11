import { ChatEntry } from "../../agent/grok-agent.js";
import { getSecurityManager, ApprovalMode } from "../../security/index.js";
import { getCodeGuardianAgent, CodeGuardianMode } from "../../agent/specialized/code-guardian-agent.js";
import { ConfirmationService } from "../../utils/confirmation-service.js";
import { SecurityReviewAgent, getSecurityReviewAgent } from "../../agent/specialized/security-review-agent.js";

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Security - Show security dashboard
 */
export function handleSecurity(args: string[]): CommandHandlerResult {
  const securityManager = getSecurityManager();
  const action = args[0]?.toLowerCase();

  let content: string;

  switch (action) {
    case "mode":
      const mode = args[1]?.toLowerCase() as ApprovalMode;
      if (mode && ['read-only', 'auto', 'full-access'].includes(mode)) {
        securityManager.updateConfig({ approvalMode: mode });
        content = `🛡️ Security mode set to: ${mode.toUpperCase()}`;
      } else {
        content = `Usage: /security mode <read-only|auto|full-access>

Modes:
  read-only   - Only read operations, no writes or commands
  auto        - Auto-approve safe operations, confirm dangerous ones
  full-access - All operations auto-approved (trusted environments)`;
      }
      break;

    case "reset":
      securityManager.resetStats();
      content = `🔄 Security statistics reset`;
      break;

    case "events":
      const events = securityManager.getEvents(10);
      if (events.length === 0) {
        content = `📜 No security events recorded`;
      } else {
        const eventLines = events.map(e => {
          const time = new Date(e.timestamp).toLocaleTimeString();
          return `[${time}] ${e.type}: ${e.action} → ${e.result}`;
        });
        content = `📜 Recent Security Events\n\n${eventLines.join('\n')}`;
      }
      break;

    case "status":
    default:
      content = securityManager.formatDashboard();
      break;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Dry-Run - Toggle simulation mode
 */
export function handleDryRun(args: string[]): CommandHandlerResult {
  const confirmationService = ConfirmationService.getInstance();
  const action = args[0]?.toLowerCase();

  let content: string;

  switch (action) {
    case "on":
      confirmationService.setDryRunMode(true);
      content = `🔍 Dry-Run Mode: ENABLED

Changes will be previewed but NOT applied.
All operations will be logged for review.

Use /dry-run off to disable and apply changes.
Use /dry-run log to see what would have executed.`;
      break;

    case "off":
      const log = confirmationService.getDryRunLog();
      confirmationService.setDryRunMode(false);
      content = `🔍 Dry-Run Mode: DISABLED

Changes will now be applied normally.

${log.length > 0 ? `📋 ${log.length} operation(s) were logged during dry-run.` : ''}`;
      break;

    case "log":
      content = confirmationService.formatDryRunLog();
      break;

    case "status":
    default:
      const isDryRun = confirmationService.isDryRunMode();
      const currentLog = confirmationService.getDryRunLog();
      content = `🔍 Dry-Run Status

Mode: ${isDryRun ? '✅ ENABLED (simulation)' : '❌ DISABLED (live)'}
Logged Operations: ${currentLog.length}

Commands:
  /dry-run on     - Enable simulation mode
  /dry-run off    - Disable and apply changes
  /dry-run log    - View logged operations

Or use --dry-run flag when starting the CLI.`;
      break;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Guardian - Code Guardian agent for code analysis and review
 */
export async function handleGuardian(args: string[]): Promise<CommandHandlerResult> {
  const guardian = getCodeGuardianAgent();

  // Initialize if needed
  if (!guardian.isReady()) {
    await guardian.initialize();
  }

  const action = args[0]?.toLowerCase() || 'help';
  const target = args[1] || process.cwd();

  // Handle mode setting
  if (action === 'mode') {
    const modeMap: Record<string, CodeGuardianMode> = {
      'analyze': 'ANALYZE_ONLY',
      'analyze-only': 'ANALYZE_ONLY',
      'suggest': 'SUGGEST_REFACTOR',
      'plan': 'PATCH_PLAN',
      'diff': 'PATCH_DIFF',
    };
    const newMode = modeMap[args[1]?.toLowerCase() || ''];
    if (newMode) {
      guardian.setMode(newMode);
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `🛡️ Code Guardian - Mode: ${newMode}

Les modifications sont ${newMode === 'ANALYZE_ONLY' ? 'désactivées' : 'possibles'}.`,
          timestamp: new Date(),
        },
      };
    }
  }

  // Map actions to agent tasks
  const actionMap: Record<string, { action: string; description: string }> = {
    'analyze': { action: 'analyze-directory', description: 'Analyse complète du répertoire' },
    'security': { action: 'check-security', description: 'Audit de sécurité' },
    'review': { action: 'analyze-file', description: 'Revue de code' },
    'refactor': { action: 'suggest-refactor', description: 'Suggestions de refactoring' },
    'plan': { action: 'create-patch-plan', description: 'Plan de modifications' },
    'architecture': { action: 'review-architecture', description: 'Revue d\'architecture' },
    'deps': { action: 'map-dependencies', description: 'Carte des dépendances' },
    'explain': { action: 'explain-code', description: 'Explication du code' },
  };

  if (action === 'help' || !actionMap[action]) {
    const currentMode = guardian.getMode();
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `🛡️ Grokinette - Code Guardian
═══════════════════════════════════════════════════

Mode actuel: ${currentMode}

📋 Actions disponibles:
  /guardian analyze [path]     - Analyse complète du code
  /guardian security [path]    - Audit de sécurité
  /guardian review <file>      - Revue d'un fichier
  /guardian refactor [path]    - Suggestions de refactoring
  /guardian architecture       - Revue d'architecture
  /guardian deps [path]        - Carte des dépendances
  /guardian explain <file>     - Explication du code

⚙️ Modes:
  /guardian mode analyze-only  - Lecture seule
  /guardian mode suggest       - Analyse + suggestions
  /guardian mode plan          - Plans de modification
  /guardian mode diff          - Génération de diffs

🔒 Règles de sécurité:
  • Validation humaine requise pour les modifications
  • Pas de suppression massive
  • Rollback toujours disponible`,
        timestamp: new Date(),
      },
    };
  }

  const taskInfo = actionMap[action];

  try {
    // Set mode for refactoring actions
    if (['refactor', 'plan'].includes(action)) {
      if (guardian.getMode() === 'ANALYZE_ONLY') {
        guardian.setMode('SUGGEST_REFACTOR');
      }
    }

    const result = await guardian.execute({
      action: taskInfo.action,
      inputFiles: [target],
    });

    if (result.success) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: result.output || JSON.stringify(result.data, null, 2),
          timestamp: new Date(),
        },
      };
    } else {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ Code Guardian - Erreur

${result.error || 'Une erreur inconnue s\'est produite'}`,
          timestamp: new Date(),
        },
      };
    }
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Code Guardian - Erreur

${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Security Review - Comprehensive security analysis command
 * Inspired by Claude Code's /security-review
 */
export async function handleSecurityReview(args: string[]): Promise<CommandHandlerResult> {
  const reviewer = getSecurityReviewAgent();

  // Initialize if needed
  if (!reviewer.isReady()) {
    await reviewer.initialize();
  }

  const action = args[0]?.toLowerCase() || 'scan';
  const target = args.slice(1).join(' ') || process.cwd();

  // Help command
  if (action === 'help') {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `🔒 Security Review - Comprehensive Security Analysis
══════════════════════════════════════════════════════

📋 Commands:
  /security-review scan [path]       - Full security scan
  /security-review quick [path]      - Quick vulnerability check
  /security-review deps [path]       - Dependency vulnerability audit
  /security-review secrets [path]    - Secret/credential detection
  /security-review permissions       - File permission audit
  /security-review network [file]    - Network security analysis
  /security-review injection [file]  - SQL/Command injection check
  /security-review xss [file]        - XSS vulnerability check
  /security-review auth [path]       - Authentication flow review
  /security-review report [format]   - Generate security report

🎯 Scan Types:
  • OWASP Top 10 vulnerabilities
  • Hardcoded credentials/secrets
  • Insecure dependencies (CVEs)
  • Injection vulnerabilities (SQL, XSS, Command)
  • Authentication/authorization issues
  • Insecure file permissions
  • Network security misconfigurations

📊 Report Formats:
  • text (default) - Human-readable
  • json           - Machine-parseable
  • sarif          - SARIF format for CI integration
  • markdown       - Documentation-friendly`,
        timestamp: new Date(),
      },
    };
  }

  try {
    let result;

    switch (action) {
      case 'scan':
      case 'full':
        result = await reviewer.fullScan(target);
        break;

      case 'quick':
        result = await reviewer.quickScan(target);
        break;

      case 'deps':
      case 'dependencies':
        result = await reviewer.auditDependencies(target);
        break;

      case 'secrets':
      case 'credentials':
        result = await reviewer.detectSecrets(target);
        break;

      case 'permissions':
      case 'perms':
        result = await reviewer.auditPermissions(target);
        break;

      case 'network':
        result = await reviewer.analyzeNetworkSecurity(target);
        break;

      case 'injection':
        result = await reviewer.checkInjectionVulns(target);
        break;

      case 'xss':
        result = await reviewer.checkXSSVulns(target);
        break;

      case 'auth':
      case 'authentication':
        result = await reviewer.reviewAuthFlow(target);
        break;

      case 'report':
        const format = args[1]?.toLowerCase() || 'text';
        result = await reviewer.generateReport(format as 'text' | 'json' | 'sarif' | 'markdown');
        break;

      default:
        result = await reviewer.quickScan(target);
        break;
    }

    if (result.success) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: result.output || formatSecurityResult(result),
          timestamp: new Date(),
        },
      };
    } else {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ Security Review - Error

${result.error || 'An unknown error occurred'}`,
          timestamp: new Date(),
        },
      };
    }
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Security Review - Error

${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Format security scan result
 */
function formatSecurityResult(result: any): string {
  const lines: string[] = [
    '🔒 Security Review Results',
    '══════════════════════════════',
    '',
  ];

  if (result.summary) {
    lines.push(`📊 Summary`);
    lines.push(`  Critical: ${result.summary.critical || 0}`);
    lines.push(`  High: ${result.summary.high || 0}`);
    lines.push(`  Medium: ${result.summary.medium || 0}`);
    lines.push(`  Low: ${result.summary.low || 0}`);
    lines.push(`  Info: ${result.summary.info || 0}`);
    lines.push('');
  }

  if (result.findings && result.findings.length > 0) {
    lines.push(`🔍 Findings (${result.findings.length})`);
    lines.push('');

    for (const finding of result.findings.slice(0, 10)) {
      const icon = getSeverityIcon(finding.severity);
      lines.push(`${icon} [${finding.severity.toUpperCase()}] ${finding.title}`);
      if (finding.file) {
        lines.push(`   📁 ${finding.file}${finding.line ? `:${finding.line}` : ''}`);
      }
      if (finding.description) {
        lines.push(`   ${finding.description}`);
      }
      if (finding.recommendation) {
        lines.push(`   💡 ${finding.recommendation}`);
      }
      lines.push('');
    }

    if (result.findings.length > 10) {
      lines.push(`... and ${result.findings.length - 10} more findings`);
      lines.push('');
    }
  } else {
    lines.push('✅ No security issues found!');
    lines.push('');
  }

  if (result.recommendations && result.recommendations.length > 0) {
    lines.push('💡 Recommendations');
    for (const rec of result.recommendations.slice(0, 5)) {
      lines.push(`  • ${rec}`);
    }
  }

  return lines.join('\n');
}

function getSeverityIcon(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    case 'info': return '🔵';
    default: return '⚪';
  }
}
