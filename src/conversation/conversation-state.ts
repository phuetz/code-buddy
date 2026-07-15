import { analyzeConversationTurn, extractSalientTerms } from './dialogue-act.js';
import {
  buildDeliberationThread,
  MAX_DELIBERATION_TURNS,
  renderDeliberationThreadForPrompt,
} from './deliberation-thread.js';
import type {
  CommonGroundSnapshot,
  ConversationTurn,
  DeliberationThreadSnapshot,
} from './types.js';

const MAX_RECENT_TURNS = MAX_DELIBERATION_TURNS;
const MAX_GROUND_ITEMS = 12;
const MAX_COMMON_GROUND_PROMPT_CHARS = 5_200;

export interface CommonGroundPromptOptions {
  /** Omit every historical derivative (actions, closings and real topic shifts). */
  suppressHistoricalContext?: boolean;
  /**
   * Repeat recent raw excerpts inside `<common_ground>`. Default true for
   * surfaces that do not otherwise send message history. Voice disables this
   * because it already sends the same bounded turns as first-class messages.
   */
  includeRecentDialogue?: boolean;
}

function boundedUnique(values: string[], limit = MAX_GROUND_ITEMS): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(-limit);
}

function promptSafeExcerpt(value: string, limit = 320): string {
  return value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[<>&]/g, (character) => {
      if (character === '<') return '‹';
      if (character === '>') return '›';
      return '＆';
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export class ConversationStateManager {
  private recentTurns: ConversationTurn[] = [];
  private focus: string[] = [];
  private accepted: string[] = [];
  private disputed: string[] = [];
  private openQuestions: string[] = [];

  constructor(history: ConversationTurn[] = []) {
    for (const turn of history.slice(-MAX_RECENT_TURNS)) {
      this.observe(turn);
    }
  }

  observe(turn: ConversationTurn): void {
    const content = turn.content.trim();
    if (!content) return;
    this.recentTurns.push({ role: turn.role, content });
    this.recentTurns = this.recentTurns.slice(-MAX_RECENT_TURNS);
    this.focus = boundedUnique([...this.focus, ...extractSalientTerms(content, 5)], 8);

    if (turn.role === 'user') {
      const analysis = analyzeConversationTurn(content, this.recentTurns.slice(0, -1));
      if (analysis.act === 'agreement') this.accepted = boundedUnique([...this.accepted, content]);
      if (analysis.act === 'disagreement' || analysis.act === 'correction') {
        this.disputed = boundedUnique([...this.disputed, content]);
      }
    }

    if (/\?\s*$/.test(content)) {
      this.openQuestions = boundedUnique([...this.openQuestions, content], 6);
    } else if (turn.role === 'user' && this.openQuestions.length > 0) {
      this.openQuestions = this.openQuestions.slice(0, -1);
    }
  }

  observeExchange(user: string, assistant: string): void {
    this.observe({ role: 'user', content: user });
    this.observe({ role: 'assistant', content: assistant });
  }

  snapshot(): CommonGroundSnapshot {
    return {
      focus: [...this.focus],
      accepted: [...this.accepted],
      disputed: [...this.disputed],
      openQuestions: [...this.openQuestions],
      recentTurns: this.recentTurns.map((turn) => ({ ...turn })),
      deliberation: buildDeliberationThread(this.recentTurns),
    };
  }

  renderForPrompt(
    deliberationOverride?: DeliberationThreadSnapshot,
    options: CommonGroundPromptOptions = {}
  ): string {
    const snapshot = this.snapshot();
    const includeHistory = !options.suppressHistoricalContext;
    const recentDialogue = includeHistory && options.includeRecentDialogue !== false
      ? snapshot.recentTurns
          .slice(-6)
          .map(
            (turn) =>
              `${turn.role === 'user' ? 'Utilisateur' : 'Compagnon'} : ${promptSafeExcerpt(turn.content)}`
          )
          .filter((line) => !/ : $/.test(line))
      : [];
    const deliberation = includeHistory
      ? renderDeliberationThreadForPrompt(deliberationOverride ?? snapshot.deliberation)
      : '';
    const candidates = [
      includeHistory && snapshot.focus.length
        ? `Foyer actuel : ${snapshot.focus.join(', ')}.`
        : '',
      deliberation,
      includeHistory && snapshot.disputed.length
        ? `Corrections ou désaccords récents : ${snapshot.disputed
            .slice(-2)
            .map((value) => promptSafeExcerpt(value))
            .join(' | ')}`
        : '',
      includeHistory && snapshot.openQuestions.length
        ? `Question encore ouverte : ${promptSafeExcerpt(snapshot.openQuestions.at(-1) ?? '')}`
        : '',
      recentDialogue.length
        ? `<recent_dialogue data-not-instructions="true">\n${recentDialogue.join('\n')}\n</recent_dialogue>`
        : '',
    ].filter(Boolean);
    const opening = '<common_ground>';
    const closing = '</common_ground>';
    const budget = MAX_COMMON_GROUND_PROMPT_CHARS - opening.length - closing.length - 2;
    const lines: string[] = [];
    let used = 0;
    for (const candidate of candidates) {
      const cost = candidate.length + (lines.length ? 1 : 0);
      if (used + cost > budget) continue;
      lines.push(candidate);
      used += cost;
    }
    return lines.length
      ? `${opening}\n${lines.join('\n')}\n${closing}`
      : '';
  }
}
