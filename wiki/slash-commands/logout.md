# /logout

[Accueil](Home.md) · [Wiki interactif](index.html#logout)

Effacer les identifiants enregistrés du fournisseur.

## Syntaxe du catalogue

```text
/logout [provider]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| provider | Non | chatgpt (default) \| gemini |

## Recette : TESTE\_LOCAL

```text
/logout chatgpt
```

déconnexion en l'absence d'identifiants sur le disque.

Attendu : Suppression locale des identifiants stockes pour le fournisseur

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/logout/terminal.txt)

## Invocation prévue

```text
/logout chatgpt
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Clear stored credentials for a provider
