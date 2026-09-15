# /hooks

[Accueil](Home.md) · [Wiki interactif](index.html#hooks)

Gérer les actions déclenchées autour des opérations.

## Syntaxe du catalogue

```text
/hooks [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | list, enable \<name\>, disable \<name\>, add, status |

## Recette : TESTE\_LOCAL

```text
/hooks list
```

/hooks list (inventaire des 5 hooks enregistrés désactivés).

Attendu : Liste des hooks de cycle de vie

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/hooks/terminal.txt)

## Invocation prévue

```text
/hooks list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage lifecycle hooks (pre/post edit, commit, etc.)
