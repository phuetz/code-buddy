# Mission DGM6 — La source « journaux de lanes » doit produire des FAITS CHIFFRÉS (tours, coût, plafond) que le rejeu des stratégies sait juger

- **Date** : 2026-09-04
- **Branche** : `feat/dgm6-faits-chiffres-2026-09-04`
- **Clone** : `~/DEV/cb-dgm6-2026-09-04`
- **Original** : `~/code-buddy` (strictement interdit en écriture)
- **Pilote / Auteur** : Antigravity (Gemini 3.8 Flash High) & Patrice

---

## 1. Objectifs de la mission

Aujourd'hui, la source `DelegationLogsExperienceSource` (mise en place lors de DGM5) produit des descriptions textuelles d'échecs comme `Échecs nommés : Maximum tool execution rounds.` et `Sortie : N.`.
Le rejeu contrefactuel des stratégies (`strategy-replay.ts`) en déduit `failure=max-rounds` mais, faute de compte de tours ou de coût, suppose par défaut que la lane a utilisé le plafond en vigueur ou ignore les métriques quantitatives.
Il manque des faits chiffrés réels :
- Tours d'outils réellement consommés (`rounds=<n>`)
- Plafond de tours de la lane (`limit=<n>`, e.g. `--max-tool-rounds 300`)
- Coût réel en USD (`cost=<usd>`, e.g. depuis `cost.total` du headless JSON quand `pricing` != `unknown`)
- Plafond de coût (`cost_cap=<usd>` si journalisé)
- Issue / échec nommé (`outcome=<success|failure> failure=<max-rounds|cost-cap|...>`)

La mission DGM6 comprend trois volets principaux :
1. **Extraction de faits chiffrés purs** : Parser les journaux de délégation (`delegation-facts.ts` ou dans `digest-sources.ts`) avec des parseurs purs testés sur des fixtures anonymisées, extrayant `engine`, `model` (effectif / demandé), `durationSec`, `exitCode`, `toolRounds` (compte des blocs d'appels d'outils ou détection du nombre dans `Maximum tool execution rounds (N)`), `roundLimit` (`--max-tool-rounds N` si présent), `costUsd` (`cost.total`), `costCap`. Ne jamais inventer les valeurs absentes.
2. **Émission des marqueurs structurés** : La ligne `context` de chaque expérience issue des logs émet une ligne de faits explicites lisible par `parseRunFacts` de `strategy-replay.ts` (`facts: rounds=<n> limit=<n> cost=<usd> outcome=<success|failure> failure=<max-rounds|cost-cap|...>`). Valider avec `ReplayStrategyEvaluator` qu'une lane coupée à 300 tours rejoue en perte sous plafond 75 et gain sous 400, et qu'une lane réussie en 41 tours reste un succès sous 50.
3. **Preuve réelle en lecture seule** : Exécution de `CODEBUDDY_SELF_IMPROVE_DELEGATION_SOURCE=true npx tsx src/index.ts improve strategies` avant / après, analyse des décisions du rejeu face aux données réelles de la journée du 04/09 (dont les lanes à 300 tours).
4. **Vérifications et garde-fous** : Suites Vitest ciblées avec `HOME=~/DEV/cb-dgm6-2026-09-04/_qa/dgm6/home`, `tsc` 0, eslint ciblé 0, `git diff --check` 0, test de données personnelles vert.

---

## 2. Journal d'avancement

- 2026-09-04 13:21 : Création du rapport avant toute inspection et réservation dans `docs/FABLE5-CODEX-COORDINATION.md`.
