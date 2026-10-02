# cli-policy — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

check et repair --dry-run diagnostiquent sans appliquer ; aucun constat dans le profil vide.

Conserver DIAGNOSTIC NON APPLIQUÉ, restreindre la promesse. Aucune réparation effective vérifiée sur ce profil vide.

[Protocole, validation et limites](README.md).

## Avant

### cli-policy-check

```text
$ buddy policy check --json
{
  "ok": true,
  "source": null,
  "application": "DIAGNOSTIC NON APPLIQUÉ",
  "domains": [
    {
      "domain": "gateway",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "channels",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "mcp",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "sandbox",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "exec",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    }
  ],
  "findings": [],
  "repairs": [],
  "errors": []
}

EXIT=0
```

### cli-policy-repair

```text
$ buddy policy repair --dry-run --json
{
  "ok": true,
  "source": null,
  "application": "DIAGNOSTIC NON APPLIQUÉ",
  "domains": [
    {
      "domain": "gateway",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "channels",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "mcp",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "sandbox",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "exec",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    }
  ],
  "findings": [],
  "repairs": [],
  "errors": []
}

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-policy-check

```text
$ buddy policy check --json
{
  "ok": true,
  "source": null,
  "application": "DIAGNOSTIC NON APPLIQUÉ",
  "domains": [
    {
      "domain": "gateway",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "channels",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "mcp",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "sandbox",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "exec",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    }
  ],
  "findings": [],
  "repairs": [],
  "errors": []
}

EXIT=0
```

### cli-policy-repair

```text
$ buddy policy repair --dry-run --json
{
  "ok": true,
  "source": null,
  "application": "DIAGNOSTIC NON APPLIQUÉ",
  "domains": [
    {
      "domain": "gateway",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "channels",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "mcp",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "sandbox",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    },
    {
      "domain": "exec",
      "application": "DIAGNOSTIC NON APPLIQUÉ"
    }
  ],
  "findings": [],
  "repairs": [],
  "errors": []
}

EXIT=0
```
