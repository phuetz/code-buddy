# cli-evolve — recette du 2 octobre 2026

État : **Prérequis vérifiés**. Décision : **b+c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

run exige l’opt-in ; propose exige un fournisseur et une fiche valide ; le magasin de variantes est vide.

Les refus existants sont explicites ; fiche synthétique valide utilisée pour atteindre PROVIDER_MISSING. Aucune évolution exécutée.

[Protocole, validation et limites](README.md).

## Avant

### cli-evolve-list

```text
$ buddy evolve list
[2026-10-02T14:04:48.392Z]  INFO  No evaluated variants yet. Run `buddy evolve run --goal "<weakness>"`.

EXIT=0
```

### cli-evolve-tree

```text
$ buddy evolve tree
[2026-10-02T14:04:48.613Z]  INFO  No evaluated variants yet. Run `buddy evolve run --goal "<weakness>"`.

EXIT=0
```

### cli-evolve-review-id

```text
$ buddy evolve review qa-missing
[2026-10-02T14:14:25.904Z]  ERROR Variant 'qa-missing' not found. Use `buddy evolve list`.

EXIT=1
```

### cli-evolve-run

```text
$ buddy evolve run
[2026-10-02T14:04:49.126Z]  ERROR Evolution is opt-in. Set CODEBUDDY_EVOLVE=true to run (it spawns real agent runs + LLM calls).

EXIT=1
```

### cli-evolve-propose-valid

```text
$ buddy evolve propose --fiche-input fiche.json --json
{
  "status": "stopped",
  "reason": "PROVIDER_MISSING",
  "events": [
    {
      "stage": "source",
      "status": "ok",
      "code": "USAGE_SELECTED",
      "detail": "usage source selected."
    },
    {
      "stage": "provider",
      "status": "stopped",
      "code": "PROVIDER_MISSING",
      "detail": "No configured LLM provider for goal synthesis and planning."
    }
  ]
}

EXIT=2
```

## Après — paquet reconstruit et réinstallé

### cli-evolve-list

```text
$ buddy evolve list
[2026-10-02T14:35:11.006Z]  INFO  No evaluated variants yet. Run `buddy evolve run --goal "<weakness>"`.

EXIT=0
```

### cli-evolve-tree

```text
$ buddy evolve tree
[2026-10-02T14:35:11.159Z]  INFO  No evaluated variants yet. Run `buddy evolve run --goal "<weakness>"`.

EXIT=0
```

### cli-evolve-review-id

```text
$ buddy evolve review qa-missing
[2026-10-02T14:35:26.156Z]  ERROR Variant 'qa-missing' not found. Use `buddy evolve list`.

EXIT=1
```

### cli-evolve-run

```text
$ buddy evolve run
[2026-10-02T14:35:11.424Z]  ERROR Evolution is opt-in. Set CODEBUDDY_EVOLVE=true to run (it spawns real agent runs + LLM calls).

EXIT=1
```

### cli-evolve-propose-valid

```text
$ buddy evolve propose --fiche-input fiche.json --json
{
  "status": "stopped",
  "reason": "PROVIDER_MISSING",
  "events": [
    {
      "stage": "source",
      "status": "ok",
      "code": "USAGE_SELECTED",
      "detail": "usage source selected."
    },
    {
      "stage": "provider",
      "status": "stopped",
      "code": "PROVIDER_MISSING",
      "detail": "No configured LLM provider for goal synthesis and planning."
    }
  ]
}

EXIT=2
```
