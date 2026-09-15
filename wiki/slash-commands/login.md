# /login

[Accueil](Home.md) · [Wiki interactif](index.html#login)

Se connecter à un fournisseur.

## Syntaxe du catalogue

```text
/login [provider]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| provider | Non | chatgpt (default) \| gemini |

## Recette : VALIDATION\_SEULE

```text
/login qa-unsupported-provider
```

validation de l'argument provider non supporté.

Attendu : Affichage du sélecteur ou validation des arguments/prérequis ; action complète non validée.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/login/terminal.txt)

## Invocation prévue

```text
/login qa-unsupported-provider
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Authenticate with a provider (default: chatgpt — uses your ChatGPT subscription)
