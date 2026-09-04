# Réparation SCORE1 — bancs littéraires et routage ModelScoreboard

Date : 2026-09-04
Branche : `feat/score1-scoreboard-bancs-2026-09-04`
Agent : Codex (GPT-5)

## Périmètre réservé

Verser les bancs du jour dans le scoreboard existant, ajouter les catégories
littéraires et prouver l'inférence/routage demandés. Le dépôt original et le
vrai registre `~/.codebuddy/fleet-model-performance.jsonl` restent en lecture
seule ; les démonstrations utilisent `_qa/score1/home`.

## État initial

Le registre réel a été lu sans modification : 91 lignes dans
`~/.codebuddy/fleet-model-performance.jsonl`. Une copie de travail a été
placée dans `_qa/score1/home/.codebuddy/`, puis l'import a porté cette copie à
102 lignes. Le registre réel et le dépôt original sont restés intacts.

## Travaux

- Taxonomie connue : `benchmark`, `french`, `code`, `general`, `reasoning`,
  `vision`, `redaction-fr`, `arbitrage-litteraire`, `jugement-litteraire`,
  `audit-adversarial`, `relecture-typo`. Les extensions libres restent
  acceptées pour les futurs bancs.
- L'inférence priorise le type de travail sur la langue : chapitre/rédaction,
  arbitrage, jugement aveugle, audit adversarial et typographie. La demande
  technique qui contient « tranche » reste `code` lorsqu'elle porte sur une
  migration, un plan ou des fichiers.
- `ModelScoreboard.importJsonl()` valide les champs et les bornes, ajoute en
  append-only et dédoublonne par `(at, model, taskType)`. `best(taskType)` et
  `buddy council scoreboard best --task …` exposent le meilleur résultat.
- Le fichier `docs/benchmarks/2026-09-04-bancs-litteraires.jsonl` contient 11
  mesures génériques : rédaction (Luna 28/30, Agy 22/30, Vibe 12/30),
  arbitrage (Agy 97,4 %, Vibe 79,5 %, Codestral 64 %, Sol/Luna 20,5 %),
  jugement (Sol), audit adversarial (Agy) et relecture typographique (Vibe).
  Les contrôles sans modèle et le moteur sans passe valide ne sont pas inventés.
  `latencyMs: 0` signifie mesure non fournie ; les coûts sont `$0`.
- Sous `CODEBUDDY_COUNCIL_ROUTING=true`, les nouvelles catégories sélectionnent
  directement le meilleur modèle observé parmi les modèles disponibles. Les
  catégories historiques conservent le tie-break recommandé/alternative.

## Preuves exécutées

Commande réelle d'import et de consultation, avec `HOME=_qa/score1/home` :

```text
Scoreboard import: 11 ajouté(s), 0 doublon(s) ignoré(s), 0 ligne(s) rejetée(s).
Best model for "redaction-fr": gpt-5.6-luna (provider chatgpt, win 100%, q0.93).
Best model for "arbitrage-litteraire": gemini-3.8-flash-high (provider agy-cli, win 100%, q0.97).
```

Commande tsx réelle de routage :

```text
Écris le chapitre 5 du roman de démonstration => gpt-5.6-luna
Tranche cet arbitrage d’auteur entre les versions => gemini-3.8-flash-high
Juge ces quatre versions à l’aveugle => gpt-5.6-sol
Fix the bug in the login function => grok-3-mini
sans flag => grok-3-mini
```

Tests des fichiers touchés et de leurs consommateurs directs : 10 fichiers,
162/162 verts (6 fichiers / 110 tests principaux, puis 4 / 52 complémentaires). Privacy :
`tests/security/donnees-personnelles.test.ts`, 40/40 verts. TypeScript :
`npx tsc --noEmit -p .` et `npm run typecheck`, code 0. ESLint ciblé avec
`--max-warnings=0`, code 0. `git diff --check`, code 0.

## Commits

- `f81ef9d99` — réservation et squelette du rapport ;
- `b16107bed` — types et inférence des catégories ;
- `257764c57` — import JSONL, `best`, CLI et banc ;
- `218304612` — bornes des mots-clés ;
- `02610dee6` — routage scoreboard dans la façade ;
- `150028369` — prise en compte des forces littéraires par `TaskRouter` ;
- `44750d758` — documentation flotte ;
- `285d90bb3` — rapport, preuves et première passation ;
- `e54bc479c` — comptage complet des tests ciblés.

## Ouvert

Aucun blocage de code dans le périmètre. Les latences absentes des bancs
d'arbitrage/jugement/typo restent inconnues (`0`) et les mentions qualitatives
ont été normalisées explicitement ; une future campagne peut les remplacer
par des mesures chronométrées sans changer le format.
