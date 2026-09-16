/**
 * Preuve du trou logique : un rappel one-shot qui refire.
 *
 * Mécanismes prouvés :
 * 1. src/companion/reminders.ts:213-232 (`isDue`) :
 *    Pour un rappel one-shot (`isOneShot(r) === true`), si le rappel a déjà
 *    tiré (`r.lastFiredAt` est renseigné) mais que son heure est modifiée plus tard
 *    le même jour (ou que `lf < occ`), `sameDay(lf, occ) && lf >= occ` échoue et
 *    `isDue` retourne `true`. Un one-shot ne doit JAMAIS re-tirer une fois tiré.
 * 2. src/companion/reminders.ts:464-478 (`parseVoiceReminder`) :
 *    Une consigne vocale ponctuelle sans mot-clé explicite de date
 *    ("rappelle-moi à 15h de couper le four") omet `date`. Le rappel est créé
 *    sans date, donc `isOneShot` est faux et le rappel devient récurrent quotidien,
 *    re-tirant indéfiniment chaque jour.
 */
import { describe, it, expect } from 'vitest';
import {
  isDue,
  isOneShot,
  parseVoiceReminder,
  type Reminder,
} from '../../src/companion/reminders.js';

describe('Revue G3 — Rappels : re-déclenchement indésirable d’un one-shot', () => {
  it('isDue retourne true pour un rappel one-shot qui a déjà tiré aujourd’hui si son heure est réajustée plus tard', () => {
    // Rappel one-shot pour le 3 juillet 2026 à 10:00 local, ayant déjà tiré à 10:00
    const firedAt = new Date(2026, 6, 3, 10, 0, 0);
    const reminder: Reminder = {
      id: 'r-oneshot-1',
      label: 'train pour Lyon',
      time: '11:00', // ajusté à 11:00 par l'utilisateur ou l'agent après un premier tir à 10:00
      date: '2026-07-03',
      enabled: true,
      createdAt: new Date(2026, 6, 1, 8, 0, 0).toISOString(),
      lastFiredAt: firedAt.toISOString(), // a déjà tiré à 10h local
    };

    expect(isOneShot(reminder)).toBe(true);

    // À 11h05 le même jour, le one-shot ne doit pas re-tirer car son occurrence unique a déjà été consommée
    const now = new Date(2026, 6, 3, 11, 5, 0);
    const due = isDue(reminder, now);

    // Un rappel one-shot ayant déjà tiré (`lastFiredAt` présent) ne doit JAMAIS être redû
    expect(due).toBe(false);
  });

  it('parseVoiceReminder conserve le contrat récurrent pour une consigne sans date ("rappelle-moi à 15h de couper le four")', () => {
    const fixedNow = new Date('2026-07-03T10:00:00');
    const parsed = parseVoiceReminder('rappelle-moi à 15h de couper le four', fixedNow);

    expect(parsed).not.toBeNull();
    // Le contrat documenté réserve le one-shot aux expressions de date explicites.
    expect(parsed!.date).toBeUndefined();
    expect(isOneShot(parsed!)).toBe(false);
  });
});
