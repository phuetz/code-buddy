# Rapport DGM3 — Extension du banc de capacités de l'auto-amélioration (15 scénarios)

Date : 2026-09-04
Auteur : Antigravity (Mission DGM3)
Branche : `feat/dgm3-benchmark-15-2026-09-04`
Dépôt : `~/DEV/cb-dgm3-2026-09-04`

## 1. Contexte et Objectifs
Dans le cadre de la proposition 2 de l'audit DGM2 (`docs/reports/2026-09/AUDIT-DGM2.md`), le banc de capacités de la Darwin-Gödel Machine (`src/agent/self-improvement/capability-benchmark.ts`, `SEED_BENCHMARK_SCENARIOS`) était restreint à seulement 3 scénarios minimaux (`npm-test-path-filter`, `esm-js-extension-imports`, `logger-not-console`), limitant la granularité de mesure de progression de l'auto-amélioration continue.

Objectifs opérationnels de la mission DGM3 :
1. Étendre le banc déterministe à **15 scénarios réels** fondés strictement sur les invariants documentés du dépôt (`CLAUDE.md`, `docs/agents.md`, `AGENTS.md`), chacun muni d'un `id` unique kebab-case, d'une `query`, d'au moins 2 termes dans `expectIncludes`, d'une `description`, et d'une `source` (`fichier:ligne`).
2. Prouver l'**orthogonalité stricte** (aucune leçon unique ne peut couvrir plus d'un scénario) et la **non-trivialité** (un store vide ou une leçon sans les termes attendus couvre 0 scénario).
3. Analyser le proposeur (`src/agent/self-improvement/proposer.ts`) : auditer le gabarit déterministe, expliquer son rôle comme bootstrap pack et documenter où l'apprentissage réel a lieu (outils avec cas cachés held-out G4, compétences avec firewall de prompts), tout en implémentant une voie opt-in LLM via `CODEBUDDY_SELF_IMPROVE_PROPOSER=llm` exploitant `resolveCommandProvider`.
4. Établir la chaîne de preuves complète : test de contrat rouge → vert, suite Vitest `tests/agent/self-improvement` (233 d'origine + les nouveaux), `tsc`, `eslint`, `git diff --check`, et démonstration réelle CLI (`node dist/index.js improve status` à 0/15 puis `improve loop --apply` montant à 15/15).

---

## 2. Inventaire des 15 Scénarios de Capacités

| # | ID du scénario | Requête (`query`) | Termes attendus (`expectIncludes` ≥ 2) | Source documentée | Description |
|---|---|---|---|---|---|
| 1 | `npm-test-path-filter` | `npm test` | `['path filter', 'path/to']` | `CLAUDE.md:27` | Filtrer systématiquement les tests Vitest pour ne pas subir la lenteur de la suite complète (~27K tests). |
| 2 | `esm-js-extension-imports` | `import` | `['.js extension', 'esm']` | `CLAUDE.md:40` | Respecter l'obligation ESM des extensions `.js` sur les imports relatifs depuis des sources `.ts`. |
| 3 | `logger-not-console` | `console.log` | `['logger', 'not console']` | `CLAUDE.md:41` | Utiliser `logger` en production au lieu de `console.*` afin de préserver l'interception dans les tests. |
| 4 | `atomic-write-state` | `atomic-write` | `['o_append', 'state write']` | `CLAUDE.md:39` | Écrire l'état persistant via `atomic-write.ts` et préserver le mode append-only `O_APPEND`. |
| 5 | `git-add-named-files` | `git add` | `['nommément', 'jamais -a']` | `CLAUDE.md:11` | Toujours indexer les fichiers modifiés un par un nommément sans recourir à `git add -A` ni `git commit -a`. |
| 6 | `subproc-bounded-timeout` | `wait_agent` | `['with timeout', 'completion']` | `docs/agents.md:11` | Borner impérativement les processus de sous-agents par un timeout explicite. |
| 7 | `no-secrets-in-repo` | `jwt_secret` | `['secret in clair', 'secretref']` | `CLAUDE.md:12` | Proscrire tout secret, clé ou token en clair dans les fichiers suivis (utiliser l'environnement ou SecretRef). |
| 8 | `isolated-home-tests` | `_qa/` | `['home isolé', 'gitignoré']` | `CLAUDE.md:13` | Exécuter les tests sous un répertoire HOME QA temporaire isolé et gitignoré (`_qa/<mission>/home`). |
| 9 | `str-replace-omission-block` | `str_replace` | `['omission placeholder', 'rest of code']` | `CLAUDE.md:210` | Privilégier `str_replace` ciblé et rejeter tout motif d'omission destructeur (`// ... rest of code`). |
| 10 | `verify-before-finishing` | `verificationenforcement` | `['verify before finishing', 'file changes']` | `CLAUDE.md:99` | Exécuter les vérifications de tests ciblées avant de déclarer une tâche terminée (`VerificationEnforcementMiddleware`). |
| 11 | `report-before-inspection` | `docs/reports` | `['rapport créé avant', 'avant toute inspection']` | `CLAUDE.md:10` | Initialiser le rapport de mission sous `docs/reports/<AAAA-MM>/` avant toute inspection du code. |
| 12 | `tests-live-in-tests-only` | `vitest.config` | `['tests/ only', 'in-source']` | `CLAUDE.md:35` | Placer tous les fichiers de test sous `tests/` sans fichier in-source dans `src/`. |
| 13 | `self-improvement-never-touch-src` | `self-improvement` | `['reversible learnable', 'never edits src']` | `CLAUDE.md:119` | Limiter l'auto-amélioration à la couche réversible sans jamais modifier directement `src/`. |
| 14 | `peer-tool-fails-closed` | `peer.tool.invoke` | `['peer_workspace_not_configured', 'fails closed']` | `CLAUDE.md:139` | Échouer fermé si `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` n'est pas configuré pour l'exécution d'outils distants. |
| 15 | `batch-anti-tautology-guard` | `/batch` | `['anti-tautology', 'no files changed']` | `docs/agents.md:119` | Valider les tâches `/batch` avec le garde anti-tautologique (échec si une unité d'écriture ne modifie aucun fichier). |

---

## 3. Analyse du Proposeur et Voie LLM Opt-in

### 3.1. Audit du Proposeur Statique et Rôle du Gabarit
Dans l'architecture V1 :
- `StaticProposer` s'appuie sur `SEED_LESSON_DRAFTS` qui associe directement chaque identifiant de scénario à une leçon pré-rédigée contenant les mots-clés attendus.
- De plus, `buildLessonDraftPrompt` incluait directement la directive : `The lesson MUST mention: ${scenario.expectIncludes.join(', ')}.`.

**Pourquoi ce gabarit est-il acceptable à ce niveau ?**
Le gabarit statique déterministe est conçu comme un **bootstrap pack hors-ligne à 0 $**. Il permet :
1. D'initialiser et de tester l'intégralité de la machinerie DGM (porte empirique, rollback, commit git versionné, détection de régressions) de manière 100 % reproductible, sans latence réseau ni coût LLM.
2. D'offrir une base solide de règles éprouvées au démarrage du système.

**Où l'apprentissage réel et non-tautologique a-t-il lieu ?**
Comme analysé dans l'audit DGM2, l'apprentissage génératif réel de Code Buddy se déploie sur les couches exécutables :
1. **Outils générés (`buddy improve tools`) :** L'agent conçoit de nouveaux outils TypeScript `authored__*` à partir de traces d'échec réelles. Ces outils sont soumis à quatre portes strictes : G1 (scan statique de sécurité), G2 (isolation sandbox en répertoire jetable), G3 (validation sur cas de test comportementaux visibles), et surtout **G4 (cas de test cachés / held-out)**. Un outil qui se contenterait de réciter la sortie attendue échoue aux cas tenus secrets et est rejeté avec rollback immédiat.
2. **Compétences procédurales (`buddy improve skills`) :** L'agent synthétise des fichiers `SKILL.md` soumis à un firewall statique de prompt-injection (`scanSkillFirewall`, neutralisant les attaques HTML et split-lines) et à une porte de couverture empirique.

### 3.2. Voie LLM Opt-in via `resolveCommandProvider`
Pour permettre au proposeur de leçons de dépasser le gabarit statique sans régression sur le mode déterministe par défaut :
- Prise en charge de la variable d'environnement `CODEBUDDY_SELF_IMPROVE_PROPOSER=llm` dans `createWorkspaceEngine`, `improve cycle` et `improve loop`.
- Amélioration de `createLlmDrafter` (`src/agent/self-improvement/llm-drafter.ts`) : tentative préalable de résolution via `resolveCommandProvider()` (issu de `src/commands/llm-provider-resolution.js`), connectant le proposeur au modèle utilisateur actif (Ollama local, OpenAI, OAuth ChatGPT à 0 $). En cas d'absence de configuration, repli propre sur la détection d'environnement ou sortie sans erreur (`returns null`).

---

## 4. Résultats des Vérifications et Preuves Réelles

### 4.1. Test de Contrat Dédié : Témoin Rouge → Vert
- Fichier : `tests/agent/self-improvement/capability-benchmark.test.ts`
- **Témoin ROUGE :** 6 échecs sur 6 tests exécutés (taille 3 au lieu de 15, absence de champ source, drafts incomplets).
- **Passage au VERT :** 6/6 tests réussis après enrichissement des 15 scénarios et des drafts orthogonaux.

### 4.2. Suite Vitest Globale `tests/agent/self-improvement`
Exécution avec HOME QA isolé :
```bash
HOME=~/DEV/cb-dgm3-2026-09-04/_qa/dgm3/home npx vitest run tests/agent/self-improvement
```
- Résultat : **33 fichiers de test passés, 241 tests passés** (233 initiaux + 6 de `capability-benchmark.test.ts` + 2 de `llm-proposer.test.ts`).
- Durée : 2.14 s.

### 4.3. Contrôles Statiques
- Typecheck TypeScript : `npx tsc --noEmit -p .` → **Code 0**, 0 erreur.
- Lint ciblé : `npx eslint --max-warnings=0 <fichiers modifiés>` → **Code 0**, 0 erreur, 0 avertissement.
- Vérification différentielle : `git diff --check` → **Code 0**, aucun marqueur résiduel ni espace parasite.

### 4.4. Preuve Réelle CLI dans le Clone
Après compilation via `npm run build` :

1. État initial :
```bash
$ CODEBUDDY_SELF_IMPROVE=true node dist/index.js improve status
Autonomy: propose-only
Capability coverage: 0/15 (0%)
Uncovered: npm-test-path-filter, esm-js-extension-imports, logger-not-console, atomic-write-state, git-add-named-files, subproc-bounded-timeout, no-secrets-in-repo, isolated-home-tests, str-replace-omission-block, verify-before-finishing, report-before-inspection, tests-live-in-tests-only, self-improvement-never-touch-src, peer-tool-fails-closed, batch-anti-tautology-guard
Archive: 4 validated improvement(s), total Δ=4
Store: 0 version(s); head —, best —
```

2. Exécution de la boucle d'auto-amélioration :
```bash
$ CODEBUDDY_SELF_IMPROVE=true node dist/index.js improve loop --apply
Autonomy: auto-apply
Cycles: 16, applied: 15
Final coverage: 15/15 (100%)
Store versions: 16
```

3. État final vérifié :
```bash
$ CODEBUDDY_SELF_IMPROVE=true node dist/index.js improve status
Autonomy: propose-only
Capability coverage: 15/15 (100%)
Uncovered: (none)
Archive: 19 validated improvement(s), total Δ=19
Store: 16 version(s); head 15/15, best 15/15 (d34e0cd0)
```

La boucle a parcouru les 15 scénarios sans régression, a appliqué les 15 améliorations validées par la porte empirique, les a versionnées dans le store git isolé, et s'est arrêtée proprement au 16ème cycle lorsque la couverture complète de 15/15 a été atteinte.

---

## 5. Historique des Commits de la Mission

- `c80932d5c` : `docs(dgm3): reservation de la mission DGM3 et initialisation du rapport`
- `368ccbba2` : `test(dgm3): ajout du test pour le benchmark a 15 scenarios (temoin rouge)`
- `178062a06` : `feat(self-improvement): extension du banc de capacites a 15 scenarios reels et orthogonaux`
- `8bd8516f2` : `feat(self-improvement): support opt-in CODEBUDDY_SELF_IMPROVE_PROPOSER=llm via resolveCommandProvider`
