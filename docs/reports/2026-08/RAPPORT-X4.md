# MISSION X4 — Code Buddy fonctionne sans `better-sqlite3`

Date : 2026-08-26
Branche : `fix/w2-cli-families-2026-08-26`
Commits fonctionnels : `65cf2bf1`, `077249eb`, `2049fb4f`

## Résultat

Une installation du paquet `@phuetz/code-buddy@1.8.0` avec `--omit=optional`, un `HOME` vierge, aucun secret et un environnement réduit à `/usr/bin:/bin` répond désormais sur les **103 commandes** : **103 exits 0, 0 crash, 0 trace de pile, 0 unhandled rejection**.

`better-sqlite3` reste dans `optionalDependencies`. Quand il manque :

- les sessions sont persistées en JSON avec un avertissement unique et actionnable ;
- RunStore conserve ses fichiers JSONL/artefacts et recherche par scan de fichiers au lieu de FTS5 ;
- une fonction exclusivement SQLite échoue avec un code non nul et une phrase indiquant `npm install better-sqlite3` ;
- `doctor` dit explicitement ce qui reste disponible et ce qui est perdu ;
- l'arrêt peut importer le store de session sans produire `Failed to save session during shutdown`.

## Reproduction avant correction

Le garde-fou de la mission interdit `/tmp`. Une installation sous le dépôt peut toutefois remonter jusqu'au `node_modules` principal et y retrouver faussement `better-sqlite3`. Le banc a donc bloqué ce nom de module dans les deux résolveurs Node, ESM et CommonJS. Le paquet installé lui-même était physiquement dépourvu de `better-sqlite3`.

La commande demandée a alors reproduit le défaut :

```text
buddy loop --help
exit 1
error: Cannot find package 'better-sqlite3' (blocked by X4 clean-install harness)
```

Sur l'état exact de départ de cette branche, 15 des 16 aides citées tombaient : 11 exposaient d'abord `better-sqlite3`, quatre exposaient d'abord le binaire optionnel de `@vscode/ripgrep`, et `tunnel --help` passait déjà. Cette différence avec la mesure transmise (16/16) est consignée au lieu d'être masquée ; `loop`, `goal` et `tools` reproduisaient bien le problème produit.

Les trois chargements runtime statiques de SQLite étaient :

```text
src/database/database-manager.ts
src/observability/run-store.ts
src/tools/db-migration.ts
```

Le second échec à l'arrêt venait de `graceful-shutdown.ts` → import dynamique de `session-store.ts` → import de `session-repository.ts` → import statique de `database-manager.ts`. Le `catch` du shutdown entourait l'import, mais ne pouvait que signaler ce second échec ; il ne rendait pas le store importable.

## Correctif de racine

`src/database/optional-sqlite.ts` est la frontière unique. Elle conserve les types réels avec `import type`, charge le constructeur seulement au premier usage et normalise les absences de paquet ou de binding natif. Le gestionnaire central et l'outil de migration utilisent le chargeur asynchrone ; RunStore utilise le chargeur CommonJS synchrone à l'intérieur de son `try`, car son index FTS est une API synchrone.

`SessionStore` et `RunStore` possédaient déjà les replis utiles. Ils sont maintenant atteignables et annoncés. `db-migration.ts` utilisait aussi `__dirname` dans un module ESM ; ce défaut masqué a été remplacé par `fileURLToPath(import.meta.url)`.

Le premier paquet minimal a également révélé six chutes sur `@vscode/ripgrep-linux-x64`, absent avec `--omit=optional`. Les neuf imports statiques du wrapper ont été remplacés par un résolveur commun : binaire empaqueté, puis `rg` sur `PATH`, puis erreur explicite seulement lorsqu'une recherche est réellement demandée.

## Preuve de dégradation sur le paquet installé

```text
[session-store] SQLite unavailable; using JSON session persistence. Install optional SQLite support with `npm install better-sqlite3` ...
SESSION_JSON=.../degraded-sessions/session_....json
RunStore: artifact FTS index unavailable, falling back to file scan. Install optional SQLite support with `npm install better-sqlite3` ...
RUN_CONTENT=persisted without sqlite
MIGRATION_EXIT=2
better-sqlite3 is unavailable. Install optional SQLite support with `npm install better-sqlite3` ...
TOOLS_EXIT=0 LOOP_EXIT=0 TOOLS_STDERR_BYTES=0 LOOP_STDERR_BYTES=0
```

