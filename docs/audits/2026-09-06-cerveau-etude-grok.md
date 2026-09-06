# Étude : le « cerveau » de Code Buddy (compagnon Lisa) vu par Grok

> **Date :** 2026-09-06. **Auteur :** Grok 4.6. **Branche :** `etude/cerveau-grok-2026-09-06`.
> **Périmètre :** un seul livrable. Idées seulement. Aucune copie de code xAI, Hermes, OpenClaw ou autre. Aucune écriture hors ce fichier (plus la ligne de réservation Fable 5).
> **Méthode :** lecture du worktree + publications officielles xAI (URLs citées). `~/code-buddy` et `~/.codebuddy` n'ont pas été ouverts.
> **Repli fournisseur :** déjà en chantier ailleurs. Ici : le contour seulement (santé visible, parole à l'utilisateur).

---

## 0. Sources officielles xAI (consultées le 2026-09-06)

| Sujet | URL |
|---|---|
| Produit Grok (voix sub-seconde, mémoire cross-chats, multi-agent) | https://x.ai/grok |
| Grok 4 (outils natifs, live search, Voice Mode + caméra) | https://x.ai/news/grok-4 |
| Grok 4.6 (500k contexte, reasoning configurable) | https://docs.x.ai/developers/grok-4-6 |
| Index docs | https://docs.x.ai/llms.txt |
| Reasoning / `reasoning_effort` | https://docs.x.ai/developers/model-capabilities/text/reasoning |
| Multi-agent research | https://docs.x.ai/developers/model-capabilities/text/multi-agent |
| Tools (web_search, x_search, code_execution, collections) | https://docs.x.ai/developers/tools/overview · https://docs.x.ai/developers/tools/web-search · https://docs.x.ai/developers/tools/x-search |
| Voice realtime (VAD, barge-in, tools, resumption) | https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech |
| Prompting voix (5 sections, Variety, pas de phonétique) | https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/prompting-guide |
| Voice Agent API (TTFA < 1 s, OpenAI Realtime-compat) | https://x.ai/news/grok-voice-agent-api |
| Grok Voice Think Fast 1.0 (τ-voice Bench, full-duplex) | https://x.ai/news/grok-voice-think-fast-1 |
| 21 voix + tags `[pause]` / `<whisper>` | https://x.ai/news/new-flagship-voices |
| Voice Agent Builder | https://x.ai/news/grok-voice-agent-builder |
| Rate limits 429 + backoff | https://docs.x.ai/developers/rate-limits |
| Grok Build : `/effort`, `/remember`, `/memory`, `/dream`, permissions, sandbox | https://docs.x.ai/build/modes-and-commands · https://docs.x.ai/build/features/permissions · https://docs.x.ai/build/features/sandbox |
| Grok Bot (VM persistante, Auto Review) | https://docs.x.ai/grok-bot/overview · https://docs.x.ai/grok-bot/approvals-security-and-privacy |
| Grok Build mémoire (CLI, Markdown, opt-in) | https://github.com/xai-org/grok-build (section Memory du shell) |

**Ce que Grok *n'est pas* ici.** Les Companions 3D (Ani, Rudy, Valentine) sont un produit grand public, gamifié, distinct du compagnon local Lisa. Cette étude prend Grok comme *exemple de mécanismes* (voix, mémoire, effort, VM, recherche, 429) — pas comme persona à copier.

---

## 1. Cartographie honnête du cerveau tel qu'il est

### 1.1 Flux réel (perception → décision → parole/action → mémoire)

```
buddy-sense (Rust)                         buddy-vision (Python)
  vital.rs heartbeat ──┐                     person_entered / drowsy / keyframe
  audio / live_audio ──┤
  video / screen / ui ─┤
         │             │
         ▼             ▼
   thalamus bus.rs     (coalesce + escalate ≥128 ; vital jamais coalescé)
         │
         ▼
   bridge.rs  ──WS loopback :8129──►  sensory-bridge.ts
                                         Origin interdit, 127.0.0.1 only, token
                                         │
                                         ▼
                              event bus  sensory:perception
                                         │
                    ┌────────────────────┼────────────────────────┐
                    ▼                    ▼                        ▼
            reactions.ts           speech-reaction          vision / semantic-vision
            → sensory-memory       STT → hearing            camera_analyze / Telegram
            (buffer 1000)          shouldRespond?           arrival → markEngaged
                    │                    │
                    │                    ▼
                    │            hybrid-reply  (phatique / prefetch / joke
                    │              / chitchat / ACT agent)
                    │                    │
                    │                    ▼
                    │            voice-loop  TTS (Kyutai / ElevenLabs / Pocket)
                    │              + sayNow + (opt) Telegram voice note
                    │                    │
                    ▼                    ▼
            HeartbeatScheduler     persistent-memory.md
            dreaming / episodes    episode:recent, dream:recent
            vitals / rules         CKG (autre porte)
```

Couture unique du serveur : `src/server/index.ts:1322` (`CODEBUDDY_SENSORY=true`, câblé **une fois** par process).

### 1.2 Ce qui est câblé (tourne dès que le système nerveux est allumé)

| Maillon | Fichier:ligne | Rôle |
|---|---|---|
| Pont WS loopback | `src/sensory/sensory-bridge.ts:69`, `:108` (Origin), `:117` (loopback) | Ingress daemon. Never-throws sur frame malformée. |
| Thalamus Rust | `buddy-sense/src/bus.rs:1`, `:16` (`ESCALATE_SALIENCE=128`), `:75` | Coalescing + digest `memory/digest`. |
| Cœur autonome | `buddy-sense/src/senses/vital.rs:11` | 1 beat/s, salience 5, jamais coalescé. |
| Œil sémantique | `buddy-vision/watch.py:1` | Transitions `person_entered` / `person_lost` / `drowsy`. `suppress_origin=True` obligatoire (le pont refuse `Origin`). |
| Réactions génériques | `src/sensory/reactions.ts:40` | Log + `SensoryMemory.push`. |
| Mémoire courte | `src/sensory/sensory-memory.ts:12` | Buffer 1000, `drain()` au rêve. |
| Pacemaker | `src/sensory/heartbeat-scheduler.ts:40` | Traitements tous les N beats, `inFlight` **par organe**. |
| Porte « parler ? » | `src/sensory/respond-decider.ts:53`, `:516` | Adressée / fenêtre / greeting / (opt) chime-in. Never-throws. Défaut **contextual**, pas `always`. |
| Boucle parole | `src/sensory/speech-reaction.ts:1605` | `speech_end` → STT → `onHeard`. Barge-in `:215`, `:233`. |
| Cerveau hybride | `src/sensory/hybrid-reply.ts:445` | Phatique → prefetch → blague → chitchat **ou** agent. |
| Bouche | `src/sensory/voice-loop.ts:1856` (`defaultReply`), `:3174` (`sayNow`), `:3331` (`makeVoiceReply`) | LLM + TTS + historique local. |
| Commandes vocales | `src/sensory/agent-reply.ts:405`, `:645` | `CodeBuddyAgent` headless sous `PermissionModeManager`. Opt-in ACT. |
| Conducteur de bouche | `src/companion/orchestrator.ts:30` | Au plus une initiative / `CODEBUDDY_COMPANION_MIN_GAP_MS` (45 s). Rappels exempts. |
| Identité vocale | `src/personas/persona-manager.ts` + `src/companion/companion-voice-character.ts:21` | `spokenPrompt` court + spine réinjectée. |
| Canaux | `src/channels/core.ts:23`, `src/channels/telegram/` | Intake opt-in `CODEBUDDY_SERVER_CHANNEL_INTAKE`. |
| Client LLM | `src/codebuddy/client.ts:306`, fallback `:685` | Un provider + liste `CODEBUDDY_FALLBACK_PROVIDERS`. |
| Routage vitesse | `src/fleet/model-selector.ts:217` `selectFastestModel` | Voix non épinglée. |

**Deux défauts ON dès que le pont sensoriel l'est** (pas des flags `=true`) :

- Prefetch fraîcheur : `src/server/index.ts:2050` (`CODEBUDDY_PREFETCH !== 'false'`).
- Éval conversationnelle : `src/server/index.ts:2013` (`CODEBUDDY_CONVERSATION_EVAL !== 'false'`).
- Timers cuisine : `src/server/index.ts:2110` (indépendant du pont ; `CODEBUDDY_COOKING_TIMERS !== 'false'`).

### 1.3 Opt-in : code vivant, mort tant que le flag est off

Sans la variable, le comportement est (par construction documentée) byte-identique. Câblé dans `src/server/index.ts` aux lignes indiquées.

| Flag | Ligne serveur | Module | Effet utilisateur |
|---|---|---|---|
| `CODEBUDDY_SENSORY` | 1322 | pont + réactions | Sans ça : pas d'oreilles, pas d'yeux. |
| `CODEBUDDY_SENSORY_SPEECH` + `TOKEN` | 1427 | STT | Entend, ne parle pas. |
| `CODEBUDDY_SENSORY_SPEAK` + `CODEBUDDY_TTS_VOICE` | 1434 | bouche | Sans TTS : **entend, reste muette** (log loud `describeVoiceReadiness` `voice-loop.ts:463`). |
| `CODEBUDDY_SENSORY_SPEAK_ACT` | 1539 | agent | Commandes réelles. Défaut = bavardage + introspection `plan`. |
| `CODEBUDDY_SENSORY_CAMERA` + token | 1378 | vision + sémantique | Accueil + Telegram photo. |
| `CODEBUDDY_SENSORY_SCREEN` | 1404 | écran | Percept `screen/change`. |
| `CODEBUDDY_SENSORY_ERRORWATCH` | 1416 | suggestion vocale | Pas d'action auto. |
| `CODEBUDDY_SENSORY_RULES` + token | 1395 | règles | Shell / webhook loopback / `kill_process`. |
| `CODEBUDDY_SENSORY_BARGE_IN` | voice-loop 3354, speech-reaction 215 | coupe la parole | Sans `CODEBUDDY_SENSORY_AEC_TRUST` : pas de barge-in acoustique. |
| `CODEBUDDY_SENSORY_CHIME_IN` | respond-decider 96 | juge LLM rare | Défaut off — se taire est le succès. |
| `CODEBUDDY_SENSORY_BACKCHANNEL` / `_REPAIR` | 1811 | « hmm » / « Pardon ? » | |
| `CODEBUDDY_TTS_TWO_SPEED` | `src/voice/two-speed-voice.ts:25` | Kyutai court / ElevenLabs long | DARK3, défaut off. |
| `CODEBUDDY_COMPANION_RELATIONAL` | 1534 | faits + mood + épisode | |
| `CODEBUDDY_COMPANION_PRESENCE` | 2136 | mot chaud si présent | |
| `CODEBUDDY_COMPANION_PROACTIVE` | 2148 | Lisa écrit **la première** (voix ou Telegram) | |
| `CODEBUDDY_COMPANION_IDLE` | 2159 | travail $0 seule | |
| `CODEBUDDY_COMPANION_INNER_LIFE` | 1974 | vignette « ce que j'ai fait » | |
| `CODEBUDDY_COMPANION_EVENT_FOLLOWUPS` | 1727 | « comment c'était, le train ? » | |
| `CODEBUDDY_COMPANION_SELF_EVOLUTION` | relational-context 46 | notes CHANGELOG jargon-free | |
| `CODEBUDDY_REMINDERS` | 2122 (runner) + 1642 (ack vocal) | indépendant du micro | |
| `CODEBUDDY_EPISODE_JOURNAL` | 1953 | `episode:recent` | |
| `CODEBUDDY_VOICE_IMPROVE` | 1998 | guidance + drift borné | |
| `CODEBUDDY_JOKES_TOPUP` | 2071 | pool LLM ; liste curatée marche sans | |
| `CODEBUDDY_SYSTEM_VITALS` / `_SCHEDULE_TICKS` / `_DOMAIN_EVENTS` / `_HEARTBEAT_FALLBACK` | 1913–2088 | surveillance événementielle | Voir `docs/surveillance-evenementielle.md`. |
| `CODEBUDDY_COLLECTIVE_MEMORY` | `src/services/prompt-builder.ts:501` | CKG dans le **prompt agent** | |
| `CODEBUDDY_MEMORY_FORGET` | dreaming.ts:132 | Ebbinghaus + archive | |
| `CODEBUDDY_VOICE_TO_TELEGRAM` | voice-loop.ts:3240 | `sayNow` → note vocale | **Les ack vocaux forcent `phoneDelivery:'never'`** (index.ts:1579) : la maison n'inonde pas le téléphone. |
| `CODEBUDDY_SELF_IMPROVE` | `src/agent/self-improvement/` | Darwin-Gödel, jamais `src/` | Idle trigger séparé. |

**Maison / rest** : `home-interaction-policy.ts` coupe les initiatives en mode repos. Rappels : toujours.

### 1.4 Enregistré d'un côté, jamais consommé de l'autre

Le motif de `docs/audits/2026-07-15-codex-backlog.md` (P1 « enregistré / jamais consommé ») et de `docs/reports/2026-09/RAPPORT-AUDIT-CODE-BUDDY-2026-09-02.md` s'applique **au cerveau**, pas seulement au catalogue d'outils.

| Produit | Écrit / émis | Consommé par la bouche ? | Verdict |
|---|---|---|---|
| `memory/digest` thalamus | `buddy-sense/src/bus.rs:56`, `:126` — « short-term recall FROM THE BODY » | Le pont l'admet (`sensory-bridge.ts:63`). `reactions.ts:47` le pousse. `dreaming.ts:104` **draine** le buffer. **Aucun** `decide` / `defaultReply` / relational-context ne lit le digest. | Enregistré. Le commentaire Rust promet un rappel ; le TS n'en fait pas un. |
| `dreams.jsonl` / `episodes.jsonl` | dreaming.ts:111, episodic-journal.ts:269 | Les **clés** `dream:recent` / `episode:recent` sont promues (`dreaming.ts:173`, `episodic-journal.ts:298`). Les JSONL ne sont **pas** relus (déjà noté `docs/reports/2026-09/RAPPORT-SYSTEME-NERVEUX-2026-09-01.md:156`). | Journaux d'audit, pas de restauration. |
| CKG collectif | ledger JSONL, `prompt-builder.ts:501` | Voix chitchat (`defaultReply`) **n'appelle pas** le prompt-builder. Seul ACT (`agent-reply.ts:418` → `CodeBuddyAgent`) peut l'injecter, et seulement si `CODEBUDDY_COLLECTIVE_MEMORY=true`. | Cerveau coding ≠ cerveau parlé. |
| Cognition « shadow mode » | index.ts:1333–1346, mesh `voice:hearing` / `voice:dialogue` | `acquireCognitiveContext` (index.ts:1476) peut louer 4 items / 1200 chars. Spécialistes : `CODEBUDDY_COGNITIVE_SPECIALISTS`. | Câblé, mais **ombre** : métriques heartbeat, pas de preuve que Lisa *parle* de ce qu'elle a vu il y a 30 s. |
| `check-in.ts` | moteur d'humeur | `presence-loop.ts:4` dit qu'il « was built but never SPOKEN » — **réparé** si `CODEBUDDY_COMPANION_PRESENCE`. Sinon mort. | Opt-in qui referme un vrai trou historique. |
| Mission-board / radar / curator / impulses | CLI `buddy assistant …` (`src/commands/cli/native-engine-commands.ts:1750`) | Pas dans `hybrid-reply` ni `onHeard`. | Outils opérateur, pas le compagnon vivant. |
| `fashion-scene-catalog.ts` | scripts YouTube / tests | Hors flux perception→parole. | Pipeline média, pas cerveau. |
| `voice-replay-lab.ts` | CLI assistant | Labo, pas runtime. | OK. |
| Anneau thalamus Rust `Memory.recent` | `bus.rs:40` `#[allow(dead_code)]` | « not yet read by the binary » — le digest est le seul lecteur. | Phase 2/3, honnêtement marqué. |
| `confirmation_requested` (audit outils) | cité TRAJECTORY | Hors cerveau Lisa. | Même famille de dérive. |

`relational-context.ts:5-12` documente **lui-même** une déconnexion historique (user-model + relationship-state + présence existaient, la voix ne les lisait pas). Le compositeur existe ; l'injection reste derrière `CODEBUDDY_COMPANION_RELATIONAL`. Sans le flag, Lisa raisonne sur les 6 tours hybrides + le `spokenPrompt`.

### 1.5 Décision de se taire (déjà une force)

`respond-decider.ts:1-19` : écouter tout, parler si adressée. Tiers cheap-first. Le chime-in LLM échoue **fermé** (erreur → silence). La fenêtre d'engagement **ne glisse pas** sur le bavardage ambiant (`:626-632`) — c'est l'anti-« elle répond à toute la pièce ». `markEngaged('arrival')` (index.ts:1388) relie l'accueil caméra à la parole, sans mot de réveil.

C'est plus proche d'un humain dans un salon que d'un Voice Mode always-on.

### 1.6 L'incident du jour : muette sur 429, sans repli *perçu*

Ce n'est pas « aucun repli n'existe ». C'est « le repli n'est pas une *expérience* ».

1. **Classification 429** déjà là : `src/codebuddy/provider-error-classifier.ts:8-19` (transitoire vs quota fatal, `Retry-After`).
2. **Repli fournisseur** déjà dans `CodeBuddyClient` (`client.ts:466-482`, `:685`). Vocabulaire env : `CODEBUDDY_FALLBACK_PROVIDERS` / `_PROVIDER` / `_MODEL` (`provider-fallback.ts:156-163`). **Lane séparée : ne pas la refaire.**
3. **La voix construit un client à 3 arguments** (`voice-loop.ts:1926`, `agent-reply.ts:601`, `respond-decider.ts:474`, `arrival-opener.ts:261`) : les fallbacks *env* s'appliquent, mais :
   - `resolveVoiceModel` (`voice-loop.ts:1233`) peut **épingler** un cloud (OAuth Codex, `CODEBUDDY_SENSORY_SPEAK_MODEL`) ;
   - un 429 transitoire déclenche des retries (`stream-retry.ts`) **avant** le catch ;
   - pendant ce temps **aucun premier son** (sauf DARK3 / ack ACT) ;
   - le catch (`defaultReply:1950`) renvoie `conversationFailureReply` (`conversation-orchestrator.ts:90`) — honnête, **si** on arrive au catch et **si** le TTS tient.
4. **TTS cloud** : plafond ElevenLabs (`src/voice/elevenlabs-voice.ts:263`) → repli local. Un **HTTP 429** ElevenLabs n'est pas le même chemin que le plafond mensuel. DARK3 (`CODEBUDDY_TTS_TWO_SPEED`) est le filet pour les phrases courtes, **défaut off**.
5. **Never-throws** : un échec devient `''` ou une phrase d'excuse. `''` + TTS no-op = **silence**. C'est ça, « muette ».

xAI documente le contraire côté API : sur 429, backoff exponentiel **explicite** (`https://docs.x.ai/developers/rate-limits` § Handling rate limit errors). Grok Voice, lui, ne laisse pas l'utilisateur dans le vide : le WebSocket reste vivant, le VAD continue. Lisa, pendant un 429, n'a plus de bouche.

### 1.7 Parité Hermes / OpenClaw (ce que ça n'est pas)

`docs/hermes-openclaw-parity.md` : plus de *code gap* enregistré vs Hermes v2026.7.1+516 / OpenClaw 2026.6.11 sur canaux, mémoire persistante, cron, MCP. Telegram est une surface de production. **Le cerveau Lisa (sens, thalamus, respond-decider, hybrid, ACT, conductor) n'a pas d'équivalent 1:1 chez eux** — c'est le différenciateur, et c'est aussi là que les dérives « écrit / jamais lu » se nichent.

---

## 2. Grok comme exemple — mécanisme public, puis retenue concrète

### 2.1 Continuité conversationnelle et mémoire

**Grok (documenté).**

- App : « Memory across chats » — hors fenêtre de contexte, consultable / éditable / supprimable (produit https://x.ai/grok).
- Voice : **session resumption** opt-in (`resumption.enabled`, `conversation_id` en query). Replay des tours au reconnect. Expire ~30 min d'inactivité (docs speech-to-speech § Session Resumption).
- Grok Build : mémoire Markdown `~/.grok/memory/` (global + workspace), `/remember`, `/memory`, `/dream`, `/flush` ; injection au 1er tour et après compact ; **opt-in** `GROK_MEMORY` / `[memory] enabled`.
- Grok Bot : équipier **nommé**, état durable (fichiers, sessions navigateur, préférences) ; les Bots **partagent un ordinateur**, ce n'est **pas** une frontière de sécurité (docs grok-bot/overview).
- API : Collections Search = base de connaissances, pas une « âme ».

**Lisa aujourd'hui.** Hybride : 6 tours (`hybrid-reply.ts:446`). Pont voix↔canal (`src/conversation/cross-channel-bridge.ts`). Relationnel opt-in. Épisode promu `episode:recent`. CKG pour l'agent coding. Rêves drainés. **Pas** d'équivalent `conversation_id` si le pont WS buddy-sense casse : l'engagement `respond-decider` est en RAM.

**Retenue.** Une reprise de session **vocale** (TTL 30 min, opt-in, local JSON, jamais de transcript dans le dépôt) + une injection **bornée** de `episode:recent` / digest thalamus dans le prompt parlé. Ne pas fusionner CKG collectif et dossier intime.

### 2.2 Choix de répondre ou de se taire

**Grok.** Voice session : `turn_detection.type = server_vad` ou `null` (manuel). Seuil, `silence_duration_ms`, `prefix_padding_ms`. `idle_timeout_ms` : le serveur **relance** si l'humain ne parle plus. Produit app : conversation always-on une fois le mode voix ouvert.

**Lisa.** Conservative-by-design (`respond-decider.ts:17`). Chime-in off. Fermeture explicite (`isConversationClosing:460`). Burst ambiant → silence. C'est **mieux** qu'un Grok always-on pour un micro-salon.

**Retenue.** Garder le silence comme succès. Emprunter seulement `idle_timeout` **après une adresse** (réengager « t'es encore là ? » via le conductor, pas un VAD serveur cloud). Ne pas activer `always` en résident.

### 2.3 Persona stable sans tics

**Grok.** Prompting guide voix : 2ᵉ personne, **cinq sections dans cet ordre** (Role, Objective, Conversation Flow, Guardrails, Voice & Style). « If the model becomes repetitive, add a Variety rule. » Interdit de scripter la phonétique / le débit dans le prompt (ça ne contrôle pas l'audio). Exemples > paragraphes. Outils nommés = outils réellement attachés.

**Lisa.** Empilement : `spokenPrompt` + `LISA_XAI_VOICE_SPINE` (nomme Ani/Mika, `companion-voice-character.ts:21`) + few-shots + crise + plan conversationnel + émotion + anti-openers + relationnel XML + pont + horloge + short-first. `LISA_COMPANION_SYSTEM_PROMPT` (`identity/companion-identity.ts:28`) est la persona **longue agent**, pas le chemin voix. `rewriteRepeatedVoiceOpener` (`voice-loop.ts:1615`) et la boucle qualité (`conversation-improvement-loop.ts`) soignent les tics *après coup*.

**Retenue.** Une structure Grok-like **courte** pour la bouche. Variety rule. Retirer les noms de personnages xAI du spine (énergie, pas cosplay). Ne pas empiler dix blocs XML : c'est précisément ce qui produit les tics (« mon cœur », « on casse ça ensemble ») par dilution.

### 2.4 Voix : latence, barge-in, humour

**Grok.** Voice Agent API : TTFA < 1 s, ~5× le concurrent (annonce 2025-12-17). Think Fast : τ-voice Bench (bruit, accents, interruptions, tour-taking). `server_vad` + outils `web_search` / `x_search` / MCP **dans la même session audio**. Tags `[pause]` / `<whisper>`. 21 voix + clone. `idle_timeout_ms` relance. Prix agent ~0,05 $/min.

**Lisa.** Pipeline STT (sherpa-rs / parakeet / faster-whisper) → LLM → TTS (ElevenLabs / Kyutai / Pocket). Streaming phrases (`voice-stream.ts`). Short-first CONV3. Barge-in opt-in + marge anti-écho + AEC trust. Humour = liste curatée instantanée (`jokes.ts:17`) + top-up opt-in. DARK3 = Kyutai ≤80 chars. **Pas** un modèle speech-to-speech unique : chaque étage peut 429 / timeout **séparément**.

**Retenue.** Ne pas remplacer le pipeline local par `wss://api.x.ai/v1/realtime` (casse $0, loopback, offline). Emprunter : (1) premier son **avant** la fin LLM (ack / Kyutai) ; (2) VAD déjà côté Rust — exposer `silence_duration` / padding comme Grok ; (3) humour déjà local, le garder hors LLM.

### 2.5 Agents persistants avec VM

**Grok Bot.** VM cloud persistante (navigateur, FS, terminal). Plusieurs Bots, **un** ordinateur compte. Routines apprises par démonstration. Auto Review (Require Approval gagne). Mots de passe : l'humain reprend la main. « Do not use separate Bots as a security boundary. »

**Lisa.** Pas de VM. ACT = `CodeBuddyAgent` éphémère (`agent-reply.ts:405`). Idle-loop = artefacts $0 lecture. Shadow workspace = autre flag CB2. Missions = CLI. Rappels = JSON local.

**Retenue.** **Ne pas** adopter la VM partagée. Emprunter le *contrat* : équipier nommé, travail qui continue si le laptop est fermé (déjà vrai pour `buddy server` + rappels), **approbation** avant send/publish/delete, secrets jamais dans le chat vocal. Un « job » Lisa = reminder + idle artefact + mission-board **parlé**, cwd local, pas un desktop cloud.

### 2.6 Recherche en direct

**Grok.** Pas d'actu sans outils (`docs.x.ai/developers/models` : knowledge cutoff Grok 4.6 = février 2026 / docs grok-4-6 : janvier 2026 — se fier à la page Models). `web_search` + `x_search` **côté serveur**, citations. Multi-agent `grok-4.20-multi-agent` orchestre. Voice session : les mêmes outils. Grok 4 : RL pour choisir ses requêtes (https://x.ai/news/grok-4).

**Lisa.** Prefetch (`prefetch-engine.ts:1`) : météo / titres / agenda **en cache**, hit instantané dans l'hybride. Rateau si `CODEBUDDY_PREFETCH=false`. Recherche live = ACT (agent + `web_search` outil) **ou** rien. Pas d'`x_search` dans la bouche.

**Retenue.** Sur un miss prefetch « il se passe quoi dehors ? », une **voie search bornée** (1 requête, timeout court, $0 SearXNG si `SEARXNG_URL`, sinon silence honnête — déjà le texte de `conversationFailureReply` si `needsFreshContext`). Pas un DeepSearch 10 étapes dans le salon.

### 2.7 Routage effort / vitesse

**Grok.** `grok-4.6` : `reasoning_effort` `low|medium|high|xhigh` (défaut **high**, **non désactivable**). Voix : `reasoning.effort` `high|none`. CLI `/effort`. Multi-agent : l'effort = **nombre d'agents** (4 ou 16), pas la profondeur.

**Lisa.** Fast lane `selectFastestModel` / `CODEBUDDY_SENSORY_SPEAK_MODEL`. Factual lane `CODEBUDDY_SENSORY_SPEAK_FACT_MODEL`. ACT = autre modèle (`CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL`) — le plus rapide tool-caller peut être trop petit (`agent-reply.ts:406-410`). Thinking Grok `budget_tokens` existe pour le coding agent, **pas** branché sur le tour parlé.

**Retenue.** Table explicite : phatique → aucun LLM (`fastCompanionReply`) ; chitchat → low/fast local ; factuel → fact model ; ACT → modèle capable épinglé. **Jamais `xhigh` en voix.** Le défaut Grok `high` est un contre-exemple pour un micro-salon.

### 2.8 Quotas, pannes, 429

**Grok.** 429 = RPS/TPM par palier de dépense. Docs : backoff exponentiel, pas un retry infini sur un quota mort. Voice et Imagine : limites séparées, sales. Prompt cache (préfixe, `x-grok-conv-id`). Coût outils serveur agrégé.

**Lisa.** Classifier fatal vs transitoire : déjà. Repli liste : déjà (autre lane). Manque : **parole pendant l'attente**, **santé injectée dans Lisa**, **message utilisateur** (voix maison + Telegram si absent). `buddy sensory status` (`sensory-status.ts:1`) voit le pacemaker, pas le 429 du LLM.

**Retenue (contour, pas le repli).** Voir chantier 1.

### 2.9 Sécurité des actions

**Grok Build.** Modes Ask / Auto / Always-approve ; deny gagne ; sandbox Landlock/Seatbelt (défaut **off**) ; plan mode indépendant ; enterprise peut **verrouiller** always-approve. Hooks `PreToolUse` fail-**open** sauf deny explicite.

**Grok Bot.** Auto Review modèle + Allow once / Deny / Always allow. Require Approval gagne. Exécution machine locale : Ask every time par défaut.

**Lisa.** ACT sous `PermissionModeManager` (même que `ConfirmationService`). Validateur statique + secret/deploy. Règles sensorielles : token + `isDestructive` à l'écriture (`sensory-action-executor.ts:102`). Kill process : double opt-in. Transcript STT **lossy** : un `dontAsk` vocal est plus dangereux qu'un `dontAsk` clavier.

**Retenue.** Lire la commande **avant** d'agir (Grok Bot « review the target »). Voix : writes = confirmation « oui » même si le mode CLI est permissif. Ne pas importer Auto Review cloud.

---

## 3. Dix chantiers (valeur / effort)

Invariants communs, non négociables : **opt-in défaut OFF** (sauf mention), **never-throws**, **loopback**, **rien de personnel dans le dépôt**, pas de VM cloud, pas de persona xAI copiée. Le repli fournisseur n'est **pas** dans la liste.

### C1 — Parole de panne + santé visible pour Lisa *(S)* — **faire en premier**

- **Utilisateur.** À la maison : au lieu du silence, Lisa dit une phrase locale (« le cloud est saturé, je reste avec toi en local »). En déplacement : une **ligne Telegram** si la bouche maison a échoué deux fois de suite (pas à chaque retry).
- **Branche.** Autour de `conversationFailureReply` (`conversation-orchestrator.ts:90`), `defaultReply` catch (`voice-loop.ts:1950`), `hybrid-reply.ts:932`. Lire `provider-error-classifier.ts` (reason `rate_limited` vs quota). Écrire un percept `system/provider_health` consommé par `buildSpokenPromptAugmentation` (`voice-loop.ts:1709`) et par `buddy sensory status` (`sensory-status.ts:160`). **Ne pas** retoucher `chatWithProviderFallback`.
- **Invariants.** Phrase 100 % banque TTS locale (DARK3 / Pocket). Aucun secret (clé, solde, nom d'hôte) dans la phrase. Opt-in `CODEBUDDY_VOICE_INCIDENT_SPEAK=true`.
- **Test.** Injecter un 429 transitoire → premier audio < 800 ms depuis le cache, `reason=rate_limited` dans le percept ; 429 fatal quota → phrase distincte, **zéro** retry visible. `tests/sensory/voice-loop.test.ts` + `tests/sensory/sensory-status.test.ts`.
- **Moteur.** Grok (contrat) puis Luna (tests $0).

### C2 — Premier son local, même si ElevenLabs 429 *(S)*

- **Utilisateur.** Les ouvertures, ack « D'accord, je regarde », « Pardon ? », rappels restent audibles si le TTS cloud râle.
- **Branche.** `CODEBUDDY_TTS_TWO_SPEED` (`two-speed-voice.ts:25`) + banque `.codebuddy/tts-bank.txt`. Étendre le filet aux **échecs HTTP** ElevenLabs, pas seulement au plafond (`elevenlabs-voice.ts:263`).
- **Invariants.** Défaut : activer two-speed **pour les phrases de la banque seulement**, pas pour tout le chitchat. Jamais de cloud obligatoire pour « je t'écoute ».
- **Test.** `tests/sensory/dark3-two-speed-routing.test.ts` : mock 429 ElevenLabs → Kyutai/Pocket, jamais `''`.
- **Moteur.** Luna.

### C3 — Consommer `memory/digest` (et cesser de mentir dans le commentaire Rust) *(S)*

- **Utilisateur.** Lisa peut dire « il y a eu du mouvement tout à l'heure, puis plus rien » sans halluciner un rêve.
- **Branche.** Lecteur borné du dernier `memory/digest` (percept déjà sur le bus) dans `relational-context.ts` **ou** `buildSpokenPromptAugmentation`, derrière `CODEBUDDY_COMPANION_RELATIONAL`. Aligner `bus.rs:56` avec la réalité.
- **Invariants.** Compteurs + `last_kind` seulement (déjà le JSON du digest). Pas de pixels, pas de WAV, pas de transcript.
- **Test.** Frame `vital/memory/digest` → bloc `<body_recall>` présent ; sans flag → octet-identique. `tests/sensory/sensory-bridge.test.ts` + relational.
- **Moteur.** Grok.

### C4 — Table d'effort vocale (anti-xhigh) *(S)*

- **Utilisateur.** « t'es là ? » = instantané. « pourquoi le ciel est bleu ? » = lane factuelle. « commit et push » = ACT capable, jamais le 4b.
- **Branche.** Formaliser le dispatch déjà épars (`fastCompanionReply` `voice-loop.ts:815`, fact lane `:1246`, ACT `agent-reply.ts:406`) en une fonction pure `resolveVoiceEffort(heard) → instant|fast|fact|act`. Interdire `xhigh` / thinking high sur instant/fast.
- **Invariants.** Opt-in overlay ; pin env gagne. $0 local par défaut.
- **Test.** Table de phrases FR STT-bruité → effort. Mutation : une phrase phatique qui part en ACT doit rougir.
- **Moteur.** Luna.

### C5 — Resumption vocale 30 min (voix ↔ Telegram) *(M)*

- **Utilisateur.** Le pont WS buddy-sense claque : Lisa se souvient encore de la fenêtre d'engagement. Un message Telegram en voiture continue la phrase commencée à la maison (le pont existe : `cross-channel-bridge.ts:1`).
- **Branche.** Persister `respond-decider.snapshot()` + `conversationId` (TTL 30 min, fichier gitignoré). Au reconnect daemon : rejouer. S'aligner sur Grok `resumption.enabled` (idée, pas le protocole).
- **Invariants.** Pas de transcript brut dans un fichier suivi. Chiffrement si `CODEBUDDY_COMPANION_ENCRYPTION_KEY`. Opt-in `CODEBUDDY_VOICE_RESUME`.
- **Test.** `tests/sensory/conversation-conv2-resume.test.ts` déjà là — l'étendre au snapshot decider + kill/rebind pont.
- **Moteur.** Astra.

### C6 — Recherche live bornée dans la bouche *(M)*

- **Utilisateur.** « il fait quel temps / quoi dans l'actu » sans ACT. Si ça rate : la phrase honnête de `conversationFailureReply` (`needsFreshContext`), pas une invention.
- **Branche.** Prefetch miss (`prefetch-engine.ts:595`, `hybrid-reply.ts:870`) → **un** appel outil timeout ≤ 2 s (SearXNG si configuré). Pas de DeepSearch, pas de 16 agents.
- **Invariants.** Opt-in. Jamais d'outil write. Citations courtes ou silence.
- **Test.** Prefetch stale + search OK → phrase avec source ; search throw → failureReply, never-throws.
- **Moteur.** Astra ; Grok pour le contrat « cutoff vs live » (docs Models).

### C7 — Un prompt voix, pas dix XML *(M)*

- **Utilisateur.** Moins de tics (« mon cœur » en boucle), plus de Lisa stable. Même personne à la maison et sur Telegram.
- **Branche.** Remplacer l'empilement `buildSpokenPromptAugmentation` + `LISA_XAI_VOICE_SPINE` par 5 sections Grok (Role, Objective, Flow, Guardrails, Style) + Variety. **Retirer** les noms Ani/Mika. Garder crise (`crisis-safety.ts`) en tête.
- **Invariants.** Le prompt long `LISA_COMPANION_SYSTEM_PROMPT` reste l'agent texte. Voix = court. Few-shots ≤ 3, périodiques (`companion-voice-character.ts:35`).
- **Test.** Snapshot du prompt voix : sections ordonnées, zéro « Ani », zéro bloc vide. Bench anti-répétition existant (`conversation-quality`).
- **Moteur.** Grok (texte) + Astra (câblage).

### C8 — Lire l'action avant de l'exécuter (voix) *(M)*

- **Utilisateur.** « envoie ça à tout le monde » mal transcrit ne part pas. Lisa dit ce qu'elle va faire, attend « oui ».
- **Branche.** `makeAgentReply` (`agent-reply.ts:645`) : pour tout write / `send` / `rm` / channel, un tour **readback** (banque TTS) avant `CodeBuddyAgent`. Deny = stop. Grok Bot Auto Review = idée de *gate*, pas le modèle cloud.
- **Invariants.** Même en `dontAsk` **vocal**. Le CLI headless inchangé. STT n'est pas une confirmation.
- **Test.** Transcript « supprime tout » → pas d'outil write, phrase de readback ; « oui » suivant dans la fenêtre → execute. `tests/sensory/agent-reply.test.ts`.
- **Moteur.** Astra.

### C9 — Barge-in / tour-taking de production *(M)*

- **Utilisateur.** Couper Lisa sans crier. Ne pas se faire couper au milieu d'un « euh ». TV / écho : elle se tait.
- **Branche.** Exposer `silence_duration_ms` / padding comme Grok VAD (`speech-to-speech` session params) sur `speech-reaction.ts` + `voice-turn-taking.ts:11`. Garder AEC trust fail-closed. `idle_timeout` **post-adresse** → C5, pas un always-on.
- **Invariants.** Défaut barge-in **off**. Jamais de barge-in sur l'écho de sa propre TTS (`voice-activity.ts`, `CODEBUDDY_SENSORY_AEC_TRUST`).
- **Test.** Les `tests/sensory/hole-sense6-barge-in-tv.test.ts`, `voice-interrupt.test.ts`, `voice-turn-taking.test.ts` : ajouter un cas padding.
- **Moteur.** Astra.

### C10 — Jobs persistants locaux, pas une VM Grok Bot *(L)*

- **Utilisateur.** « surveille la CI et préviens-moi » survit à la fermeture du laptop (déjà le cas du serveur). Lisa **annonce** quand c'est fini, voix ou Telegram. Pas un ordinateur cloud partagé entre « bots ».
- **Branche.** Relier `mission-board.ts` / `idle-loop.ts:291` / rappels au conductor (`orchestrator.ts:18` : ajouter surface `job`). Artefacts reviewables. **Pas** de desktop distant, **pas** de logins partagés façon Grok Bot.
- **Invariants.** Opt-in. Lecture/réversible par défaut. Toute émission (Telegram, git push) = C8. Un job ≠ une frontière de sécu (leçon Grok Bot : le dire explicitement).
- **Test.** Job idle crée un fichier sous `_qa/…` ; présence coupe le job parlé ; Telegram si `away`.
- **Moteur.** Astra + revue Grok.

**Autour du repli fournisseur (pas un 11ᵉ chantier).** Quand l'autre lane atterrit : Lisa doit (C1) *savoir* quel moteur a répondu (`onProviderResolved` existe déjà `hybrid-reply.ts:851`) et le dire une fois, pas à chaque tour. `selectFastestModel` ne doit pas réélire un palier 429 pendant `Retry-After`.

---

## 4. Cinq choses à ne pas faire

1. **Copier une persona xAI (Ani, Mika, Valentine) ou un score d'affection.** Le spine actuel le fait déjà nommément (`companion-voice-character.ts:21`). C'est un tic et un mauvais exemple : Grok Companions gamifient ; Lisa a refusé XP/streaks (`relationship-state.ts:5-7`). Énergie ≠ cosplay.
2. **Faire dépendre la voix locale d'un cloud.** `wss://api.x.ai/v1/realtime` est séduisant (TTFA < 1 s) et casse le foyer $0 / offline / loopback. ElevenLabs = option. Kyutai/Pocket = plancher qui **parle**.
3. **Always-on micro / `RESPONSE_POLICY=always` en résident.** Grok Voice est un mode qu'on ouvre. Lisa vit dans une pièce. `always` est un échappatoire de test (`respond-decider.ts:87-90`).
4. **ACT vocal sans readback, ou YOLO parce que Grok Bot a Auto Review.** Un STT n'est pas un clic. Les Bots xAI partagent une VM : ce n'est **pas** un modèle de sécu à importer.
5. **Nourrir la bouche avec un dossier.** CKG, rêves, percepts caméra, user-model : bornes, chiffrement, opt-in. Un digest thalamus n'est pas une biographie. Rien de personnel dans les fichiers suivis.

---

## 5. Bilan (10 lignes)

Le cerveau Lisa est un vrai système nerveux (Rust thalamus + pont loopback + pacemaker + porte de silence + hybride + ACT), plus riche qu'un Voice Mode cloud, et déjà discipliné sur le *se taire*. Ses trous ne sont pas l'absence de features : c'est la dérive **écrit d'un côté / jamais lu de l'autre** (`memory/digest`, CKG hors bouche, JSONL d'audit, missions CLI) et l'**expérience de panne** (429 → silence, alors que le classifier et le repli existent ailleurs). Grok gagne sur TTFA, VAD unique, resumption 30 min, `reasoning_effort` explicite, outils live *dans* la session audio, et un contrat d'approbation Bot — pas sur l'éthique anti-gamification ni sur le $0 foyer. Dix chantiers, S d'abord : faire parler la panne, garantir un premier son local, consommer le digest, tabler l'effort ; puis resumption, search bornée, prompt unique, readback ACT, barge-in, jobs locaux. Ne pas recâbler le repli fournisseur ; lui donner une bouche et un état que Lisa elle-même peut dire. Preuve de lecture : `src/server/index.ts:1322-2163`, `respond-decider.ts:516`, `voice-loop.ts:1233/1856/1950`, `client.ts:685`, `bus.rs:56`, docs xAI citées en §0. Reste ouvert : l'état réel des flags sur la machine foyer (interdit d'ouvrir `~/.codebuddy`) et le contenu exact de la lane repli.

ETUDE CERVEAU: 10 chantiers proposés
