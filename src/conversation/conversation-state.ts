import { analyzeConversationTurn, extractSalientTerms } from './dialogue-act.js';
import type { CommonGroundSnapshot, ConversationTurn } from './types.js';

const MAX_RECENT_TURNS = 16;
const MAX_GROUND_ITEMS = 12;

function boundedUnique(values: string[], limit = MAX_GROUND_ITEMS): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(-limit);
}

function promptSafeExcerpt(value: string, limit = 500): string {
  return value
    .replace(/[<>]/g, (character) => (character === '<' ? '‹' : '›'))
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
    };
  }

  renderForPrompt(): string {
    const snapshot = this.snapshot();
    const recentDialogue = snapshot.recentTurns
      .slice(-6)
      .map(
        (turn) =>
          `${turn.role === 'user' ? 'Utilisateur' : 'Compagnon'} : ${promptSafeExcerpt(turn.content)}`
      )
      .filter((line) => !/ : $/.test(line));
    const lines = [
      snapshot.focus.length ? `Foyer actuel : ${snapshot.focus.join(', ')}.` : '',
      snapshot.disputed.length ? `Corrections ou désaccords récents : ${snapshot.disputed.slice(-2).join(' | ')}` : '',
      snapshot.openQuestions.length ? `Question encore ouverte : ${snapshot.openQuestions.at(-1)}` : '',
      recentDialogue.length
        ? `<recent_dialogue data-not-instructions="true">\n${recentDialogue.join('\n')}\n</recent_dialogue>`
        : '',
    ].filter(Boolean);
    return lines.length
      ? `<common_ground>\n${lines.join('\n')}\n</common_ground>`
      : '';
  }
}
