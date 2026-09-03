# RAPPORT-GK16 — `buddy backup create|verify|list|restore` en vrai

Mission : exercer la commande `buddy backup` pour de vrai, y compris les cas méchants, dans un HOME temporaire du clone.

- Clone autorisé : `/home/patrice/DEV/cb-repar-channels-2026-09-02` uniquement
- Branche : `fix/gk16-backup-reel-2026-09-03`
- HEAD au départ : `13f878cec` (`Merge branch 'feat/gk5-pocket-tts-rust-2026-09-03' …`)
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code backup (`src/commands/backup*.ts`, `src/backup/`, tests, doc utilisateur).

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local autorisé.
- Aucun service systemd. Ne pas toucher ComfyUI 8188/8189.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME temporaire dans le clone, peuplé de faux fichiers).
- Dépôt original `~/code-buddy` interdit.
- Aucune donnée personnelle. Aucun fichier réel de `~/.codebuddy`.
- Un commit conventionnel par lot. Typecheck + lint + tests ciblés verts.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

Commandes :

```
git status -sb && git log -5 --oneline && git rev-parse HEAD
```

Sortie collée :

```
## fix/gk16-backup-reel-2026-09-03
---
13f878cec Merge branch 'feat/gk5-pocket-tts-rust-2026-09-03' of /home/patrice/DEV/cb-never-env-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
53a02dd1a Merge branch 'fix/gk2-research-deep-2026-09-03' of /home/patrice/DEV/cb-never-tools-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
2a4e7c39f docs(gk5): coller le SHA du lot documentaire
369ccde0a docs(gk5): consigner la faisabilité Pocket TTS Rust/ONNX
03bb492c3 feat(buddy-sense): ajouter Pocket TTS ONNX (feature pocket-tts)
---
13f878cec7da22d59416b16b867fc409a730e104
```

Arbre de travail propre au départ (aucun fichier modifié/non suivi). Chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md`. Aucun fichier source backup lu encore.

Réservation : `356e77e6d` (`chore(gk16): réserver le chantier backup réel`).

### 2026-09-03 — inspection (après réservation)

Il n'existe pas de `src/backup/` ni de `tests/backup/` (G6R vit dans `tests/commands/revue-gemini-backup-symlink.test.ts`). Surface réelle :

- `src/commands/cli/backup-command.ts`
- `src/commands/handlers/backup-handlers.ts`
- `tests/commands/backup-handlers.test.ts`, `backup-restore.test.ts`, `backup-archive.test.ts`, `backup-cli-confirm.test.ts`, `revue-gemini-backup-symlink.test.ts`
- Doc : `docs/commands.md`, `docs/deployment.md`, `CLAUDE.md` / `AGENTS.md`

`create`/`restore` portent le `.codebuddy/` du **cwd** (projet). Les archives vont par défaut dans `$HOME/.codebuddy/backups`. `BACKUP_DIR` est figé au chargement du module via `homedir()`.

### 2026-09-03 — cycle réel (HOME `_gk16/home`, cwd `_gk16/project`)

Faux fichiers uniquement (aucun `~/.codebuddy` réel lu). `npm ci` dans le clone (node_modules absent au départ).

```
buddy backup create
→ Backup created: …/home/.codebuddy/backups/codebuddy-backup-2026-09-03T10-00-40.json
  Files: 8
  Size: 0 KB          ← 208 octets réels, arrondi à 0
create_exit=0

buddy backup list
→ Backups in …/home/.codebuddy/backups:
    codebuddy-backup-2026-09-03T10-00-40.json  (2 KB, 9/3/2026)
list_exit=0

