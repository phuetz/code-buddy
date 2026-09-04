# REPARATION-HOMEBACKUP1 — Sauvegarde du profil ~/.codebuddy

**Date:** 2026-09-04
**Branche:** `feat/homebackup1-profil-2026-09-04`
**Commits:**
- `d330ee786` (Vibe: implémentation initiale)
- `b10425f9f` (Vibe: doc REPARATION-HOMEBACKUP1 en cours)
- `1041dbe97` (Antigravity: renommage `--home`, correction tests, garde-fous verify/restore)
**Statut:** TERMINÉ

## 1. Contexte et Synthèse de l'Intervention

La lane Vibe initiale avait amorcé l'implémentation de la sauvegarde du profil utilisateur `~/.codebuddy` mais avait laissé le chantier incomplet et cassé :
1. **Collision d'options CLI** : l'utilisation de `--profile` entrait en collision directe avec l'option globale de `buddy` (`buddy --profile <name>` dans `src/cli/requested-profile.ts` et `src/index.ts` pour charger un profil TOML). Commander interceptait le flag avant que le sous-programme `backup` ne puisse le traiter.
2. **4 tests rouges** :
   - 3 échecs dans `tests/commands/backup-profile.test.ts` (taille de fichier ignorée, taille totale ignorée, `mockFileSystem` filtrant les sous-répertoires).
   - 1 échec dans `tests/backup/gk16-backup.test.ts` (assertion sur le rapport d'honnêteté des sources).
3. **Incohérences de sécurité** : `vision.env` figurait indûment dans `PROFILE_BACKUP_WHITELIST` alors que la liste noire absolue des secrets (`*.env`) doit primer impérativement.
4. **Garde-fous verify & restore manquants** : absence de vérification contre la présence de secrets lors de l'inspection/restauration d'une archive, absence de sauvegarde préalable (`.bak`) avant d'écraser un fichier existant du profil lors d'un `restore --confirm`.

Antigravity a repris la branche sans perte d'historique, a levé les collisions et incohérences, sécurisé `verify` et `restore`, rendu tous les tests au vert et exécuté un test réel en lecture seule sur `~/.codebuddy`.

---

## 2. Modifications Réalisées

### A. Renommage de `--profile` en `--home` (`src/commands/cli/backup-command.ts`)
- Ajout de `--home` (« Backup the home profile (~/.codebuddy) instead of the current project »).
- Maintien de `--home-profile` comme alias.
- Conservation de `--scope <home|project|both>` et `--dry-run`.
- Mise à jour de la description générale de la commande pour orienter l'utilisateur vers `--home`.

### B. Moteur de sauvegarde, vérification et restauration (`src/commands/handlers/backup-handlers.ts`)
- **Résolution dynamique du HOME** : utilisation de `getHomeProfileDir()` (`process.env.HOME` ou `os.homedir()`).
- **Support des flags** : gestion unifiée de `--home`, `--home-profile`, `--scope` et repli gracieux si `--profile` arrive par un canal programmatique.
- **Transparence sur les sources** : pour une sauvegarde projet, affichage explicite que `~/.codebuddy` n'est pas inclus et suggestion d'utiliser `--home`.
- **Nettoyage de la liste blanche** : retrait de `vision.env` de `PROFILE_BACKUP_WHITELIST`.
- **Garde-fous de restauration (`handleBackupRestore`)** :
  - Vérification de l'absence de fichiers interdits (secrets) dans l'archive avant toute opération.
  - Sauvegarde de précaution automatique de tout fichier existant (`copyFileSync(dest, `${dest}.bak`)`) avant écrasement lors d'un `restore --confirm`.
  - Aperçu détaillé sans écrasement lorsque `--confirm` est omis.
- **Garde-fous de vérification (`handleBackupVerify`)** : rejet avec erreur explicite si une archive contient un fichier secret blacklisté.
- **Respect strict des plafonds** : fichiers individuels limités à 5 Mo (les fichiers plus gros sont signalés comme ignorés) et levée d'erreur si la taille cumulée dépasse 200 Mo.

### C. Réparation du harnais de test (`tests/commands/backup-profile.test.ts` & `tests/backup/gk16-backup.test.ts`)
- Correction de `createMockFileSystem` : le mock de `readdirSync` ne filtre plus les chemins comportant des sous-dossiers, permettant à `personas/` et `skills/` d'être correctement parcourus.
- Mise à jour du mock `writeFileSync` pour stocker en mémoire le fichier écrit, permettant à la post-vérification de hash de `restore` de réussir.
- Mise à jour de tous les cas de test vers `--home`.
- Ajout de tests complets couvrant :
  - Le rejet d'une archive contenant des secrets lors de `verify` et `restore`.
  - La création du fichier `.bak` avant écrasement lors de `restore --home --confirm`.
  - La simulation d'un faux répertoire HOME peuplé (avec `.env`, `auth-profiles.json`, fichier de 10 Mo ignorés, `settings.json` restauré).
- Mise à jour de l'assertion dans `tests/backup/gk16-backup.test.ts` pour refléter la mention honnête de `--home`.

---

## 3. Preuves de Validation Automatisée

### A. Vitest (Fichiers touchés et sécurité)
Commande exécutée :
```bash
HOME=/home/patrice/DEV/cb-homebackup1-2026-09-04/_qa/homebackup1/home npx vitest run tests/commands/backup-profile.test.ts tests/commands/backup* tests/backup tests/security/donnees-personnelles.test.ts
```
Résultat :
```text
Test Files  7 passed (7)
     Tests  103 passed | 1 skipped (104)
  Duration  2.58s
```
Tous les 103 tests passent avec succès (1 test sauté préexistant dans `tests/backup/gk23-backup-verify.test.ts` qui requiert tar en environnement de test).

### B. TypeScript (`tsc`)
Commande exécutée :
```bash
npx tsc --noEmit -p .
```
Résultat : **code de sortie 0**, aucune erreur de type.

### C. ESLint ciblé
Commande exécutée :
```bash
npx eslint src/commands/cli/backup-command.ts src/commands/handlers/backup-handlers.ts tests/commands/backup-profile.test.ts tests/backup/gk16-backup.test.ts
```
Résultat : **code de sortie 0**, 0 erreur (19 warnings de typage `any` dans les mocks de test préexistants).

### D. Contrôle de propreté Git (`git diff --check`)
Commande exécutée :
```bash
git diff --check
```
Résultat : **code de sortie 0**, aucun conflit ni espace de fin de ligne.

---

## 4. Preuve du Test Grandeur Nature en LECTURE SEULE sur le vrai `~/.codebuddy`

Un test réel a été mené sans altération sur le profil utilisateur réel.

### Protocole et exécution
1. Création d'un témoin d'horodatage :
   ```bash
   touch _qa/witness
   ```
2. Lancement du CLI en mode dry-run avec sortie redirigée dans `_qa/out` :
   ```bash
   npx tsx src/index.ts backup create --home --dry-run --output _qa/out
   ```

### Sortie observée
```text
[DRY RUN] Would create backup: _qa/out/codebuddy-backup-2026-09-04T11-11-18-profile.json
Source: /home/patrice/.codebuddy (profile)
Files: 32
Size: 66 KB
Skipped: 179 (.encryption-key: not in whitelist; auth-profiles.json: blacklisted (secret file); channel-scoped-auth.json: blacklisted (secret file); codex-auth.json: blacklisted (secret file); cowork.env: blacklisted (secret file); credentials: blacklisted (secret file); credentials.enc: blacklisted (secret file); fleet.env: blacklisted (secret file); gpu-worker-client.env: blacklisted (secret file); lisa.env: blacklisted (secret file); media.env: blacklisted (secret file); secrets: blacklisted (secret file); vision.env: blacklisted (secret file); xai-auth.json: blacklisted (secret file); collective/ckg-ledger.jsonl: larger than 5.0 MB; logs: directory not in whitelist; comfyui: directory not in whitelist; backups: directory not in whitelist; ...)
Actual scope: home
```

### Vérification de non-mutation absolue de `~/.codebuddy`
Commande exécutée :
```bash
find ~/.codebuddy -maxdepth 1 -newer _qa/witness
```
Résultat : **strictement vide (0 fichier touché, modifié ou créé)**.

### Vérification de l'absence de fuite de secrets
- Tous les fichiers d'environnement (`*.env`) et d'authentification (`*auth*`, `credentials*`, `secrets`) ont été détectés et exclus par la liste noire sous le motif explicite `blacklisted (secret file)`.
- Aucun contenu secret ni valeur de jeton/clé n'apparaît dans la sortie.
- Les fichiers volumineux (`collective/ckg-ledger.jsonl` > 5 Mo) et répertoires hors liste blanche (`logs`, `runtimes`, `comfyui`, `backups`) ont été correctement ignorés.

---

## 5. Points Ouverts et Recommandations

1. **Option `--profile`** : l'option `--profile` ne doit pas être réintroduite au premier niveau du CLI car elle est réservée par l'architecture globale de Code Buddy pour la sélection des profils de configuration TOML (`requested-profile.ts`). L'utilisation de `buddy backup create --home` (ou `--scope home`) est désormais la norme recommandée.
2. **Sous-dossiers de personas** : la règle `personas/*.json` capture les fichiers JSON directs sous `personas/` mais ignore volontairement les sous-dossiers complexes (ex. banques d'images ou d'audio de personas pesant plusieurs Go). Ce comportement protège la compacité de l'archive (66 Ko retenus sur un dossier pesant 1,3 To).
