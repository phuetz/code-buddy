# memory-ckg — recette du 2 octobre 2026

> Reprise de revue : **Partiellement vérifiée**. Crash sharp de research recall signalé par Grok non reproduit ; résolution non démontrée. Les scénarios synthétiques ci-dessous ne permettent pas de clore le défaut initial.

État : **Partiellement vérifiée**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Le repli lexical est déjà présent ; le crash du rapport ne se reproduit pas dans ce paquet installé.

Aucune correction spéculative : retrait temporaire réel du binaire sharp, fait rappelé et code 0. La recherche sémantique multilingue reste non vérifiée.

[Protocole, validation et limites](README.md).

## Avant

### memory-ckg-add-valid

```text
$ buddy research fact add localhealth is online --category tool
🆕 Nouveau fait : localhealth is online [tool]

EXIT=0
```

### memory-ckg-fact-valid

```text
$ buddy research fact recall localhealth
• online  [tool] — rétention 1.00, vu 1×

EXIT=0
```

### memory-ckg-recall-native-absent

```text
$ buddy research recall localhealth
[2026-10-02T14:07:37.409Z]  WARN  Local embedding model failed to load; semantic search must use its declared keyword-only fallback {"error":"Local embeddings need a working sharp native module. Reinstall dependencies with install scripts enabled."}
[2026-10-02T14:07:37.411Z]  WARN  [ckg] semantic recall unavailable; retrieval is explicitly degraded to keyword-only {"error":"Local embeddings need a working sharp native module. Reinstall dependencies with install scripts enabled."}
online

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### memory-ckg-add-valid

```text
$ buddy research fact add localhealth is online --category tool
🆕 Nouveau fait : localhealth is online [tool]

EXIT=0
```

### memory-ckg-fact-valid

```text
$ buddy research fact recall localhealth
• online  [tool] — rétention 1.00, vu 1×

EXIT=0
```

### memory-ckg-recall-native-absent

```text
$ buddy research recall localhealth
[2026-10-02T14:35:24.231Z]  WARN  Local embedding model failed to load; semantic search must use its declared keyword-only fallback {"error":"Local embeddings need a working sharp native module. Reinstall dependencies with install scripts enabled."}
[2026-10-02T14:35:24.234Z]  WARN  [ckg] semantic recall unavailable; retrieval is explicitly degraded to keyword-only {"error":"Local embeddings need a working sharp native module. Reinstall dependencies with install scripts enabled."}
online

EXIT=0
```
