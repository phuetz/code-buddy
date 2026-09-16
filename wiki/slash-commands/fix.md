# /fix

[Accueil](Home.md) · [Wiki interactif](index.html#fix)

Corriger les erreurs de lint et vérifier les types.

## Syntaxe du catalogue

```text
/fix
```

Le catalogue ne détaille pas les arguments de cette commande ; cela ne signifie pas qu’elle n’en accepte aucun.

## Recette : BLOQUE\_PREREQUIS

```text
/fix
```

La commande répond après attente : ESLint échoue car la fixture ne possède pas de configuration de lint. npx télécharge ESLint dans le profil temporaire ; aucune correction de code validée.

Attendu : Correction automatique des erreurs de linting et verification des types

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/replays-async/cases/fix/terminal.txt)

## Invocation prévue

```text
/fix
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Auto-fix lint errors and check for type errors
