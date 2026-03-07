/**
 * Session Send Policy
 *
 * Rule-based message delivery blocking.
 * Inspired by OpenClaw's session.sendPolicy with deny/allow rules.
 *
 * Rules can match on channel, chatType (dm/group/thread), keyPrefix, and peerId.
 * Evaluated in order; first matching rule wins. Falls back to default action.
 *
 * Runtime overrides: /send on, /send off, /send inherit
 */

import { logger } from '../utils/logger.js';
import type { ChannelType } from './core.js';

// ============================================================================
// Types
// ============================================================================

export type SendAction = 'allow' | 'deny';

export interface SendPolicyRule {
  action: SendAction;
  match: {
    channel?: ChannelType | ChannelType[];
    chatType?: 'dm' | 'group' | 'thread';
    keyPrefix?: string;
    peerId?: string;
  };
  reason?: string;
}

export interface SendPolicyConfig {
  rules: SendPolicyRule[];
  default: SendAction;
}

export type SendOverride = 'on' | 'off' | 'inherit';

// ============================================================================
// Send Policy Engine
// ============================================================================

export class SendPolicyEngine {
  private static instance: SendPolicyEngine | null = null;
  private config: SendPolicyConfig;
  private overrides: Map<string, SendOverride> = new Map(); // sessionKey → override

  constructor(config?: Partial<SendPolicyConfig>) {
    this.config = {
      rules: config?.rules || [],
      default: config?.default || 'allow',
    };
  }

  static getInstance(config?: Partial<SendPolicyConfig>): SendPolicyEngine {
    if (!SendPolicyEngine.instance) {
      SendPolicyEngine.instance = new SendPolicyEngine(config);
    }
    return SendPolicyEngine.instance;
  }

  static resetInstance(): void {
    SendPolicyEngine.instance = null;
  }

  // --------------------------------------------------------------------------
  // Evaluation
  // --------------------------------------------------------------------------

  evaluate(context: {
    sessionKey: string;
    channel?: ChannelType;
    chatType?: 'dm' | 'group' | 'thread';
    peerId?: string;
  }): { allowed: boolean; rule?: SendPolicyRule; reason?: string } {
    // Check runtime override first
    const override = this.overrides.get(context.sessionKey);
    if (override === 'on') return { allowed: true, reason: 'Runtime override: /send on' };
    if (override === 'off') return { allowed: false, reason: 'Runtime override: /send off' };

    // Evaluate rules in order
    for (const rule of this.config.rules) {
      if (this.matchesRule(rule, context)) {
        const allowed = rule.action === 'allow';
        return { allowed, rule, reason: rule.reason || `Matched rule: ${rule.action}` };
      }
    }

    // Default action
    const allowed = this.config.default === 'allow';
    return { allowed, reason: `Default policy: ${this.config.default}` };
  }

  private matchesRule(
    rule: SendPolicyRule,
    context: {
      sessionKey: string;
      channel?: ChannelType;
      chatType?: 'dm' | 'group' | 'thread';
      peerId?: string;
    }
  ): boolean {
    const match = rule.match;

    // Channel match
    if (match.channel) {
      const channels = Array.isArray(match.channel) ? match.channel : [match.channel];
      if (context.channel && !channels.includes(context.channel)) return false;
    }

    // Chat type match
    if (match.chatType && context.chatType !== match.chatType) return false;

    // Key prefix match
    if (match.keyPrefix && !context.sessionKey.startsWith(match.keyPrefix)) return false;

    // Peer ID match
    if (match.peerId && context.peerId !== match.peerId) return false;

    return true;
  }

  // --------------------------------------------------------------------------
  // Runtime Overrides
  // --------------------------------------------------------------------------

  setOverride(sessionKey: string, override: SendOverride): void {
    if (override === 'inherit') {
      this.overrides.delete(sessionKey);
    } else {
      this.overrides.set(sessionKey, override);
    }
    logger.debug(`Send policy override for ${sessionKey}: ${override}`);
  }

  getOverride(sessionKey: string): SendOverride {
    return this.overrides.get(sessionKey) || 'inherit';
  }

  clearOverrides(): void {
    this.overrides.clear();
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  addRule(rule: SendPolicyRule): void {
    this.config.rules.push(rule);
  }

  removeRule(index: number): boolean {
    if (index >= 0 && index < this.config.rules.length) {
      this.config.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  getRules(): SendPolicyRule[] {
    return [...this.config.rules];
  }

  setDefaultAction(action: SendAction): void {
    this.config.default = action;
  }

  getConfig(): SendPolicyConfig {
    return { ...this.config, rules: [...this.config.rules] };
  }
}
