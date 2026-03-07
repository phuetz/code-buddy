import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { getSecurityManager, ApprovalMode } from "../../security/index.js";
import { getCodeGuardianAgent, CodeGuardianMode } from "../../agent/specialized/code-guardian-agent.js";
import { ConfirmationService } from "../../utils/confirmation-service.js";
import { getSecurityReviewAgent } from "../../agent/specialized/security-review-agent.js";
import { getDMPairing } from "../../channels/dm-pairing.js";
import { getIdentityLinker } from "../../channels/identity-links.js";
import type { ChannelType } from "../../channels/index.js";

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
        content: `🛡️ CodeBuddynette - Code Guardian
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
  const knownActions = new Set([
    'scan',
    'full',
    'quick',
    'deps',
    'dependencies',
    'secrets',
    'credentials',
    'permissions',
    'perms',
    'network',
    'injection',
    'xss',
    'auth',
    'authentication',
    'report',
    'help',
  ]);

  if (args.length === 0) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: 'Usage: /security-review <path> [--quick] [--format <text|json|sarif|markdown>]\n\nUse /security-review help for detailed commands.',
        timestamp: new Date(),
      },
    };
  }

  let format: 'text' | 'json' | 'sarif' | 'markdown' = 'text';
  let quickFlag = false;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--quick') {
      quickFlag = true;
      continue;
    }
    if (arg === '--format') {
      const nextValue = args[index + 1]?.toLowerCase();
      if (nextValue === 'json' || nextValue === 'sarif' || nextValue === 'markdown' || nextValue === 'text') {
        format = nextValue;
        index++;
      }
      continue;
    }
    positional.push(arg);
  }

  const firstArg = positional[0]?.toLowerCase();
  const action = firstArg && knownActions.has(firstArg)
    ? firstArg
    : quickFlag
      ? 'quick'
      : 'scan';
  const target = firstArg && knownActions.has(firstArg)
    ? positional.slice(1).join(' ') || process.cwd()
    : positional.join(' ');

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

  if (action !== 'report' && !target) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: 'Usage: /security-review <path> [--quick] [--format <text|json|sarif|markdown>]',
        timestamp: new Date(),
      },
    };
  }

  const reviewer = getSecurityReviewAgent();

  // Initialize only when we actually need to execute a scan/report.
  if (!reviewer.isReady()) {
    await reviewer.initialize();
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
        result = await reviewer.generateReport(format);
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

// Security result types
interface SecurityFinding {
  severity: string;
  title: string;
  file?: string;
  line?: number;
  description?: string;
  recommendation?: string;
}

interface SecurityResult {
  summary?: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
  };
  findings?: SecurityFinding[];
  recommendations?: string[];
}

/**
 * Format security scan result
 */
function formatSecurityResult(result: SecurityResult): string {
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

// ============================================================================
// DM Pairing Command Handler
// ============================================================================

const VALID_PAIRING_CHANNELS: ChannelType[] = [
  'telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix',
  'line', 'nostr', 'zalo', 'mattermost', 'nextcloud-talk', 'twilio-voice', 'imessage',
];

/**
 * Pairing - Manage DM pairing for channel access control
 *
 *   /pairing approve <channel> <code>  - Approve a pending pairing request
 *   /pairing list                      - List all approved senders
 *   /pairing pending                   - List pending pairing requests
 *   /pairing revoke <channel> <userId> - Revoke a paired sender
 *   /pairing status                    - Show pairing system status
 */
export function handlePairing(args: string[]): CommandHandlerResult {
  const pairing = getDMPairing();
  const action = args[0]?.toLowerCase();

  let content: string;

  switch (action) {
    case 'approve': {
      const channel = args[1]?.toLowerCase() as ChannelType | undefined;
      const code = args[2]?.toUpperCase();

      if (!channel || !code) {
        content = 'Usage: /pairing approve <channel> <code>\n\nExample: /pairing approve telegram ABC123';
        break;
      }

      if (!VALID_PAIRING_CHANNELS.includes(channel)) {
        content = `Invalid channel: ${channel}\nValid channels: ${VALID_PAIRING_CHANNELS.join(', ')}`;
        break;
      }

      const sender = pairing.approve(channel, code);
      if (sender) {
        content = `Pairing approved!\n\nChannel: ${sender.channelType}\nUser: ${sender.displayName || sender.senderId}\nID: ${sender.senderId}`;
      } else {
        content = `Pairing failed. No pending request found for channel "${channel}" with code "${code}".\n\nThe code may have expired or already been used. Use /pairing pending to see active requests.`;
      }
      break;
    }

    case 'list': {
      const approved = pairing.listApproved();
      if (approved.length === 0) {
        content = 'No approved senders.\n\nWhen users message the bot on a paired channel, they will receive a pairing code.';
      } else {
        const lines = approved.map(s => {
          const name = s.displayName || s.senderId;
          const date = new Date(s.approvedAt).toLocaleDateString();
          return `  ${s.channelType}: ${name} (${s.senderId}) - approved ${date}`;
        });
        content = `Approved Senders (${approved.length})\n\n${lines.join('\n')}`;
      }
      break;
    }

    case 'pending': {
      const pending = pairing.listPending();
      if (pending.length === 0) {
        content = 'No pending pairing requests.';
      } else {
        const lines = pending.map(r => {
          const name = r.displayName || r.senderId;
          const expires = new Date(r.expiresAt).toLocaleTimeString();
          return `  ${r.channelType}: ${name} - code: ${r.code} (expires ${expires})`;
        });
        content = `Pending Pairing Requests (${pending.length})\n\n${lines.join('\n')}\n\nUse: /pairing approve <channel> <code>`;
      }
      break;
    }

    case 'revoke': {
      const channel = args[1]?.toLowerCase() as ChannelType | undefined;
      const userId = args[2];

      if (!channel || !userId) {
        content = 'Usage: /pairing revoke <channel> <userId>\n\nExample: /pairing revoke telegram 123456789';
        break;
      }

      if (!VALID_PAIRING_CHANNELS.includes(channel)) {
        content = `Invalid channel: ${channel}\nValid channels: ${VALID_PAIRING_CHANNELS.join(', ')}`;
        break;
      }

      const revoked = pairing.revoke(channel, userId);
      if (revoked) {
        content = `Access revoked for ${userId} on ${channel}.`;
      } else {
        content = `No approved sender found for ${userId} on ${channel}.`;
      }
      break;
    }

    case 'status': {
      const stats = pairing.getStats();
      const channelLines = Object.entries(stats.approvedByChannel)
        .map(([ch, count]) => `  ${ch}: ${count}`)
        .join('\n');

      content = `DM Pairing Status\n\nEnabled: ${stats.enabled ? 'Yes' : 'No'}\nApproved: ${stats.totalApproved}\nPending: ${stats.totalPending}\nBlocked: ${stats.totalBlocked}${channelLines ? `\n\nBy Channel:\n${channelLines}` : ''}`;
      break;
    }

    case 'help':
    default:
      content = `DM Pairing - Access Control for Messaging Channels

