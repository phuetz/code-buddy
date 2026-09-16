# /elevated

[Accueil](Home.md) · [Wiki interactif](index.html#elevated)

Configurer les opérations privilégiées.

## Syntaxe du catalogue

```text
/elevated [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | on \[duration-min\], off, status, grants, revoke \<id\> |

## Recette : TESTE\_LOCAL

```text
/elevated status
```

consultation du statut des privilèges et permissions élevées.

Attendu : Affichage du statut des privileges et permissions elevees

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/elevated/terminal.txt)

## Invocation prévue

```text
/elevated status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Toggle elevated permission mode (sudo-like for privileged operations)
