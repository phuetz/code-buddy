import { describe, it, expect } from 'vitest';
import {
  FORGET_FLOOR,
  MAX_FACTS,
  MemoryKeyValueStore,
  WhatMattersMemory,
  applySoftForgetting,
  describeWhatMatters,
  fixedClock,
  forget,
  isClinicalClaim,
  normalizeSheet,
  recall,
  remember,
  type Fact,
} from '../src/index.js';

const NOW = Date.UTC(2026, 0, 15, 10, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function sheetWith(...inputs: Array<Parameters<typeof remember>[1]>): Fact[] {
  let sheet: Fact[] = [];
  for (const input of inputs) {
    const result = remember(sheet, input, NOW);
    sheet = result.sheet;
  }
  return sheet;
}

describe('memory — écrire ce qui compte', () => {
  it('enregistre un fait nommé, daté et sourcé', () => {
    const result = remember([], { key: 'Projet', value: 'le chantier en cours', provenance: 'explicit', source: 'voice' }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fact).toMatchObject({
      key: 'projet',
      value: 'le chantier en cours',
      provenance: 'explicit',
      source: 'voice',
      at: NOW,
      updatedAt: NOW,
      pinned: true,
      confidence: 1,
    });
  });

  it('épingle l’explicite et le confirmé, pas l’inféré', () => {
    const sheet = sheetWith(
      { key: 'a', value: 'dit explicitement', provenance: 'explicit' },
      { key: 'b', value: 'confirmé en conversation', provenance: 'confirmed' },
      { key: 'c', value: 'déduit d’un indice', provenance: 'inferred' },
    );
    expect(sheet.find((f) => f.key === 'a')?.pinned).toBe(true);
    expect(sheet.find((f) => f.key === 'b')?.pinned).toBe(true);
    expect(sheet.find((f) => f.key === 'c')?.pinned).toBe(false);
  });

  it('reconfirme au lieu de dupliquer, et remonte la confiance', () => {
    const first = remember([], { key: 'rythme', value: 'se couche tard', provenance: 'inferred' }, NOW);
    const second = remember(first.sheet, { key: 'rythme', value: 'se couche tard', provenance: 'confirmed' }, NOW + DAY);
    expect(second.sheet).toHaveLength(1);
    if (!second.ok) return;
    expect(second.fact.confidence).toBeGreaterThan(0.5);
    expect(second.fact.at).toBe(NOW);
    expect(second.fact.updatedAt).toBe(NOW + DAY);
  });

  it('refuse une clé ou une valeur vide', () => {
    const result = remember([], { key: '   ', value: 'quelque chose' }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('refuse une affirmation clinique — la fiche n’est pas un dossier médical', () => {
    expect(isClinicalClaim('diagnostic posé la semaine dernière')).toBe(true);
    expect(isClinicalClaim('se lève tôt le mardi')).toBe(false);
    const result = remember([], { key: 'sante', value: 'traitement de fond prescrit' }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('clinical');
    expect(result.sheet).toHaveLength(0);
  });

  it('plafonne la fiche et évince le plus faible non épinglé', () => {
    let sheet: Fact[] = [];
    for (let i = 0; i < MAX_FACTS + 4; i += 1) {
      sheet = remember(sheet, { key: `k${i}`, value: `fait ${i}`, provenance: 'inferred' }, NOW + i).sheet;
    }
    expect(sheet.length).toBe(MAX_FACTS);
  });

  it('n’évince jamais un fait épinglé', () => {
    let sheet = remember([], { key: 'pilier', value: 'ce qui compte vraiment', provenance: 'explicit' }, NOW).sheet;
    for (let i = 0; i < MAX_FACTS + 6; i += 1) {
      sheet = remember(sheet, { key: `k${i}`, value: `fait ${i}`, provenance: 'inferred' }, NOW + i).sheet;
    }
    expect(sheet.some((fact) => fact.key === 'pilier')).toBe(true);
  });
});

describe('memory — relire et oublier', () => {
  it('rend les épinglés d’abord, puis les plus confiants', () => {
    const sheet = sheetWith(
      { key: 'faible', value: 'indice ténu', provenance: 'inferred', confidence: 0.3 },
      { key: 'fort', value: 'dit clairement', provenance: 'explicit' },
    );
    expect(recall(sheet)[0]?.key).toBe('fort');
  });

  it('filtre par confiance, par clé et par nombre', () => {
    const sheet = sheetWith(
      { key: 'a', value: 'un', provenance: 'inferred', confidence: 0.9 },
      { key: 'b', value: 'deux', provenance: 'inferred', confidence: 0.3 },
    );
    expect(recall(sheet, { minConfidence: 0.5 }).map((f) => f.key)).toEqual(['a']);
    expect(recall(sheet, { keys: ['B'] }).map((f) => f.key)).toEqual(['b']);
    expect(recall(sheet, { limit: 1 })).toHaveLength(1);
  });

  it('oublie une clé sur demande explicite', () => {
    const sheet = sheetWith({ key: 'voyage', value: 'part deux semaines', provenance: 'explicit' });
    expect(forget(sheet, 'Voyage')).toHaveLength(0);
  });

  it('oublie doucement l’inféré ancien, jamais l’épinglé', () => {
    const sheet = sheetWith(
      { key: 'epingle', value: 'promesse tenue', provenance: 'explicit' },
      { key: 'vague', value: 'impression passagère', provenance: 'inferred' },
    );
    const apres = applySoftForgetting(sheet, NOW + 400 * DAY);
    expect(apres.map((f) => f.key)).toEqual(['epingle']);
    expect(apres[0]?.confidence).toBe(1);
  });

  it('érode la confiance avant de laisser tomber le fait', () => {
    const sheet = sheetWith({ key: 'vague', value: 'impression', provenance: 'inferred' });
    const apres = applySoftForgetting(sheet, NOW + 45 * DAY);
    expect(apres).toHaveLength(1);
    expect(apres[0]?.confidence).toBeCloseTo(0.25, 2);
    expect(apres[0]?.confidence).toBeGreaterThan(FORGET_FLOOR);
  });

  it('rend un bloc de prompt sans jargon ni chiffre', () => {
    const bloc = describeWhatMatters(sheetWith({ key: 'projet', value: 'le chantier en cours', provenance: 'explicit' }));
    expect(bloc).toBe('- le chantier en cours');
    expect(describeWhatMatters([])).toBe('');
  });

  it('normalise une fiche venue d’un stockage douteux', () => {
    const sheet = normalizeSheet([
      { key: 'Bon', value: 'valeur utile', provenance: 'explicit', at: NOW, confidence: 5 },
      { key: '', value: 'sans clé' },
      { key: 'clinique', value: 'ordonnance renouvelée' },
      'pas un objet',
    ]);
    expect(sheet.map((f) => f.key)).toEqual(['bon']);
    expect(sheet[0]?.confidence).toBe(1);
    expect(normalizeSheet(null)).toEqual([]);
  });
});

describe('memory — fiche persistée', () => {
  it('survit à un redémarrage sur le même magasin', async () => {
    const store = new MemoryKeyValueStore();
    const first = new WhatMattersMemory({ store, clock: fixedClock(NOW) });
    await first.remember({ key: 'projet', value: 'le chantier en cours', provenance: 'explicit' });

    const second = new WhatMattersMemory({ store, clock: fixedClock(NOW + DAY) });
    const facts = await second.recall();
    expect(facts.map((f) => f.value)).toEqual(['le chantier en cours']);
  });

  it('applique l’oubli doux à la lecture', async () => {
    const store = new MemoryKeyValueStore();
    const memory = new WhatMattersMemory({ store, clock: fixedClock(NOW) });
    await memory.remember({ key: 'vague', value: 'impression', provenance: 'inferred' });

    const plusTard = new WhatMattersMemory({ store, clock: fixedClock(NOW + 400 * DAY) });
    expect(await plusTard.recall()).toEqual([]);
  });

  it('oublie et vide sur demande', async () => {
    const store = new MemoryKeyValueStore();
    const memory = new WhatMattersMemory({ store, clock: fixedClock(NOW) });
    await memory.remember({ key: 'a', value: 'un', provenance: 'explicit' });
    await memory.remember({ key: 'b', value: 'deux', provenance: 'explicit' });
    await memory.forget('a');
    expect((await memory.recall()).map((f) => f.key)).toEqual(['b']);
    await memory.clear();
    expect(await memory.recall()).toEqual([]);
  });

  it('ne persiste jamais une affirmation clinique', async () => {
    const store = new MemoryKeyValueStore();
    const memory = new WhatMattersMemory({ store, clock: fixedClock(NOW) });
    const result = await memory.remember({ key: 'x', value: 'symptômes de la semaine' });
    expect(result.ok).toBe(false);
    expect(await memory.recall()).toEqual([]);
  });
});
