# Réparation G6 — trous de sécurité Gemini

- Début : 2026-09-02 (Europe/Paris)
- Clone autorisé : ce dépôt uniquement
- Branche attendue : `fix/g6-securite-2026-09-03`
- Contraintes : aucun push, aucune API payante, aucun service touché, aucune écriture hors du clone.

## Journal initial

Ce rapport a été créé avant toute inspection du dépôt, conformément à la mission.

### Fichiers lus

- `docs/FABLE5-CODEX-COORDINATION.md` (protocole et entrée de réservation pertinente)
- `REVUE-G6-GEMINI.md` (365 lignes, revue complète)
- `src/fleet/peer-tool-bridge.ts` (intégralité)
- `src/fleet/permissions.ts` (intégralité)
- `tests/fleet/revue-gemini-peer-tool-traversal.test.ts` (intégralité)
- `tests/fleet/peer-tool-bridge.test.ts` (intégralité)
- `src/commands/handlers/backup-handlers.ts` (intégralité)
- `tests/commands/revue-gemini-backup-symlink.test.ts` (intégralité)
- `tests/commands/backup-restore.test.ts` (intégralité)
- `tests/commands/backup-archive.test.ts` (intégralité)
- `tests/commands/backup-handlers.test.ts` (intégralité)
- `tests/commands/backup-cli-confirm.test.ts` (intégralité)
- `tests/helpers/tmp.ts` (intégralité)
- `src/security/declarative-rules.ts` (intégralité)
- `src/security/permission-modes.ts` (intégralité)
- `src/tools/registry/tool-alias-map.ts` (intégralité)
- `src/tools/registry/tool-aliases.ts` (intégralité)
- `src/security/tool-policy/groups.ts` (normalisation des noms)
- `src/security/tool-policy/tool-groups.ts` (intégralité)
- `tests/security/revue-gemini-allowlist-alias.test.ts` (intégralité)
- `tests/security/declarative-rules.test.ts` (intégralité)
- `tests/security/permission-modes.test.ts` (cas de classification et modes)
- `tests/security/tool-policy/policy-resolver.test.ts` (cas d’alias)
- `src/skills/hub-signing.ts` (intégralité)
- `src/skills/hub.ts` (configuration, trousseau, vérification et deux chemins d’installation)
- `tests/skills/revue-gemini-signed-package.test.ts` (intégralité)
- `tests/skills/hub.test.ts` (tests de signature et politique d’installation)
- `tests/skills/hub-signing.test.ts` (tests voisins de cryptographie et confiance)
- `src/server/origin-check.ts` (intégralité)
- `src/security/dev-origins.ts` (intégralité)
- `src/gateway/ws-transport.ts` (validation d’origine et intégration WebSocket)
- `tests/server/revue-gemini-origin-check.test.ts` (intégralité)
- `tests/unit/ws-origin-hardening.test.ts` (validation d’origine et intégration Gateway)
- `tests/server/peer-tool-bridge.test.ts` (diagnostic du test voisin sensible aux ignores)
- `src/agent/multi-agent/session-fleet-bridge.ts` (intégralité)
- `src/fleet/privacy-lint.ts` (intégralité, primitive de caviardage)
- `tests/fleet/revue-gemini-session-leak.test.ts` (intégralité)
- `tests/agent/multi-agent/session-fleet-bridge.test.ts` (intégralité)
- `src/security/skill-scanner.ts` (intégralité)
- `src/skills/skill-importer.ts` (intégralité, copie des dossiers support et firewall)
- `tests/security/revue-gemini-skill-scanner.test.ts` (intégralité)
- `tests/security/skill-scanner.test.ts` (scanner de fichier, répertoire et firewall)
- `tests/skills/skill-importer.test.ts` (import et quarantaine)
- `tests/skills/skill-exchange.test.ts` (échange et refus fail-closed)
- `tests/fleet/revue-gemini-iban.test.ts` (intégralité)
- `tests/fleet/privacy-lint.test.ts` (intégralité)

### Commandes exécutées

