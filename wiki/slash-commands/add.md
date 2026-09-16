# /add

[Accueil](Home.md) · [Wiki interactif](index.html#add)

Ajouter des fichiers au contexte.

## Syntaxe du catalogue

```text
/add <pattern>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| pattern | Oui | File path or glob pattern (e.g., src/\*\*/\*.ts) |

## Recette : TESTE\_LOCAL

```text
/add package.json
```

ajout d'un fichier existant au contexte de conversation.

Attendu : Ajout du fichier specifie au contexte de conversation actif

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/add/terminal.txt)

## Invocation prévue

```text
/add package.json
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Add files to the current context
