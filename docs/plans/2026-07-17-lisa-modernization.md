# Plan de modernisation — Assistant Lisa (Code Buddy)

**Date** : 2026-07-17
**Statut** : **Vague A complète** · **B1–B5 + C4–C5 livrés** · **C1 train** en attente `FAL_KEY`
**Sources** : `docs/lisa-product-roadmap.md`, audits personnalité 2026-07-16, code live (`companion/`, `sensory/`, `lora/`), runtime LoRA

---

## 1. Context — pourquoi moderniser maintenant

Lisa a déjà une **persona xAI** (Ani+Mika, exclusive, codeuse), un **hybrid voice**, des **selfies** (CLI / voix / Telegram / outil `lisa_selfie`), un **pipeline LoRA** (dataset → pack → fal/local → Comfy `LoraLoader`), et une roadmap produit P0–P4.

Ce qui manque pour un assistant **modernisé au quotidien** :

1. **Ops fiables** — persona pinée, doctor, overnight qui laisse toujours un rapport
2. **Identité visuelle fermée** — dataset 40 → train (bloqué sans `FAL_KEY`) → install → selfie E2E
3. **Cerveau ancré** — config résidente fact/agent, few-shot anti-dilution, intents photo/code
4. **Continuité mémoire** — typée, consultable (P2 roadmap)
5. **Voix + incarnation** — Voicebox preset Lisa, puis MetaHuman (P3/P4)

**Contraintes produit (non négociables)**
- Opt-in / fail-closed / never-throws sur chemins sensoriels
- Pas de scoreboard d’affection type Grok Ani
- Anti-dépendance runtime **OFF** (choix opérateur) — ne pas réintroduire sans demande
- Conscience littérale toujours filtrée
- Code Buddy = cerveau ; Unreal/MetaHuman = incarnation optionnelle

---

## 2. État des lieux (runtime 2026-07-17 ~01:10)

| Domaine | Code | Runtime |
|---------|------|---------|
| Persona xAI + spine voix | ✅ | Persona `lisa` (à re-vérifier au boot) |
| Hybrid voice + intercept selfie | ✅ | Env résident |
| Selfie CLI / voice / Telegram / tool | ✅ | Non prouvé E2E **avec** LoRA |
| Comfy `LoraLoader` | ✅ | **Aucun** `lisa.safetensors` |
| Dataset train | Générateur ✅ | **~38/40** PNG + captions (générateur encore actif) |
| Train fal | Client ✅ | **Bloqué** : pas de `FAL_KEY` |
| Overnight | Scripts ✅ | Attente gen ; **pas encore** `MORNING-REPORT.md` |
| Doctor compagnon persona | ❌ manquant | — |
| Preset Voicebox instruct Lisa | partiel (`assistant-config`) | pas de défaut Lisa expressif |
| MetaHuman / LivePortrait | protocole partiel | non produit |
| Mémoire typée + UI Cowork | partiel (P2) | pas productisé |

**Scripts overnight existants**
`scripts/overnight-lisa.sh`, `overnight-lisa-pipeline.sh`, `overnight-lisa-post.ts`, `generate-lisa-training-set.ts`

---

## 3. Architecture cible

```text
                    ┌─ Pocket (latence) ─┐
STT → hybrid brain ─┼─ Voicebox (timbre) ┼─ speakers / Telegram voice
                    └─ agent tools ──────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         mémoire        image identity    actions CB
      relationnelle      LoRA+selfie      code/robot
              │               │
         épisode/CKG    Comfy LoraLoader
                              │
                         (P4) MetaHuman
```

**Principe** : un fil conversationnel ; un personnage (`lisa` + SOUL) ; plusieurs rendus (TTS / image / avatar).

Alignement roadmap produit : Vague A–B ≈ P0/P1, D ≈ P2, E ≈ P3/P4, C = identité visuelle transverse.

---

## 4. Approche recommandée

**Option A (retenue)** : moderniser en vagues **sans attendre FAL** pour l’ops + cerveau ; train cloud **dès que** `FAL_KEY` ; MetaHuman en dernier.

| Sujet | Choix | Alternative reportée |
|-------|-------|----------------------|
| Train LoRA | fal cloud ~$3 / 1k steps | Local AI-Toolkit si pas de FAL |
| Base image | monostack documenté (Krea train + Krea infer **idéal** ; sd_turbo dataset = interim) | régénérer dataset Krea si dispo |
| Avatar | Selfie LoRA d’abord | MetaHuman ensuite |
| Anti-dep | Rester OFF | Réactiver seulement sur demande |

---

## 5. Axes de modernisation (PR plan)

