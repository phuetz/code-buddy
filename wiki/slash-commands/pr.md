# /pr

[Accueil](Home.md) · [Wiki interactif](index.html#pr)

Créer une demande de fusion GitHub ou GitLab.

## Syntaxe du catalogue

```text
/pr [title]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| title | Non | PR title (auto-generated if omitted). Use --draft for draft PR. |

## Recette : VALIDATION\_SEULE

```text
/pr --draft
```

garde-fou de branche git (interdiction de créer une PR sur la branche master).

Attendu : Affichage du sélecteur ou validation des arguments/prérequis ; action complète non validée.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/pr/terminal.txt)

## Invocation prévue

```text
/pr --draft
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Create a GitHub/GitLab PR from the current branch
