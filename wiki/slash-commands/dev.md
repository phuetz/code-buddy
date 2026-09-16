# /dev

[Accueil](Home.md) · [Wiki interactif](index.html#dev)

Exécuter les workflows de développement guidés.

## Syntaxe du catalogue

```text
/dev [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | plan \<objective\>, run \<objective\>, pr \<objective\>, fix-ci, status |

## Recette : TESTE\_LOCAL

```text
/dev status
```

/dev status (consultation de l'état du workflow de développement).

Attendu : Statut des workflows de developpement golden-path

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/dev/terminal.txt)

## Invocation prévue

```text
/dev status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Golden-path developer workflows (plan, run, pr, fix-ci, status)