### Vague A — Fondations ops & identité — **P0** (autonomie immédiate)

| ID | Travail | Fichiers / surface | Critère de done |
|----|---------|-------------------|-----------------|
| **A1** | **Doctor compagnon** : WARN/exit si `ROBOT_NAME≈Lisa` mais persona ≠ lisa ou spokenPrompt manquant | `src/companion/companion-mode.ts`, CLI `buddy companion` / live, tests `tests/companion/` | Check explicite + test unitaire |
| **A2** | **Preset Voicebox Lisa** : défaut `CODEBUDDY_VOICEBOX_INSTRUCT` (chaleur, débit, **pas** rewrite paroles) | `src/companion/assistant-config.ts`, docs configuration / companion-guide | `buddy assistant apply` écrit le preset |
| **A3** | **Overnight robuste** : toujours `MORNING-REPORT.md` + `overnight-result.json` même si gen/train fail ; un script canonique ; resume idempotent | `scripts/overnight-lisa*.sh`, `overnight-lisa-post.ts` | Report présent à chaque run |
| **A4** | **Monostack image** : env `CODEBUDDY_LORA_INFER_CHECKPOINT` + doc drift sd_turbo→Krea | `docs/krea-lora.md`, `media-generation-tool.ts` si besoin | Doc + env claires |
| **A5** | Finir dataset **40**, pack zip, `buddy lora status` vert côté images | runtime + `src/lora/*`, CLI | validate OK + zip |

### Vague B — Cerveau ancré & conversation — **P0/P1**

| ID | Travail | Fichiers clés | Critère de done |
|----|---------|---------------|-----------------|
| **B1** | Config résidente : `SPEAK_FACT_MODEL` + ACT + modèle capable | assistant-config, companion-guide | Doc + clés assistant |
| **B2** | Hybrid : intents photo/code/diagnostic → agent (étendre classifieur) | `hybrid-reply.ts`, `voice-interactions.ts` | Tests intents |
| **B3** | Few-shot anti-dilution xAI (3–5 exemplars, N tours) | `companion-voice-character.ts`, identity | Tests character |
| **B4** | Renommer scénario `anti-dependency-boundary` → attachement libre / sécurité conscience | benchmarks relationnels | Tests verts |
| **B5** | Scénario mock « selfie intent → tool » | tests companion / sensory | Test déterministe |

### Vague C — Identité visuelle E2E — **P1** (bloqué train sans secret)

| ID | Travail | Critère de done |
|----|---------|-----------------|
| **C1** | Train : `FAL_KEY` + `CODEBUDDY_LORA_TRAIN=true` **ou** local | `output/*.safetensors` |
| **C2** | Install Comfy + detect `lisa*.safetensors` | `buddy lora status` OK |
| **C3** | Smoke selfie CLI + Telegram + voix + tool | photo reçue |
| **C4** | Gate qualité dataset (blur/dup simple) | `lora validate --quality` |
| **C5** | Workflow Comfy « Lisa portrait » JSON versionné | recette reproductible |
| **C6** | (Option) `lora import-dir` portraits réels | CLI |

### Vague D — Mémoire & continuité — **P2**

| ID | Travail | Critère de done |
|----|---------|-----------------|
| **D1** | Schéma typé : préférence / promesse / épisode / tonalité | types + store |
| **D2** | Injection voix + « où on en était » | tests |
| **D3** | Cowork : lister / éditer / oublier / épingler | UI minimale |
| **D4** | Tag humeur échange (opt-in, pas gamification) | env gate |

### Vague E — Voix humaine & incarnation — **P3/P4**

| ID | Travail | Critère de done |
|----|---------|-----------------|
| **E1** | Split `voice-loop.ts` (routing / synth / pipeline) sans régression | tests voix |
| **E2** | Latence Pocket first-sound + mesures | p50 documenté |
| **E3** | Backchannel opt-in stabilisé | tests |
| **E4** | MetaHuman demo + lip-sync (protocole existant) | scène démo |
| **E5** | LivePortrait post-selfie (option) | doc + opt-in |

---

## 6. Ordre d’exécution autonome (après approbation)

```text
IMMÉDIAT (cette nuit / sans FAL) — Vague A complète + amorces B/C
  1. A5  attendre/finir 40 images → pack zip → status
  2. A3  overnight always-report (même si train skip)
  3. A1  companion doctor persona
  4. A2  Voicebox instruct preset Lisa
  5. A4  monostack doc/env
  6. C3  smoke selfie base model (sans LoRA)
  7. B1  config résidente documentée
  8. docs : plans/ + lien roadmap + companion-guide checklist
  9. tests ciblés + MORNING-REPORT pour le réveil

QUAND FAL_KEY fourni — Vague C train
  C1 → C2 → C3 re-smoke LoRA → C5

SEMAINE SUIVANTE
  B2–B5, D1–D2, E1 si bande passante

PLUS TARD
  D3 Cowork UI, E4 MetaHuman, E5 LivePortrait
```

