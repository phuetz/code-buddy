# RAPPORT-GK36 — La couche relationnelle et proactive de Lisa en vrai

Mission : se servir des applis EN VRAI. `CODEBUDDY_COMPANION_RELATIONAL`, `_PROACTIVE` / `_MIN_GAP_MS`, journal épisodique, oubli d'Ebbinghaus. Ce qu'un utilisateur obtient, ce qui casse, réparé.

- Clone : `/home/patrice/DEV/cb-repar-telegram-2026-09-02`
- Branche : `fix/gk36-compagnon-relationnel-reel-2026-09-03`
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source companion / sensory / memory-forgetting
- HEAD de départ : `9b63a2137`
- Réservation : `8b87bec8e`
- HOME : `_qa/gk36/home` dans le clone seulement
- Faits : **tous fictifs**. Aucune donnée personnelle réelle.

## Garde-fous

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama `qwen3:4b-instruct` seulement (pas de 27B). `ollama ps` avant tout appel.
- HOME temporaire dans le clone. Jamais le pont 8129 ni les enceintes (lecteur audio factice). Faux Telegram local (seams injectés).
- Original `~/code-buddy` interdit. ComfyUI 8188/8189 intact. Aucun service systemd.
- Invariants de la nuit : SENSE1 / SENSE3 / SENSE7 / GT2 — non cassés (rejeu dans l'union).
- Un commit par défaut (test rouge → correctif → vert).

## Environnement mesuré

- Ollama `127.0.0.1:11434` : `qwen3:4b-instruct` déjà chargé (GPU, 24 GB VRAM). Aucun 27B lancé.
- Pont 8129 et ComfyUI 8188 : écoutés, **non contactés**.
- `HOME` des scripts live : `_qa/gk36/home`. Artefacts : `_qa/gk36/` (gitignoré).
- Horloge factice : 2026-09-03 08:00 / 14:00 / 20:15 Europe/Paris.

## Tableau scénario → attendu → obtenu → correctif → commit

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| 20 énoncés d'une journée (frustration, joie, « j'ai un train demain », souvenir Luna) | Journal épisodique consolidé (« de quoi on a parlé ») | Avant : seulement les 6 derniers tours, **sans train ni concert**. Après : train, concert, galère, joie | Garder les énoncés saillants (émotion + fait personnel) en plus de la fenêtre récente | `96ef80e2a` |
| Raffinerie LLM du journal | Pas d'invention | « divorce à Paris / vente de la maison » **écrasait** le journal | Jeter le refine si < 50 % des termes saillants viennent des énoncés | `3a06815d5` |
| État relationnel sur les 20 tours | Dérive sans ratchet ni gamification, bornes [0,100] | Conforme : clamp, retour vers baseline sous `neutral`, réunions plafonnées à 100 | aucun (contrat déjà là) | — |
| Accueil du soir | Référence l'épisode sans jargon | Avant : « Qu'est-ce qui t'a marqué aujourd'hui ? » **sans train**. Après : « … on parlait de souviens, concert, luna, train. » | Tisser un indice d'épisode jargon-free (soir/après-midi) | `a34cd9a94` |
| Accueil LLM | Pas de XML, pas de `/100`, pas de self-evolution non demandée | Avant : la phrase jargon était parlée. Après : `null` → repli déterministe | Filtre `isJargonArrivalLine` ; arrivée `includeSelfEvolution: false` | `d5a92c396` |
| Proactif `_MIN_GAP_MS` | Au plus 1 initiative par fenêtre, y compris Telegram | Telegram **ignorait** le chef d'orchestre | `claim('proactive')` aussi à distance | `9480d283f` |
| Cooldown 12 h | Pas de rejeu avant 12 h | Conforme (`canSend` + tick) | aucun | — |
| Politique Maison `rest` | Silencieux local et distant | Conforme (`evaluateHomeInteractionPolicy`) | aucun | — |
| Absent | Telegram factice, pas les enceintes | Conforme (`telegramVoice` appelé, `say` non) | aucun | — |
| Initiative pendant la parole | Ne pas parler par-dessus | Avant : milestone **parlé** alors que `speaking: true`. Après : silence | Garde `speaking` / `isSpeaking` si présent | `9480d283f` |
| Préférence épinglée | Ne s'efface jamais | Conforme (`isProtectedMemory` casse-insensible) | aucun | — |
| Fait ancien non rappelé | Archivé puis restaurable | Conforme (`applyForgetting` → `restoreFromArchive`) | aucun | — |
| Faux fait auto-capturé | Pas gardé | « I never said that » / Ruby on Rails / « je n'ai jamais dit ça » : **aucun** souvenir | aucun (G3 déjà en place) | — |
| `self_evolution` | Cité seulement si on le demande | « qu'est-ce qui a changé chez toi ? » = oui ; bonjour / accueil = non | Filtre accueil + garde vocale existante | `d5a92c396` |
| Doc CLAUDE.md | Vrai | Doublon `_MIN_GAP_MS` ; l'arrivée **n'injectait pas** l'épisode | Une ligne PROACTIVE, accueil = indice d'épisode, refine ancré | `3bb983580` |

