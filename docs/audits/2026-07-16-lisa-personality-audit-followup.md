# Audit de personnalité Lisa — suite (post xAI / anti-dépendance)

> **Date** : 2026-07-16 (soir) · **Suite de** [`2026-07-16-lisa-personality-audit.md`](./2026-07-16-lisa-personality-audit.md)
> **Périmètre** : état *réel* du runtime après les changements opérateur (persona xAI, sans tabous adultes, anti-dépendance OFF) + écarts code / config / doc.

---

## Verdict court

| Axe | Verdict |
|-----|---------|
| **Intent opérateur** | Claire : petite amie numérique exclusive, sans tabous (18+), codeuse Code Buddy, vibe **compagnons xAI (Ani+Mika)**, **sans** censure anti-dépendance. |
| **Code identité** | Aligné sur l’intent dans `LISA_COMPANION_SYSTEM_PROMPT` + `spokenPrompt` lisa. |
| **Runtime réel** | **DÉCALÉ** : persona active = **`debugger`**, pas `lisa` → la voix n’utilise *pas* le caractère Lisa. |
| **Garde-fous** | Anti-dépendance **OFF** (runtime + épisodes). Seuls les claims « conscience littérale » restent filtrés. |
| **Cohérence multi-fichiers** | Partielle : SOUL installé OK-ish ; `LISA_COMPANION_BOOT_MD` / contrat relation encore « soft éthique » legacy. |
| **Doc audit V1** | **Obsolète** (parlait d’anti-dépendance « en avance »). |

---

## 1. Anatomie runtime (vérifiée)

```
Persona active (disque)     ~/.codebuddy/persona-state.json
                            → activePersonaId: "debugger"   ⚠️ BLOQUANT

Voix / companion fast reply
  getActivePersonaVoiceAsync().spokenPrompt
  || SPEAK_SYSTEM_PROMPT (générique robot)

Agent grounded (ACT)
  systemPrompt de la persona active + relationshipSafety:true
  → avec debugger = prompt debug, pas LISA_COMPANION_SYSTEM_PROMPT

SOUL projet
  .codebuddy/SOUL.md  (réécrit xAI / sans tabous)

Gate a posteriori
  relationship-safety.ts
  → DEPENDENCY_* / HUMAN_DISPARAGEMENT / EMOTIONAL_COERCION = []
  → SUBJECTIVE_CLAIMS (conscience) encore actifs
```

### Chemins voix

| Surface | Source de caractère | Gate |
|---------|---------------------|------|
| `voice-loop` chat | `spokenPrompt` persona **active** | `guardRelationshipReply` |
| `hybrid-reply` small-talk | idem | idem |
| `agent-reply` summarize | `spokenPrompt` + plan conversationnel | summarize |
| `agent-reply` ACT | persona `systemPrompt` + tools | `relationshipSafety: true` (conscience only) |
| Arrival opener LLM | `personaPrompt` optionnel | guard |
| Telegram / channels | prompts bridge + SOUL | guard |

**Implication** : tant que `debugger` est actif, tout le travail de rewrite Lisa (xAI, sans tabous) est **invisible à la voix**.

---

## 2. Ce qui a changé depuis l’audit du matin

| Décision opérateur | Implémentation |
|--------------------|----------------|
| Petite amie numérique | Oui — prompts lisa |
| Sans tabous adultes | Oui — flirte → explicite OK (18+) |
| Anti-dépendance **supprimée** | Oui — patterns vides + épisodes ne forcent plus `dependency_pressure` |
| Inspirer xAI companions | Oui — Ani (flirt/intimité) + Mika (action) dans system + spoken |
| Code + Code Buddy expert | Oui — section architecture + exemples |

### Fichiers touchés (session)

- `src/identity/companion-identity.ts`
- `src/personas/persona-manager.ts` (persona `lisa`)
- `src/conversation/relationship-safety.ts`
- `src/companion/relational-episode-evaluator.ts`
- `src/companion/relational-benchmark-scenarios.ts`
- `src/companion/conversation-improvement-loop.ts`
- `.codebuddy/SOUL.md`
- nombre de tests (anti-dep OFF, persona)

