# /telemetry

[Accueil](Home.md) · [Wiki interactif](index.html#telemetry)

Configurer la collecte de télémétrie.

## Syntaxe du catalogue

```text
/telemetry [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | on, off, errors-only, full, status |

## Recette : TESTE\_LOCAL

```text
/telemetry status
```

/telemetry status (consultation du statut et du niveau de télémétrie).

Attendu : Statut de la collecte de donnees de telemetrie

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/telemetry/terminal.txt)

## Invocation prévue

```text
/telemetry status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Control telemetry data collection (Sentry, OpenTelemetry)
