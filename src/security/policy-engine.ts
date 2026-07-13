export type Capability =
  | 'fs:read'
  | 'fs:write:scoped'
  | 'shell:safe'
  | 'net:listed'
  | 'fleet:listen'
  | 'peer:invoke'
  | 'self_improvement';

export type RiskLevel = 'low' | 'medium' | 'high';
export type PolicyDecision = 'allow' | 'deny' | 'needs_approval';

export interface PolicyRequest {
  capability: Capability;
  risk: RiskLevel;
  detail?: Record<string, unknown>;   // ex. { path, command, peerId }
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export class PolicyEngine {
  private static instance: PolicyEngine | null = null;

  static getInstance(): PolicyEngine {
    if (!PolicyEngine.instance) {
      PolicyEngine.instance = new PolicyEngine();
    }
    return PolicyEngine.instance;
  }

  /** Coupe-circuit global : tout passe en `deny`. */
  engageKillSwitch(reason: string): void {
    (globalThis as any).CODEBUDDY_KILL_SWITCH = true;
    (globalThis as any).CODEBUDDY_KILL_SWITCH_REASON = reason;
    process.env.CODEBUDDY_KILL_SWITCH = 'true';
    process.env.CODEBUDDY_KILL_SWITCH_REASON = reason;
  }

  releaseKillSwitch(): void {
    (globalThis as any).CODEBUDDY_KILL_SWITCH = false;
    delete (globalThis as any).CODEBUDDY_KILL_SWITCH_REASON;
    delete process.env.CODEBUDDY_KILL_SWITCH;
    delete process.env.CODEBUDDY_KILL_SWITCH_REASON;
  }

  isKilled(): boolean {
    return (globalThis as any).CODEBUDDY_KILL_SWITCH === true || process.env.CODEBUDDY_KILL_SWITCH === 'true';
  }

  getKillReason(): string {
    return (globalThis as any).CODEBUDDY_KILL_SWITCH_REASON || process.env.CODEBUDDY_KILL_SWITCH_REASON || 'No reason provided';
  }

  /** Décision déclarative ; par défaut tout ce qui touche prod/réseau/secret = needs_approval. */
  evaluate(req: PolicyRequest): PolicyResult {
    if (this.isKilled()) {
      return {
        decision: 'deny',
        reason: `Kill switch engaged: ${this.getKillReason()}`,
      };
    }

    // Fail-safe check for unknown capability
    const validCapabilities = [
      'fs:read',
      'fs:write:scoped',
      'shell:safe',
      'net:listed',
      'fleet:listen',
      'peer:invoke',
      'self_improvement',
    ];
    if (!validCapabilities.includes(req.capability)) {
      return {
        decision: 'needs_approval',
        reason: `Unknown capability: ${req.capability}. Defaulting to needs_approval.`,
      };
    }

    // Check for secrets or deployment in details
    if (this.isSecretsOrDeployment(req.detail)) {
      return {
        decision: 'needs_approval',
        reason: 'Operation accesses secrets or deployment configuration. Approval required.',
      };
    }

    switch (req.capability) {
      case 'fs:read':
        return {
          decision: 'allow',
          reason: 'Read operations are allowed.',
        };

      case 'fs:write:scoped':
        if (req.risk === 'low') {
          return {
            decision: 'allow',
            reason: 'Low risk scoped write allowed.',
          };
        } else {
          return {
            decision: 'needs_approval',
            reason: `${req.risk} risk scoped write requires approval.`,
          };
        }

      case 'shell:safe':
        if (req.risk === 'low') {
          return {
            decision: 'allow',
            reason: 'Low-risk shell execution allowed.',
          };
        }
        return {
          decision: 'needs_approval',
          reason: `${req.risk} risk shell execution requires approval.`,
        };

      case 'net:listed':
      case 'fleet:listen':
      case 'peer:invoke':
      case 'self_improvement':
        return {
          decision: 'needs_approval',
          reason: `${req.capability} operations require explicit approval.`,
        };

      default:
        return {
          decision: 'needs_approval',
          reason: 'Fallthrough check: Approval required.',
        };
    }
  }

  private isSecretsOrDeployment(detail?: Record<string, unknown>): boolean {
    if (!detail) return false;
    const pathStr = String(detail.path || '').toLowerCase();
    const cmdStr = String(detail.command || '').toLowerCase();
    const peerIdStr = String(detail.peerId || '').toLowerCase();

    const secretKeywords = ['.env', 'secret', 'credential', 'token', 'key', 'password', 'private'];
    const deployKeywords = ['deploy', 'publish', 'release', 'prod', 'production', 'kube', 'docker'];

    const hasSecret = secretKeywords.some(kw => pathStr.includes(kw) || cmdStr.includes(kw) || peerIdStr.includes(kw));
    const hasDeploy = deployKeywords.some(kw => pathStr.includes(kw) || cmdStr.includes(kw));

    return hasSecret || hasDeploy;
  }
}
