# Catalogue d'outils — corrections après la vérification de Jules

Branche locale `integration/catalogue-outils-2026-09-23`, base `acbfc69f891dbffb505103d3bcd5d25131da08be`.
Aucun push, aucune fusion. Livraison et preuves :
`Partage/20260923-reprise-pilotage-opus/lot13-catalogue-jules-suite/corrections`.

## Commits

| Commit | Sujet |
|---|---|
| `bc351986d` | fix(diagram): garder la flèche ASCII et ne pas créer .codebuddy |
| `65a483033` | fix(codebase-map): respecter la racine demandée sans plafond |
| `0cd16bc83` | fix(skills): supprimer une compétence de l'espace de travail |
| `4545f614e` | fix(sbom): dater le SBOM au moment de la génération |
| `4af6715f1` | fix(export): compter la taille exportée en octets |
| `d8504d4fc` | test(catalogue): verrouiller les effets des outils de Jules |
| `8d6b19fac` | test(catalogue): conserver les tests de Jules déjà verrouillés |
| `f6294e58e` | docs(catalogue): noter la branche et les preuves du lot 13 |
| `09aefb6c5` | style(catalogue): retirer les espaces de fin des tests de Jules |

## Hors périmètre

`skill_discover` interroge un hub distant. Le réseau de la barrière est coupé.
Aucun correctif n'essaie de le joindre. Le classement reste `PARTIEL`.

## Preuve

Barrière Docker `--network none`, 55 contrôles, canaris hôte `bad=0`.
Les 8 fichiers de tests du catalogue : 28 tests verts.
Treize mutants, un par test durci, font chacun échouer une assertion précise.
Suite voisine : 116 tests verts sur le candidat, 115 sur `origin/main` seul
(l'écart est le test ASCII ajouté). Aucun échec des deux côtés.
