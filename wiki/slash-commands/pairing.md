# /pairing

[Accueil](Home.md) · [Wiki interactif](index.html#pairing)

Gérer les autorisations de contact des canaux de messagerie.

## Syntaxe du catalogue

```text
/pairing [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | status, approve \<code\>, revoke \<id\>, list, pending |

## Recette : TESTE\_LOCAL

```text
/pairing status
```

consultation du statut de l'appairage direct des canaux de messagerie.

Attendu : Affichage de l'etat de l'appairage direct des canaux de messagerie

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/pairing/terminal.txt)

## Invocation prévue

```text
/pairing status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage DM pairing security for messaging channels
