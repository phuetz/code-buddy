# IMPL — Surveillance événementielle par battements de cœur (Phases 1 & 2)

Branche : `feat/surveillance-evenementielle-2026-09-05`
Worktree : `~/DEV/cb-heartwatch-2026-09-05`
Mission : Phases 1 et 2 du plan `warm-moseying-zebra.md` (pas 3-5).
Début : 2026-09-05.

## Objectif
- Phase 1 : `src/sensory/system-vitals-emitter.ts` — passe pure/testable `runSystemVitalsPass(deps)`
  réutilisant les moniteurs existants ; garde « processus emballé » (N passes CPU au-dessus du seuil) ;
  émission directe sur le bus `sensory:perception` (modality:system). Enregistrement comme traitement
  de battement opt-in `CODEBUDDY_SYSTEM_VITALS=true`, cadence `CODEBUDDY_SYSTEM_VITALS_EVERY` (défaut 30).
- Phase 2 : opérateurs de seuil `{op,value}` dans `ruleMatches()` + `validateRule()` du moteur de règles,
  rétro-compatible strict (string = égalité).

## Invariant
- Défaut OFF ⇒ byte-identique (assert par test). `git add` fichier par fichier. Aucun push.

## Journal
(rempli au fil de l'implémentation)
