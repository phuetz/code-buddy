# cli-curator — recette du 2 octobre 2026

État : **Testée localement**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Le HOME vide n’a aucun ledger council ; la commande n’affiche donc aucun coût à agréger.

Préciser la portée council des coûts, pas un audit global. Fixture locale à 0,125 USD correctement agrégée, aucun appel payant.

[Protocole, validation et limites](README.md).

## Avant

### cli-curator-scan

```text
$ buddy curator scan
<!-- AUTO-GÉNÉRÉ par `buddy curator scan` — NE PAS ÉDITER (régénéré à chaque scan) -->
# Rapport Curator — 2026-10-02T14:04:44.333Z

Projet : `<WORKSPACE>`

## État

- ✅ **Mémoire persistante** — 0 souvenirs vivants, 0 candidat(s) à l'oubli (rétention < 0.05)
- ✅ **Skills authored** — aucun répertoire de skills (rien à curer)
- ✅ **CKG (mémoire collective)** — 0 entités, 0 relations, 0 supersédées (0%)
- ✅ **Leçons** — 0 candidate(s) pending, 0 qui stagnent ≥ 7j
- ✅ **Modèles (council)** — pas de ledger de performance (rien à agréger)

## Propositions (0) — validation humaine requise

Rien à proposer : la couche apprenante est saine.

> Le Curator PROPOSE et n'applique rien : chaque patch pointe vers la commande humaine existante.

Rapport écrit : <WORKSPACE>/.codebuddy/curator/latest.md (+ report-2026-10-02T14-04-44-333Z.json)

EXIT=0
```

### cli-curator-cost-fixture

```text
$ buddy curator scan
<!-- AUTO-GÉNÉRÉ par `buddy curator scan` — NE PAS ÉDITER (régénéré à chaque scan) -->
# Rapport Curator — 2026-10-02T14:17:05.282Z

Projet : `<WORKSPACE>`

## État

- ✅ **Mémoire persistante** — 0 souvenirs vivants, 0 candidat(s) à l'oubli (rétention < 0.05)
- ✅ **Skills authored** — aucun répertoire de skills (rien à curer)
- ✅ **CKG (mémoire collective)** — 1 entités, 0 relations, 0 supersédées (0%)
- ✅ **Leçons** — 0 candidate(s) pending, 0 qui stagnent ≥ 7j
- ✅ **Modèles (council)** — 1 run(s) sur 7j, $0.1250, 0 échec(s) de fan-out

## Propositions (0) — validation humaine requise

Rien à proposer : la couche apprenante est saine.

> Le Curator PROPOSE et n'applique rien : chaque patch pointe vers la commande humaine existante.

Rapport écrit : <WORKSPACE>/.codebuddy/curator/latest.md (+ report-2026-10-02T14-17-05-282Z.json)

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-curator-scan

```text
$ buddy curator scan
<!-- AUTO-GÉNÉRÉ par `buddy curator scan` — NE PAS ÉDITER (régénéré à chaque scan) -->
# Rapport Curator — 2026-10-02T14:35:08.123Z

Projet : `<WORKSPACE>`

## État

- ✅ **Mémoire persistante** — 0 souvenirs vivants, 0 candidat(s) à l'oubli (rétention < 0.05)
- ✅ **Skills authored** — aucun répertoire de skills (rien à curer)
- ✅ **CKG (mémoire collective)** — 0 entités, 0 relations, 0 supersédées (0%)
- ✅ **Leçons** — 0 candidate(s) pending, 0 qui stagnent ≥ 7j
- ✅ **Modèles (council)** — pas de ledger de performance (rien à agréger)

## Propositions (0) — validation humaine requise

Rien à proposer : la couche apprenante est saine.

> Le Curator PROPOSE et n'applique rien : chaque patch pointe vers la commande humaine existante.

Rapport écrit : <WORKSPACE>/.codebuddy/curator/latest.md (+ report-2026-10-02T14-35-08-123Z.json)

EXIT=0
```

### cli-curator-cost-fixture

```text
$ buddy curator scan
<!-- AUTO-GÉNÉRÉ par `buddy curator scan` — NE PAS ÉDITER (régénéré à chaque scan) -->
# Rapport Curator — 2026-10-02T14:35:25.591Z

Projet : `<WORKSPACE>`

## État

- ✅ **Mémoire persistante** — 0 souvenirs vivants, 0 candidat(s) à l'oubli (rétention < 0.05)
- ✅ **Skills authored** — aucun répertoire de skills (rien à curer)
- ✅ **CKG (mémoire collective)** — 1 entités, 0 relations, 0 supersédées (0%)
- ✅ **Leçons** — 0 candidate(s) pending, 0 qui stagnent ≥ 7j
- ✅ **Modèles (council)** — 1 run(s) sur 7j, $0.1250, 0 échec(s) de fan-out

## Propositions (0) — validation humaine requise

Rien à proposer : la couche apprenante est saine.

> Le Curator PROPOSE et n'applique rien : chaque patch pointe vers la commande humaine existante.

Rapport écrit : <WORKSPACE>/.codebuddy/curator/latest.md (+ report-2026-10-02T14-35-25-591Z.json)

EXIT=0
```
