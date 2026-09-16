# /loop

[Accueil](Home.md) · [Wiki interactif](index.html#loop)

Poursuivre un objectif avec une vérification indépendante.

## Syntaxe du catalogue

```text
/loop [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | \<text\> to start a dev-loop, or status, pause, resume, clear |

## Recette : TESTE\_LOCAL

```text
/loop status
```

consultation du statut de la boucle de développement en l'absence d'objectif actif.

Attendu : Affichage du statut de la boucle de developpement et du verificateur

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/loop/terminal.txt)

## Invocation prévue

```text
/loop status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Dev-loop: /goal + an independent Verifier gate (a judge "done" only passes once the Verifier CONFIRMS): /loop \<text\> \| status \| pause \| resume \| clear
