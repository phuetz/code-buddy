# RAPPORT GK23 — Les rappels de Lisa (`buddy remind`, runner, voix, Telegram) en vrai

Date : 2026-09-03
Agent : Grok 4.6
Clone : `~/DEV/cb-repar-jumeaux-3-2026-09-02`
Branche : `fix/gk23-rappels-reel-2026-09-03`
HEAD au démarrage : `4659bf343` (`Merge GK16 (buddy backup en vrai, cas méchants) into codex/audit-systeme-nerveux-2026-09-01`)
HEAD produit : lot documentaire (cette révision)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code des rappels, du runner, des outils, des tests et de la documentation.

## Mission

Éprouver le parcours réel des rappels de Lisa : `buddy remind add` (one-shot daté et récurrent) → `list`/`agenda` → déclenchement à l'heure (annonce vocale synthétisée + Telegram factice reçu) → ack vocal « c'est fait » lié au BON rappel (deux rappels en attente) → snooze « dans 10 min » → re-nag ×2 puis escalade `missed` → redémarrage du runner (rien n'est rejoué ni perdu : `snoozes.json`, `pending-acks.json`) → le one-shot daté se retire après tir, le récurrent revient le lendemain → `buddy remind rm`.

Loi : « se servir de ses applis EN VRAI ». Horloge factice/accélérée. Piper pour la voix, sortie WAV, jamais de lecture sur les enceintes (`aplay` remplacé par `_qa/gk23/bin/aplay`). HOME temporaire `_qa/gk23/home` et workdirs `_qa/gk23/work/*`. `~/.codebuddy/reminders.json` RÉEL jamais touché (sha256 `6a34fc33…` identique avant/après).

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. `ELEVENLABS_API_KEY` retiré de l'environnement de test. Piper local `/usr/local/bin/piper` + `fr_FR-siwis-medium.onnx`.
- Aucun service systemd, ComfyUI 8188/8189 non touché.
- Faux Telegram : `_qa/gk10/fake-telegram.mjs` (déjà sur la branche).
- Faux lecteur : `_qa/gk23/bin/aplay` (copie le WAV, journalise argv, exit 0).
- Un commit conventionnel par lot, fichiers nommés un par un.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 12:23 | Rapport créé **avant inspection**. Coordination réservée. |
| 12:24–12:31 | Inspection CLAUDE.md, `reminders.ts`, `reminder-runner.ts`, `remind-tools.ts`, CLI `src/index.ts`, tests existants, GK10 fake Telegram. Checksum stores réels. |
| 12:31–12:34 | `npm install` isolé (`HOME`/`TMPDIR`/`npm_config_cache` sous `_qa/gk23`). 1848 paquets, exit 0. `package-lock.json` (licence npm) restauré, hors sujet. |
| 12:35 | Tests E1/E2/E3 collés **rouges** (4 failed / 1 CLI add-list déjà vert). |
| 12:36 | Correctifs E1+E2+E3. 24/24 verts voisins. |
| 12:38 | Parcours e2e réel 1/1 en 4,78 s : 2 WAV Piper 22 050 Hz, 2 `sendMessage` Telegram, journal `fired/done/renag×2/missed`. Stores opérateur inchangés. |
| 12:39 | Union 13 fichiers / 78 tests verts. `tsc` racine+GPU 0. ESLint ciblé `--max-warnings=0` 0. |

## Fichiers lus

- `CLAUDE.md` (§ `CODEBUDDY_REMINDERS`, ack, snooze, re-nag, `remind` tool)
- `src/companion/reminders.ts`, `src/companion/reminder-runner.ts`, `src/companion/user-name.ts`
- `src/tools/registry/remind-tools.ts`
- `src/index.ts` (commande `remind`)
- `src/server/index.ts` (câblage voix ack/snooze/create)
- `src/sensory/alert.ts`, `src/utils/telegram-api-base.ts`, `src/sensory/voice-loop.ts` (`sayNow`, `defaultPlay`)
- `src/utils/audio-player.ts`
- `tests/companion/reminder-runner.test.ts`, `reminders-snooze.test.ts`, `reminders-oneshot.test.ts`, `reminder-ack-persistence.test.ts`, `reminders.test.ts`, `revue-gemini-reminders-ack.test.ts`
- `tests/tools/remind-tool.test.ts`
- `_qa/gk10/fake-telegram.mjs`

## Écarts

### E1 — `CODEBUDDY_REMINDERS_FILE` n'isolait pas pending/snoozes/log — FERMÉ

Seules les définitions suivaient l'env. `openAck` / `snoozeReminder` écrivaient `~/.codebuddy/companion/pending-acks.json` et `snoozes.json` via `homedir()`. Un test (ou un store custom) pouvait toucher le vrai home.

- Rouge : `tests/companion/gk23-store-isolation.test.ts` — `custom-store/companion/pending-acks.json` absent.
- Correctif : `companionStore()` dérive log/pending/snoozes de `dirname(remindersFile())/companion/` sauf override explicite. Défaut `~/.codebuddy/companion/` inchangé.
- Vert : 1/1. Commit `b13051cfe`.

### E2 — `say()` qui throw avalait Telegram — FERMÉ

`runReminderTick` enchaînait `await say(msg)` puis `notifyAndRecord` dans le même `try`. Piper/aplay en panne = **annonce sans Telegram**.

- Rouge : `tests/companion/gk23-fire-telegram.test.ts` — `notify` appelé 0 fois.
- Correctif : `announceChannels()` — voix et Telegram indépendants, jamais-throw. Snooze consommé seulement si au moins un canal a livré. Voisin D6 : les deux canaux doivent échouer pour restaurer le snooze.
- Vert : 1/1 + runner/snooze/ack-persist. Commit `c9abdc687`.

### E3 — usage CLI omettait `agenda` et `--date` — FERMÉ

La commande implémente `agenda` et `--date` ; les chemins d'erreur disaient `add|list|done|rm` et `add --at HH:MM [--days]`.

- Rouge : `buddy remind nope` sans `agenda` ; `buddy remind add train` sans `--date`.
- Correctif : messages d'usage alignés sur le contrat réel.
- Vert : 3/3 CLI (dont add/list/agenda/rm réel). Commit `c9abdc687`.

## Tableau final « scénario → attendu → obtenu → correctif → commit »

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy remind add` one-shot daté | id, `one-shot`, date | OK | — | preuve `e489d7afb` |
| `buddy remind add` récurrent | `daily` | OK | — | `e489d7afb` |
| `list` / `agenda --ahead` | train ponctuel + médicaments récurrent | OK | — | `e489d7afb` |
| Usage CLI (`nope`, add sans `--at`) | nomme `agenda` et `--date` | omettait les deux | E3 | `c9abdc687` |
| Tir à l'heure | Piper WAV + Telegram `⏰ …` | 2 WAV 22 050 Hz (1,68 s / 2,36 s), 2 `sendMessage`, faux aplay `-q` | E2 (indépendance canaux) | `c9abdc687` + preuve `e489d7afb` |
| Deux pending, « c'est fait pour le train » | lie **train**, pas médicaments | `matchAck` → id train, médicaments reste | déjà en place (revue G3) | `e489d7afb` |
| Snooze « dans 10 minutes » | ack fermé, re-annonce à +10 min | OK, `delayMs=600000` | — | `e489d7afb` |
| Redémarrage runner | rien rejoué ni perdu (`snoozes.json` / `pending-acks.json`) | `resetAcks`+`loadSnoozes` : snooze survit, pas de double tir | E1 (store isolé) | `b13051cfe` + `e489d7afb` |
| Re-nag ×2 puis `missed` | 2 « Petit rappel » + Telegram « Pas de confirmation » | journal `renag` nag 1 puis 2, puis `missed` | — | `e489d7afb` |
| One-shot après tir | retiré (`enabled: false`), jamais J+1 | train disabled, `isDue` J+1 false | — | `e489d7afb` |
| Récurrent J+1 | dû le lendemain à la même heure | `isDue` 5 sep 10:38 true | — | `e489d7afb` |
| `buddy remind rm` | store vide | `No reminders yet` | — | `e489d7afb` |
| Store custom | pending/snoozes à côté du JSON | fuyait vers `$HOME/.codebuddy/companion` | E1 | `b13051cfe` |
| Message technique | pas de `[reminders]` dans CLI/Telegram | absent des `sendMessage` et du stdout add | — | `e489d7afb` |
| `~/.codebuddy/reminders.json` réel | sha256 inchangé | `6a34fc33d16c4dd13b5d2b541341f95fe30ccd7671c9c474a0cc4e26791eeae2` avant = après | HOME + E1 | — |

Journal e2e (`_qa/gk23/work/e2e-qntrwK/home/.codebuddy/companion/reminder-log.jsonl`) :

```
fired train
fired médicaments
done train via=voice retired=true
fired médicaments snoozed=true
renag médicaments nag=1
renag médicaments nag=2
missed médicaments
```

WAV (faux aplay, jamais ALSA) : PCM 16-bit mono 22 050 Hz, 74 292 o et 104 324 o. `aplay.log` pointe `_qa/gk23/bin/aplay -q …wav`.

## Vérifications

- Union ciblée : 13 fichiers / **78 verts**.
- `npx tsc --noEmit -p .` exit 0 (31,6 s).
- `npx tsc --noEmit -p tsconfig.gpuNode-identity.json` exit 0.
- ESLint ciblé `--max-warnings=0` exit 0.
- `git diff --check` propre.
- Stores opérateur : sha256 identiques au snapshot `_qa/gk23/checksums-before.txt`.
- Aucun push. `package-lock.json` (mutation licence npm) restauré.

## Commits

1. `4dc73bb62` `docs(gk23): réserver le chantier et ouvrir le rapport`
2. `b13051cfe` `fix(reminders): isoler pending/snoozes/log à côté du store`
3. `c9abdc687` `fix(reminders): Telegram malgré panne vocale et usage CLI honnête`
4. `e489d7afb` `test(reminders): parcours réel GK23 horloge factice Piper Telegram`
5. lot documentaire `docs(gk23): consigner les rappels réels et libérer le chantier` (HEAD)

## Reste ouvert

- L'ack vocal est exercé via `matchAck` + `markDone('voice')` (le même code que `src/server/index.ts` sur `onHeard`). Pas de STT micro : hors périmètre matériel.
- `markDone` tamponne `ts` avec l'horloge réelle, pas l'horloge factice du tick (cosmétique dans le jsonl).
- Synthèse Piper écrit d'abord sous `.codebuddy/tts/` du clone (gitignoré, unlink après play). `TMPDIR` n'est pas le dossier TTS.

## Bilan (≤ 10 lignes)

Les rappels de Lisa marchent en vrai sous HOME isolé : CLI add/list/agenda/rm, tir Piper+Telegram factice, ack du bon rappel parmi deux, snooze persisté au redémarrage, re-nag×2 puis `missed`, one-shot retiré et récurrent J+1. Trois écarts collés rouge puis fermés (store qui fuyait vers le home, Telegram avalé si la voix throw, usage CLI muet sur agenda/--date). Preuve : 13 fichiers / 78 tests, e2e 1/1 en 4,78 s (2 WAV 22 kHz, journal fired/done/renag/missed), `tsc` 0, eslint ciblé 0, sha256 de `~/.codebuddy/reminders.json` inchangé. Aucun push, aucune API payante, aucun `aplay` réel, original `~/code-buddy` intact.