```text
sed -n '1,260p' docs/FABLE5-CODEX-COORDINATION.md
rg -n "G6|Gemini.*sécur|REPARATION-G6|cb-verif-g-2026-09-02|fix/g6-securite" docs/FABLE5-CODEX-COORDINATION.md
git branch --show-current
git status --short --branch
wc -l REVUE-G6-GEMINI.md
sed -n '1,260p' REVUE-G6-GEMINI.md
sed -n '261,420p' REVUE-G6-GEMINI.md
git log --oneline --decorate -12
git status --short
```

Résultat : branche `fix/g6-securite-2026-09-03` confirmée. Seuls `REPARATION-G6.md`, `node_modules` et `cowork/node_modules` sont non suivis ; les deux répertoires de dépendances sont laissés intacts et hors commits. Le chantier G6R a été réservé dans le tableau de coordination.

## Correctifs

### 1. Outil pair hors workspace

Commande rouge :

```text
npm test -- tests/fleet/revue-gemini-peer-tool-traversal.test.ts --reporter=verbose
× ... doit refuser la configuration de workspace root="/" ...
AssertionError: expected true to be false
Test Files  1 failed (1)
Tests       1 failed (1)
EXIT_CODE=1
```

Correctif : `assertPathInsideWorkspace()` refuse désormais une racine inexistante, non répertoire ou égale à la racine physique du système, après `realpath`. Une racine configurée par symlink vers `/` est donc également refusée. Le contrôle reste fail-closed.

Vert ciblé et voisin :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet/revue-gemini-peer-tool-traversal.test.ts tests/fleet/peer-tool-bridge.test.ts --reporter=verbose
Test Files  2 passed (2)
Tests       17 passed (17)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet --exclude tests/fleet/revue-gemini-session-leak.test.ts --exclude tests/fleet/revue-gemini-iban.test.ts --reporter=dot
Test Files  37 passed (37)
Tests       625 passed (625)
EXIT_CODE=0

npx eslint src/fleet/peer-tool-bridge.ts tests/fleet/revue-gemini-peer-tool-traversal.test.ts
EXIT_CODE=0
```

La suite `tests/fleet` sans exclusion donne 625 tests verts et uniquement 3 rouges déjà attendus pour les trous 2 et 7, non encore traités à cette étape.

Commit : `b5901663e fix(fleet): refuse peer tool filesystem roots`.

### 5. Archive de sauvegarde hors cible / symlink

Rouge :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/commands/revue-gemini-backup-symlink.test.ts --reporter=verbose
× ... doit refuser d’écrire à travers un symlink ...
AssertionError: expected undefined to be 1
Test Files  1 failed (1)
Tests       1 failed (1)
EXIT_CODE=1
```

Correctif : avant toute écriture, la restauration contrôle par `lstat` la racine et chaque composant existant de toutes les destinations. Tout symlink ou parent non-répertoire provoque un refus. Le contrôle est répété après création des parents, juste avant l’écriture. La couverture a été étendue au symlink placé sur un répertoire parent, sans modifier ni affaiblir le test rouge.

Vert ciblé et voisins :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/commands/revue-gemini-backup-symlink.test.ts tests/commands/backup-restore.test.ts tests/commands/backup-archive.test.ts tests/commands/backup-handlers.test.ts tests/commands/backup-cli-confirm.test.ts --reporter=dot
Test Files  5 passed (5)
Tests       23 passed (23)
EXIT_CODE=0

npx eslint src/commands/handlers/backup-handlers.ts tests/commands/revue-gemini-backup-symlink.test.ts
0 erreur ; 1 warning préexistant (`logger` inutilisé dans `backup-handlers.ts`)
EXIT_CODE=0
```

Le dépôt ne contient pas de répertoire `tests/backup` ; les cinq suites `backup-*` sous `tests/commands` constituent le périmètre voisin disponible.

Commit : `6810c1c41 fix(backup): reject symlink restore destinations`.

### 3. Allowlist contournée par alias

Rouge :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/security/revue-gemini-allowlist-alias.test.ts --reporter=verbose
× ... doit appliquer la règle deny Bash(*) ... alias terminal
AssertionError: expected 'ask' to be 'deny'
× ... doit considérer l’alias terminal comme outil destructeur ...
AssertionError: expected false to be true
Test Files  1 failed (1)
Tests       2 failed (2)
EXIT_CODE=1
```

