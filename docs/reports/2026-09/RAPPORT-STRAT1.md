# RAPPORT STRAT1 — couche « stratégies » de la Darwin-Gödel Machine (04/09/2026, Fable 5.1)

Créé AVANT toute modification. Worktree `~/DEV/cb-strat1-2026-09-04`, branche
`feat/strat1-couche-strategies-2026-09-04`, base `0f5d5542c`.

## Pourquoi
La DGM de Code Buddy fait évoluer trois choses : leçons, outils, skills. Rien ne fait évoluer
**la façon dont l'agent exécute** : plafond de tours, plafond de coût, niveau de raisonnement,
exigences de vérification, consignes de méthode. Or la journée du 04/09 a montré que ce sont
précisément ces réglages que le pilote a dû corriger à la main (limite de 50 tours en headless →
300 ; « preuve = tests des fichiers touchés » ; « commiter après chaque point »). La proposition 4
de `AUDIT-DGM2.md` demandait cette couche, avec un schéma strict et un pare-feu ; elle n'existait
pas. Ce chantier la livre, avec une porte EMPIRIQUE et non un simple schéma.

## Contrat
- Aucune écriture dans `src/` par la machine : une stratégie est un JSON sous
  `.codebuddy/strategies/`, validé par un schéma Zod STRICT (toute clé inconnue rejetée).
- Aucun champ ne permet de désactiver un garde-fou : par construction, le schéma n'expose que des
  bornes (tours 1–400, coût 0–100 $), un niveau de raisonnement, deux exigences de vérification et
  au plus cinq consignes courtes, passées au pare-feu des skills (injection de prompt,
  exfiltration) plus une liste de verbes interdits (désactiver/contourner un garde-fou).
- Porte empirique : rejeu contrefactuel déterministe sur les expériences (journaux de lanes) +
  test de signe bayésien apparié de `paired-gate.ts` ; un évaluateur « live » (runs appariés)
  est injectable. Une candidate identique à sa mère est rejetée (inerte).
- Consommation opt-in : `CODEBUDDY_SELF_IMPROVE_STRATEGIES=true` seulement ; sans la variable,
  comportement octet pour octet identique (testé).

## Points (mis à jour au fil du travail)
1. **Types + magasin** (`strategy-types.ts`, `strategy-store.ts`) — schéma Zod strict (`.strict()` à
   chaque niveau), enveloppe `STRATEGY_LIMITS`, baseline virtuelle (jamais écrite, toujours
   résolvable) ; magasin atomique 0600, `active.json` par scope, fichier invalide ou étranger
   ignoré avec avertissement, archive au lieu de suppression. Commit `933d1ab89`.
2. **Porte à cinq étages** (`strategy-gate.ts`) — schéma → sécurité (pare-feu des skills sur les
   consignes + `FORBIDDEN_DIRECTIVE_RE` FR/EN) → lignée (parent, version+1, scope du moteur, id
   neuf) → inerte → empirique (`pairedBayesianDecision` de `paired-gate.ts`, seuil 0,95 sur ≥ 3
   paires décisives, ratio de coût ≤ 1,5). Sans évaluateur : `no-evidence`. Même commit.
3. **Rejeu contrefactuel** (`strategy-replay.ts`) — faits `rounds= limit= cost= cap= outcome=
   failure=` lus dans les expériences (le texte libre ne compte jamais) ; une lane coupée au
   plafond gagne sous un plafond plus haut, un succès devient une PERTE sous un plafond qui l'aurait
   coupé. `evidence: 'replay'` explicite ; un évaluateur « live » (runs appariés) est injectable.
4. **Proposeur heuristique** (`strategy-proposer.ts`) — l'échec dominant choisit UN opérateur :
   `max-rounds` → tours ×1,5 ; `cost-cap` → coût ×1,5 ; `unverified` → exigence « tests des
   fichiers touchés » + consigne ; `lost-uncommitted-work` → « commit par point » + consigne.
