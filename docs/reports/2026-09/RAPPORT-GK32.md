# RAPPORT-GK32 — `buddy onboard`, `buddy doctor --fix`, `buddy login`/`whoami` et `buddy update` par un inconnu, sans réseau payant

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-repar-heure-2026-09-02`
Branche : `fix/gk32-onboard-doctor-2026-09-03`
HEAD au départ : `345bb4f87` (`Merge GK27 (conseil de modèles et routage en vrai) into codex/audit-systeme-nerveux-2026-09-01`)
HEAD produit : `d0f4ee187` (`docs(gk32): consigner onboard/doctor/login/update en vrai et libérer le chantier`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** des commandes (réservation `56d7fbb61`).
Buddy invoqué depuis le clone : `_qa/gk32/buddy.sh` → `node_modules/tsx/dist/cli.mjs src/index.ts`
HOME temporaire : `_qa/gk32/home`. Les invocations CLI forçaient ce HOME.
Ollama local uniquement (`http://127.0.0.1:11434`). Aucun service systemd. ComfyUI 8188 non touché.
`buddy login` : jamais la vraie session ChatGPT. `buddy update` : `--dry-run` uniquement.

## Mission

Éprouver **pour de vrai** le parcours d’un inconnu à profil vierge :

1. `buddy onboard` (assistant : choix fournisseur local, modèle, dossier)
2. `buddy doctor` (diagnostic réel : Ollama, ffmpeg, Piper, node, permissions)
3. `buddy doctor --fix` (corrige ce qu’il annonce, rien d’autre — sha256 avant/après)
4. `buddy whoami` sans session (message honnête)
5. `buddy login` sans navigateur (échec propre, pas de blocage)
6. `buddy update --dry-run` (version, canal, source, sans écrire)
7. `buddy --help` cohérent avec la doc

Chaque défaut : test rouge → correctif → vert, un commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Aucun service systemd. ComfyUI 8188/8189 non touché.
- HOME temporaire dans le clone seulement.
- E18 (`~/DEV/cb-exec-inconnu-cli-2026-09-02/REPARATION-E18.md`) déjà 7 points (D5–D11) : non rejoués.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `345bb4f87`. Arbre propre. Réservation `56d7fbb61`.

### Inspection (après réservation)

Surface réelle : `src/commands/cli/utility-commands.ts` (`doctor`, `onboard`), `src/wizard/onboarding.ts`, `src/doctor/index.ts`, `src/index.ts` (`login`, `whoami`), `src/commands/update.ts`, `src/providers/codex-oauth.ts`. E18 déjà fermé. Tests existants : `tests/wizard/onboarding.test.ts`, `tests/doctor/*`, `tests/unit/update-tag.test.ts`.

### Parcours réel (avant correctifs)

Profil isolé, Ollama joignable (22 modèles), ffmpeg 6.1.1, Piper `/usr/local/bin/piper`, Node v24.14.1.

| Commande | Obtenu avant correctif |
|---|---|
| `buddy onboard` (pipe) | exit 2, message TTY — **conforme** |
| `buddy onboard` (PTY) | Quick-start Ollama, modèle `gemma4-moe-rag:latest`, démo refusée. Écrit `cwd/.codebuddy/config.json` **sans demander de dossier**. Footer TTS **edge-tts**. `user-settings.json` garde le catalogue grok. Processus PTY n’a pas quitté avant timeout 90 s (stdin PTY encore ouvert). |
| `buddy doctor` (vierge + `OLLAMA_HOST`) | **Écrit** `user-settings.json` grok-code-fast-1 puis titre « saved model grok-code-fast-1 is not currently advertised ». **Pas** de ffmpeg, Piper, permissions. |
| `buddy doctor` (après onboard) | Ready Ollama 22 modèles, Node OK, TTS Pocket via uvx. Toujours pas ffmpeg/Piper/permissions. exit 0. |
| `buddy doctor --fix` (après onboard) | Rien de fixable. Aucun fichier de config réécrit. |
| `buddy whoami` | `ChatGPT: not connected` **seulement** — ignore Ollama onboardé. |
| `buddy login` (pas de TTY, timeout 20 s) | Affiche « Opening your browser to https://auth.openai.com/oauth/authorize », **exit 124**. Hang. |
| `buddy update --dry-run` | `unknown option '--dry-run'` exit 1. |
| `buddy --help` | Liste `onboard`, `doctor`, `login`, `whoami`, `update`. Cohérent avec `docs/getting-started.md` (8 commandes). |

### Défauts, rouge → vert

| Id | Défaut | Rouge | Commit |
|---|---|---|---|
| D1 | `update --dry-run` option inconnue ; `buddy --dry-run update` aurait lancé `npm install -g` | `error: unknown option '--dry-run'` | `99ff831b2` |
| D2 | `login` bloque 5 min sans navigateur | hang 20 s → exit 124 | `f894fc791` |
| D3 | doctor ne mentionne ni ffmpeg, ni Piper, ni les permissions du profil | checks `ffmpeg` / `Piper TTS` / `Profile permissions` absents | `e00ab9ce5` |
| D4 | doctor **écrit** grok-code-fast-1 sur un profil vierge puis le traite comme modèle Ollama périmé | `user-settings.json` créé | `67704e661` |
| D5 | `whoami` ignore le fournisseur local onboardé | seulement « ChatGPT: not connected » | `72a7bdb87` |
| D6 | onboard écrit `.codebuddy/` dans cwd sans choix de dossier | `PROJECT_FOLDER_QUESTION` absent | `1273be52a` |
| D7 | footer onboard promet encore edge-tts (E18 a aligné doctor sur Pocket/ElevenLabs) | `renderCapabilitiesFooter is not a function` puis edge-tts | `399b4f146` |
| D8 | persist Ollama fusionne le catalogue grok dans `models` | `['grok-code-fast-1', …]` | `2663be10f` |

