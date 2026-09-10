/**
 * Companion identity resolution.
 *
 * Resolves who is speaking to Lisa across Telegram, PWA mobile WebSocket,
 * and physical voice presence, and assigns a trust level:
 * - 'owner': Full trust. Identified via Telegram allowlist/chat or PWA JWT.
 * - 'present': Physical presence detected and robot named. Lower trust.
 * - 'guest': Unknown / unauthenticated speaker. Fail-closed: ZERO tools.
 *
 * @module companion/companion-identity
 */

export type CompanionIdentityRole = 'owner' | 'present' | 'guest';

export type CompanionIdentityConfidence = 'high' | 'medium' | 'none';

export interface CompanionIdentity {
  role: CompanionIdentityRole;
  channel: 'telegram' | 'pwa' | 'voice' | 'channel' | 'unknown';
  userId?: string;
  chatId?: string;
  confidence: CompanionIdentityConfidence;
  reason: string;
}

export interface ResolveIdentityOptions {
  channel: 'telegram' | 'pwa' | 'mobile' | 'voice' | 'channel' | string;
  userId?: string;
  chatId?: string;
  senderId?: string;
  senderUsername?: string;
  allowedUsers?: readonly string[];
  isVoicePresence?: boolean;
  robotNamed?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve identity and confidence tier from incoming channel information.
 * Pure function: takes options and env, zero global side-effects.
 */
export function resolveCompanionIdentity(options: ResolveIdentityOptions): CompanionIdentity {
  const env = options.env ?? process.env;
  const channelRaw = (options.channel || '').toLowerCase().trim();

  // 1. Telegram
  if (channelRaw === 'telegram') {
    const alertChat = (env.CODEBUDDY_SENSORY_ALERT_CHAT ?? '').trim();
    const allowed = new Set((options.allowedUsers ?? []).map((u) => u.trim().toLowerCase()));

    const chatId = (options.chatId ?? '').trim();
    const senderId = (options.senderId ?? options.userId ?? '').trim();
    const rawUsername = (options.senderUsername ?? '').trim().toLowerCase();
    const senderUsername = rawUsername.replace(/^@/, '');

    const isChatAlertMatch = Boolean(alertChat && chatId && chatId === alertChat);
    const isChatAllowedMatch = Boolean(chatId && allowed.has(chatId.toLowerCase()));
    const isSenderIdMatch = Boolean(senderId && allowed.has(senderId.toLowerCase()));
    const isUsernameMatch = Boolean(
      senderUsername && (allowed.has(senderUsername) || allowed.has(`@${senderUsername}`)),
    );

    if (isChatAlertMatch || isChatAllowedMatch || isSenderIdMatch || isUsernameMatch) {
      return {
        role: 'owner',
        channel: 'telegram',
        ...(senderId ? { userId: senderId } : {}),
        ...(chatId ? { chatId } : {}),
        confidence: 'high',
        reason: isChatAlertMatch
          ? 'telegram_sensory_alert_chat_match'
          : isChatAllowedMatch
            ? 'telegram_chat_id_allowed'
            : isSenderIdMatch
              ? 'telegram_sender_id_allowed'
              : 'telegram_username_allowed',
      };
    }

    return {
      role: 'guest',
      channel: 'telegram',
      ...(chatId ? { chatId } : {}),
      confidence: 'none',
      reason: 'telegram_unauthorized_sender',
    };
  }

  // 2. PWA (Mobile / Web)
  if (channelRaw === 'pwa' || channelRaw === 'mobile') {
    const userId = (options.userId ?? options.senderId ?? '').trim();
    if (!userId) {
      return {
        role: 'guest',
        channel: 'pwa',
        confidence: 'none',
        reason: 'pwa_missing_jwt_user_id',
      };
    }

    const ownerUserId = (env.CODEBUDDY_OWNER_USER_ID ?? '').trim();
    if (ownerUserId) {
      if (userId === ownerUserId) {
        return {
          role: 'owner',
          channel: 'pwa',
          userId,
          confidence: 'high',
          reason: 'pwa_jwt_owner_matched',
        };
      }
      return {
        role: 'guest',
        channel: 'pwa',
        userId,
        confidence: 'none',
        reason: 'pwa_jwt_user_not_owner',
      };
    }

    // Default when CODEBUDDY_OWNER_USER_ID is not set:
    // Any valid JWT issued and verified by this daemon is recognized as owner.
    // In a single-user self-hosted installation, only the owner holds the login credentials.
    return {
      role: 'owner',
      channel: 'pwa',
      userId,
      confidence: 'high',
      reason: 'pwa_jwt_valid_server_token_default_owner',
    };
  }

  // 3. Voice
  if (channelRaw === 'voice') {
    if (options.isVoicePresence === true && options.robotNamed === true) {
      return {
        role: 'present',
        channel: 'voice',
        confidence: 'medium',
        reason: 'voice_presence_and_robot_named',
      };
    }
    return {
      role: 'guest',
      channel: 'voice',
      confidence: 'none',
      reason: 'voice_unauthenticated_or_unnamed',
    };
  }

  // 4. Default / unknown channel -> fail closed
  return {
    role: 'guest',
    channel: 'unknown',
    confidence: 'none',
    reason: 'unknown_channel_fail_closed',
  };
}

/** Check if identity is owner */
export function isCompanionOwner(identity?: CompanionIdentity | null): boolean {
  return identity?.role === 'owner';
}

/** Check if identity is at least present (owner or present) */
export function isCompanionPresentOrOwner(identity?: CompanionIdentity | null): boolean {
  return identity?.role === 'owner' || identity?.role === 'present';
}

/** Default guest identity (fail-closed) */
export const DEFAULT_GUEST_IDENTITY: CompanionIdentity = Object.freeze({
  role: 'guest' as const,
  channel: 'unknown' as const,
  confidence: 'none' as const,
  reason: 'default_guest_fail_closed',
});