5. **Moteur** (`strategy-engine.ts`) — un candidat par cycle, archive `kind: 'strategy'`, ne
   jette jamais au-delà de la porte ; le scope du moteur est propagé au proposeur et à la porte
   (bug trouvé par le test CLI : un enfant de la baseline s'activait sur `default`). `f16be03c4`.
6. **Consommateurs** — `strategy-runtime.ts resolveStrategyOverlay` (opt-in
   `CODEBUDDY_SELF_IMPROVE_STRATEGIES`) ; `src/index.ts processPromptHeadless` : plafond de tours
   de la stratégie si `--max-tool-rounds` absent, consignes en `systemPromptAppend` ; CLI
   `improve strategies [--apply] [--scope] [--experiences]` + `strategies-list` ; étage stratégies
   du `defaultSelfImproveHook` (après outils et skills, seulement si la variable est posée).

## Preuves
- Tests : `tests/agent/self-improvement/strategy-gate.test.ts` (11), `strategy-engine.test.ts` (11),
  `strategy-store-runtime.test.ts` (7), `tests/commands/improve-strategies.test.ts` (2) — **31 verts**
  (HOME isolé `_qa/strat1/home`, puis rejoués avec le vrai HOME, voir bilan) ; fichiers touchés :
  `tests/commands/improve-*`, `tests/daemon/autonomous-loop*`, `tests/agent/self-improvement` —
  297 verts ; `tsc` 0 ; eslint 0 erreur (2 avertissements préexistants dans `autonomous-loop.ts`).
- Réel, dans le worktree (HOME isolé), six expériences de la journée (cinq lanes coupées à 50
  tours, un succès à 41) :
  ```
  Candidate: strat-headless-v2-489b5c — 5 run(s) with failure=max-rounds → rounds 75
  Gate: accepted (propose-only) wins=5 losses=0 ties=1 P=0.984 (replay)      # sans --apply
  Refusing `buddy improve strategies --apply`: … CODEBUDDY_SELF_IMPROVE is unset  # --apply sans opt-in
  Gate: ACCEPTED + INSTALLED (strat-headless-v2-489b5c)                       # --apply + opt-in
  Active: default=baseline headless=strat-headless-v2-489b5c …
  2e cycle : Candidate v3 → rounds 113 ; Gate: rejected (undecided) ties=6   # borné : rien à mesurer
  ```
- Réel, headless : `CODEBUDDY_SELF_IMPROVE_STRATEGIES=true buddy -p "Réponds seulement: OK"` →
  `INFO Execution strategy strat-headless-v2-489b5c in force (rounds 75, no directives)`, réponse
  `OK`, coût 0 (forfait) ; sans la variable : zéro ligne « Execution strategy ».

## Ce qu'il manque (honnête)
- Le plafond de COÛT de la stratégie n'est pas encore consommé (le headless ne lit que les tours et
  les consignes) ; `reasoning` non plus. Les deux sont dans l'overlay, prêts à brancher.
- Les faits `rounds=/failure=` doivent être produits par une source d'expérience : c'est l'objet de
  DGM5 (journaux de lanes) ; aujourd'hui `--experiences fichier.jsonl` ou la source `run` les portent.
- Le rejeu est une preuve NÉCESSAIRE ; l'évaluateur « live » (runs appariés réels via
  `createHeadlessRunner`) reste à écrire — l'interface existe.

## Complément 13 h 40 — pont avec DGM5 et preuve sur la journée RÉELLE
DGM5 (Gemini) a livré la source d'expérience « journaux de lanes » ; ses expériences sont en prose
(`Échecs nommés : Maximum tool execution rounds.`, `Sortie : 0.`). Le rejeu lit maintenant ces
marqueurs (jamais le texte libre) et rejoue une lane coupée sans compte mesuré contre le plafond en
vigueur ; `improve strategies` élargit la fenêtre à 200 journaux et dédoublonne (`76c3ae554`, suivant).

Preuve réelle, 857 journaux de délégation de la machine, source activée, **propose-only** :
```
Autonomy: propose-only · scope: headless · experiences: 50
Candidate: strat-headless-v2-489b5c — 9 run(s) with failure=max-rounds → rounds 75
Gate: accepted (propose-only) wins=9 losses=0 ties=34 P=0.999 (replay)
```
Avec la fenêtre par défaut de 10 journaux, la même commande répondait `undecided` (1 gain, P=0,75) :
la porte refuse une preuve mince, c'est le comportement voulu. La machine a donc dérivé seule, de la
journée réelle, la correction que le pilote avait faite à la main le matin (plafond de tours headless).
