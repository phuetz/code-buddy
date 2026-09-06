# Rapport de vérification croisée — Socle relationnel `@phuetz/companion-core` (Opus)

- **Date** : 2026-09-06
- **Branche** : `feat/companion-core-2026-09-06` (base `533b32d47`, 6 commits Opus vérifiés)
- **Worktree** : `~/DEV/cb-companion-core-2026-09-06`
- **Auditeur** : Antigravity (AGY)
- **Rapport audité** : `docs/reports/2026-09/COMPANION-CORE-OPUS.md`
- **Environnement de test** : `HOME=~/DEV/cb-companion-core-2026-09-06/_qa/verifcore/home`, `env -u FORCE_COLOR`

---

## 1. Tableau récapitulatif des 8 points de contrôle

| Point | Intitulé | Statut | Catégorie | Preuve synthétique |
| --- | --- | --- | --- | --- |
| 1 | **Byte-identique OFF** | **TIENT** | A | `src/companion/core-adapter.ts:49` garde `loadCompanionCore` sur `companionCoreEnabled`. 0 appel dans `src/`. Simulation paquet absent : repli transparent sans levée d'erreur. |
| 2 | **Byte-identique ON** | **TIENT** | A | `tests/companion/core-adapter.test.ts` (12 tests) compare directement l'ancien module (`relationship-state.ts`, `reply-augment.ts`) et le paquet sur les mêmes entrées. 12/12 verts. |
| 3 | **Zéro dépendance** | **TIENT** | A | `packages/companion-core/package.json` n'a que `zod ^3.25.0`. `grep` d'imports interdits (`../../src`, `@/`, `node:http`, `fetch(`) strictement vide (code 1). Aucun import hôte. |
| 4 | **Workspace** | **TIENT** | A | `workspaces: ["packages/*"]` présent. `npm run build` passe (45,1 s). `npm run typecheck` passe (39,7 s, 3 sous-projets). `npm pack --dry-run` liste 32 fichiers sans fixture ni donnée personnelle. |
| 5 | **API** | **TIENT** | A | `packages/companion-core/src/index.ts` documente l'API en exactement 15 lignes. `types.ts` exporte les 5 types requis. Signatures `Clock`, `Rng`, `KeyValueStore` injectables vérifiées. |
| 6 | **Relationnel** | **TIENT** | A | Pas de gamification (validé par test & Zod), anti-cliquet prouvé (convergence asymptote), inertie testée. `memory` : `remember/recall/forget`, soft forgetting préservant `pinned`, refus clinique. `initiative` : fenêtré, plafonné, stop 24 h, 0 réseau. |
| 7 | **Suites de test** | **TIENT** | A | Vitest (core + companion + donnees-personnelles) : 820 verts, 1 sauté (Piper absent, attendu). `tsc -p tsconfig.json` : 0 erreur. ESLint sur code neuf : 0 erreur. `git diff --check` : 0 anomalie. |
| 8 | **Trois ajustements Opus** | **TIENT** | A | Profil `copine` générique, ligne `away` sans anti-motif, `lastLine` survivant à minuit : tous les trois documentés et testés unitairement. Zéro altération du comportement drapeau éteint. |

---

## 2. Vérifications détaillées et preuves d'exécution

### Point 1 — Byte-identique OFF & chargement dynamique résilient

1. **Absence d'import dans les chemins existants** :
   - Commande : `grep -rn "core-adapter" src/`
   - Résultat : uniquement `src/companion/core-adapter.ts:17` (`@module companion/core-adapter`). Aucun fichier source de production n'importe ni n'appelle `core-adapter.ts`.
2. **Gardes systématiques fichier:ligne dans `src/companion/core-adapter.ts`** :
   - `companionCoreEnabled` : lignes 37-40 (évalue explicitement `CODEBUDDY_COMPANION_CORE`).
   - `loadCompanionCore` : ligne 49 (`if (!companionCoreEnabled(env)) return null;`).
   - `resolveCompanionPersonaViaCore` : ligne 81 (`const core = await loadCompanionCore(env); if (!core || !historical) return historical;`).
   - `validateCompanionPersona` : ligne 99 (`const core = await loadCompanionCore(env); if (!core) return { ok: true };`).
   - `evolveTraitsViaCore` : ligne 111 (`const core = await loadCompanionCore(env); if (!core) return evolveTraits(state, signal);`).
   - `applyLimitsContractViaCore` : ligne 126 (`const core = await loadCompanionCore(env); if (!core) return applyLimitsContract(output, opts);`).
