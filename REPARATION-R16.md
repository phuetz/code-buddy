# MISSION R16 — Réparation de l’import de skills

Date : 2026-09-02 (Europe/Paris)
Dépôt : `/home/patrice/DEV/cb-repar-skills-import-2026-09-02`
Branche : `fix/repar-skills-import-2026-09-02`

## Périmètre et garde-fous

Réparation minimale des trois défauts mesurés dans `AUDIT-A-REPARER.md` :

1. quarantaine des motifs d’exécution distante dans `SKILL.md` et les scripts ;
2. retour de `skills import --apply` après rechargement ;
3. cohérence import → list → delete/uninstall et échec explicite si introuvable.

Contraintes appliquées : aucun appel LLM, aucun réseau, aucune exécution de script
importé, aucun service touché, aucun changement de
`docs/FABLE5-CODEX-COORDINATION.md`. Les fichiers non suivis préexistants sont
laissés hors périmètre.

## État initial

Audit lu intégralement. État Git initial : branche dédiée ; `AUDIT-A-REPARER.md`
et `node_modules` non suivis déjà présents.

## Point 1 — Pare-feu

### Rouge

Commande :

```text
npx vitest run tests/security/skill-scanner.test.ts --reporter=verbose
```

Sortie avant correctif : `1 failed, 59 passed` ; la fixture distante recevait
`expected 'review' to be 'quarantine'`.

### Correctif et vert

Ajout des motifs critiques pour `curl|wget | sh|bash`, `bash -c ... curl`,
PowerShell `iwr | iex` et `eval $(...)`. La récursion scanne aussi les fichiers
placés sous `scripts/` et les extensions de scripts courantes. Fixtures ajoutées
dans le scanner et l’import ; aucun script importé n’est exécuté.

Commande et sortie :

```text
npx vitest run tests/skills/skill-importer.test.ts tests/security/skill-scanner.test.ts
Test Files  2 passed (2)
Tests  78 passed (78)
```

Commit : `19bc850b9` — `fix(skills): renforcer le pare-feu des imports`.

## Point 2 — Commande qui pend

### Rouge

Commande :

```text
npx vitest run tests/skills/skill-import-command-lifecycle.test.ts --reporter=verbose
```

Sortie avant correctif : après `4586ms`, le smoke CLI échouait avec
`spawnSync ... node ETIMEDOUT` (la limite de 4,5 s était atteinte).

### Correctif et vert

Le handler ferme `SkillRegistry`’s watchers après le rechargement et avant le
retour du rapport. La sonde `process.getActiveResourcesInfo()` confirme
l’absence de `FSWatcher` au retour.

Commande et sortie :

```text
npx vitest run tests/skills/skill-import-command-lifecycle.test.ts tests/skills/skill-importer.test.ts
Test Files  2 passed (2)
Tests  20 passed (20)
Duration  631ms
```

Le smoke CLI réel revient en environ `0,5 s`, bien sous 5 s.

Commit : `c51414129` — `fix(skills): fermer les watchers après import`.

## Point 3 — Registre, suppression et uninstall

### Rouge

Commande :

```text
npx vitest run tests/skills/skill-import-command-lifecycle.test.ts --reporter=verbose
```

Sortie avant correctif : `2 failed, 2 passed` ; `skills list` retournait une
liste vide et `hub uninstall missing-r16-skill` retournait `0` au lieu de `1`.

### Correctif et vert

Après écriture, l’import enregistre chaque `SKILL.md` du root utilisateur via
`SkillsHub.registerLocalSkillFile()`. Le lockfile devient la provenance de
gestion commune ; `uninstall()` supprime le répertoire basé sur le chemin
enregistré, et `hub uninstall` quitte avec le code 1 si l’entrée est absente.

Commande et sortie :

```text
npx vitest run tests/skills/skill-import-command-lifecycle.test.ts tests/skills/skill-importer.test.ts tests/skills/hub.test.ts
Test Files  3 passed (3)
Tests  107 passed (107)
```

Ce correctif constitue le troisième commit thématique de la mission.

## Vérifications finales

Commandes et sorties :

```text
npx vitest run tests/skills/skill-import-command-lifecycle.test.ts tests/skills/skill-importer.test.ts tests/skills/hub.test.ts tests/security/skill-scanner.test.ts
Test Files  4 passed (4)
Tests  167 passed (167)
Duration  1.09s

npm run typecheck
> @phuetz/code-buddy@2.0.0 typecheck
> tsc --noEmit && npm run typecheck:darkstar-identity
> @phuetz/code-buddy@2.0.0 typecheck:darkstar-identity
> tsc --project tsconfig.darkstar-identity.json
exit 0

npx eslint src/security/skill-scanner.ts src/skills/skill-importer.ts src/skills/hub.ts src/commands/skills-cli/index.ts src/commands/cli/native-engine-commands.ts tests/security/skill-scanner.test.ts tests/skills/skill-importer.test.ts tests/skills/skill-import-command-lifecycle.test.ts
exit 0

git diff --check
exit 0
```

La suite complète `npm test` n’est pas lancée, conformément à la mission.

## Bilan

- Pare-feu : les pipelines de téléchargement/exécution distants sont quarantainés dans le Markdown et les scripts.
- Cycle : l’import appliqué rend la main en moins de 5 s et ne laisse plus de `FSWatcher` actif.
- Registre : chaque import appliqué est inscrit dans le lockfile consommé par `skills list`.
- Nettoyage : `skills delete` et `hub uninstall` suppriment le chemin enregistré ; l’absence de skill vaut exit 1.
- Preuves : 4 fichiers de tests ciblés, 167 tests verts ; typecheck, ESLint ciblé et diff-check verts.
- Commits : `19bc850b9`, `c51414129`, puis le commit thématique du point 3.
- Restent hors périmètre : `AUDIT-A-REPARER.md`, `node_modules` et le fichier de coordination gelé.
