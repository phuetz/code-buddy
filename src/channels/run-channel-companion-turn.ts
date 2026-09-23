/** Channel entry that always stamps a session key before Lisa answers. */

import {
  runCompanionChannelTurn,
  type CompanionChannelTurnInput,
  type CompanionChannelTurnResult,
} from './companion-channel-turn.js';
import { channelCompanionSessionKey } from './channel-companion-session.js';

export async function runChannelCompanionTurn(
  input: CompanionChannelTurnInput & {
    chatId?: string;
    senderId?: string;
    channelType?: string;
  },
): Promise<CompanionChannelTurnResult> {
  const sessionKey = channelCompanionSessionKey({
    channelType: input.channelType ?? input.surface,
    chatId: input.chatId ?? input.identity?.chatId,
    senderId: input.senderId ?? input.identity?.userId,
    sessionKey: input.sessionKey,
    env: input.env,
  });
  return runCompanionChannelTurn({ ...input, sessionKey });
}