## Défauts (un commit chacun)

1. **Journal muet sur le train** — rouge : `expected … to match /train/i`, obtenu les 6 derniers tours. Vert après `96ef80e2a`.
2. **Épisode qui invente** — rouge : refine « divorce à Paris » conservé. Vert après `3a06815d5`.
3. **Accueil du soir sans l'épisode** — rouge : pas de `train` dans l'ouvreur. Vert après `a34cd9a94`.
4. **Jargon / self-evolution dans l'accueil LLM** — rouge : XML + « J'ai appris à » + `72/100` parlées. Vert après `d5a92c396`.
5. **Initiative qui parle par-dessus** — rouge : `say` appelé pendant `speaking: true`. Vert après `9480d283f`.
6. **MIN_GAP contourné par Telegram** — rouge : Telegram malgré `conductor.claim === false`. Vert après `9480d283f`.
7. **Doc fausse / doublon** — CLAUDE.md corrigé `3bb983580`.

## Invariants nuit (SENSE1 / SENSE3 / SENSE7 / GT2)

Rejeu dans l'union : `tests/sensory/hole-sense6-*.test.ts`, `revue-gt1-mutations.test.ts`, `hole-arrival-*.test.ts`. Inclus dans **26 fichiers / 195 tests, 0 échec**.

## Live Ollama (qwen3:4b-instruct)

- `ollama ps` : uniquement `qwen3:4b-instruct` (pas de 27B).
- Journal + accueil **déterministe** (horloge 20:15) : l'épisode contient le train et le concert ; l'accueil dit « on parlait de souviens, concert, luna, train ».
- `buildLlmArrivalOpener` vers `127.0.0.1:11434` : **null** (timeout / pas de contenu avant 8–25 s). Repli déterministe intact. Aucune clé payante, aucun audio réel.

## Preuves

```
npx vitest run tests/companion/gk36-compagnon-relationnel.test.ts
# Test Files  1 passed  |  Tests  15 passed

npx vitest run tests/companion/gk36-compagnon-relationnel.test.ts \
  tests/companion/proactive-engine.test.ts tests/companion/orchestrator.test.ts \
  tests/companion/relational-context.test.ts tests/companion/relationship-mood.test.ts \
  tests/companion/relationship-state.test.ts tests/companion/reply-augment.test.ts \
  tests/companion/home-interaction-policy.test.ts tests/sensory/episodic-journal.test.ts \
  tests/sensory/arrival-opener.test.ts tests/sensory/arrival-greeting.test.ts \
  tests/memory/memory-forgetting.test.ts tests/memory/archive-restore.test.ts \
  tests/memory/revue-gemini-forgetting-pinned.test.ts tests/memory/revue-gemini-autocapture.test.ts \
  tests/sensory/hole-sense6-*.test.ts tests/sensory/revue-gt1-mutations.test.ts \
  tests/sensory/hole-arrival-voice-collision.test.ts \
  tests/sensory/hole-arrival-conductor-race.test.ts \
  tests/sensory/hole-arrival-home-policy.test.ts
# Test Files  26 passed  |  Tests  195 passed

npx tsc --noEmit -p tsconfig.json                         # exit 0
npx tsc --project tsconfig.gpuNode-identity.json --noEmit # exit 0
npx eslint --max-warnings=0 src/sensory/episodic-journal.ts \
  src/sensory/arrival-opener.ts src/sensory/semantic-vision-reaction.ts \
  src/companion/proactive-engine.ts tests/companion/gk36-compagnon-relationnel.test.ts \
  tests/companion/proactive-engine.test.ts tests/sensory/episodic-journal.test.ts
# exit 0
git diff --check                                          # exit 0
```

## Reste ouvert

- Accueil LLM Ollama 4b : pas de phrase dans le délai (repli déterministe OK). Un modèle plus rapide ou un timeout plus long est un choix opérateur, pas un trou de contrat.
- L'indice d'épisode dit « souviens, concert, luna, train » (termes) plutôt qu'une phrase « ton train de demain » : compréhensible, un peu télégraphique.
- `getMemoryManager()` n'est pas lu par l'arrivée (on lit `episodes.jsonl` du cwd) : volontaire, pour ne pas toucher `~/.codebuddy`.
