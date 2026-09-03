# Réparation PACK1 — Sécurisation du contenu du paquet npm (pack contents policy)

Date : 2026-09-03
Branche : `fix/pack1-2026-09-03`
Dépôt de travail : `~/DEV/cb-pack1-2026-09-03`

---
## Objectifs de la mission
1. `src/security/pack-contents-policy.ts` — une fonction pure `auditPackContents(files: string[], options?: PackPolicyOptions)` avec règles explicites :
   - (a) Préfixes autorisés dérivés de `package.json` (`files`) et fichiers métadonnées implicites npm.
   - (b) Interdictions strictes : `*.map`, `.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `*.sqlite`, `*.jsonl`, `.codebuddy/`, `tests/`, `src/`, `cowork/`, `.github/`, `_qa/`, `scripts/`.
   - (c) Motifs de données personnelles / infrastructure privée (réutilisation des motifs de `tests/security/donnees-personnelles.test.ts`).
2. `tests/security/npm-pack-contents.test.ts` — suite de tests unitaires et d'intégration réelle (`npm pack --dry-run --json --ignore-scripts`), prouvant l'exclusion des `.map` et provoquant un ROUGE si `**/*.js.map` est commenté dans `.npmignore`.
3. Script `"check:pack"` dans `package.json` et inclusion dans `"validate"`.
4. Validation stricte : `vitest`, `tsc --noEmit -p .`, `eslint`, `donnees-personnelles.test.ts`.

---
## Fichiers lus en entier (avec nombre de lignes)
- `tests/security/donnees-personnelles.test.ts` : 88 lignes (87 sans saut final)
- `package.json` : 295 lignes (294 initialement)
- `.npmignore` : 92 lignes (91 sans saut final)
- `~/DEV/lecture-comparative-2026-09-03/codex/codex-cli/package.json` : 23 lignes (22 sans saut final)
- `~/DEV/lecture-comparative-2026-09-03/gemini-cli/packages/cli/package.json` : 92 lignes (91 sans saut final)
- `scripts/strip-sourcemaps.mjs` : 50 lignes (49 sans saut final)
- `src/security/index.ts` : 510 lignes

---
## Démarche TDD & Journal des sorties

### 1. Test unitaire initial (Rouge avant implémentation)
Commande : `npx vitest run tests/security/npm-pack-contents.test.ts`
Code de sortie : `1`
Sortie :
```text
 RUN  v4.1.9 ~/DEV/cb-pack1-2026-09-03

 ❯ tests/security/npm-pack-contents.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/security/npm-pack-contents.test.ts [ tests/security/npm-pack-contents.test.ts ]
Error: Cannot find module '../../src/security/pack-contents-policy.js' imported from ~/DEV/cb-pack1-2026-09-03/tests/security/npm-pack-contents.test.ts
 ❯ tests/security/npm-pack-contents.test.ts:6:1
      4| import { join } from 'path';
      5| import { tmpdir } from 'os';
      6| import {
       | ^
      7|   auditPackContents,
      8|   DEFAULT_ALLOWED_PREFIXES,

 Test Files  1 failed (1)
      Tests  no tests
   Start at  15:36:21
   Duration  139ms
```

### 2. Implémentation de `src/security/pack-contents-policy.ts`
Fichier créé : `src/security/pack-contents-policy.ts` (167 lignes)
- Lignes 29-40 : `DEFAULT_ALLOWED_PREFIXES`
- Lignes 45-66 : `FORBIDDEN_DIRECTORIES` et `FORBIDDEN_PATTERNS` (`*.map`, `.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `*.sqlite`, `*.jsonl`)
- Lignes 72-83 : `FORBIDDEN_PERSONAL_PATTERNS` avec construction tokenisée évitant tout motif brut dans le dépôt
- Lignes 89-166 : Fonction pure `auditPackContents(files, options)` validant les règles (a), (b) et (c)

### 3. Test de régression `.map` exclu via `.npmignore` (Rouge provoqué puis Vert)
Pour prouver que le test d'intégration détecte bien l'absence d'exclusion des `.map` :
1. Altération temporaire dans `.npmignore` (commentaire de la règle `**/*.js.map`).
2. Exécution du test `npx vitest run tests/security/npm-pack-contents.test.ts` :

Sortie Rouge obtenue :
```text
 RUN  v4.1.9 ~/DEV/cb-pack1-2026-09-03

 ❯ tests/security/npm-pack-contents.test.ts (9 tests | 1 failed) 1120ms
     × prouve que .npmignore exclut bien les .map et que leur présence fait échouer l’audit 129ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/security/npm-pack-contents.test.ts > Pack Contents Policy - Intégration réelle npm pack & .npmignore > prouve que .npmignore exclut bien les .map et que leur présence fait échouer l’audit