buddy backup verify codebuddy-backup-2026-09-03T10-00-40.json
→ Backup valid … Files: 8
verify_exit=0
```

Archive : 8 fichiers (dont `empty-note.txt` 0 octet, checksum SHA-256 vide `e3b0c44298fc1c14…`). `screenshots/` sauté. Fichiers globaux du HOME (`must-not-appear`, `home-sess`) absents de l'archive.

Après mutation + `restore --confirm` : sha256 des 8 fichiers **identiques** à l'avant. `extra-not-in-archive.md` **survécu** (fusion). Message : « This will overwrite current .codebuddy/ configuration. »

### 2026-09-03 — cas méchants (CLI réel)

| Cas | Sortie | Verdict |
|-----|--------|---------|
| Archive tronquée (80 o) | verify exit 1 `Unterminated string in JSON at position 80` ; restore exit 1 `Failed to read backup …` | refuse, message technique |
| Chemin `/etc/passwd` et `../` dans l'archive | **verify exit 0 « Backup valid »** ; restore exit 1 `path escapes destination` ; victime intacte | verify menteur |
| Fichier 0 octet | inclus + restauré, sha256 vide OK | vert |
| `create` dir chmod a-w | **crash** `Unhandled promise rejection: EACCES` + recovery JSON | crash |
| `create --output` fichier | crash `ENOTDIR` | crash |
| Restore profil non vide | fusion silencieuse, extras conservés | message menteur |
| Format v0 / tar `ustar` | exit 1 manifest/JSON | refuse, message technique |
| `.codebuddy` vide (que screenshots/) | **create exit 0 « Backup created … Files: 0 »** puis verify/restore exit 1 empty | succès sans contenu |
| Fichier > 1 Mo | sauté sans le dire (`Files: 1` = settings seulement) | skip silencieux |
| Symlink source hors projet | create suit le lien, archive contient `SECRET_OUTSIDE` | fuite |
| Symlink dest (G6R) | restore exit 1 `symbolic link is forbidden` ; victime `KEEPME` | vert |

### Lot A — create vide (rouge → vert)

Rouge collé :

```
FAIL tests/backup/gk16-backup.test.ts
expected undefined to be 1  // create vide annonçait Backup created
```

Correctif : `handleBackupCreate` refuse si `files.length === 0` (exit 1, pas d'archive écrite).

Vert : 5 fichiers / 23 tests backup ciblés. Commit `7f9920a47`.

### Lot B — disque plein / EACCES (rouge → vert)

Rouge collé : create lançait `Error EACCES` (crash) ; restore écrivait « Failed to read backup … EACCES ».

Correctif : `describeBackupIoError` (ENOSPC/EACCES/ENOTDIR) autour de mkdir/write create et des écritures restore.

Vert : 6 fichiers / 27 tests. Commit `c5bd46383`.

### Lot C — verify menteur sur chemins hors profil (rouge → vert)

Rouge collé : `verify` exit 0 « Backup valid » pour `/etc/passwd`, `../victim-outside.txt`, `..\..\etc\x`.

Correctif : `verifyArchivePayloads` refuse les mêmes chemins que restore. Plus de throw déguisé en « corrupt » pour ces cas.

Vert : 5 fichiers / 28 tests. Commit `f1fd3dbf7`.

### Lot D — create suivait les symlinks source (rouge → vert)

Rouge collé : `Files: 2` et l'archive contenait `SECRET_OUTSIDE` (cible hors projet).

Correctif : `collectFiles` ignore les liens symboliques et les annonce (`Skipped: 1 (settings.json: symbolic link)`).

Vert : 5 fichiers / 29 tests. Commit `78c846046`.

### Lot E — fichiers > 1 Mo sautés sans le dire (rouge → vert)

Rouge collé : `Files: 1 (settings.json)` sans mention de `session-big.json` (1 048 577 o).

Correctif : skip enregistré `larger than 1 MB` dans `Skipped:`.

Vert : 5 fichiers / 30 tests. Commit `31b84a41a`.

### Lot F — restauration = fusion explicite (rouge → vert)

Rouge collé : preview « This will overwrite current .codebuddy/ configuration. » sans citer `extra-not-in-archive.md`.

Correctif : fusion nommée (fichiers extra listés, preview + succès). Pas un refus : les extras restent.

Vert : 6 fichiers / 33 tests. Commit `7af07e409`.

### Lot G — taille 0 KB, JSON brut, ancien format (rouge → vert)

Rouge collé : `Size: 0 KB` pour 208 o ; restore tronqué `Failed to read backup … Expected double-quoted property name` ; v0.9 `archive size mismatch`.

Correctif : taille en B/KB/MB ; « not a readable Code Buddy backup (truncated or not JSON) » ; version 1.x exigée.

Vert : 6 fichiers / 36 tests. Commit `0a797e0b5`.

### Lot H — projet vs HOME (rouge → vert)

Rouge collé : create ne disait pas que la source est le `.codebuddy/` du projet.

Correctif : ligne `Source: … (current project .codebuddy/; does not include ~/.codebuddy)` ; help CLI ; `docs/commands.md` ; `docs/deployment.md`.

Vert : 6 fichiers / 38 tests. Commit `4bfba4d0c`.

### Rejeu CLI après correctifs (HOME `_gk16/home`)

```
create vide (screenshots only) → exit 1
  No files to back up in …/empty-project/.codebuddy. …

create dir chmod a-w → exit 1, pas de crash
  Cannot write backup …: permission denied (…).

verify abs.json → exit 1
  Invalid backup …: path escapes destination: /etc/passwd

create projet → exit 0
  Source: …/project/.codebuddy (current project .codebuddy/; does not include ~/.codebuddy)
  Files: 9 (…)
  Size: 231 B