## Balayage final complet

Commande exécutée dans un bac interne au dépôt :

```bash
BALAYAGE_DIR="$x4_sweep" \
BALAYAGE_NODE_OPTIONS="--no-warnings --experimental-loader=$PWD/tests/fixtures/block-optional-dependencies-loader.mjs --require=$PWD/tests/fixtures/block-optional-dependencies-require.cjs" \
BALAYAGE_BLOCKED_MODULES="better-sqlite3" \
scripts/balayage-installation.sh
```

Sortie brute :

```text
== construction
== empaquetage
== installation propre --omit=optional
== balayage de 103 commandes

✓ 103/103 commandes répondent sur une installation neuve
```

Contrôles du résultat :

```text
commands=103 results=103 failures=0 pass=103 nonzero=0
better-sqlite3=absent
ripgrep-platform=absent
```

Matrice complète copiée depuis `resultats.txt` :

```text
acp|0|PASS
approvals|0|PASS
assistant|0|PASS
auth-profile|0|PASS
autonomous-code|0|PASS
autonomy|0|PASS
backup|0|PASS
bundles|0|PASS
campaign|0|PASS
capsule|0|PASS
changelog|0|PASS
channels|0|PASS
cloud|0|PASS
code-explorer|0|PASS
companion|0|PASS
completions|0|PASS
config|0|PASS
cost|0|PASS
council|0|PASS
cron|0|PASS
curator|0|PASS
daemon|0|PASS
deploy|0|PASS
desktop|0|PASS
dev|0|PASS
device|0|PASS
doctor|0|PASS
evolve|0|PASS
exchange|0|PASS
execpolicy|0|PASS
explain|0|PASS
film|0|PASS
fleet|0|PASS
flow|0|PASS
forge|0|PASS
gateway-pairing|0|PASS
git|0|PASS
goal|0|PASS
gpu-worker|0|PASS
groups|0|PASS
gui|0|PASS
heartbeat|0|PASS
hermes|0|PASS
hub|0|PASS
identity|0|PASS
import|0|PASS
improve|0|PASS
influencer|0|PASS
insights|0|PASS
install-gui|0|PASS
intent|0|PASS
intents|0|PASS
knowledge|0|PASS
lessons|0|PASS
llm|0|PASS
login|0|PASS
logout|0|PASS
loop|0|PASS
lora|0|PASS
lsp|0|PASS
maison|0|PASS
mcp|0|PASS
mcp-server|0|PASS
meeting|0|PASS
message|0|PASS
nodes|0|PASS
ollama|0|PASS
onboard|0|PASS
pairing|0|PASS
papers|0|PASS
pipeline|0|PASS
provider|0|PASS
proxy|0|PASS
remind|0|PASS
replay|0|PASS
research|0|PASS
rules|0|PASS
run|0|PASS
science|0|PASS
scrape|0|PASS
screen|0|PASS
secrets|0|PASS
security-audit|0|PASS
server|0|PASS
session|0|PASS
shadow|0|PASS
share|0|PASS
skills|0|PASS
speak|0|PASS
spec|0|PASS
todo|0|PASS
tools|0|PASS
trigger|0|PASS
try|0|PASS
tunnel|0|PASS
update|0|PASS
user-model|0|PASS
vision-train|0|PASS
voice|0|PASS
webhook|0|PASS
whoami|0|PASS
widgets|0|PASS
ws|0|PASS
```

## Vérifications avec SQLite installé

```text
npx vitest run tests/database/
Test Files  2 passed (2)
Tests      11 passed (11)

npx tsc --noEmit -p tsconfig.json
exit 0

tests ciblés SQLite/session/doctor/recherche
Test Files  15 passed (15)
Tests      480 passed (480)

ESLint ciblé
0 erreur, 7 avertissements préexistants dans deux fichiers de grande taille

bash -n scripts/balayage-installation.sh
exit 0
```

Le test d'absence SQLite a d'abord échoué **4/4**, dont le hook d'arrêt, puis passe **4/4** après le correctif. Aucun fichier de `scripts/influencer/`, aucune dépendance déclarée, aucun service et aucune API payante n'ont été touchés. Aucun échec de commande ne reste ouvert dans le périmètre X4.