### Rejeu live après correctifs

- **`buddy update --dry-run`** exit 0 : `Channel: stable` / `Current: 2.0.0` / `Source: npm` / `Package: @phuetz/code-buddy@latest` / `Would run: npm install -g …` / `Dry-run: nothing was installed.` `buddy --dry-run update` identique. Aucun `execSync`.
- **`buddy login`** exit 1 en **539 ms** : « ChatGPT login needs an interactive terminal and a browser » + `buddy onboard`. `--no-browser` idem. Jamais de callback OAuth.
- **`buddy doctor --verbose`** (profil onboardé) : Ready Ollama 22 modèles, Node v24.14.1, **ffmpeg installed**, **Piper TTS installed**, **Profile permissions** `…/_qa/gk32/home/.codebuddy writable (mode 775)`.
- **doctor profil vierge** (`HOME=_qa/gk32/home-virgin`) : **aucun** `user-settings.json` écrit, aucun `grok-code-fast-1`.
- **`buddy doctor --fix`** sur `_qa/gk32/fix-project` sans `.codebuddy/` : annonce `[fixable]`, crée uniquement ce dossier (`create-codebuddy-dir`). sha256 des **fichiers** inchangé (répertoire vide). `user-settings` Ollama non réécrit. `.codebuddy/settings.json` du clone : `4f7424548b9d698e7ac8db87ecab6829350d0fb29c265d91488f0c4e8c51df06` inchangé.
- **`buddy whoami`** : `ChatGPT: not connected` + `Local: ollama · gemma4-moe-rag:latest · http://127.0.0.1:11434/v1`.
- **`buddy --help`** : `onboard`, `doctor`, `login`, `whoami`, `update` présents ; `update --help` liste `--dry-run`.

### HOME réel

Snapshot léger au départ : `user-settings.json` sha256 `d60240793a7a7eb6f35d621c33b9b5247864e8a2a07a4558ee7f33a9d36e41a4`.
En fin de session le fichier réel pèse toujours 209 octets, mode 600, mais sha256 `0f7b6e4210df24c62e49aa9b938e11e788ceafd9b12643db82ae64d5ec207092`, mtime `2026-09-03 13:29:28`. Les CLI GK32 passaient par `buddy.sh` avec `HOME=_qa/gk32/home`. **Je n’ai pas de preuve que GK32 a écrit le fichier réel** (un processus concurrent robot/Lisa est plausible). Je ne l’ai ni relu ni restauré.

## Tableau final

| Commande | Attendu | Obtenu (avant → après) | Correctif | Commit |
|---|---|---|---|---|
| `buddy onboard` | Fournisseur local, modèle, dossier, écrit dans le profil + le dossier choisi | PTY Ollama OK ; cwd forcé ; edge-tts ; catalogue grok → dossier demandé ; Pocket/ElevenLabs ; `models: [choisi]` | D6 D7 D8 | `1273be52a` `399b4f146` `2663be10f` |
| `buddy doctor` | Diagnostic vrai : Ollama, ffmpeg, Piper, node, permissions | Ollama+Node oui ; ffmpeg/Piper/perms absents ; écrit grok → checks présents ; peek sans écriture | D3 D4 | `e00ab9ce5` `67704e661` |
| `buddy doctor --fix` | Répare ce qu’il annonce, rien d’autre | Après onboard : no-op. Projet sans `.codebuddy/` : crée ce dossier uniquement | — (déjà honnête une fois D4) | — |
| `buddy whoami` | Message honnête sans session ChatGPT | Seulement ChatGPT → + ligne Local ollama | D5 | `72a7bdb87` |
| `buddy login` | Échec propre sans navigateur | Hang 20 s / 5 min → exit 1 en 539 ms | D2 | `f894fc791` |
| `buddy update --dry-run` | Version, canal, source, sans écrire | option inconnue → plan npm affiché, 0 install | D1 | `99ff831b2` |
| `buddy --help` | Cohérent avec la doc | 8 commandes getting-started présentes ; `--dry-run` ajouté à `update --help` et `docs/commands.md` | D1 | `99ff831b2` |

## Vérifications

- `npx tsc --noEmit -p .` exit 0
- `npx tsc --noEmit -p tsconfig.gpuNode-identity.json` exit 0
- ESLint ciblé `--max-warnings=0` exit 0
- Union : 11 fichiers / 70 tests verts
- `ss -ltn` : ComfyUI `127.0.0.1:8188` toujours en écoute
- Aucun push

## Bilan

Parcours inconnu éprouvé en vrai sous HOME `_qa/gk32/home` : onboard Ollama `gemma4-moe-rag:latest`, doctor Node/ffmpeg/Piper/Ollama, `--fix` borné, whoami honnête, login 539 ms sans navigateur, `update --dry-run` sans npm. Huit défauts rouge→vert, un commit chacun (`99ff831b2` … `2663be10f`). Preuves : tsc 0+0, ESLint ciblé 0, 70 tests. Ouvert : sha256 du vrai `~/.codebuddy/user-settings.json` a bougé à 13:29:28 sans preuve d’écriture GK32 ; SQLite absent de ce clone (`npm install --ignore-scripts`) ; le hang PTY d’onboard après succès n’a pas été traité (stdin du PTY reste ouvert).