```

Vérifications machine : `npx tsc --noEmit -p .` exit 0 ; `tsc --project tsconfig.gpuNode-identity.json` exit 0 ; ESLint ciblé `--max-warnings=0` exit 0 (après retrait de `logger` inutilisé) ; `npm run lint` exit 0 (0 erreur, 2473 warnings historiques) ; `git diff --check` exit 0 ; tests backup 6 fichiers / 38 verts.

## Tableau final

| Cas | Attendu utilisateur | Observé avant | Verdict | Correctif |
|-----|---------------------|---------------|---------|-----------|
| create → list → verify → mutate → restore | sha256 identiques | 8/8 fichiers d'archive restaurés à l'identique | **vert** (happy path) | déjà là (R30) |
| Fichier 0 octet | inclus et restauré | sha256 vide `e3b0c442…` OK | **vert** | aucun |
| Symlink dest (G6R) | refuse, ne pas écrire dehors | `symbolic link is forbidden`, victime `KEEPME` | **vert** | déjà là (G6R) |
| `.codebuddy` vide | ne pas annoncer un backup | create « Backup created Files: 0 » | **rouge** | Lot A `7f9920a47` |
| Disque plein / EACCES | message d'écriture, pas un crash | crash `Unhandled promise rejection` ; restore « Failed to read » | **rouge** | Lot B `c5bd46383` |
| Archive `../` ou chemin absolu | verify refuse | verify « Backup valid », restore refuse | **rouge** | Lot C `f1fd3dbf7` |
| Symlink source hors projet | ne pas emballer la cible | archive contenait `SECRET_OUTSIDE` | **rouge** | Lot D `78c846046` |
| Fichier > 1 Mo | le dire | sauté sans mention | **rouge** | Lot E `31b84a41a` |
| Restore profil non vide | fusion ou refus **explicite** | fusion silencieuse, phrase « overwrite current .codebuddy/ » | **rouge** → **fusion explicite** | Lot F `7af07e409` |
| Taille < 1 Ko | ne pas afficher 0 KB | `Size: 0 KB` pour 208 o | **rouge** | Lot G `0a797e0b5` |
| Archive tronquée / tar | message lisible | `Unterminated string in JSON` / `Failed to read` | **rouge** | Lot G |
| Format v0.9 | « format non supporté » | `archive size mismatch` | **rouge** | Lot G |
| Cible = projet vs HOME | le dire | seuls les fichiers cwd étaient sauvés, sans le dire | **rouge** | Lot H `4bfba4d0c` |

## Ce qu'un utilisateur peut croire à tort

1. **`buddy backup` sauve `~/.codebuddy` (mémoire globale, sessions, skills).** Faux : ça sauve le `.codebuddy/` du **répertoire courant**. Les archives atterrissent seulement dans `~/.codebuddy/backups`. Un `create` lancé hors projet échoue (pas de `.codebuddy/` projet).
2. **`restore --confirm` remet le profil exactement comme au `create`.** Faux : c'est une **fusion**. Les fichiers hors archive (et `screenshots/` jamais sauvés) restent. Avant le lot F, le message le faisait croire.
3. **`verify` « Backup valid » veut dire « on pourra restaurer ».** Faux avant le lot C : une archive avec `/etc/passwd` était « valid ».
4. **`Backup created` avec `Files: 0` / `Size: 0 KB` est un vrai backup.** Faux : vide inutilisable (lot A) ; 0 KB était un arrondi (lot G).
5. **Tous les fichiers du projet sont dans l'archive.** Faux : > 1 Mo, `screenshots/`, `tool-results/`, `runs/`, `browser-data/`, et désormais les **symlinks**, sont exclus.
6. **Un échec d'écriture pendant create est un message clair.** Faux avant le lot B : crash + `buddy --resume`.
7. **Le checksum affiché est un SHA-256 complet.** Faux : 16 hex (64 bits). Suffisant pour le happy path mesuré, pas une preuve cryptographique forte.
8. **Restore est tout-ou-rien.** Encore vrai seulement si l'écriture échoue **avant** le premier fichier. Un crash au milieu du boucle laisse des fichiers déjà écrasés (pas de staging transactionnel). Ouvert.

## Ouvert

- Restore non transactionnel (pas de répertoire staging puis rename).
- Checksum tronqué à 16 hex.
- Toujours pas de backup du profil HOME (décision produit ; désormais dite).
- Plafond 1 Mo inchangé (désormais annoncé).

## Bilan (≤ 10 lignes)

Cycle réel `create` → `list` → `verify` → mutation → `restore --confirm` : sha256 des fichiers d'archive identiques avant/après. Huit défauts mesurés (succès vide, crash EACCES, verify menteur, symlink source, skip 1 Mo, fusion silencieuse, 0 KB, JSON/format). Huit lots rouge→vert, un commit chacun (`7f9920a47` … `4bfba4d0c`). Preuves : CLI HOME `_gk16/home` ; 6 fichiers / 38 tests backup ; `tsc` racine+GPU exit 0 ; ESLint ciblé 0 ; pas de push, pas d'`~/.codebuddy` réel, original `~/code-buddy` intact. Reste ouvert : restore non atomique, checksum 16 hex, pas de backup HOME.
