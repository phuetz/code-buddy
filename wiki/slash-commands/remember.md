# /remember

[Accueil](Home.md) · [Wiki interactif](index.html#remember)

Enregistrer une information dans la mémoire persistante.

## Syntaxe du catalogue

```text
/remember <key> <value>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| key | Oui | Key for the memory |
| value | Oui | Value to remember |

## Recette : PARTIEL

```text
/remember test_key test_valeur
```

La clé test\_key et la valeur test\_valeur sont réellement persistées dans la mémoire du projet. La première exécution signale toutefois un échec de réconciliation des faits ; cet aspect reste à corriger ou diagnostiquer.

Attendu : Enregistrement d'une paire cle-valeur dans la memoire persistante

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/replays-memory/cases/remember/terminal.txt)

## Invocation prévue

```text
/remember test_key test_valeur
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Store something in persistent memory
