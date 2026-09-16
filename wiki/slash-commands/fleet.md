# /fleet

[Accueil](Home.md) · [Wiki interactif](index.html#fleet)

Découvrir, interroger et piloter les pairs Code Buddy.

## Syntaxe du catalogue

```text
/fleet [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | listen \<ws-url\> \[--api-key \<key\>\] \| stop \| status |

## Recette : TESTE\_LOCAL

```text
/fleet status
```

/fleet status (branche statut vide / aucun écouteur actif).

Attendu : Statut du recepteur de streaming inter-buddy fleet

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/fleet/terminal.txt)

## Invocation prévue

```text
/fleet status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Inter-Claude live streaming receiver (listen/stop/status) — connects to a peer Code Buddy WS and streams fleet:\* events. Requires apiKey with fleet:listen scope.
