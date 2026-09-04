# RÉPARATION VERIFIX3A — fermeture des trouvailles T1–T11 et T16–T21 de VERIF3

Date : 2026-09-04
Lane : VERIFIX3A (Fable 5.1)
Clone : `~/DEV/cb-verifix3a-2026-09-04`
Branche : `fix/verifix3a-harnais-2026-09-04`
Source : `docs/reports/2026-09/RAPPORT-VERIF3.md`, sections « Trouvailles » T1–T11 et T16–T21
HEAD de départ : `ee51f1096`

Ce rapport a été créé **avant** toute inspection.

## Périmètre

Dix-sept trouvailles, toutes de la famille « le harnais n'observe pas le
contrat » : assertions `toHaveBeenCalled()` nues, `stringContaining` trop
lâches, `mode: 0o600` non asserté, exception explicite non gardée, latence
neutralisée par le test lui-même.

| Trouvaille | Fichier de test |
|---|---|
| T1 | `tests/unit/migration-manager.test.ts` |
| T2 | `tests/unit/telemetry-config.test.ts` |
| T3 | `tests/unit/cost-tracker.test.ts` |
| T4 | `tests/unit/codebase-rag.test.ts` |
| T5 | `tests/unit/vector-store.test.ts` |
| T6 | `tests/unit/roi-tracker.test.ts` |
| T7 | `tests/unit/session-replay.test.ts` |
| T8 | `tests/unit/response-cache.test.ts` |
| T9 | `tests/unit/persistent-checkpoint-manager.test.ts` |
| T10 | `tests/features/tailscale-dashboard-nodes.test.ts` |
| T11 | `tests/channels/dm-pairing.test.ts` |
| T16 | `tests/unit/doctor-fix.test.ts` |
| T17 | `tests/sensory/agent-reply-routing.test.ts` |
| T18 | `tests/unit/auth.test.ts` |
| T19 | `tests/unit/misc-tools-part2.test.ts` |
| T20 | `tests/unit/memory.test.ts` |
| T21 | `tests/unit/workflows.test.ts` |

Hors périmètre (lane sœur VERIFIX3B) : T12 à T15.

## Méthode

Pour chaque trouvaille : (1) rejouer la mutation restée VERTE du rapport
VERIF3 et confirmer qu'elle est bien verte ; (2) renforcer le test pour qu'il
asserte le contrat réel (chemin exact, contenu sérialisé, mode `0o600` quand
la source le fixe, exception réellement levée) **sans toucher au code de
production** ; (3) rejouer la même mutation : ROUGE ; restaurer
(`git checkout -- <src>`) : VERT. Aucun `it.skip`, aucun test supprimé,
aucune assertion affaiblie. Un commit par trouvaille.

Préfixe d'exécution :

```bash
env HOME="$PWD/_qa/verifix3a/home" TMPDIR="$PWD/_qa/verifix3a/home/tmp" \
    XDG_CACHE_HOME="$PWD/_qa/verifix3a/home/cache" NO_COLOR=1 \
    npx vitest run <fichier de test> --reporter=dot
```

## Journal des réparations

_(complété au fil du chantier)_

## Vérifications finales

_(complété en fin de chantier)_

## Bilan

_(complété en fin de chantier)_
