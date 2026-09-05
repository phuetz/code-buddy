# Bilan — `buddy improve digest`

Date : 2026-08-16

Branche : `feat/improve-digest-2026-08-16`

Commit de fonctionnalité : `c75e44a9` (`feat(improve): add shareable self-improvement digest`)

Publication distante : aucune (`git push` non exécuté)

## Livré

- `buddy improve digest` produit par défaut un résumé Markdown lisible de la période glissante des sept derniers jours.
- `--since <durée-ou-date>` accepte notamment `7d`, `24h`, `2w`, `30m` et une date ISO passée. La borne de début est inclusive.
- `--json` expose la structure versionnée `self_improvement_digest` pour les consommateurs machine.
- `--html <fichier>` écrit une carte HTML autonome et responsive, sans CDN, script, image, police ou ressource réseau. Une Content Security Policy locale interdit les chargements externes.
- L'agrégateur pur `src/agent/self-improvement/digest.ts` reçoit ses sources par injection et ne réalise aucune I/O. Il déduplique les artifacts, filtre la période, reconstruit les nouvelles leçons et calcule les deltas de benchmark.
- `src/agent/self-improvement/digest-sources.ts` réalise séparément les lectures best-effort de l'archive, du learning-store git, de l'historique du benchmark, des tools authored et des skills authored/importées.
- Le learning-store expose désormais une vue en lecture seule de ses snapshots historiques ; le loop Darwin–Gödel et ses gates ne sont pas modifiés.
- Si aucune source n'existe ou si elles sont vides, les trois formats indiquent honnêtement « Rien à rapporter » et retournent des compteurs nuls.

## Sémantique des agrégats

- Les noms de tools et skills sont uniques sur la période.
- Une leçon est comptée lorsqu'elle apparaît pour la première fois dans un snapshot de la période ; une leçon déjà présente avant la borne n'est pas recomptée.
- Les scénarios d'un même run de benchmark sont moyennés avant comparaison. Le début est la dernière mesure antérieure à la période lorsqu'elle existe, sinon la première mesure de la période ; la fin est la dernière mesure de la période.
- Le delta de benchmark est exprimé à la fois comme ratio (`delta`) et en points de pourcentage (`deltaPercentPoints`). Une seule mesure sans baseline conserve le score mais annonce un delta indisponible.
- Les artifacts qui n'ont aucun timestamp dans leur format persistant utilisent la date du fichier comme repli. Le digest marque cette estimation dans `notes`.
- Tous les textes issus des sources passent par le scrubber central de secrets ; le rendu HTML échappe ensuite chaque valeur interpolée.

## Limite connue, affichée dans le produit

Le schéma v1 de `archive.json` conserve uniquement les améliorations appliquées. Les cycles sans application et leurs gates rejetées ne sont pas persistés par le loop actuel. La contrainte interdisant de modifier ce loop est respectée : avec les sources réelles v1, `cycles.complete` et `gates.complete` valent `false`, les comptes sont présentés comme des minima observés et une note explicite accompagne le digest.

L'agrégateur accepte aussi un ledger injecté `all-cycles` plus riche : les tests prouvent alors le comptage exact des gates passées/rejetées et des raisons de rejet. Il est donc prêt à exploiter un futur historique complet sans changer son contrat.

`src/export/session-share.ts` n'est pas appelé directement : son modèle d'entrée est une session de conversation, pas un digest. L'export conserve le même contrat de sûreté (fichier unique, styles inline, zéro réseau, CSP) et réutilise le scrubber central commun.

## Vérifications exécutées

Suite globale de quelque 27 000 tests non lancée, conformément à la consigne de tests ciblés.

```text
$ npm run typecheck
> @phuetz/code-buddy@1.8.0 typecheck
> tsc --noEmit && npm run typecheck:gpuNode-identity

> @phuetz/code-buddy@1.8.0 typecheck:gpuNode-identity
> tsc --project tsconfig.gpuNode-identity.json
```

Résultat : exit 0.

```text
$ npm test -- tests/agent/self-improvement tests/self-improvement/continuous-benchmark.test.ts tests/commands/improve-digest.test.ts
Test Files  32 passed (32)
Tests       219 passed (219)
Duration    1.55s
```

Résultat : exit 0. Le périmètre couvre l'agrégateur, le learning-store, l'historique benchmark, la commande et le reste du sous-système self-improvement associé.

Contrôles complémentaires :

- tests strictement nouveaux/modifiés : 3 fichiers, 16 tests, exit 0 ;
- ESLint ciblé sur les fichiers TypeScript touchés : exit 0 ;
- Prettier ciblé sur les nouveaux fichiers : tous conformes ;
- `git diff --check` : exit 0 ;
- smokes réels via `npm run dev:node` : aide de la commande, Markdown vide, JSON vide et génération HTML autonome, exit 0.

## État du worktree

`node_modules` non suivi était présent avant le chantier. Il est resté hors commits et n'a pas été modifié volontairement. Aucun push n'a été exécuté.
