# Réparation CIFIX1

Mission : rendre la CI verte sur les six jobs pour le balayage d'installation portable et la fixture interactive Windows.

Le rapport a été créé avant toute inspection. Travail réalisé uniquement dans `~/DEV/cb-cifix1-2026-09-04`, branche `fix/cifix1-ci-portable-2026-09-04`. `~/code-buddy` n'a pas été écrit ; aucun push, aucune API payante et aucun service n'ont été utilisés.

## R1 — balayage d'installation portable

Cause confirmée par `docs/reports/2026-09/RAPPORT-CIMAIN1.md` : après `env -i`, le script imposait `PATH=/usr/bin:/bin` puis appelait `node` nu ; Node des runners Actions est dans le toolcache. Le même environnement appelait `timeout --kill-after`, indisponible sur macOS.

Correctif dans `scripts/balayage-installation.sh` :

- `node`, `npm`, `env` et `sleep` sont résolus par `command -v` avant l'environnement vierge et les chemins absolus sont utilisés ; `tsx` est lancé via `node` sur son `dist/cli.mjs`, car son shebang dépend lui-même de `env node`.
- Le PATH du programme testé reste minimal (`/usr/bin:/bin` par défaut) et n'hérite pas du PATH de l'appelant. `BALAYAGE_ISOLATED_PATH` est uniquement le seam de test qui permet de prouver un PATH sans Node ni timeout.
- Le délai est assuré par un watchdog Bash portable (`sleep`, `kill`, puis `kill -KILL` après 5 s). Le lancement direct d'`env` permet de tuer le Node lui-même et la sortie du watchdog est redirigée pour éviter de retenir les pipes du test.

Tests ajoutés dans `tests/scripts/balayage-installation.test.ts` : PATH isolé sans Node et PATH isolé sans `timeout`. Contre-épreuve mutationnelle : en remettant le PATH historique `/usr/bin:/bin`, les deux tests sont rouges (2 échecs, 13 tests ignorés) ; code restauré, 15/15 sont verts.

## R2 — fixture interactive POSIX / PowerShell

`tests/security/interactive-bash-env-injection.test.ts` sélectionne désormais une fixture de quoting selon `getShellConfiguration()`, la même fonction appelée par `InteractiveBashTool` : quoting POSIX historique ou chaînes PowerShell entre apostrophes, avec apostrophe doublée (`''`). Les assertions de sécurité réelles restent inchangées : NODE_OPTIONS, NODE_PATH et PYTHONPATH ne doivent pas faire apparaître le marqueur d'injection, sur PTY et repli.

Un test sans exemption CI mocke `getShellConfiguration()` en mode Windows, injecte un faux PTY et vérifie l'exécutable/les arguments PowerShell, le quoting et l'absence de NODE_OPTIONS dans l'environnement. Mutation du quoting PowerShell vers le quoting POSIX : 1 échec, 7 tests ignorés ; code restauré : 8/8 verts.

## R3 — macOS PTY, décision de ne pas corriger à l'aveugle

Le log CIMAIN1 rapporte `PTY execution failed: posix_spawnp failed` sur macOS, alors que la production résout déjà `/bin/bash` absolument. Ce clone Linux ne peut pas distinguer un défaut `node-pty`/ABI, de l'image runner, des permissions ou des options de spawn ; aucun changement de production n'est donc appliqué.

Sur un runner macOS, mesurer dans le même job et avec le même Node :

1. `sw_vers`, `uname -a`, `node --version`, `node -p 'process.execPath'`, `npm ls node-pty` et `node -p 'process.versions.modules'` ;
2. `test -x /bin/bash`, `realpath /bin/bash`, le `cwd`, et les clés/valeurs non secrètes de l'environnement finalement remis à `node-pty` ;
3. un micro-programme `node-pty` qui appelle `pty.spawn('/bin/bash', ['-c', 'printf ok'], { name: 'xterm-256color', cols: 120, rows: 30, cwd: process.cwd(), env })`, en distinguant exception au constructeur, événement `onExit` et événement `onData` ;
4. `file node_modules/node-pty/build/Release/pty.node`, `otool -L` sur cette bibliothèque et la présence du binaire compilé pour l'architecture du runner.

Si le micro-programme échoue, la cause est runner/native/ABI et il faut mesurer rebuild et image ; s'il passe, comparer avec la commande exacte du test (exécutable, arguments, cwd et env) avant toute modification de production. Il ne faut pas transformer ce cas en skip.

## Vérifications

- Baseline Linux avant correction : `HOME=~/DEV/cb-cifix1-2026-09-04/_qa/cifix1/home npx vitest run tests/scripts/balayage-installation.test.ts` → 1 fichier, 13/13 verts (la machine de l'auteur masque le défaut).
- R1 après correction : même commande → 1 fichier, 15/15 verts.
- R2 après correction : `HOME=~/DEV/cb-cifix1-2026-09-04/_qa/cifix1/home npx vitest run tests/security/interactive-bash-env-injection.test.ts` → 1 fichier, 8/8 verts.
- Commande de preuve demandée : `HOME=~/DEV/cb-cifix1-2026-09-04/_qa/cifix1/home npx vitest run tests/scripts tests/security tests/unit/bash-tool.test.ts tests/commands/utility-commands.test.ts` → 65 fichiers sélectionnés, 1 196 passés, 1 échec sur 1 197 tests. L'échec est préexistant et hors CIFIX1 : `tests/security/donnees-personnelles.test.ts` signale `ministar` déjà présent dans `docs/FABLE5-CODEX-COORDINATION.md` et `darkstar` déjà présent dans `docs/reports/2026-09/RAPPORT-CIMAIN1.md` ; aucune de ces occurrences n'a été introduite par les deux correctifs.
- `bash -n scripts/balayage-installation.sh` → 0 ; ShellCheck non installé (`shellcheck absent`).
- ESLint ciblé sur les deux tests → 0 ; `npm run typecheck` (tsc principal + GPU identity) → 0 ; `git diff --check` → 0.

## Commits et passation

- R1 : `e22bbb4e8 fix(ci): make installation sweep portable`.
- R2 : `df9f6b9d9 fix(security): select interactive shell fixture by host`.
- Documentaire : ce rapport et la mise à jour de `docs/FABLE5-CODEX-COORDINATION.md`.
- Reste ouvert : reproduire le PTY macOS sur runner macOS ; traiter séparément le rouge préexistant de données personnelles si Patrice le souhaite. La zone CIFIX1 est sinon prête à être relue, sans publication distante.