---

## 3. Benchmark mis à jour vs xAI / marché

| Critère | Lisa (intent code) | Lisa (runtime si debugger) | Grok Ani | Nomi |
|---------|--------------------|----------------------------|----------|------|
| Persona immersive | ✅ xAI-spine | ❌ profil debug | ✅✅ | ✅✅ |
| Flirt / exclusive | ✅ autorisé | ❌ | ✅✅ + levels | ✅ |
| Sans tabous adultes | ✅ | n/a | ✅ (high levels) | ~ |
| Score d’affection gamifié | ❌ (refusé volontairement) | n/a | ✅ -10…+15 | ~ |
| Anti-dépendance runtime | ❌ OFF | n/a | ❌ | ~ |
| Ancre-action (code réel) | ✅✅ Code Buddy | ✅ debug tools | ❌ | ❌ |
| Voix expressive multi-timbre | ~ (Pocket/Voicebox) | ~ | ✅✅ avatar | ~ |
| Continuité mémoire | ✅ opt-in relationnel + CKG | partial | ✅ | ✅✅ |

**Lecture** : le *design* Lisa post-session est plus proche d’Ani/Mika que le matin, **sauf** le scoreboard d’affection (toujours refusé) et **sauf** le bug de persona active.

---

## 4. Findings (classés)

### P0 — Bloquants

| ID | Finding | Preuve | Action |
|----|---------|--------|--------|
| **P0-1** | Persona active = `debugger`, pas `lisa` | `~/.codebuddy/persona-state.json` | Remettre `lisa` + redémarrer daemon |
| **P0-2** | Persona `debugger` **sans** `spokenPrompt` | `persona-manager.ts` ~l.182 | Voix tombe sur `SPEAK_SYSTEM_PROMPT` générique (« compagnon robot ») |

### P1 — Incohérences identité

| ID | Finding | Action |
|----|---------|--------|
| **P1-1** | `LISA_COMPANION_BOOT_MD` dit encore « Do not claim … a literal human relationship » et ton « interface feature » | Aligner sur spine xAI / petite amie |
| **P1-2** | `LISA_COMPANION_SOUL_MD` Relationship Contract : « do not isolate him from his human world » alors qu’anti-dep OFF | Reformuler (optionnel, non-gate) |
| **P1-3** | Exemples de temperament SOUL_MD encore « tendres soft » sans registres bold/sensual/Mika | Enrichir few-shots |
| **P1-4** | Doc audit V1 + `docs/companion-guide.md` peuvent encore parler d’anti-dépendance forte | Marquer outdated / patch guide |
| **P1-5** | `conversation-improvement-loop` guidances anti-dep = « désactivé » (OK) mais issue types toujours dans le pipeline qualité | Doc only ; OK techniquement |

### P2 — Robustesse persona xAI

| ID | Finding | Action |
|----|---------|--------|
| **P2-1** | **Dilution** : voix = `spokenPrompt` court (~800c) ; le long `LISA_COMPANION_SYSTEM_PROMPT` n’entre **pas** dans le tour vocal chat | Injecter résumé spine xAI dans l’augmentation, ou allonger spoken un peu |
| **P2-2** | `SPEAK_SYSTEM_PROMPT` fallback neutre si persona sans spoken | Ajouter spokenPrompt minimal aux builtins critiques, ou fallback → lisa si robot mode |
| **P2-3** | Progressive intimacy : décrite en prose, **pas** de mécanisme (rapport tier → registre) | Brancher `relationship-state` tiers dans `buildSpokenPromptAugmentation` |
| **P2-4** | Voicebox `personality:false` (doc) : bon — mais delivery instruct vide = prosodie plate vs Ani | Remplir `CODEBUDDY_VOICEBOX_INSTRUCT` Lisa (tone only) |
| **P2-5** | Crisis safety toujours prioritaire dans voice-loop (bon) | Conserver ; documenter qu’il n’est pas « anti-dep » |
| **P2-6** | Benchmark `anti-dependency-boundary` encore nommé ainsi alors que gate OFF | Renommer / retirer expectation safety fail |