AssertionError: expected [ 'dist/index.js', …(2) ] to not include 'dist/index.js.map'
 ❯ tests/security/npm-pack-contents.test.ts:173:36
    171|
    172|       expect(packedWithIgnore).toContain('dist/index.js');
    173|       expect(packedWithIgnore).not.toContain('dist/index.js.map');
       |                                    ^
    174|
    175|       const auditWithIgnore = auditPackContents(packedWithIgnore);

 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
   Duration  1.27s
```
3. Restauration immédiate de `.npmignore` via `git checkout .npmignore`.
4. Ré-exécution validée : 10/10 tests passés (Vert).

---
## Vérifications et Commandes

### 1. `npx vitest run tests/security/npm-pack-contents.test.ts tests/security/donnees-personnelles.test.ts`
Code de sortie : `0`
```text
 RUN  v4.1.9 ~/DEV/cb-pack1-2026-09-03

 Test Files  2 passed (2)
      Tests  11 passed (11)
   Duration  4.73s
```

### 2. `npm run check:pack`
Code de sortie : `0`
```text
> @phuetz/code-buddy@2.0.0 check:pack
> vitest run tests/security/npm-pack-contents.test.ts

 RUN  v4.1.9 ~/DEV/cb-pack1-2026-09-03

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  1.39s
```

### 3. `npx tsc --noEmit -p .`
Code de sortie : `0` (aucune erreur de typage)

### 4. `npx eslint src/security/pack-contents-policy.ts src/security/index.ts tests/security/npm-pack-contents.test.ts`
Code de sortie : `0` (0 erreur, 0 warning)

---
## Commit réalisé
- `feat(security): audit pack contents to prevent map and secret leaks in npm tarball` (commit sur branche `fix/pack1-2026-09-03`)

---
## Points d'architecture & Ce qui reste ouvert
- **Double ligne de défense npm pack / source maps** :
  npm privilégie le champ `"files"` dans `package.json` au détriment du `.npmignore` racine pour les sous-répertoires listés (ex: `"dist"` inclut par défaut `dist/*.js.map` lors d'un `npm pack` sans pré-traitement).
  Le projet Code Buddy combine ainsi :
  1. `prepack` (`scripts/strip-sourcemaps.mjs`) qui supprime physiquement les `.map` avant packaging.
  2. `.npmignore` avec `**/*.js.map`.
  3. Le nouveau garde-fou automatisé `auditPackContents` + test `npm-pack-contents.test.ts` qui audite exhaustivement le contenu du tarball lors de `npm run check:pack` et `npm run validate`.

---
## Bilan (10 lignes)
1. Création de `src/security/pack-contents-policy.ts` avec la fonction pure `auditPackContents`.
2. Règles strictes d'audit implémentées : préfixes autorisés, blocage `.map`, `.env*`, clés, certificats, SQLite, JSONL, répertoires sources/tests/cowork/qa/scripts, et motifs personnels.
3. Suite de tests de sécurité livrée dans `tests/security/npm-pack-contents.test.ts` (10 tests unitaires et intégration).
4. Intégration réelle testée via `npm pack --dry-run --json --ignore-scripts` (sans écriture de tarball).
5. Preuve formelle de détection des `.map` avec test rouge documenté lors du retrait de la règle `.npmignore`.
6. Ajout du script npm `"check:pack"` et intégration dans la chaîne `"validate"` dans `package.json`.
7. Ré-export propre du module dans `src/security/index.ts`.
8. Validation `vitest` : 11/11 tests passés (`npm-pack-contents.test.ts` + `donnees-personnelles.test.ts`).
9. Validation outillage : `tsc --noEmit -p .` (code 0) et `eslint` (0 erreur, 0 avertissement).
10. Dépôt principal et services système préservés sans aucune écriture non autorisée ni appel réseau.
