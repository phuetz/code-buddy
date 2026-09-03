# RAPPORT GK10 — Le compagnon Telegram de Code Buddy (« Lisa sur le téléphone ») utilisé par un inconnu, contre un faux serveur Telegram

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-succes-channels-2026-09-02`
Branche : `fix/gk10-telegram-inconnu-2026-09-03`
HEAD au démarrage : `3fcf5a97d` (`docs(voice): consigner les preuves DARK3`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code des canaux, des alertes, des commandes et de la documentation utilisateur.

## Mission

Éprouver le parcours d’un inconnu qui configure le canal Telegram de Code Buddy en suivant uniquement la documentation, puis discute avec Lisa (texte, commandes, photo, vocal), reçoit une note vocale via `sayNow` (Piper), arrête proprement et redémarre sans doublon. Le Bot API réel (`api.telegram.org`) n’est jamais appelé : un faux serveur HTTP local `_qa/gk10/fake-telegram.mjs` le remplace.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante (Ollama local autorisé).
- Aucun service systemd, aucun service déjà en cours (ComfyUI 8188/8189) touché.
- Aucune écriture hors du clone. HOME temporaire : `_qa/gk10/home` dans le clone.
- Aucune donnée personnelle.
- Un commit conventionnel par lot, fichiers nommés un par un.
- Chaque écart : test rouge → correctif minimal → vert, un commit.
- typecheck + lint + tests ciblés verts.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 2026-09-03 (démarrage) | Rapport créé **avant inspection**. Coordination réservée. HOME temporaire : `_qa/gk10/home`. |
| 2026-09-03 (inspection) | Lecture de la doc canaux, du client Telegram, des alertes, des handlers CLI et des tests existants. |
| 2026-09-03 (lot 1) | Écart E1 : `TELEGRAM_API_BASE` n’existait pas (constante figée `https://api.telegram.org`). Test rouge 3/3, correctif, vert 5/5 + 38 ciblés. Commit `73d8f7915`. |
| 2026-09-03 (lot 2) | Faux Bot API `_qa/gk10/fake-telegram.mjs` : getMe, getUpdates (long poll), sendMessage, sendVoice, sendPhoto, answerCallbackQuery, journal avec jeton masqué. 3/3 tests HTTP verts. Commit `526df0c61`. |
| 2026-09-03 (lot 3) | E2 chemin documenté : `TELEGRAM_BOT_TOKEN`, `settings.json` objet, `buddy --channel telegram`. Rouge 5, vert 21. |

## Plan d’exécution (annoncé avant lecture)

1. Réserver le chantier dans `docs/FABLE5-CODEX-COORDINATION.md`.
2. Préparer `_qa/gk10/` (HOME temporaire, journal, artefacts).
3. Lire uniquement les sources autorisées : CLAUDE.md (canaux, `CODEBUDDY_VOICE_TO_TELEGRAM`, alertes), `src/channels/telegram*`, `src/sensory/alert.ts`, `src/commands/channel*`, doc utilisateur des canaux, tests existants.
4. Identifier `TELEGRAM_API_BASE` / équivalent. S’il n’existe pas, c’est le premier écart : variable + tests.
5. Écrire `_qa/gk10/fake-telegram.mjs` : `getMe`, `getUpdates` (long polling), `sendMessage`, `sendVoice`, `sendPhoto`, `answerCallbackQuery`, journal des requêtes. Jeton factice.
6. Parcours inconnu, **en suivant uniquement la doc** :
   - configurer le canal
   - démarrer
   - premier message texte → réponse LLM local Ollama
   - `/help` et 2 commandes documentées
   - photo envoyée → réponse
   - message vocal reçu (OGG factice) → transcription ou excuse honnête
   - note vocale envoyée par `sayNow` (Piper)
   - arrêt propre
   - redémarrage : pas de doublon (offset persisté)
7. Pour chaque écart (réponse dupliquée, crash média, message technique montré, secret dans les journaux, boucle sur erreur réseau, doc fausse) : test rouge → correctif → vert → commit.
8. Tableau final « étape → écart → correctif → commit » + ce qui bloque encore un inconnu.

## Fichiers lus (complété au fil de l’eau)

- `docs/channels.md`, `docs/commands.md` (§ `--channel`, `buddy channels`), `docs/configuration.md`, `docs/companion-guide.md` (voix Telegram), `docs/getting-started.md`
- `src/channels/telegram/client.ts`, `index.ts`, `types.ts`, `pro-formatter.ts`, `enhanced-commands.ts`
- `src/channels/pro/pro-features.ts`, `enhanced-commands.ts`, `dm-pairing.ts`, `core.ts`, `resolve-channel-secret.ts`
- `src/sensory/alert.ts`
- `src/commands/handlers/channel-handlers.ts`, `src/index.ts` (commande `channels`)
- `tests/channels/telegram.test.ts`, `telegram-polling-resilience.test.ts`, `tests/sensory/telegram-voice.test.ts`