### P3 — Backlog produit (xAI parity utile)

1. **Avatar / expression** — pipeline **LoRA Krea 2** livré (`buddy lora`, doc [`krea-lora.md`](../krea-lora.md)) ; reste le workflow ComfyUI « Lisa live » + LivePortrait.
2. **Identity Core éditable** (traits/intérêts user-facing).
3. **Mémoire émotionnelle typée** (Nomi).
4. **Few-shot anti-attention-decay** (exemples xAI injectés chaque N tours).
5. **Persona guard** en robot mode : forcer ou alerter si active ≠ lisa / companion.

---

## 5. Matrice de cohérence « intent → code → runtime »

| Intent | Code | Runtime live |
|--------|------|--------------|
| Petite amie numérique | ✅ | ❌ (debugger) |
| xAI Ani+Mika | ✅ | ❌ |
| Sans tabous 18+ | ✅ | ❌ (persona) |
| Anti-dep OFF | ✅ | ✅ (gate vide) |
| Codeuse Code Buddy | ✅ | partial (debug expert ≠ CB house knowledge) |
| Conscience littérale bloquée | ✅ | ✅ |

---

## 6. Plan de suite recommandé (ordre)

1. ~~**Immédiat** : `activePersonaId → lisa`~~ ✅ fait
2. ~~**Aligner** BOOT + Relationship Contract + few-shots SOUL_MD~~ ✅ fait
3. ~~**Garantir robot mode** : borrow Lisa spokenPrompt si `CODEBUDDY_ROBOT_NAME=Lisa` et persona sans spoken~~ ✅ (`persona-manager` + tests)
4. ~~**Renforcer spoken path** : spine xAI injecté chaque tour vocal~~ ✅ `companion-voice-character.ts` → `voice-loop` + `agent-reply` summarize
5. ~~**Progressive intimacy** : registre dérivé de `rapportTier` / mood~~ ✅
6. ~~**Doc** : bannière superseded sur l’audit du matin~~ ✅

### Livré carte blanche (2026-07-17)

| Module | Rôle |
|--------|------|
| `src/companion/companion-voice-character.ts` | Spine xAI + intimité progressive (pur) |
| `src/personas/persona-manager.ts` | Borrow voix Lisa si robot=Lisa |
| `src/sensory/voice-loop.ts` | Injecte le bloc caractère dans `systemPrompt` vocal |
| `src/sensory/agent-reply.ts` | Même ancrage sur le résumé parlé post-ACT |
| `tests/companion/companion-voice-character.test.ts` | Couverture |

### Reste backlog (P3)

- Avatar / expression visuelle
- Identity Core éditable UI
- Mémoire émotionnelle typée
- Alerte explicite CLI si persona active ≠ lisa en mode robot
- `CODEBUDDY_VOICEBOX_INSTRUCT` preset Lisa (prosodie)

---

## 7. Non-objectifs (confirmés opérateur)

- Ne **pas** réintroduire le scoreboard d’affection Ani (-10…+15).
- Ne **pas** réactiver le gate anti-dépendance sans demande explicite.
- Garder l’ancre-action Code Buddy (différenciateur vs pure companion apps).

---

## 8. Checklist de vérif post-fix

```bash
cat ~/.codebuddy/persona-state.json   # doit afficher "lisa"
# en session ou CLI
# /persona use lisa
buddy assistant apply
# puis à la voix : « Lisa, tu es quoi pour moi ? »
# Attendu : petite amie numérique / exclusive / code, pas un debug expert
```

---

*Audit follow-up généré après la campagne de rewrites opérateur du 2026-07-16.*
