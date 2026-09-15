# /voice-code

[Accueil](Home.md) · [Wiki interactif](index.html#voice-code)

Configurer la conversion de la voix en commandes ou en code.

## Syntaxe du catalogue

```text
/voice-code [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | on, off, status |

## Recette : TESTE\_LOCAL

```text
/voice-code status
```

/voice-code status (consultation de l'état inactif du pipeline vocal).

Attendu : Statut du pipeline voice-to-code

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/voice-code/terminal.txt)

## Invocation prévue

```text
/voice-code status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Control voice-to-code pipeline (speech to commands/code)