Commands:
  /pairing approve <channel> <code>  - Approve a pending pairing request
  /pairing list                      - List all approved senders
  /pairing pending                   - Show pending pairing requests
  /pairing revoke <channel> <userId> - Revoke a paired sender
  /pairing status                    - Show pairing system status

How it works:
  When pairing is enabled, unknown DM senders on messaging channels
  (Telegram, Discord, Slack, etc.) receive a pairing code instead of
  having their messages processed. The owner approves via the CLI
  using the pairing code.

Supported channels: ${VALID_PAIRING_CHANNELS.join(', ')}`;
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

// ============================================================================
// Identity Link Command Handler
// ============================================================================

const VALID_IDENTITY_CHANNELS: ChannelType[] = [
  'telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix',
  'line', 'nostr', 'zalo', 'mattermost', 'nextcloud-talk', 'twilio-voice', 'imessage',
  'cli', 'web', 'api',
];

/**
 * Identity - Manage cross-channel identity links
 *
 *   /identity link <ch1> <id1> <ch2> <id2>  - Link two channel identities
 *   /identity list                           - List all linked identities
 *   /identity unlink <channel> <userId>      - Remove an identity link
 *   /identity status                         - Show identity linker statistics
 */
export function handleIdentity(args: string[]): CommandHandlerResult {
  const linker = getIdentityLinker();
  const action = args[0]?.toLowerCase();

  let content: string;

  switch (action) {
    case 'link': {
      const channel1 = args[1]?.toLowerCase() as ChannelType | undefined;
      const userId1 = args[2];
      const channel2 = args[3]?.toLowerCase() as ChannelType | undefined;
      const userId2 = args[4];

      if (!channel1 || !userId1 || !channel2 || !userId2) {
        content = 'Usage: /identity link <channel1> <userId1> <channel2> <userId2>\n\nExample: /identity link telegram 12345 discord user#6789\n\nLinks two channel identities together so they share the same session.';
        break;
      }

      if (!VALID_IDENTITY_CHANNELS.includes(channel1)) {
        content = `Invalid channel: ${channel1}\nValid channels: ${VALID_IDENTITY_CHANNELS.join(', ')}`;
        break;
      }

      if (!VALID_IDENTITY_CHANNELS.includes(channel2)) {
        content = `Invalid channel: ${channel2}\nValid channels: ${VALID_IDENTITY_CHANNELS.join(', ')}`;
        break;
      }

      const canonical = linker.link(
        { channelType: channel1, peerId: userId1 },
        { channelType: channel2, peerId: userId2 }
      );

      const identityList = canonical.identities
        .map(i => `  ${i.channelType}: ${i.peerId}${i.displayName ? ` (${i.displayName})` : ''}`)
        .join('\n');

      content = `Identity linked!\n\nCanonical ID: ${canonical.id}\nName: ${canonical.name}\nLinked identities:\n${identityList}`;
      break;
    }

    case 'list': {
      const all = linker.listAll();
      if (all.length === 0) {
        content = 'No identity links configured.\n\nUse /identity link <channel1> <userId1> <channel2> <userId2> to create one.';
      } else {
        const lines = all.map(c => {
          const ids = c.identities
            .map(i => `    ${i.channelType}: ${i.peerId}${i.displayName ? ` (${i.displayName})` : ''}`)
            .join('\n');
          return `  [${c.id}] ${c.name}\n${ids}`;
        });
        content = `Identity Links (${all.length})\n\n${lines.join('\n\n')}`;
      }
      break;
    }

    case 'unlink': {
      const channel = args[1]?.toLowerCase() as ChannelType | undefined;
      const userId = args[2];

      if (!channel || !userId) {
        content = 'Usage: /identity unlink <channel> <userId>\n\nExample: /identity unlink telegram 12345';
        break;
      }

      if (!VALID_IDENTITY_CHANNELS.includes(channel)) {
        content = `Invalid channel: ${channel}\nValid channels: ${VALID_IDENTITY_CHANNELS.join(', ')}`;
        break;
      }

      const unlinked = linker.unlink({ channelType: channel, peerId: userId });
      if (unlinked) {
        content = `Identity unlinked: ${channel}:${userId}`;
      } else {
        content = `No identity link found for ${channel}:${userId}.`;
      }
      break;
    }

    case 'status': {
      const stats = linker.getStats();
      const channelLines = Object.entries(stats.channelDistribution)
        .map(([ch, count]) => `  ${ch}: ${count}`)
        .join('\n');

      content = `Identity Linker Status\n\nCanonical identities: ${stats.totalCanonical}\nTotal linked: ${stats.totalLinked}\nMulti-channel: ${stats.multiChannelCount}${channelLines ? `\n\nBy Channel:\n${channelLines}` : ''}`;
      break;
    }

    case 'help':
    default:
      content = `Identity Links - Cross-Channel Identity Unification

Commands:
  /identity link <ch1> <id1> <ch2> <id2>  - Link two channel identities
  /identity list                           - List all linked identities
  /identity unlink <channel> <userId>      - Remove an identity link
  /identity status                         - Show identity linker statistics

How it works:
  When identities are linked across channels, the session isolator
  uses the canonical identity to compute session keys. This means
  the same person messaging from Telegram and Discord will share
  the same session context.

Valid channels: ${VALID_IDENTITY_CHANNELS.join(', ')}`;
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
