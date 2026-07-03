/**
 * Spoken undo — the P2-reliquat "confirm-and-await", ambient-style: the creation
 * confirmation reads label + cadence back, and a bare "annule" within the window
 * reverts the just-created reminder. Pure registry + parser, no store mocks.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseUndo,
  undoPending,
  isUndoCommand,
  noteCreatedForUndo,
  resetUndo,
  undoWindowMs,
} from '../../src/companion/reminders.js';

const NOW = 1_800_000_000_000;

describe('parseUndo (bare spoken correction)', () => {
  it('fires on short bare corrections', () => {
    for (const t of ['annule', 'Annule ça', "non c'est pas ça", 'efface', 'oublie', 'je me suis trompé']) {
      expect(parseUndo(t), t).toBe(true);
    }
  });

  it('does NOT fire on targeted management, creations, or long sentences', () => {
    expect(parseUndo('supprime le rappel du train')).toBe(false); // parseReminderCommand's job
    expect(parseUndo('annule le rappel du médicament')).toBe(false);
    expect(parseUndo('quels sont mes rappels')).toBe(false);
    expect(parseUndo("j'ai annulé mon rendez-vous chez le dentiste finalement tant pis")).toBe(false); // long → conversation
    expect(parseUndo('')).toBe(false);
  });
});

describe('undoPending / isUndoCommand (window-bounded registry)', () => {
  afterEach(() => resetUndo());

  it('reverts the just-created reminder within the window and consumes the slot', () => {
    noteCreatedForUndo({ id: 'r1', label: 'train de 10h38' }, NOW);
    expect(isUndoCommand('annule', NOW + 5_000)).toBe(true);

    const undone = undoPending('annule', NOW + 5_000);
    expect(undone).toEqual({ id: 'r1', label: 'train de 10h38' });
    // Consumed: a second "annule" does nothing (never deletes something else).
    expect(undoPending('annule', NOW + 6_000)).toBeNull();
    expect(isUndoCommand('annule', NOW + 6_000)).toBe(false);
  });

  it('expires after the window — a later "annule" is just conversation', () => {
    noteCreatedForUndo({ id: 'r2', label: 'kiné' }, NOW);
    const late = NOW + undoWindowMs() + 1_000;
    expect(isUndoCommand('annule', late)).toBe(false);
    expect(undoPending('annule', late)).toBeNull();
  });

  it('a newer creation replaces the undo target (last one wins)', () => {
    noteCreatedForUndo({ id: 'old', label: 'ancien' }, NOW);
    noteCreatedForUndo({ id: 'new', label: 'nouveau' }, NOW + 10_000);
    expect(undoPending("c'est pas ça", NOW + 15_000)?.id).toBe('new');
  });

  it('never fires with no fresh creation', () => {
    expect(undoPending('annule', NOW)).toBeNull();
    expect(isUndoCommand('annule', NOW)).toBe(false);
  });

  it('a non-undo utterance never consumes the slot', () => {
    noteCreatedForUndo({ id: 'r3', label: 'arrosage' }, NOW);
    expect(undoPending('merci beaucoup', NOW + 1_000)).toBeNull();
    // Still armed for a real correction.
    expect(undoPending('annule ça', NOW + 2_000)?.id).toBe('r3');
  });
});