## Écarts

### E1 — `TELEGRAM_API_BASE` absent (premier écart annoncé) — FERMÉ

Le client (`src/channels/telegram/client.ts`) et les alertes (`src/sensory/alert.ts`) appelaient `https://api.telegram.org` en dur. Aucune variable d’environnement ne permettait un Bot API local. Un inconnu (et GK10) ne pouvaient pas éviter `api.telegram.org`.

- Rouge : `tests/channels/telegram-api-base.test.ts` 3 failed — les URL restaient `https://api.telegram.org/bot…`
- Correctif : `resolveTelegramApiBase()` (`src/utils/telegram-api-base.ts`), lu à chaque requête ; défaut inchangé.
- Vert : 5/5 sur ce fichier ; union `telegram-api-base` + `telegram-voice` + `telegram` = 38/38.

### E2 — chemin documenté de configuration/démarrage — FERMÉ

`docs/channels.md` promettait `TELEGRAM_BOT_TOKEN`, `.codebuddy/settings.json` objet, et `buddy --channel telegram`. Rien de tout cela n’était câblé.

- Rouge : 5 tests (`resolveChannelSecret` ignore l’env, `loadChannelConfig` ignore settings.json, `startConfiguredChannels` noConfig, `--help` sans `--channel`)
- Correctif : env + settings.json + synthèse telegram ; flag racine `--channel` ; doc daemon clarifiée (`CODEBUDDY_SERVER_CHANNEL_INTAKE`)
- Vert : 21 tests (stranger-config + secret + channel-intake)

### E3 — offset de polling non persisté (ouvert)

`lastUpdateId` est un champ mémoire. Un redémarrage rappelle `getUpdates` avec `offset=1` et retraiterait les anciens messages encore en file Telegram.

### E4 — `/help` et `/status` annoncés, non routés (ouvert)

`getCommandList()` enregistre `start`, `help`, `status` auprès de BotFather. `routeCommand()` ne gère que `repo|branch|pr|task|yolo|runs|run|pins`. `/help` tombe dans le LLM.

### E5 — `sayNow` / `CODEBUDDY_VOICE_TO_TELEGRAM` (à éprouver)

Les alertes vocale utilisent `CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT`, pas le jeton du canal compagnon. À vérifier pendant le parcours `sayNow`.

## Tableau étape → écart → correctif → commit

| Étape | Écart | Correctif | Commit |
|---|---|---|---|
| Faux Bot API local | E1 constante `api.telegram.org` | `TELEGRAM_API_BASE` + `resolveTelegramApiBase()` | `73d8f7915` |
| Configurer le canal | E2 `TELEGRAM_BOT_TOKEN` / settings.json ignorés | env + objet settings.json | *(lot 3)* |
| Démarrer | E2 `buddy --channel telegram` absent | flag racine `--channel` | *(lot 3)* |
| Premier texte / Ollama | à éprouver après E2 | | |
| `/help` + 2 commandes | E4 `/help` `/status` non gérés | *(à faire)* | |
| Photo | à éprouver | | |
| Vocal OGG | à éprouver | | |
| `sayNow` Piper | E5 jetons distincts | *(à éprouver)* | |
| Stop + restart sans doublon | E3 offset mémoire | *(à faire)* | |

## Ce qui bloque encore un inconnu

Un inconnu qui suit uniquement `docs/channels.md` ne démarre pas Telegram : le flag documenté n’existe pas, `TELEGRAM_BOT_TOKEN` n’est pas lu, et le JSON documenté n’est pas le fichier chargé. Même après un démarrage réussi, un redémarrage peut redupliquer les messages (offset non persisté).

## Preuves de vérification

```text
# Rouge (avant correctif E1)
npm test -- tests/channels/telegram-api-base.test.ts
Test Files  1 failed (1)
Tests       3 failed (3)

# Vert (après E1)
npm test -- tests/channels/telegram-api-base.test.ts tests/sensory/telegram-voice.test.ts tests/channels/telegram.test.ts
Test Files  3 passed (3)
Tests      38 passed (38)

npm run typecheck   # exit 0
npx eslint src/utils/telegram-api-base.ts tests/channels/telegram-api-base.test.ts src/sensory/alert.ts --max-warnings=0  # exit 0
# client.ts : 2 warnings préexistants (EventEmitter, ChannelStatus unused)
```