Correctif : les règles déclaratives et les classifications de modes résolvent maintenant les noms via la table canonique `TOOL_ALIASES`. `terminal` et `shell_exec` héritent donc de `bash`, y compris pour l’analyse des commandes et le mode plan ; les alias de lecture/écriture/édition héritent aussi de leur classe de sécurité.

Vert ciblé et voisins :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/security/revue-gemini-allowlist-alias.test.ts tests/security/declarative-rules.test.ts tests/security/permission-modes.test.ts tests/security/tool-policy/policy-resolver.test.ts --reporter=verbose
Test Files  4 passed (4)
Tests       84 passed (84)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/security --exclude tests/security/revue-gemini-skill-scanner.test.ts --reporter=dot
Test Files  40 passed (40)
Tests       819 passed (819)
EXIT_CODE=0

npx eslint src/security/declarative-rules.ts src/security/permission-modes.ts tests/security/revue-gemini-allowlist-alias.test.ts
EXIT_CODE=0
```

La seule suite sécurité exclue est le test rouge du trou 4, traité plus loin selon l’ordre imposé.

Commit : `f6456812f fix(security): normalize tool aliases in permissions`.

### 6. Paquet signé accepté avec mauvaise clé

Rouge :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/skills/revue-gemini-signed-package.test.ts --reporter=verbose
× ... doit refuser l’installation d’un skill signé avec une clé inconnue ...
AssertionError: promise resolved ... instead of rejecting
signatureStatus: "untrusted"
Test Files  1 failed (1)
Tests       1 failed (1)
EXIT_CODE=1
```

Correctif : une signature fournie constitue désormais une revendication de confiance qui doit être vérifiée. Les statuts `untrusted` et `invalid` sont toujours refusés avant toute écriture, même lorsque les installations non signées restent permises. L’option `requireSignedInstalls` conserve sa sémantique supplémentaire : refuser aussi le contenu réellement non signé. Le test voisin qui documentait l’ancien comportement vulnérable a été corrigé pour exiger le refus et l’absence de fichier installé.

Vert ciblé et voisins :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/skills/revue-gemini-signed-package.test.ts tests/skills/hub.test.ts tests/skills/hub-signing.test.ts --reporter=dot
Test Files  3 passed (3)
Tests       106 passed (106)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/skills --reporter=dot
Test Files  25 passed | 1 skipped (26)
Tests       387 passed | 3 skipped (390)
EXIT_CODE=0

npx eslint src/skills/hub.ts tests/skills/hub.test.ts tests/skills/revue-gemini-signed-package.test.ts
EXIT_CODE=0
```

Commit : `3306c9a82 fix(skills): reject signatures from untrusted keys`.

### 8. Origine non-loopback acceptée par wildcard

Rouge :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/server/revue-gemini-origin-check.test.ts --reporter=verbose
× ... doit refuser les origines non loopback qui usurpent le préfixe localhost:*
AssertionError: expected true to be false
Test Files  1 failed (1)
Tests       1 failed (1)
EXIT_CODE=1
```

Correctif : les wildcards d’origine sont maintenant comparés sur une structure stricte `schéma://hôte:port`. Le wildcard de port n’accepte qu’un port numérique explicite ; il ne peut ni consommer un suffixe d’hôte ni valider une URL avec identifiants, chemin, requête ou fragment. La passerelle WebSocket réutilise la même fonction centrale au lieu de conserver sa copie vulnérable.

Vert ciblé et voisins :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/server/revue-gemini-origin-check.test.ts tests/unit/ws-origin-hardening.test.ts --reporter=verbose
Test Files  2 passed (2)
Tests       17 passed (17)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" RIPGREP_CONFIG_PATH="$PWD/.g6-rg.conf" npm test -- tests/server --reporter=dot
Test Files  46 passed (46)
Tests       507 passed (507)
EXIT_CODE=0

