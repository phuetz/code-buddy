# /init

[Accueil](Home.md) · [Wiki interactif](index.html#init)

Initialiser la configuration du projet et son fichier AGENTS.md.

## Syntaxe du catalogue

```text
/init
```

Le catalogue ne détaille pas les arguments de cette commande ; cela ne signifie pas qu’elle n’en accepte aucun.

## Recette : TESTE\_LOCAL

```text
/init
```

Le replay termine en environ 60 secondes et AGENTS.md existe sur disque. Le premier délai de 45 secondes était insuffisant ; exactitude complète du guide non validée.

Attendu : Creation deterministe du dossier .codebuddy et du fichier AGENTS.md

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/replays/cases/init/terminal.txt)

## Invocation prévue

```text
/init
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Scaffold .codebuddy, then analyze the repo and write a tailored AGENTS.md (use \`--fast\` for the deterministic template only)
