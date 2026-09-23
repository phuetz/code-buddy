/** Resolve a stable companion history key for a channel inbound message. */

import { companionHistorySessionKey } from '../companion/channel-history.js';

export function channelCompanionSessionKey(input: {
  channelType?: string;
  chatId?: string;
  senderId?: string;
  sessionKey?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  if (input.sessionKey?.trim()) return input.sessionKey.trim();
  const env = input.env ?? process.env;
  const chatId = input.chatId?.trim();
  const senderId = input.senderId?.trim();
  if (chatId || senderId) {
    return companionHistorySessionKey({
      sessionKey: [input.channelType, chatId, senderId].filter(Boolean).join(':'),
      chatId,
      userId: senderId,
      env,
    });
  }
  return companionHistorySessionKey({ env });
}