npx eslint src/server/origin-check.ts src/gateway/ws-transport.ts tests/server/revue-gemini-origin-check.test.ts
EXIT_CODE=0
```

Note de confinement : avec `TMPDIR` dans le clone, le premier passage de `tests/server` ignorait `hello.txt` à cause de la règle versionnée `*.txt`, ce qui faisait échouer uniquement le test de recherche pair (506 verts). La relance avec un fichier temporaire `RIPGREP_CONFIG_PATH` contenant `--no-ignore`, créé puis supprimé dans le clone, reproduit le comportement habituel d’un tmp hors dépôt sans écrire hors du clone ; 507/507 tests passent.

Commit : `8dbf9642a fix(server): constrain wildcard origin matching`.

### 2. Session pair et fuite de prompt

Rouge :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet/revue-gemini-session-leak.test.ts --reporter=verbose
× ... doit masquer les secrets et ne pas diffuser le prompt confidentiel en clair ...
AssertionError: le contenu reçu contient encore le faux jeton de test
Test Files  1 failed (1)
Tests       1 failed (1)
EXIT_CODE=1
```

Correctif : `redactSecrets()` traite le message complet avant la limite de 200 caractères, puis seulement le résultat caviardé est diffusé. Un test voisin couvre explicitement un secret qui chevauche la limite de prévisualisation, afin qu’une troncature préalable ne puisse pas casser la détection.

Vert ciblé et voisins :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet/revue-gemini-session-leak.test.ts tests/agent/multi-agent/session-fleet-bridge.test.ts --reporter=verbose
Test Files  2 passed (2)
Tests       11 passed (11)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet --exclude tests/fleet/revue-gemini-iban.test.ts --reporter=dot
Test Files  38 passed (38)
Tests       626 passed (626)
EXIT_CODE=0

npx eslint src/agent/multi-agent/session-fleet-bridge.ts tests/agent/multi-agent/session-fleet-bridge.test.ts tests/fleet/revue-gemini-session-leak.test.ts
0 erreur ; 4 warnings préexistants `no-explicit-any` dans le type de broadcaster
EXIT_CODE=0
```

La seule suite flotte exclue est le test rouge du trou 7, dernier correctif de la mission.

Commit : `200e56b47 fix(fleet): redact session message previews`.

### 4. Script de skill dangereux non scanné

Rouge :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/security/revue-gemini-skill-scanner.test.ts --reporter=verbose
× ... doit scanner et bloquer les scripts exécutables sans extension ...
AssertionError: expected 'allow' not to be 'allow'
Test Files  1 failed (1)
Tests       1 failed (1)
EXIT_CODE=1
```

Correctif : en plus des extensions connues et de tout contenu sous `scripts/`, le scanner inspecte désormais chaque fichier ayant un bit exécutable ou commençant par un shebang, quel que soit son nom ou son dossier. Une lecture bornée à deux octets suffit pour reconnaître le shebang. Un test voisin couvre le script sans extension et sans bit exécutable. Le chemin nominatif privé présent dans le payload du test Gemini a été remplacé par un chemin générique, sans diminuer la détection `rm -rf`.

Vert ciblé et voisins :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/security/revue-gemini-skill-scanner.test.ts tests/security/skill-scanner.test.ts tests/skills/skill-importer.test.ts tests/skills/skill-exchange.test.ts --reporter=verbose
Test Files  4 passed (4)
Tests       102 passed (102)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/security --reporter=dot
Test Files  41 passed (41)
Tests       821 passed (821)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/skills --reporter=dot
Test Files  25 passed | 1 skipped (26)
Tests       387 passed | 3 skipped (390)
EXIT_CODE=0

npx eslint src/security/skill-scanner.ts tests/security/revue-gemini-skill-scanner.test.ts tests/security/skill-scanner.test.ts
EXIT_CODE=0
```

Commit : `30616585f fix(skills): scan extensionless executable payloads`.

### 7. Lint vie privée et IBAN autrement formaté

Rouge :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet/revue-gemini-iban.test.ts --reporter=verbose
× ... doit détecter un IBAN français au format RIB standard ...
AssertionError: expected false to be true
× ... doit détecter et masquer un IBAN en minuscules ou séparé par des tirets
AssertionError: expected false to be true
Test Files  1 failed (1)
Tests       2 failed (2)
EXIT_CODE=1
```