3. **Import dynamique & résilience en cas d'absence du paquet** :
   - Ligne 20 : `import type * as CompanionCore from '@phuetz/companion-core';` (effacé à la compilation TS ; zéro import statique dans `dist/companion/core-adapter.js`).
   - Ligne 53 : chargement dynamique par `await import('@phuetz/companion-core')` enveloppé dans un bloc `try / catch` avec repli propre sur `logger.warn` et verrou `loadFailed = true`.
   - **Preuve par simulation de paquet manquant** :
     - Commande : `mv packages/companion-core packages/companion-core.disabled && node -e "import('./dist/companion/core-adapter.js').then(async m => { console.log('Import sans paquet:', !!m); const rOff = await m.loadCompanionCore({ CODEBUDDY_COMPANION_CORE: 'false' }); console.log('load(OFF):', rOff); const rOn = await m.loadCompanionCore({ CODEBUDDY_COMPANION_CORE: 'true' }); console.log('load(ON):', rOn); const traits = await m.evolveTraitsViaCore({ celebratedMilestones: [] }, 'affection', { CODEBUDDY_COMPANION_CORE: 'true' }); console.log('traits fallback:', traits.mood); });" ; mv packages/companion-core.disabled packages/companion-core`
     - Sortie observée :
       ```
       Import sans paquet: true
       load(OFF): null
       [companion-core] paquet indisponible, repli sur le chemin historique : Cannot find package '@phuetz/companion-core' ...
       load(ON): null
       traits fallback: 65
       ```
     - Conclusion : le module ne casse jamais au chargement et se replie silencieusement sur le chemin historique.

---

### Point 2 — Byte-identique ON & Parité des tests

- Fichier examiné : `tests/companion/core-adapter.test.ts` (186 lignes).
- **Citations des imports** :
  - Adaptateur sous test :
    - Lignes 14-22 : `import { applyLimitsContractViaCore, companionCoreEnabled, evolveTraitsViaCore, loadCompanionCore, resetCompanionCoreCache, resolveCompanionPersonaViaCore, validateCompanionPersona } from '../../src/companion/core-adapter.js';`
  - Modules historiques de référence :
    - Ligne 23 : `import { COPINE_PERSONA, resolveCompanionPersona } from '../../src/companion/personas/index.js';`
    - Lignes 24-28 : `import { evolveTraits, type RelationalSignal, type RelationshipState } from '../../src/companion/relationship-state.js';`
    - Ligne 29 : `import { applyLimitsContract } from '../../src/companion/reply-augment.js';`