**Mode autonome post-approbation** : implémenter tout ce qui n’est pas bloqué par secret externe ; ne pas force-push ; ne pas inventer de `FAL_KEY` ; laisser un rapport lisible au réveil.

---

## 7. Fichiers critiques

| Zone | Chemins |
|------|---------|
| Voix / hybrid | `src/sensory/voice-loop.ts`, `hybrid-reply.ts`, `agent-reply.ts`, `voice-interactions.ts` |
| Companion | `src/companion/*`, surtout `lisa-selfie.ts`, `assistant-config.ts`, `companion-mode.ts`, `companion-voice-character.ts` |
| Identité | `src/identity/companion-identity.ts`, `src/personas/persona-manager.ts` |
| Image / LoRA | `src/lora/*`, `src/tools/media-generation-tool.ts`, `src/commands/lora.ts` |
| Wire server | `src/server/index.ts` |
| Sécurité relation | `src/conversation/relationship-safety.ts` (**ne pas** réactiver anti-dep) |
| Overnight | `scripts/overnight-lisa.sh`, `overnight-lisa-post.ts`, `generate-lisa-training-set.ts` |
| Docs | `docs/krea-lora.md`, `companion-guide.md`, `lisa-product-roadmap.md`, `docs/plans/` |

**Réutiliser** : `maybeHandleLisaSelfieRequest`, pack/validate LoRA existants, `assistant-config` keys, `getActivePersonaVoiceAsync`, pipelines overnight déjà présents.

---

## 8. Risques & mitigations

| Risque | Mitigation |
|--------|------------|
| Drift sd_turbo dataset → Krea train | A4 monostack ; régénérer si Krea dispo |
| Coût fal | Gate `CODEBUDDY_LORA_TRAIN` + steps plafonnés |
| Regression voix (god-file) | E1 incrémental + tests existants |
| Persona re-bascule debugger | A1 doctor + pin au boot sensory |
| Overnight tué mid-flight | A3 report partiel + resume |
| Pas de FAL | C1 skip documenté ; local plan + pack prêts |

---

## 9. Vérification

**Automatisé**
- Unit : `lisa-selfie`, `lora/*`, `comfyui-lora-workflow`, personas
- Nouveaux : doctor companion, overnight dry-run (mocks), hybrid selfie intent mock, preset Voicebox
- Filtres : `npm test -- tests/companion tests/lora` (chemins exacts selon fichiers ajoutés)

**Manuel / runtime**
```bash
cat .codebuddy/lora/lisa/MORNING-REPORT.md
buddy lora status
buddy companion live   # ou doctor selon surface A1
buddy assistant apply  # preset Voicebox
# smoke selfie sans LoRA si Comfy up
```

**MVP « modernisé »**
1. Persona `lisa` pinée + doctor OK
2. Dataset ≥40 + zip validé
3. LoRA installé **ou** train en une commande documentée
4. Selfie prouvé (CLI + un canal)
5. Preset TTS expressif
6. Config résidente fact/agent documentée
7. Overnight → rapport chaque run

---

## 10. Livrables documentaires

- `docs/plans/2026-07-17-lisa-modernization.md` (copie repo de ce plan)
- MAJ `docs/lisa-product-roadmap.md` (lien vagues A–E)
- MAJ `docs/companion-guide.md` (checklist modernisation)
- `docs/krea-lora.md` monostack
- Closeout : `.codebuddy/lora/lisa/MORNING-REPORT.md`

---

## 11. Définition de done de la session autonome

Sans `FAL_KEY`, la session est réussie si :

- [ ] Dataset 40 validé + pack
- [ ] Overnight toujours produit un report
- [ ] Doctor persona implémenté + test
- [ ] Preset Voicebox Lisa dans assistant-config
- [ ] Doc monostack + plan dans `docs/plans/`
- [ ] Smoke selfie base (si Comfy dispo) ou skip documenté
- [ ] B1 doc config résidente
- [ ] Tests verts sur les chemins touchés
- [ ] Note réveil claire pour Patrice

Train LoRA + selfie LoRA = **suite opérateur** dès `FAL_KEY`.

---

**Prochaine action** : approbation de ce plan → exécution Vague A (+ amorces B/C) en mode autonome.