Correctif : le scanner repère le préfixe pays/checksum sans tenir compte de la casse, reconstruit la longueur officielle en acceptant espaces, tabulation, espace insécable ou tiret, puis exige un checksum MOD-97 valide. Les plages détectées restent exprimées dans le texte original pour que `redactSecrets()` masque exactement la valeur. Un test voisin refuse une valeur de même forme mais au checksum invalide.

Correction de test justifiée : la seconde assertion du premier test rouge utilisait `result.findings[].ruleId`, API inexistante dans `PrivacyLintResult`. L’interface et les tests voisins prouvent que l’API publique est `result.matches[].kind`. L’assertion a été corrigée vers cette API sans changer l’exigence ni le premier point rouge `hasSecrets`.

Vert ciblé et voisins :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet/revue-gemini-iban.test.ts tests/fleet/privacy-lint.test.ts tests/fleet/revue-gemini-session-leak.test.ts tests/agent/multi-agent/session-fleet-bridge.test.ts --reporter=verbose
Test Files  4 passed (4)
Tests       36 passed (36)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" npm test -- tests/fleet --reporter=dot
Test Files  39 passed (39)
Tests       629 passed (629)
EXIT_CODE=0

npx eslint src/fleet/privacy-lint.ts tests/fleet/privacy-lint.test.ts tests/fleet/revue-gemini-iban.test.ts
EXIT_CODE=0
```

Commit : `0a284a351 fix(fleet): detect normalized valid IBANs`.

## Vérifications globales

État cumulé des huit correctifs :

```text
TMPDIR="$PWD/.g6-test-tmp" npm test -- <les 8 fichiers revue-gemini dans l’ordre G6R> --reporter=verbose
Test Files  8 passed (8)
Tests       11 passed (11)
EXIT_CODE=0

TMPDIR="$PWD/.g6-test-tmp" RIPGREP_CONFIG_PATH="$PWD/.g6-rg.conf" npm test -- tests/fleet tests/security tests/skills tests/server <5 suites backup sous tests/commands> tests/agent/multi-agent/session-fleet-bridge.test.ts --reporter=dot
Test Files  157 passed | 1 skipped (158)
Tests       2377 passed | 3 skipped (2380)
EXIT_CODE=0

npm run typecheck
tsc --noEmit && tsc --project tsconfig.gpuNode-identity.json
EXIT_CODE=0

npm run lint -- --quiet
eslint . --ext .js,.jsx,.ts,.tsx --quiet
EXIT_CODE=0

git diff b94d656b9..HEAD -U0 -- '*.ts' '*.tsx' '*.js' '*.jsx' | rg <motifs nominatifs, chemins privés et IP privées>
aucune occurrence ajoutée

git diff --check
EXIT_CODE=0
```

Le premier lancement du lint complet a dépassé la fenêtre de capture de 30 secondes ; le processus a été laissé finir, puis la même commande a été relancée avec suivi jusqu’à terminaison et a renvoyé 0. Aucun service n’a été touché, aucune API appelée, aucun push effectué et aucune écriture n’a eu lieu hors du clone. Les répertoires temporaires confinés au clone ont été vérifiés puis supprimés avec `find ... -depth -delete` ; ils ne contenaient que des artefacts générés par les tests.

## Commits

1. `b5901663e fix(fleet): refuse peer tool filesystem roots`
2. `6810c1c41 fix(backup): reject symlink restore destinations`
3. `f6456812f fix(security): normalize tool aliases in permissions`
4. `3306c9a82 fix(skills): reject signatures from untrusted keys`
5. `8dbf9642a fix(server): constrain wildcard origin matching`
6. `200e56b47 fix(fleet): redact session message previews`
7. `30616585f fix(skills): scan extensionless executable payloads`
8. `0a284a351 fix(fleet): detect normalized valid IBANs`
