import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  formatConversationImprovementResult,
  loadConversationImprovementState,
  runConversationImprovementCycle,
} from '../../src/companion/conversation-improvement-loop.js';
import { loadVoiceGuidance } from '../../src/companion/voice-guidance.js';
import type { ConversationTurn } from '../../src/conversation/types.js';

function paths() {
  const dir = mkdtempSync(join(tmpdir(), 'conversation-improve-'));
  return {
    statePath: join(dir, 'quality-state.json'),
    journalPath: join(dir, 'quality.jsonl'),
    guidancePath: join(dir, 'guidance.json'),
  };
}

function shallowConversation(extra = false, suffix = ''): ConversationTurn[] {
  return [
    { role: 'user', content: 'Explique la conscience et le libre arbitre.' },
    { role: 'assistant', content: "C'est complexe." },
    { role: 'user', content: 'Développe avec de vrais arguments.' },
    { role: 'assistant', content: "C'est complexe." },
    ...(extra
      ? [
          { role: 'user', content: `Ajoute au moins une objection. ${suffix}` } as ConversationTurn,
          { role: 'assistant', content: "C'est complexe." } as ConversationTurn,
        ]
      : []),
  ];
}

describe('runConversationImprovementCycle', () => {
  it('does not adapt from a single occurrence or from an unchanged transcript', async () => {
    const store = paths();
    const readConversation = async (): Promise<ConversationTurn[]> => shallowConversation();

    const first = await runConversationImprovementCycle({
      now: 1_000,
      readConversation,
      ...store,
    });
    const duplicate = await runConversationImprovementCycle({
      now: 2_000,
      readConversation,
      ...store,
    });

    expect(first?.report.issues).toContain('too_shallow');
    expect(first?.appliedGuidance).toBeUndefined();
    expect(duplicate).toBeNull();
    expect(loadVoiceGuidance(store.guidancePath)).toEqual([]);
  });

  it('applies one reversible guidance only after a weakness recurs', async () => {
    const store = paths();
    let transcript = shallowConversation();
    const readConversation = async (): Promise<ConversationTurn[]> => transcript;

    await runConversationImprovementCycle({ now: 1_000, readConversation, ...store });
    transcript = shallowConversation(true);
    const second = await runConversationImprovementCycle({
      now: 2_000,
      readConversation,
      ...store,
    });

    expect(second?.dominantIssue).toBe('topic_drift');
    expect(second?.appliedGuidance).toContain('point central');
    expect(loadVoiceGuidance(store.guidancePath)).toHaveLength(1);
    expect(loadConversationImprovementState(store.statePath).issueStreaks.too_shallow).toBe(2);
  });

  it('persists aggregate scores but never raw private dialogue', async () => {
    const store = paths();
    const privateMarker = 'SECRET_CONVERSATION_MARKER';
    const result = await runConversationImprovementCycle({
      now: 1_000,
      readConversation: async () => [
        { role: 'user', content: `${privateMarker} développe la conscience.` },
        { role: 'assistant', content: "C'est complexe." },
        { role: 'user', content: 'Argumente davantage.' },
        { role: 'assistant', content: "C'est complexe." },
      ],
      ...store,
    });

    const journal = readFileSync(store.journalPath, 'utf8');
    expect(journal).not.toContain(privateMarker);
    expect(journal).toContain('overallScore');
    expect(formatConversationImprovementResult(result!)).not.toContain(privateMarker);
  });

  it('rolls back learned guidance that fails three subsequent evaluations', async () => {
    const store = paths();
    let transcript = shallowConversation();
    const readConversation = async (): Promise<ConversationTurn[]> => transcript;

    await runConversationImprovementCycle({ now: 1_000, readConversation, ...store });
    transcript = shallowConversation(true, 'cycle-2');
    const applied = await runConversationImprovementCycle({
      now: 2_000,
      readConversation,
      ...store,
    });
    expect(applied?.appliedGuidance).toBeTruthy();

    let result = applied;
    for (let cycle = 3; cycle <= 5; cycle += 1) {
      transcript = shallowConversation(true, `cycle-${cycle}`);
      result = await runConversationImprovementCycle({
        now: cycle * 1_000,
        readConversation,
        ...store,
      });
    }

    expect(result?.rolledBackGuidance).toBe(applied?.appliedGuidance);
    expect(loadVoiceGuidance(store.guidancePath)).toEqual([]);
    expect(loadConversationImprovementState(store.statePath).activeGuidance).toBeUndefined();
  });

  it('keeps dry evaluation side-effect free', async () => {
    const store = paths();
    const result = await runConversationImprovementCycle({
      mode: 'dry',
      readConversation: async () => shallowConversation(),
      ...store,
    });

    expect(result).not.toBeNull();
    expect(loadVoiceGuidance(store.guidancePath)).toEqual([]);
    expect(loadConversationImprovementState(store.statePath).lastFingerprint).toBeUndefined();
  });
});
