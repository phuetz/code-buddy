/**
 * Light « companion » channel profile: spokenPrompt + relational context +
 * the last 10 turns, without the agent system prompt or the tool catalogue.
 *
 * Opt-in: CODEBUDDY_CHANNEL_PROFILE=companion
 * Automatic: CODEBUDDY_COMPANION_PERSONA is set and the message is not a command.
 * Commands (`/…`, « lance », « code ») keep the full agent profile.
 */

import { estimateTokens } from '../utils/token-counter.js';
import type { ConversationTurn } from '../conversation/types.js';
import type { CodeBuddyMessage } from '../codebuddy/client.js';
import { resolveCompanionPersona } from '../companion/personas/index.js';

export const COMPANION_CHANNEL_HISTORY_LIMIT = 10;
export const COMPANION_CHANNEL_TURN_CHAR_CAP = 400;
export const DEFAULT_CHANNEL_WAIT_NOTICE_MS = 20_000;
export const DEFAULT_COMPANION_SPOKEN_PROMPT =
  'Tu es Lisa, une voix amie. Français, tutoiement, phrases courtes. ' +
  'Pas de markdown, pas d’emojis lus, pas de XML, pas de scores.';

const AGENT_INTENT_RE = /(?:^|\s)\/\S+|\blance\b|\bcode\b/i;

export interface CompanionChannelProfileInput {
  text: string;
  isCommand?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function isChannelAgentIntent(text: string, isCommand = false): boolean {
  if (isCommand) return true;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/')) return true;
  return AGENT_INTENT_RE.test(trimmed);
}

export function shouldUseCompanionChannelProfile(
  input: CompanionChannelProfileInput,
): boolean {
  const env = input.env ?? process.env;
  if (isChannelAgentIntent(input.text, input.isCommand === true)) return false;
  const profile = (env.CODEBUDDY_CHANNEL_PROFILE ?? '').trim().toLowerCase();
  if (profile === 'agent' || profile === 'full') return false;
  if (profile === 'companion') return true;
  const persona = (env.CODEBUDDY_COMPANION_PERSONA ?? '').trim();
  return persona.length > 0;
}

export function channelWaitNoticeMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_CHANNEL_WAIT_NOTICE_MS);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_CHANNEL_WAIT_NOTICE_MS;
  return Math.min(120_000, Math.floor(configured));
}

export function companionWaitNoticeText(): string {
  return 'Je réfléchis, quelques secondes…';
}

function capTurn(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= COMPANION_CHANNEL_TURN_CHAR_CAP) return trimmed;
  return `${trimmed.slice(0, COMPANION_CHANNEL_TURN_CHAR_CAP).trimEnd()}…`;
}

export interface CompanionChannelPrompt {
  system: string;
  messages: CodeBuddyMessage[];
  tokenEstimate: number;
}

export function buildCompanionChannelPrompt(options: {
  spokenPrompt: string;
  relationalContext?: string;
  history?: ConversationTurn[];
  userText: string;
}): CompanionChannelPrompt {
  const spoken = options.spokenPrompt.trim() || DEFAULT_COMPANION_SPOKEN_PROMPT;
  const relational = options.relationalContext?.trim() ?? '';
  const system = [spoken, relational].filter(Boolean).join('\n\n');
  const history = (options.history ?? [])
    .filter((turn) => turn.content.trim())
    .slice(-COMPANION_CHANNEL_HISTORY_LIMIT)
    .map((turn) => ({
      role: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: capTurn(turn.content),
    }));
  const messages: CodeBuddyMessage[] = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: options.userText.trim() },
  ];
  const tokenEstimate = estimateTokens(
    messages.map((message) => String(message.content ?? '')).join('\n'),
  );
  return { system, messages, tokenEstimate };
}

export async function assembleCompanionChannelPrompt(options: {
  userText: string;
  history?: ConversationTurn[];
  env?: NodeJS.ProcessEnv;
  relationalContext?: string;
}): Promise<CompanionChannelPrompt> {
  const env = options.env ?? process.env;
  const persona = resolveCompanionPersona(env);
  const spokenPrompt = persona?.spokenPrompt ?? DEFAULT_COMPANION_SPOKEN_PROMPT;
  let relational = options.relationalContext?.trim() ?? '';
  if (!relational && env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
    try {
      const { buildRelationalContext } = await import('../companion/relational-context.js');
      relational = await Promise.race([
        buildRelationalContext({
          includePresence: false,
          includeInnerLife: false,
          includeSelfEvolution: false,
        }),
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(''), 80).unref?.();
        }),
      ]);
    } catch {
      relational = '';
    }
  }
  return buildCompanionChannelPrompt({
    spokenPrompt,
    relationalContext: relational,
    history: options.history,
    userText: options.userText,
  });
}
