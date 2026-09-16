# /policy

[Accueil](Home.md) · [Wiki interactif](index.html#policy)

Gérer les politiques de sécurité et l’arrêt global.

## Syntaxe du catalogue

```text
/policy <action>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Oui | kill \<reason\> \| release \| status |

## Recette : TESTE\_LOCAL

```text
/policy status
```

consultation du statut des politiques de sécurité et du coupe-circuit.

Attendu : Affichage du statut des politiques de securite et du coupe-circuit

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/policy/terminal.txt)

## Invocation prévue

```text
/policy status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage security policies and global kill switch
