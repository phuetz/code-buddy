import { describe, expect, it } from 'vitest';
import {
  consolider,
  LOT_ATTENTION,
  SEUIL_ESCALADE,
} from '../../../src/fleet/consolidation/thalamus.js';
import type { Constat } from '../../../src/fleet/consolidation/types.js';

function constat(p: Partial<Constat> = {}): Constat {
  return {
    mission: 'CB1',
    angle: 'ergonomie',
    lignee: 'codex',
    resume: 'une option documentée est refusée après la sous-commande',
    ou: 'src/commands/loop-cli.ts:71',
    consequence: 'friction',
    reproduit: true,
    preuve: 'buddy loop x --permission-mode acceptEdits',
    ...p,
  };
}

describe('thalamus cognitif', () => {
  it('escalade une régression de sécurité reproduite, et elle passe devant tout', () => {
    const d = consolider([
      constat({ consequence: 'cosmetique', resume: 'valeur par défaut affichée deux fois' }),
      constat({
        mission: 'V3',
        consequence: 'regression-securite',
        resume: 'le test reste vert quand on supprime application de la posture',
        ou: 'tests/commands/loop-cli-options.test.ts:8',
      }),
    ]);
    expect(d.escalades).toHaveLength(1);
    expect(d.escalades[0]!.consequence).toBe('regression-securite');
    expect(d.escalades[0]!.saillance).toBeGreaterThanOrEqual(SEUIL_ESCALADE);
  });

  it("n'escalade JAMAIS un constat non reproduit, même annoncé grave", () => {
    // Sans cette règle, il suffit qu'un modèle écrive « faille critique possible » pour
    // réveiller quelqu'un. La gravité annoncée n'est pas une mesure ; la reproduction si.
    const d = consolider([
      constat({
        consequence: 'regression-securite',
        resume: 'une traversée de chemin semble possible ici',
        reproduit: false,
        preuve: undefined,
      }),
    ]);
    expect(d.escalades).toHaveLength(0);
    expect(d.admis[0]!.saillance).toBeLessThan(SEUIL_ESCALADE);
  });

  it('fusionne le même constat et ÉLÈVE le survivant — corroborer, pas effacer', () => {
    const commun = { resume: 'le ledger est écrit sans atomicité', ou: 'src/memory/ckg.ts:120' };
    const seul = consolider([constat({ ...commun, consequence: 'perte-silencieuse' })]);
    const trois = consolider([
      constat({ ...commun, consequence: 'perte-silencieuse', mission: 'CB4', lignee: 'kimi' }),
      constat({ ...commun, consequence: 'perte-silencieuse', mission: 'CB13', lignee: 'nemotron' }),
      constat({ ...commun, consequence: 'perte-silencieuse', mission: 'CB20', lignee: 'grok' }),
    ]);
    expect(trois.coalesces).toBe(2);
    expect(trois.admis.length + trois.escalades.length).toBe(1);
    const apres = [...trois.escalades, ...trois.admis][0]!;
    const avant = [...seul.escalades, ...seul.admis][0]!;
    expect(apres.saillance).toBeGreaterThan(avant.saillance);
    expect(apres.corrobore_par).toHaveLength(2);
  });

  it('ne compte pas deux fois la même lignée : elles se trompent ensemble', () => {
    const commun = { resume: 'le ledger est écrit sans atomicité', ou: 'src/memory/ckg.ts:120' };
    const memeLignee = consolider([
      constat({ ...commun, mission: 'A', lignee: 'codex' }),
      constat({ ...commun, mission: 'B', lignee: 'codex' }),
    ]);
    const lignesDistinctes = consolider([
      constat({ ...commun, mission: 'A', lignee: 'codex' }),
      constat({ ...commun, mission: 'B', lignee: 'kimi' }),
    ]);
    const s = (d: ReturnType<typeof consolider>) => [...d.escalades, ...d.admis][0]!.saillance;
    expect(s(memeLignee)).toBeLessThan(s(lignesDistinctes));
  });

  it('garde la meilleure preuve quand il fusionne, pas le plus vague', () => {
    const commun = { resume: 'le ledger est écrit sans atomicité', ou: 'src/memory/ckg.ts:120' };
    const d = consolider([
      constat({ ...commun, mission: 'vague', reproduit: false, preuve: undefined, lignee: 'a' }),
      constat({ ...commun, mission: 'precis', reproduit: true, preuve: 'test X rougit', lignee: 'b' }),
    ]);
    const survivant = [...d.escalades, ...d.admis][0]!;
    expect(survivant.mission).toBe('precis');
    expect(survivant.preuve).toBe('test X rougit');
  });

  it("borne ce qui remonte, mais dit ce qu'il a écarté", () => {
    const beaucoup = Array.from({ length: 40 }, (_, i) =>
      constat({ mission: `M${i}`, resume: `friction numéro ${i} sur une commande`, ou: `f${i}.ts:1` }),
    );
    const d = consolider(beaucoup);
    expect(d.admis).toHaveLength(LOT_ATTENTION);
    // Un digest qui cache ce qu'il a écarté ment par omission : le compte total reste lisible.
    const total = Object.values(d.par_consequence).reduce((s, n) => s + n, 0);
    expect(total).toBe(40);
  });

  it('fusionne deux formulations différentes du même défaut', () => {
    // Né d'un essai grandeur nature, pas d'une prévision : sur la moisson réelle du 25/08, une
    // clé par mots triés donnait ZÉRO fusion sur quatre doublons. La corroboration ne se
    // déclenchait jamais — la partie la plus utile du thalamus était morte sans que rien ne
    // le signale, et les tests d'alors passaient tous.
    const d = consolider([
      constat({
        mission: 'CB20', lignee: 'grok', consequence: 'corruption-donnees',
        resume: 'le ledger jsonl est ecrit par deux processus sans atomicite garantie',
        ou: 'src/memory/collective-knowledge-graph.ts',
      }),
      constat({
        mission: 'CB13', lignee: 'nemotron', consequence: 'corruption-donnees',
        resume: 'le ledger jsonl est ecrit sans atomicite par le moteur rust',
        ou: 'src/memory/collective-knowledge-graph.ts',
      }),
    ]);
    expect(d.coalesces).toBe(1);
    const survivant = [...d.escalades, ...d.admis][0]!;
    expect(survivant.corrobore_par).toEqual(['CB13']);
    // Corroboré par une lignée distincte, il passe DEVANT une régression de sécurité isolée.
    expect(survivant.saillance).toBeGreaterThan(150);
  });

  it('ne fusionne pas deux défauts DIFFÉRENTS du même fichier', () => {
    // Trou révélé par mutation : le test du « même fichier » ci-dessous est protégé par la
    // garde sur le lieu, pas par le seuil de similarité. Un seuil trop bas fusionnerait tout
    // sans qu'aucun test ne bronche — et deux défauts distincts se corroboreraient l'un
    // l'autre, fabriquant de la fausse confiance. Ici, même lieu, vocabulaires disjoints.
    const d = consolider([
      // Vocabulaire partiellement commun (« entre », « deux », « limite ») mais défauts
      // distincts : similarité ~0,2. Au seuil de 0,45 ils restent séparés ; un seuil laxiste
      // les fusionnerait. C'est précisément ce que ce test doit attraper — deux résumés SANS
      // aucun mot commun ne prouveraient rien, leur similarité valant zéro quel que soit le seuil.
      constat({
        resume: 'le compteur de tours redemarre entre deux sessions sans limite',
        ou: 'src/agent/executor.ts', lignee: 'x',
      }),
      constat({
        resume: 'le fichier journal grandit entre deux nettoyages sans limite de taille',
        ou: 'src/agent/executor.ts', lignee: 'y',
      }),
    ]);
    expect(d.coalesces).toBe(0);
    expect(d.admis).toHaveLength(2);
  });

  it('ne fusionne pas deux défauts voisins dans des fichiers différents', () => {
    const d = consolider([
      constat({ resume: 'la valeur invalide est acceptee sans erreur', ou: 'src/a.ts:10', lignee: 'x' }),
      constat({ resume: 'la valeur invalide est acceptee sans erreur', ou: 'src/b.ts:20', lignee: 'y' }),
    ]);
    expect(d.coalesces).toBe(0);
  });

  it('sert les plus saillants en premier', () => {
    const d = consolider([
      constat({ consequence: 'cosmetique', resume: 'A', ou: 'a.ts:1' }),
      constat({ consequence: 'corruption-donnees', resume: 'B', ou: 'b.ts:1' }),
      constat({ consequence: 'friction', resume: 'C', ou: 'c.ts:1' }),
    ]);
    const ordre = [...d.escalades, ...d.admis].map((c) => c.consequence);
    expect(ordre[0]).toBe('corruption-donnees');
    expect(ordre[ordre.length - 1]).toBe('cosmetique');
  });
});
