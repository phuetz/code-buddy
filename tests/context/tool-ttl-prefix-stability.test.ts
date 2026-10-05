import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  expireOldToolResults,
  resolveToolTtlStep,
  EXPIRED_STUB,
} from '../../src/context/tool-output-masking.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

const hash = (m: CodeBuddyMessage): string => createHash('sha256').update(JSON.stringify(m)).digest('hex');

/** Simule une longue boucle d'outils : un tour = un message assistant + un resultat d'outil de 2 000 caracteres. */
function simulate(turns: number, step: number): { breaks: number[]; messages: CodeBuddyMessage[] } {
  const messages: CodeBuddyMessage[] = [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'audit' },
  ];
  let before: string[] = messages.map(hash);
  const breaks: number[] = []; // tours ou le prefixe de la requete precedente a ete reecrit
  for (let t = 1; t <= turns; t++) {
    messages.push({ role: 'assistant', content: `tour ${t}` } as CodeBuddyMessage);
    messages.push({ role: 'tool', tool_call_id: `c${t}`, content: `resultat ${t}\n` + `ligne utile ${t} `.repeat(150) } as CodeBuddyMessage);
    expireOldToolResults(messages, t, 20, step);
    // La requete t doit prolonger la requete t-1 : on compare les messages deja envoyes.
    const after = messages.map(hash);
    const changed = before.findIndex((h, i) => h !== after[i]);
    if (changed !== -1) breaks.push(t);
    before = after;
  }
  return { breaks, messages };
}

describe('expiration des resultats d\'outils et stabilite du prefixe (cache LLM)', () => {
  it('par paliers de 10, le prefixe ne bouge qu\'aux paliers', () => {
    const { breaks } = simulate(60, 10);
    // 60 tours : au plus un palier tous les 10 tours, jamais une reecriture a chaque tour
    expect(breaks.length).toBeLessThanOrEqual(Math.floor(60 / 10));
    expect(breaks.every((t) => t % 10 === 0)).toBe(true);
  });

  it('meme avec un pas de 1, un resultat expire ne change plus jamais (aucun age dans le stub)', () => {
    const { breaks, messages } = simulate(60, 1);
    const stubs = messages.filter((m) => m.role === 'tool' && String(m.content).startsWith('[Tool result expired'));
    expect(stubs.length).toBeGreaterThan(10);
    expect(new Set(stubs.map((m) => m.content))).toEqual(new Set([EXPIRED_STUB]));
    // Apres l'apparition des premiers stubs, une reecriture n'a lieu que lorsqu'un NOUVEAU resultat franchit un seuil
    // (au plus une par tour), jamais parce qu'un compteur d'age change dans les anciens stubs.
    expect(EXPIRED_STUB).not.toMatch(/\d/);
    expect(breaks.length).toBeLessThanOrEqual(60);
  });

  it('un second appel avec les memes arguments ne change rien (idempotence)', () => {
    const { messages } = simulate(45, 10);
    const snapshot = messages.map(hash);
    expect(expireOldToolResults(messages, 45, 20, 10)).toBe(0);
    expect(messages.map(hash)).toEqual(snapshot);
  });

  it('ne resume pas un resume : les resultats reduits ne s\'emboitent pas', () => {
    const { messages } = simulate(60, 1);
    for (const m of messages) {
      const c = String(m.content);
      expect(c.split('[Aged tool result:').length - 1).toBeLessThanOrEqual(1);
    }
  });

  it('entre deux paliers, les seuils ne bougent pas : le contenu ancien est strictement identique', () => {
    const { messages } = simulate(35, 10); // dernier palier : 30
    const at35 = messages.map(hash);
    // Les tours 31 a 34 n'ont rien reecrit : on rejoue 30 puis 35 et on compare
    const replay: CodeBuddyMessage[] = JSON.parse(JSON.stringify(messages));
    expireOldToolResults(replay, 36, 20, 10);
    expect(replay.map(hash)).toEqual(at35);
  });

  it('resolveToolTtlStep : defaut 10, 1 accepte, valeur invalide = defaut', () => {
    expect(resolveToolTtlStep({} as NodeJS.ProcessEnv)).toBe(10);
    expect(resolveToolTtlStep({ CODEBUDDY_TOOL_TTL_STEP: '1' } as NodeJS.ProcessEnv)).toBe(1);
    expect(resolveToolTtlStep({ CODEBUDDY_TOOL_TTL_STEP: '5' } as NodeJS.ProcessEnv)).toBe(5);
    expect(resolveToolTtlStep({ CODEBUDDY_TOOL_TTL_STEP: '0' } as NodeJS.ProcessEnv)).toBe(10);
    expect(resolveToolTtlStep({ CODEBUDDY_TOOL_TTL_STEP: 'abc' } as NodeJS.ProcessEnv)).toBe(10);
  });
});