- **Structure des 12 tests de parité** :
  1. *Drapeau* (3 tests) : valeur par défaut OFF, pas de chargement sans drapeau, chargement unique mémoïsé si ON.
  2. *Persona* (5 tests) :
     - Lignes 100-105 : vérifie avec `toBe` (égalité stricte de référence d'objet) que `resolveCompanionPersonaViaCore(CORE_ET_COPINE) === COPINE_PERSONA === resolveCompanionPersona(COPINE_SEULE)`.
     - Lignes 107-109 : validation du profil historique par le schéma Zod du paquet.
  3. *Dérive relationnelle* (2 tests) :
     - Lignes 135-143 : boucle croisée de 3 états × 8 signaux = 24 cas. Compare `attendu = evolveTraits(etat, signal)` (module historique) avec `evolveTraitsViaCore(..., CORE_SEUL)` (paquet).
  4. *Contrat de limites* (2 tests) :
     - Lignes 169-184 : boucle sur les 9 sorties de `SORTIES` couvrant les 5 motifs et idiotismes. Compare `attendu = applyLimitsContract(...)` (module historique) avec `applyLimitsContractViaCore(..., CORE_ET_COPINE)` (paquet).
- **Exécution Vitest** :
  - Commande : `env -u FORCE_COLOR HOME=~/DEV/cb-companion-core-2026-09-06/_qa/verifcore/home npx vitest run tests/companion/core-adapter.test.ts`
  - Sortie : `Test Files 1 passed (1) | Tests 12 passed (12) | Duration 692ms`.

---

### Point 3 — Zéro dépendance & Isolation

1. **Inspection de `packages/companion-core/package.json`** :
   - Lignes 28-30 :
     ```json
     "dependencies": {
       "zod": "^3.25.0"
     }
     ```
   - Aucune autre dépendance (`devDependencies`, `peerDependencies` inexistantes).
2. **Vérification de l'absence d'imports non autorisés** :
   - Commande : `grep -rn "from '\.\./\.\./src\|from '@/\|node:http\|fetch(" packages/companion-core/src`
   - Code retour : 1 (0 correspondance trouvée).
3. **Audit de la totalité des imports du paquet** :
   - Commande : `grep -rn "from " packages/companion-core/src`
   - Résultat : 100 % des imports sont des fichiers internes relatifs (`./types.js`, `../runtime/clock.js`, etc.), à l'exception unique de `import { z } from 'zod'` dans `src/persona/schema.ts:10`. Zéro dépendance externe, zéro import de Code Buddy.

---

### Point 4 — Workspace, compilation et publication propre

1. **Déclaration du workspace racine** :
   - `package.json:15-17` : `"workspaces": [ "packages/*" ]`.
2. **Build complet du dépôt racine** :
   - Commande : `time npm run build`
   - Sortie : code 0.
   - Chronométrage : `real 0m45.103s`, `user 1m3.255s`, `sys 0m2.759s`.
3. **Typecheck complet du dépôt** :
   - Commande : `time npm run typecheck`
   - Sortie : exécute `tsc --noEmit`, `tsc --project tsconfig.gpuNode-identity.json` et `tsc --noEmit -p packages/companion-core/tsconfig.json`. Code 0.
   - Chronométrage : `real 0m39.669s`, `user 1m6.819s`, `sys 0m2.775s`.
4. **Configuration TypeScript dédiée du paquet** :
   - `packages/companion-core/tsconfig.json` : compilation globale stricte (src + tests).
   - `packages/companion-core/tsconfig.build.json` : compilation de production excluant `tests`, ciblant `dist/`.
   - Build unitaire : `npm run --prefix packages/companion-core build` s'exécute avec succès en 1,2 s.
5. **Vérification du tarball (`npm pack --dry-run`)** :
   - Commande : `npm pack --dry-run` exécuté dans `packages/companion-core`.
   - Sortie : package size 35.0 kB, 32 fichiers indexés (`dist/**/*.js`, `dist/**/*.d.ts`, `package.json`, `README.md`).
   - Audit de propreté : aucun fichier de test, aucune fixture, aucune clé, aucun chemin absolu, aucune donnée personnelle.

---

### Point 5 — Surface de l'API publique & Seams injectables

1. **Documentation de l'API en tête de `src/index.ts`** :
   - `packages/companion-core/src/index.ts` lignes 4 à 18 : exactement 15 appels documentés numérotés de 1 à 15 (`loadPersonaProfile`, `createPersonaRegistry`, `pickGreeting`, `detectEmotion`, `detectRelationalSignal`, `evolveRelationship`, `evolveRelationshipWithDayInertia`, `rapportTier`, `remember`, `recall`, `forget`, `planInitiative`, `isPauseRequest`, `applyLimitsContract`, `WhatMattersMemory`).
2. **Types exportés dans `packages/companion-core/src/types.ts`** :
   - `CompanionProfile` (ligne 33)
   - `RelationshipState` (ligne 76)
   - `Fact` (ligne 97)
   - `Initiative` (ligne 116)
   - `LimitsVerdict` (ligne 127)
   - Réexportés à `packages/companion-core/src/index.ts:30-43`.
3. **Signatures des seams injectables** :
   - **Horloge** (`src/runtime/clock.ts`) :
     ```ts
     export type Clock = () => number;
     export function fixedClock(epochMs: number): Clock;
     export function resolveCivilClock(epochMs: number, timeZone?: string): CivilClock;
     ```
   - **Aléa** (`src/runtime/rng.ts`) :
     ```ts
     export type Rng = () => number;
     export function seededRng(seed: number): Rng;
     export function constantRng(value?: number): Rng;
     ```
   - **Stockage clé-valeur** (`src/runtime/store.ts`) :
     ```ts
     export interface KeyValueStore {
       get<T>(key: string): Promise<T | null>;
       set<T>(key: string, value: T): Promise<void>;
       delete(key: string): Promise<void>;
     }
     export class MemoryKeyValueStore implements KeyValueStore { ... }
     ```

---

### Point 6 — Moteur relationnel, mémoire et initiatives

1. **Absence de gamification & anti-cliquet** :
   - Le schéma Zod `companionProfileSchema` et `containsGamification` refusent les scores (XP, niveaux, séries) dans les répliques parlées.
   - `packages/companion-core/tests/limits.test.ts:88-98` : parcourt les >50 lignes parlées du profil `copine` et valide qu'aucune ne contient de terme de score.
   - Anti-cliquet prouvé dans `packages/companion-core/tests/relationship.test.ts:45-54` : 200 signaux consécutifs convergent vers l'asymptote (`DEFAULT_TRAITS + delta / DECAY`), sans dépasser 100 ni monter indéfiniment.
   - Lignes 56-64 : décroissance (`decay`) progressive vers `MOOD_BASELINE` en l'absence de signal actif.
2. **Inertie journalière** :
   - Testé dans `packages/companion-core/tests/relationship.test.ts:81-110` : pas d'humeur plafonné par tour (`MAX_MOOD_STEP_PER_TURN = 4`), bande d'humeur stable face aux phrases neutres, recentrage doux au changement de jour civil (`moodLocalDate`).
3. **Mémoire (« ce qui compte »)** :
   - Fonctions `remember`, `recall`, `forget` testées dans `packages/companion-core/tests/memory.test.ts:31, 101, 119`.
   - Métadonnées complètes : `provenance` (`explicit` / `confirmed` / `inferred`), horodatages `at` et `updatedAt`, `confidence` 0..1, flag `pinned`.
   - Oubli doux (`applySoftForgetting`) : demi-vie de 45 jours sur les faits inférés (`tests/memory.test.ts:124-140`), ne supprime jamais un fait épinglé (`pinned: true`).
   - Refus clinique : `isClinicalClaim` filtre les termes diagnostiques, posologies et symptômes (`tests/memory.test.ts:74-81` et `192-198`).
4. **Initiatives** :
   - Plafond de 3 initiatives par jour (`policy.maxPerDay = 3`), 1 angle par créneau (`morning`, `thought`, `evening`), testé dans `tests/initiative.test.ts:62-90`.
   - Fenêtre horaire civile locale (`inWindow`), testée dans `tests/initiative.test.ts:50-59, 104-108`.
   - Pause de 24 h (`isPauseRequest` sur "stop", "not now", "pas maintenant"), testée dans `tests/initiative.test.ts:140-170`.
   - Zéro livraison réseau : recherche `grep -rni "fetch\|telegram\|http\|net" packages/companion-core/src` ne renvoie que des commentaires ou des motifs textuels ("honnetement"). Zéro module réseau.

---

### Point 7 — Validation des suites et contrôles qualité

1. **Exécution groupée Vitest** :
   - Commande : `env -u FORCE_COLOR HOME=~/DEV/cb-companion-core-2026-09-06/_qa/verifcore/home npx vitest run packages/companion-core tests/companion tests/security/donnees-personnelles.test.ts`
   - Résultat :
     - Fichiers : **85 passés, 1 sauté** (86 fichiers au total).
     - Tests : **820 passés, 1 sauté** (821 tests au total).
     - Durée : 10,21 s.
     - Justification du test sauté : `[CIFIX2] Piper unavailable; test guarded: Piper voice model is missing...` (saut conditionnel normal en environnement de test sans modèle vocal ONNX Piper lourd).
   - Détail par sous-ensemble :
     - `packages/companion-core` : 6 fichiers, **105 / 105 passés**.
     - `tests/companion` : 79 fichiers, **675 passés, 1 sauté** (inclut les 12 tests de `core-adapter.test.ts`).
     - `tests/security/donnees-personnelles.test.ts` : 1 fichier, **40 / 40 passés**.
2. **Contrôle TypeScript racine** :
   - Commande : `npx tsc --noEmit -p tsconfig.json`
   - Résultat : code 0, 0 erreur.
3. **Contrôle ESLint sur les fichiers neufs** :
   - Commande : `npx eslint packages/companion-core src/companion/core-adapter.ts tests/companion/core-adapter.test.ts`
   - Résultat : code 0, 0 erreur, 0 avertissement.
4. **Contrôle de conformité Git (`git diff --check`)** :
   - Commande : `git diff --check` et `git diff --check 533b32d47..HEAD`
   - Résultat : code 0, aucun espace superflu ni conflit.

---

### Point 8 — Audit des 3 ajustements assumés par Opus

1. **Profil `copine` générique dans le paquet** :
   - Documenté dans `COMPANION-CORE-OPUS.md` §3.2 (lignes 109-116).
   - Testé dans `tests/companion/core-adapter.test.ts:100-105` et `packages/companion-core/tests/persona.test.ts:19-24`.
   - Impact drapeau OFF : **nul**. `core-adapter.ts` n'est pas appelé par le code existant, et l'adaptateur restitue la référence directe à `COPINE_PERSONA` du dépôt.
2. **Ligne `away` sans anti-motif** :
   - Documenté dans `COMPANION-CORE-OPUS.md` §3.2 (lignes 117-121).
   - Testé dans `packages/companion-core/tests/initiative.test.ts:180-186` (chaque ligne du pool `away` vérifie `isShameLine === false`).
   - Impact drapeau OFF : **nul**. Le fichier `src/companion/away-mode.ts` du dépôt n'a pas été modifié (`git diff` vide).
3. **`lastLine` survit au passage à minuit** :
   - Documenté dans `COMPANION-CORE-OPUS.md` §3.2 (lignes 122-124).
   - Testé dans `packages/companion-core/tests/initiative.test.ts:92-102` (`expect(rolled.lastLine).toBe('Bonjour.');`) et lignes 119-126 (non-répétition le lendemain).
   - Impact drapeau OFF : **nul**. `rollInitiativeDay` n'existe que dans le nouveau paquet, le robot utilise son code historique tant que le drapeau est absent.

---

## 3. Bilan de vérification

Vérification contradictoire complète exécutée sur les 6 commits de la branche `feat/companion-core-2026-09-06`.
L'adaptateur `src/companion/core-adapter.ts` est strictement opt-in, non appelé par `src/`, et résilient face à un paquet absent (prouvé par renommage temporaire et simulation Node.js).
La parité byte-identique avec et sans drapeau est formellement démontrée sur 24 états de dérive et 9 motifs de limites (12/12 tests).
Le paquet `@phuetz/companion-core` est pur TypeScript, sans UI, sans réseau, isolé avec la seule dépendance `zod`.
La configuration workspace est fonctionnelle : `npm run build` (45,1 s) et `npm run typecheck` (39,7 s) sont impeccables.
L'API publique en 15 lignes expose des seams injectables (`Clock`, `Rng`, `KeyValueStore`) et les 5 types requis.
Les suites de tests (`packages/companion-core`, `tests/companion`, `donnees-personnelles`) cumulent 820 tests verts et 1 sauté normal.
TypeScript racine, ESLint sur les fichiers neufs et `git diff --check` sont tous à zéro anomalie.
Les 3 ajustements assumés par Opus sont rigoureusement documentés, testés, et sans aucun impact drapeau éteint.
Reste ouvert pour l'étape 3 : le choix définitif du profil `copine` de référence et l'arbitrage sur l'oubli de mémoire.

VERDICT: PUSHABLE
