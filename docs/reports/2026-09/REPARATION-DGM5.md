# Mission DGM5 — Donner à la Darwin-Gödel Machine de la matière réelle : la journée du 04/09 comme première expérience

- **Date** : 2026-09-04
- **Branche** : `feat/dgm5-experience-reelle-2026-09-04`
- **Clone** : `~/DEV/cb-dgm5-2026-09-04`
- **Original** : `~/code-buddy` (strictement préservé en lecture seule)
- **Pilote / Auteur** : Antigravity (Assistant) & Patrice

---

## 1. Constat initial

Avant cette mission, la Darwin-Gödel Machine (DGM) de Code Buddy possédait déjà ses briques architecturales (boucles d'auto-amélioration, portes statiques et comportementales, pare-feu de skills, archive évolutive), mais **fonctionnait uniquement sur des fixtures synthétiques ou des scénarios de test offline**.
Aucune matière opérationnelle réelle issue de la production quotidienne des agents de développement (les journaux de délégations de lanes, les échecs récurrents et les leçons de terrain) n'avait jamais traversé la boucle.
De plus, les benchmarks de génération de code se limitaient à des exemples génériques (`slugify`, `word-count`, `git-bisect`), sans injecter les besoins concrets rencontrés au cours des sprints.

L'objectif de la mission DGM5 a été d'apporter cette matière réelle en trois étapes :
1. Connecter une source d'expérience opérationnelle analysant les journaux de délégation de subagents (`~/.codebuddy/logs/delegation/` ou injectés).
2. Faire concevoir, implémenter et valider par la machine 3 outils logiciels réels répondant à des besoins opérationnels du 04/09/2026 (`sitemap-check`, `ffmpeg-argv-audit`, `orphan-temporaries`).
3. Faire concevoir, rédiger et valider par la machine 2 skills méthodologiques et normatifs (`relecture-typographique-francaise`, `mission-contrat-lane`).

---

## 2. Point 1 : Source d'expérience « journaux de lanes »

### Conception & Implémentation
- **Types unifiés** (`src/agent/self-improvement/types.ts`) :
  - Extension du type `Experience.source` avec `'delegation-log'`.
  - Extension du type `ArchiveEntry.kind` avec `'delegation-log'`.
  - Extension de la provenance des leçons dans `DigestExperienceItem.provenance`.
- **Moteur d'extraction de faits & leçons** (`src/agent/self-improvement/digest-sources.ts`) :
  - `NAMED_DELEGATION_FAILURES` : reconnaissance structurée des 5 échecs emblématiques observés :
    1. *Maximum tool execution rounds reached* (boucle outil infinie).
    2. *Unexpected end of JSON input* (troncature / crash IPC).
    3. *trim is not a function* (défaut de type / argument non-string).
    4. *peer closed connection* (rupture réseau ou arrêt daemon).
    5. *Turn limit reached* (épuisement du quota de tours d'agent).
  - `PILOT_LESSONS` : synthèse des leçons opérationnelles du pilote :
    1. *HOME isolé pour vitest* (`HOME=.../_qa/.../home` pour ne pas polluer l'espace personnel).
    2. *Commiter après chaque point* (atomicité des commits nommés).
    3. *Lire le journal du boot précédent avant toute relance*.
    4. *Ne jamais éditer un script bash pendant son exécution*.
    5. *Preuve par les tests des fichiers touchés*.
  - `extractDelegationFacts()` et `readDelegationLogs()` : lecture robuste de fichiers JSON / JSONL / texte brut sous `~/.codebuddy/logs/delegation/` (ou répertoire configuré), anonymisation stricte des chemins absolus `/home/...` et détection des métriques réelles.
  - Classe `DelegationLogsExperienceSource` : intégration opt-in via variable d'environnement `CODEBUDDY_SELF_IMPROVE_DELEGATION_SOURCE=true` ou option d'instanciation, respectant scrupuleusement la règle de non-accès passif aux répertoires privés.
- **Intégration CLI & Digest** (`src/commands/cli/improve-command.ts`, `src/agent/self-improvement/digest.ts`) :
  - Ingestion dans `collectExperiences()` lors de `buddy improve digest` ou des cycles d'amélioration.
  - Affichage et rendu Markdown / HTML avec badge `provenance: delegation-log`.
- **Validation unitaire & conformité RGPD** :
  - Test unitaire dédié `tests/agent/self-improvement/delegation-experience-source.test.ts` (4 tests verts) avec fixtures anonymisées.
  - Test gardien `tests/security/donnees-personnelles.test.ts` (40 tests verts) confirmant l'absence de fuite de chemins personnels dans les artefacts persistés.

---

## 3. Point 2 : Trois outils écrits par la machine

Trois scénarios réels du 04/09/2026 ont été intégrés au catalogue `SEED_TOOL_SCENARIOS` (`src/agent/self-improvement/tool-benchmark.ts`).
Le moteur `ToolImprovementEngine` a été exécuté en mode `--apply` avec `CODEBUDDY_SELF_IMPROVE=true` dans le clone dédié.
Fournisseur LLM actif : ChatGPT OAuth (`gpt-5.6-sol`), coût réel **0,00 $**.

### Détail par outil :

1. **`sitemap-check`** (`authored__extract_url_statuses`) :
   - *Spécification* : Extraire les URLs d'un XML sitemap ou document HTML et associer un statut HTTP simulé via un dictionnaire sans appel réseau sortant.
   - *Temps d'exécution* : 30,5 s.
   - *Coût* : 0,00 $.
   - *Portes franchies* :
     - G1 (scan statique, regexes de sécurité, interdiction d'appels réseau / fs écriture) : PASSÉ.
     - G1b (préfixe `authored__*` obligatoire) : PASSÉ (`authored__extract_url_statuses`).
     - G3 (cas visibles : parsing XML et fallback HTML) : PASSÉ.
     - G4 (cas held-out tenus secrets : tags `<loc>` multilignes, statuts personnalisés) : PASSÉ.
   - *Statut* : **AUTHORED + KEPT** (enregistré dans `.codebuddy/self-improvement/authored-tools.json` et archivé).

2. **`ffmpeg-argv-audit`** (`authored__audit_ffmpeg_argv`) :
   - *Spécification* : Auditer les arguments CLI ffmpeg et identifier 3 anomalies classiques : boucle sans durée (`stream_loop_without_t`), double fichier de sortie (`duplicate_output`), et `-f` placé après le fichier de sortie (`format_after_output`).
   - *Temps d'exécution* : 41,3 s.
   - *Coût* : 0,00 $.
   - *Portes franchies* :
     - G1 / G1b : PASSÉ (`authored__audit_ffmpeg_argv`).
     - G3 (cas visibles) : PASSÉ.
     - G4 (cas held-out tenus secrets : cumuls d'anomalies, options de copie sans anomalie) : PASSÉ.
   - *Statut* : **AUTHORED + KEPT**.

3. **`orphan-temporaries`** (`authored__find_orphan_temp_files`) :
   - *Spécification* : Inspecter une liste de fichiers avec ancienneté en minutes et détecter les temporaires orphelins correspondant au motif `<cible>.tmp.*` dont l'âge dépasse strictement un seuil donné.
   - *Temps d'exécution* : 8,1 s.
   - *Coût* : 0,00 $.
   - *Portes franchies* :
     - G1 / G1b : PASSÉ (`authored__find_orphan_temp_files`).
     - G3 (cas visibles) : PASSÉ.
     - G4 (cas held-out tenus secrets : seuils stricts, suffixes de compression, extensions régulières) : PASSÉ.
   - *Statut* : **AUTHORED + KEPT**.

---

## 4. Point 3 : Deux skills écrits par la machine

Deux scénarios réels ont été ajoutés à `SEED_SKILL_SCENARIOS` (`src/agent/self-improvement/skill-benchmark.ts`).
Les portes de validation des skills ont été formalisées en 4 niveaux ordonnés et bloquants :
- **SG1** : Structure Markdown valide, instructions non vides, titre et triggers présents.
- **SG2** : Pare-feu de sécurité (`scanSkillFirewall`) — rejet sans appel de toute tentative d'injection de prompt, d'écrasement des consignes système ou d'exfiltration de clés/secrets.
- **SG3** : Couverture visible des notions obligatoires.
- **SG4** : Couverture held-out tenue secrète du proposer LLM (défense anti-gaming).

Le moteur `SkillImprovementEngine` a été exécuté en mode `--apply` dans le clone :

1. **`relecture-typographique-francaise`** (`authored-relecture-typographique-francaise`) :
   - *Spécification* : Guide opérationnel de relecture typographique française de premier passage.
   - *Visible (SG3)* : Guillemets français « », ponctuation double (; : ? !), apostrophes typographiques, sanctuarisation des blocs de code.
   - *Held-out secret (SG4)* : Espace insécable, virgule décimale vs séparateur de milliers anglais.
   - *Résultat* : Portes SG1 → SG4 passées du premier coup.
   - *Artefact installé* : `.codebuddy/skills/authored-relecture-typographique-francaise/SKILL.md`.

2. **`mission-contrat-lane`** (`authored-mission-contrat-lane`) :
   - *Spécification* : Formalisation de la méthode de travail rigoureuse pour une mission-contrat de lane autonome.
   - *Visible (SG3)* : Clone dédié (original en lecture seule), rapport d'intervention avant toute inspection, commits nommés par étape (aucun git add global), preuve par tests des fichiers touchés.
   - *Held-out secret (SG4)* : HOME isolé pour l'exécution des tests, bilan final de dix lignes synthétique.
   - *Résultat* : Portes SG1 → SG4 passées du premier coup.
   - *Artefact installé* : `.codebuddy/skills/authored-mission-contrat-lane/SKILL.md`.

---

## 5. Sorties réelles des commandes (Avant / Après)

### `buddy improve status`
```text
Autonomy: propose-only
Capability coverage: 0/15 (0%)
Uncovered: npm-test-path-filter, esm-js-extension-imports, logger-not-console, atomic-write-state, git-add-named-files, subproc-bounded-timeout, no-secrets-in-repo, isolated-home-tests, str-replace-omission-block, verify-before-finishing, report-before-inspection, tests-live-in-tests-only, self-improvement-never-touch-src, peer-tool-fails-closed, batch-anti-tautology-guard
Archive: 12 validated improvement(s), total Δ=12
Store: 0 version(s); head —, best —
```

### `buddy improve digest`
```text
# Digest d’auto-amélioration
Période : 2026-08-28 → 2026-09-04
Sur cette période, l’agent a écrit 3 tools, ajouté 2 skills et appris 1 leçon. Le benchmark a gagné 0 points. au moins 6 gates passées, 0 rejetées observées.

## Cette période
- Tools écrits : 3 — authored__audit_ffmpeg_argv, authored__extract_url_statuses, authored__find_orphan_temp_files
- Skills authored : 2 — authored-mission-contrat-lane, authored-relecture-typographique-francaise
- Skills importées : 0 — aucun
- Leçons apprises : 1
- Gates : 6 passées · 0 rejetées (historique partiel)
```

### `buddy improve skills-list`
```text
     authored-mission-contrat-lane
     authored-relecture-typographique-francaise
```

---

## 6. Preuve de validation par les tests

Tous les tests couvrant l'ensemble des fichiers touchés de la mission ont été exécutés avec un environnement `HOME` isolé (`_qa/dgm5/home`) :
- `tests/agent/self-improvement/` (35 suites, 286 tests unitaires passés sur 286).
- `tests/security/donnees-personnelles.test.ts` (40 tests d'intégrité et confidentialité passés sur 40).
- Compilation TypeScript `tsc --noEmit` : 0 erreur.
- Linter ESLint sur les fichiers touchés : 0 warning / 0 erreur.
