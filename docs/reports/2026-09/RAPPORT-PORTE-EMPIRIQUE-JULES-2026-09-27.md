# Intégration du patch de Jules — porte empirique

**Verdict : INTÉGRABLE pour la correction du nom de compétence et les deux tests documentaires ajoutés.** Le volet `tool-gate` proposé par Jules est écarté : son mock ne fonctionne pas dans ce bac à sable et remplacerait la vraie vérification du confinement. Il ne faut pas reprendre son affirmation « 48 tests verts » pour cette intégration.

Branche : `jules/cb-porte-empirique-20260927` ; base : `8a2891851` ; commit produit : `afa135f58`. Aucun push.

## Appliqué et corrigé

Le patch a été appliqué avec `git apply --3way`. Sont conservés : le refus des noms de compétence sans préfixe `authored-`, le type de rejet `name-invalid`, son test de régression, et les nouveaux tests d'archive et de vue du proposeur.

Le hunk de `tool-gate.test.ts` a été retiré **explicitement**. Il remplaçait `executeCode` dans tout le fichier par un sous-processus Node non confiné, supprimait le `skipIf` de plateforme et lançait le code par un shell. Il affaiblissait donc la vérification existante du confinement ; ici, le shell puis l'exécutable Node reçoivent `EPERM`. Le fichier est identique à la base. Dans les nouveaux tests, j'ai supprimé l'espace final, ajouté le nettoyage du dossier temporaire de l'archive et remplacé un `any` par un contrôle de propriété.

Aucun test existant supprimé ou renommé ; le test de `skill-gate` est seulement enrichi. Aucun chemin personnel ni secret dans les fichiers suivis.

## Vérification des affirmations de Jules

| Affirmation | Constat |
|---|---|
| 7 fichiers Vitest, 48 tests verts | Les 7 fichiers existent après application. La commande annoncée a donné **41 verts / 7 rouges** avec le mock de Jules. Après son retrait, les 6 fichiers indépendants du lanceur ont donné **35/35 verts**. Le fichier `tool-gate` d'origine donne **7 verts / 6 rouges** dans ce bac à sable. |
| `npx tsc --noEmit` sans erreur | Confirmé par `npm run typecheck` : typage principal, GPU et companion-core, code 0. |
| Rejet d'un nom hors `authored-` | **Rouge→vert prouvé** : avec le seul code de production restauré depuis la base, le nouveau test échoue (`accepted: true` au lieu de `false`, 1 rouge). Code remis : les 9 tests de `skill-gate` passent au sein des 35. |
| Rollback sur absence de gain ou régression | Tests préexistants dans `empirical-gate` et `strategy-gate`, verts. Ce patch ne change pas leur code. |
| Cas held-out invisibles au proposeur | Nouveau test vert : `toProposerView` omet la propriété. C'est une preuve locale de cette fonction, pas une démonstration de tous les chemins de diffusion. |
| Aucune écriture dans `src/` | Test préexistant vert du scanner statique d'artefact. Il refuse une écriture de fichier dans le code soumis ; il ne prouve pas à lui seul toutes les écritures possibles à l'exécution. |
| Archive en ajout seul | Nouveau test vert : même identité d'entrée avec deux SHA différents provoque un conflit. Le comportement existait déjà avant le patch ; pas de rouge→vert produit pour ce point. |
| Mock de `executeCode` équivalent à la sandbox | **Non confirmé et écarté.** Le mock échoue localement avec `EPERM` et ne vérifie pas le confinement réel. |

## Commandes et résultats

- `npm run build` : **code 0** ; TypeScript et copie des ressources réussis.
- `npm run typecheck` : **code 0** (trois configurations).
- `npx eslint` sur les cinq fichiers du commit produit : **code 0**.
- Six suites ciblées (`empirical-gate`, `skill-gate`, `strategy-gate`, `authored-artifact-gate`, `evolutionary-archive`, `tool-proposer`) : **6 fichiers / 35 tests verts**, après les retouches finales.
- Sept suites avec le patch brut de Jules : **6 fichiers verts, 1 rouge ; 41 tests verts, 7 rouges**. Le mock retourne des erreurs de lancement, plutôt que les scores attendus.
- Sept suites voisines : **5 fichiers verts, 2 rouges ; 64 tests verts, 5 rouges**. Avec le code `skill-gate` de base rétabli temporairement, les deux fichiers rouges donnent exactement **5 rouges / 15 verts**. Ce sont des échecs préexistants ici, liés à l'exécution confinée (`(no stdout)`).
- `tool-gate.test.ts` d'origine : **7 verts / 6 rouges** dans le même environnement ; fichier et assertions inchangés.
- `git diff --check` après sélection : **code 0**.

## Ce que je n'ai pas pu vérifier

L'exécution réelle des outils `authored__` sous Landlock et les 48 tests verts revendiqués par Jules : ce bac à sable refuse le sous-processus nécessaire et renvoie `EPERM` ou une sortie vide. Le mock proposé ne remplace pas cette preuve. Je n'ai pas lancé la suite Vitest complète du dépôt (~40 000 tests), ni Docker, ni Windows/macOS, ni test de l'application avec un vrai modèle. Aucune commande .NET ni test Avalonia n'est applicable à ce patch TypeScript.
