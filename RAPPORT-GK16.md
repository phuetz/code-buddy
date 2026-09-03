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

Vert : 5 fichiers / 30 tests.

## Périmètre annoncé (à remplir après lecture)

Fichiers à lire ensuite (annoncés, pas encore ouverts) :

- `src/commands/backup*.ts`
- `src/backup/`
- `tests/backup/`
- documentation utilisateur relative à `buddy backup`

Cycle réel prévu, HOME temporaire du clone uniquement :

1. peupler un faux `~/.codebuddy` (config / mémoire / sessions)
2. `create` → `list` → `verify`
3. modifier des fichiers
4. `restore` et comparer sha256 avant/après

Cas méchants prévus :

- archive tronquée
- archive avec symlink absolu et `../`
- fichier de 0 octet
- disque « plein » simulé
- restauration dans un profil non vide (fusion ou refus explicite ?)
- archive d'une version antérieure du format

Chaque défaut : test rouge → correctif → vert, un commit.

## Tableau final (à compléter)

| Cas | Attendu utilisateur | Observé | Verdict | Correctif |
|-----|---------------------|---------|---------|-----------|
| *(vide jusqu'à exécution)* | | | | |

## Ce qu'un utilisateur peut croire à tort

*(à remplir après les exécutions)*

## Bilan (≤ 10 lignes)

*(à remplir en fin de mission)*
