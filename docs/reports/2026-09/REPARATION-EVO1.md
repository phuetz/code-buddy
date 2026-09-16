# Réparation EVO1 — Notes de version auto-réflexives

## État initial

- Date : 2026-09-03
- Clone de travail : `cb-succes-context-2026-09-02`
- Branche demandée : `feat/evo1-notes-de-version-2026-09-03`
- Mission : rendre les évolutions de Code Buddy/Lisa lisibles par le self-model, l’outil, le contexte compagnon et la boucle Darwin-Gödel, avec des fonctionnalités opt-in et un défaut inchangé.
- Contraintes : aucun push, aucune API payante, aucun service systemd, aucune écriture hors du clone ou dans `~/.codebuddy`, dépôt original `~/code-buddy` interdit, pas de données personnelles.

## Journal

| Étape | État | Preuve / résultat |
|---|---|---|
| Rapport initial créé avant inspection | fait | Ce fichier |
| Coordination Fable 5 lue et chantier réservé | fait | Ligne EVO1 ajoutée dans `docs/FABLE5-CODEX-COORDINATION.md` |
| Modèle de notes et cache | fait | `feat(self-model): parse and cache evolution notes` — `e78fd2627`; parseur fixture + cache invalidé par mtime/taille, date de la note robot normalisée au 03/09 |
| Outil et commandes CLI | fait | `feat(cli): expose self evolution notes` — `947e47556`; `self_evolution`, registres, métadonnées sans `fleetSafe`, `buddy changelog --self`, `buddy self evolution` |
| Intégration Lisa opt-in | fait | `feat(companion): let Lisa report documented evolution` — `0b92a5489`; opt-in, trois lignes maximum, première personne, garde d’invitation et réponse orale factice |
| Source Darwin-Gödel opt-in | fait | `feat(self-improvement): feed evolution notes to the engine` — `7bb60ada5`; source `evolution-notes`, contexte réparé/pourquoi, archive `provenance: changelog`, invariant `src/` |
| Documentation | fait | `docs/self-evolution.md` + variables ajoutées à `CLAUDE.md` |
| Typecheck, lint et tests ciblés | fait | 180 fichiers / 1 764 tests voisins verts ; typecheck principal + GPU vert ; lint complet 0 erreur (2 474 warnings préexistants), lint ciblé vert |
| Commits conventionnels par lot | fait | Quatre commits fonctionnels conventionnels : `e78fd2627`, `947e47556`, `0b92a5489`, `7bb60ada5`, plus le lot documentaire final contenant ce rapport |
| Artefacts de test nettoyés | fait | Deux worktrees locaux créés par les tests `/worktree` (`branch/`, `feature-branch/`) retirés après contrôle de leur provenance ; branches locales supprimées |

## Vérifications

- `npx vitest run tests/self-model/evolution-notes.test.ts` — premier essai bloqué par l’environnement : `vitest` absent du clone (`ERR_MODULE_NOT_FOUND`) ; après installation locale des dépendances, le fichier a été inclus dans la suite EVO1 verte ci-dessous.
- `npm ci --ignore-scripts --no-audit --no-fund` — dépendances du clone installées, sans modification de `package.json` ni de `package-lock.json`.
- `npm run typecheck` — **vert**, `tsc --noEmit` puis `tsconfig.gpuNode-identity.json`.
- Tests EVO1 + voisins immédiats — **208/208 verts** sur 9 fichiers ; `tests/agent/self-improvement/experience-source.test.ts`, `tests/commands/changelog.test.ts` et `tests/commands/improve-digest.test.ts` — **18/18 verts**.
- `npx vitest run tests/self-improvement tests/companion tests/commands` — **180 fichiers, 1 764 tests verts**.
- `npm run lint` — **sortie 0**, 0 erreur et 2 474 avertissements préexistants ; lint ciblé des fichiers touchés — sortie 0.
- `./node_modules/.bin/tsx src/index.ts self evolution --since 2026-09-02 --limit 1` — sortie CLI réelle correcte, exit 0, sans API ni service.
- `git diff --check` — vert avant chaque commit ; aucun push, aucun service systemd et aucun dépôt original touché.
- `git status --short --branch` et `git worktree list` — clone final propre, un seul worktree sur `feat/evo1-notes-de-version-2026-09-03`.

## Décisions et limites

- Les notes sont dérivées du CHANGELOG existant ; le parseur conserve une représentation structurée et privacy-safe, mais les faits peuvent rester longs côté CLI pour ne pas perdre l’information documentée.
- Lisa ne reçoit les trois lignes que lorsque `CODEBUDDY_COMPANION_SELF_EVOLUTION=true` et le contexte relationnel est actif. La voie vocale spécialisée répond uniquement à une invitation explicite et ne fait pas appel à un second résumé génératif.
- La source Darwin-Gödel est inactive par défaut. Lorsqu’elle est active, elle enrichit le proposer et son archive ; elle ne reçoit aucune autorité d’écriture sur `src/`.
