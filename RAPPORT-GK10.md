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
| 2026-09-03 (lot 3) | E2 chemin documenté : `TELEGRAM_BOT_TOKEN`, `settings.json` objet, `buddy --channel telegram`. Rouge 5, vert 21. Commit `676b4d96a`. |
| 2026-09-03 (lots 4–8) | E3 offset `a20913125` ; E4 /help `74884532b` ; E5 média/sayNow `72015f575` ; E6 jeton technique `000681dd9` ; parcours Ollama `bcb7d5f97`. |

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

### E3 — offset de polling non persisté — FERMÉ

`lastUpdateId` était un champ mémoire. Un redémarrage rappelait `getUpdates` avec `offset=1`.

- Rouge : `tests/channels/telegram-offset.test.ts` rejouait « ne me duplique pas »
- Correctif : `~/.codebuddy/telegram-offset-<botId>.json` (surcharge `CODEBUDDY_TELEGRAM_OFFSET_DIR`)
- Vert : 1/1 + régression Telegram 28/28. Commit `a20913125`

### E4 — `/help` et `/status` annoncés, non routés — FERMÉ

- Rouge : `/help` ne produisait aucune liste `/repo`
- Correctif : `routeCommand` gère `help|start|status`
- Vert : 2/2 help + 31 avec pro-features/offset. Commit `74884532b`

### E5 — jetons `sayNow` / photo / vocal — FERMÉ

- Vocal illisible : excuse française, pas de crash
- Photo : message actionable, pas de crash
- `sendTelegramVoice` : `TELEGRAM_BOT_TOKEN` si `CODEBUDDY_SENSORY_ALERT_TOKEN` absent ; `CODEBUDDY_SENSORY_ALERT_CHAT` reste obligatoire
- Commit `72015f575`

### E6 — jeton technique `[transcription vocale échouée]` émis vers le LLM — FERMÉ

Après l’excuse, le bot émettait encore le marqueur interne. Plus d’émission. Commit `000681dd9`

### E7 — parcours inconnu (Ollama local + faux Bot API) — FERMÉ côté tests

`tests/channels/telegram-inconnu-journey.test.ts` : config env, start, texte Ollama `qwen2.5:1.5b-instruct`, `/help`, `/pins`, photo, vocal, note vocale, restart sans doublon. 1/1 en 103 s. Commit `bcb7d5f97`

## Tableau étape → écart → correctif → commit

| Étape | Écart | Correctif | Commit |
|---|---|---|---|
| Faux Bot API local | E1 constante `api.telegram.org` | `TELEGRAM_API_BASE` | `73d8f7915` |
| Faux serveur HTTP | (infra GK10) | `_qa/gk10/fake-telegram.mjs` | `526df0c61` |
| Configurer le canal | E2 `TELEGRAM_BOT_TOKEN` / settings.json | env + objet settings.json | `676b4d96a` |
| Démarrer | E2 `buddy --channel telegram` absent | flag racine `--channel` | `676b4d96a` |
| Premier texte / Ollama | handler lent / pas de réponse | parcours réel 1.5b, ~100 s | `bcb7d5f97` |
| `/help` + `/pins` + `/status` | E4 non routés | `routeCommand` local | `74884532b` |
| Photo | crash / silence | pas de crash, contenu actionnable | `72015f575` |
| Vocal OGG | E6 jeton technique + STT absent | excuse FR, pas d’émission LLM | `000681dd9` |
| `sayNow` / note vocale | E5 jeton alerte distinct | repli `TELEGRAM_BOT_TOKEN` | `72015f575` |
| Stop + restart | E3 offset mémoire | fichier d’offset | `a20913125` |

## Ce qui bloque encore un inconnu

- `buddy daemon start` ne démarre Telegram que si `CODEBUDDY_SERVER_CHANNEL_INTAKE=true`. La doc le dit maintenant ; un lecteur pressé du daemon sera surpris.
- `CODEBUDDY_SENSORY_ALERT_CHAT` (id numérique du chat) reste obligatoire pour les notes vocales `sayNow`. Le jeton du canal suffit, pas l’id.
- Premier tour LLM via le handler canal : ~100 s à froid sur `qwen2.5:1.5b-instruct` (prompt + outils). Un inconnu peut croire que le bot est mort.
- `sayNow` sans `synth` injecté appelle Piper/Pocket pour un second rendu ; sans modèle TTS configuré, la voie téléphone peut rester muette ou très lente.
- Whisper résout encore `os.homedir()`, pas `HOME` : un test isolé peut toucher le venv réel.
- Le client Cowork Telegram (`cowork/src/main/remote/channels/telegram/`) hardcode encore `api.telegram.org` (hors périmètre CLI).
- Un fichier d’offset de test `~/.codebuddy/telegram-offset-123456.json` a été créé puis **supprimé** pendant E4 ; plus de fuite constatée ensuite.

## Preuves de vérification

```text
# Union ciblée (hors parcours Ollama 103 s déjà vert)
npm test -- tests/channels/telegram-api-base.test.ts \
  tests/channels/fake-telegram-server.test.ts \
  tests/channels/telegram-stranger-config.test.ts \
  tests/channels/telegram-offset.test.ts \
  tests/channels/telegram-help.test.ts \
  tests/channels/telegram-media-saynow.test.ts \
  tests/channels/telegram.test.ts \
  tests/channels/telegram-polling-resilience.test.ts \
  tests/channels/resolve-channel-secret.test.ts \
  tests/sensory/telegram-voice.test.ts \
  tests/server/channel-intake.test.ts \
  tests/sensory/say-now-phone-policy.test.ts
Test Files  12 passed (12)
Tests      75 passed (75)

npm test -- tests/channels/telegram-inconnu-journey.test.ts
Test Files  1 passed (1)
Tests      1 passed (1)
Duration   103.39s

npm run typecheck   # exit 0
```

HEAD fonctionnel : `bcb7d5f97`. Aucun push. `package-lock.json` touché par `npm install` du clone, non commité. `_qa/gk10/home/` non suivi.
