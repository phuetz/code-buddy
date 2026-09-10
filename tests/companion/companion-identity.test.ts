import { describe, it, expect } from 'vitest';
import {
  resolveCompanionIdentity,
  isCompanionOwner,
  isCompanionPresentOrOwner,
  DEFAULT_GUEST_IDENTITY,
} from '../../src/companion/companion-identity.js';

describe('companion-identity', () => {
  describe('Telegram identity resolution', () => {
    it('resolves owner when chatId matches CODEBUDDY_SENSORY_ALERT_CHAT', () => {
      const identity = resolveCompanionIdentity({
        channel: 'telegram',
        chatId: '12345678',
        env: { CODEBUDDY_SENSORY_ALERT_CHAT: '12345678' },
      });
      expect(identity.role).toBe('owner');
      expect(identity.confidence).toBe('high');
      expect(identity.reason).toBe('telegram_sensory_alert_chat_match');
      expect(isCompanionOwner(identity)).toBe(true);
      expect(isCompanionPresentOrOwner(identity)).toBe(true);
    });

    it('resolves owner when chatId is in allowedUsers list', () => {
      const identity = resolveCompanionIdentity({
        channel: 'telegram',
        chatId: '999888',
        allowedUsers: ['111222', '999888'],
        env: {},
      });
      expect(identity.role).toBe('owner');
      expect(identity.confidence).toBe('high');
      expect(identity.reason).toBe('telegram_chat_id_allowed');
    });

    it('resolves owner when senderId is in allowedUsers', () => {
      const identity = resolveCompanionIdentity({
        channel: 'telegram',
        chatId: 'general_group_chat',
        senderId: 'user_42',
        allowedUsers: ['user_42'],
        env: {},
      });
      expect(identity.role).toBe('owner');
      expect(identity.confidence).toBe('high');
      expect(identity.reason).toBe('telegram_sender_id_allowed');
    });

    it('resolves owner when senderUsername is in allowedUsers (with or without @)', () => {
      const identityWithAt = resolveCompanionIdentity({
        channel: 'telegram',
        chatId: 'group',
        senderUsername: '@PatriceDev',
        allowedUsers: ['@ownerhandle'],
        env: {},
      });
      expect(identityWithAt.role).toBe('owner');

      const identityWithoutAt = resolveCompanionIdentity({
        channel: 'telegram',
        chatId: 'group',
        senderUsername: 'ownerhandle',
        allowedUsers: ['@ownerhandle'],
        env: {},
      });
      expect(identityWithoutAt.role).toBe('owner');
    });

    it('resolves guest when telegram sender/chat is not allowed', () => {
      const identity = resolveCompanionIdentity({
        channel: 'telegram',
        chatId: 'random_chat',
        senderId: 'stranger',
        senderUsername: 'stranger_user',
        allowedUsers: ['trusted_user'],
        env: { CODEBUDDY_SENSORY_ALERT_CHAT: 'owner_chat' },
      });
      expect(identity.role).toBe('guest');
      expect(identity.confidence).toBe('none');
      expect(identity.reason).toBe('telegram_unauthorized_sender');
      expect(isCompanionOwner(identity)).toBe(false);
      expect(isCompanionPresentOrOwner(identity)).toBe(false);
    });
  });

  describe('PWA identity resolution', () => {
    it('resolves guest when PWA request has no userId', () => {
      const identity = resolveCompanionIdentity({
        channel: 'pwa',
        env: {},
      });
      expect(identity.role).toBe('guest');
      expect(identity.confidence).toBe('none');
      expect(identity.reason).toBe('pwa_missing_jwt_user_id');
    });

    it('resolves owner when CODEBUDDY_OWNER_USER_ID matches JWT userId', () => {
      const identity = resolveCompanionIdentity({
        channel: 'pwa',
        userId: 'patrice-uuid-1234',
        env: { CODEBUDDY_OWNER_USER_ID: 'patrice-uuid-1234' },
      });
      expect(identity.role).toBe('owner');
      expect(identity.confidence).toBe('high');
      expect(identity.reason).toBe('pwa_jwt_owner_matched');
    });

    it('resolves guest when CODEBUDDY_OWNER_USER_ID is set but does not match JWT userId', () => {
      const identity = resolveCompanionIdentity({
        channel: 'pwa',
        userId: 'other-user-5678',
        env: { CODEBUDDY_OWNER_USER_ID: 'patrice-uuid-1234' },
      });
      expect(identity.role).toBe('guest');
      expect(identity.confidence).toBe('none');
      expect(identity.reason).toBe('pwa_jwt_user_not_owner');
    });

    it('resolves owner by default for any valid JWT when CODEBUDDY_OWNER_USER_ID is unset', () => {
      const identity = resolveCompanionIdentity({
        channel: 'mobile',
        userId: 'user_signed_token',
        env: {},
      });
      expect(identity.role).toBe('owner');
      expect(identity.confidence).toBe('high');
      expect(identity.reason).toBe('pwa_jwt_valid_server_token_default_owner');
    });
  });

  describe('Voice identity resolution', () => {
    it('resolves present when presence is true and robot is named', () => {
      const identity = resolveCompanionIdentity({
        channel: 'voice',
        isVoicePresence: true,
        robotNamed: true,
        env: {},
      });
      expect(identity.role).toBe('present');
      expect(identity.confidence).toBe('medium');
      expect(identity.reason).toBe('voice_presence_and_robot_named');
      expect(isCompanionOwner(identity)).toBe(false);
      expect(isCompanionPresentOrOwner(identity)).toBe(true);
    });

    it('resolves guest when voice presence is false', () => {
      const identity = resolveCompanionIdentity({
        channel: 'voice',
        isVoicePresence: false,
        robotNamed: true,
        env: {},
      });
      expect(identity.role).toBe('guest');
      expect(identity.confidence).toBe('none');
      expect(identity.reason).toBe('voice_unauthenticated_or_unnamed');
    });

    it('resolves guest when robot is not named', () => {
      const identity = resolveCompanionIdentity({
        channel: 'voice',
        isVoicePresence: true,
        robotNamed: false,
        env: {},
      });
      expect(identity.role).toBe('guest');
      expect(identity.confidence).toBe('none');
    });
  });

  describe('Fail-closed default', () => {
    it('resolves guest for unknown channels or empty options', () => {
      const identity = resolveCompanionIdentity({
        channel: 'unknown_surface',
      });
      expect(identity.role).toBe('guest');
      expect(identity.confidence).toBe('none');
      expect(identity.reason).toBe('unknown_channel_fail_closed');
    });

    it('DEFAULT_GUEST_IDENTITY is frozen and guest', () => {
      expect(DEFAULT_GUEST_IDENTITY.role).toBe('guest');
      expect(isCompanionOwner(DEFAULT_GUEST_IDENTITY)).toBe(false);
      expect(isCompanionPresentOrOwner(DEFAULT_GUEST_IDENTITY)).toBe(false);
    });
  });
});
