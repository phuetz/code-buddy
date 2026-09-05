# REPARATION-CIFIX3 — macOS + Windows CI (2026-09-06)

- **Branche de travail** : `fix/cifix3-macos-windows-2026-09-06` (clone dédié, hors de la copie de travail)
- **Branche poussée** : `ci/cifix3-macos-windows`
- **Base** : `54cb2b2f0` (`codex/audit-systeme-nerveux-2026-09-01`, PR brouillon #149)
- **Run de référence** : `33918143339` — macOS 20/22 `Run tests` (19 échecs) et Windows 20/22 `Run tests (shard 1/6)` (15 puis 14 après retry)

## Méthode

Aucune désactivation en bloc. Chaque défaut a d'abord été **reproduit sous Linux** au moyen d'un
faux environnement, puis corrigé dans le code, puis re-mesuré :

| Reproduction | Ce qu'elle imite |
| --- | --- |
| shim `wc` préfixant son décompte d'espaces | `wc(1)` BSD de macOS |
| userland BSD (PATH curé sans `sha256sum` ni `realpath`, `find` sans `-printf`, `stat` sans `-c`) | coreutils absents de macOS |
| `TMPDIR` pointé sur un lien symbolique | `/var` → `/private/var` de macOS |
| `TMPDIR` dont le chemin logique est plus court que le physique | profondeur physique de `/private/var` |
| PTY injecté qui lève `posix_spawnp failed.` | `spawn-helper` de node-pty sans bit exécutable |
| séparateur du double `path.join` changé en `\|` | antislash de Windows |

## Points traités

### 1. `wc -l` BSD — `scripts/balayage-installation.sh` (4 échecs macOS)
`$(wc -l < f)` conserve les espaces initiaux de BSD : le compte rendu devenait
`✓        1/       1 commandes répondent`. `compter_lignes()` normalise par arithmétique shell.
*Preuve : shim BSD → 4 rouges avant, 15/15 après.*

### 2. Userland GNU absent — `scripts/deleguer.sh`, `scripts/fusionner-lane.sh` (5 échecs macOS)
`sha256sum`, `find -printf`, `stat -c` et `realpath -e` échouaient en silence : le journal
enregistrait `report: null`, puis la porte de fusion refusait toute lane (exit 3), et l'empreinte
du dépôt retombait sur `?` (deux états différents rendaient la même empreinte). Helpers sondant
ce qui existe ; sélection du rapport le plus récent sans `-printf` ; `realpath -e` remplacé par
`cd`+`pwd -P`. `CLONE`/`CIBLE`/`DEPOT` passent en `pwd -P` — le journal canonicalisait déjà ses
dépôts par `realpath`, les deux côtés comparent enfin la même chose.
*Preuve : userland BSD → 5 rouges avant (identiques à macOS), 12/12 après.*

### 3. `/var` ↔ `/private/var` — fixtures (2 échecs macOS)
`assembleFilm` passe le LUT par `fs.realpath` (garde anti-lien symbolique) et `shadow status` lit
`git rev-parse --show-toplevel`, toujours canonique : les deux codes de production ont raison,
c'est la fixture qui comparait un chemin logique à un chemin résolu. `mkdtemp` est suivi de
`realpath`.
*Preuve : `TMPDIR` sur un lien → 1 rouge par fichier avant, 50/50 et 11/11 après.*

### 4. `install.sh` — lien relatif entre chemins incohérents (1 échec macOS, **défaut utilisateur réel**)
L'entrée du paquet passait par `realpathSync` mais le répertoire bin restait logique : sur macOS
la profondeur physique dépasse d'un cran la logique, il manquait un `..` et le lien atterrissait
sur `/private`. L'installation s'annonçait réussie et `buddy --version` répondait
`Cannot find module … /dist/index.js`. Les deux extrémités passent désormais par `realpathSync`.
*Preuve : `TMPDIR` logique plus court que le physique → même « Cannot find module » avant, vert après.*

### 5. `InteractiveBashTool` (4 échecs macOS + 5 Windows)
- **macOS** : node-pty se CHARGE mais son `spawn-helper` perd son bit exécutable à l'installation,
  donc tout spawn rend `posix_spawnp failed`. Le repli sans PTY existait déjà pour node-pty
  ABSENT ; le refuser ici transformait une dégradation en panne dure. La sonde est l'échec réel du
  spawn. Nouveau test de régression. Au passage le repli honore enfin `options.cwd`.
- **Windows** : PowerShell traite une commande commençant par une chaîne citée comme une
  expression littérale (`Unexpected token …`). La fixture ajoute l'opérateur d'appel `&`.

### 6. `computer_control` — bureau FABRIQUÉ sur macOS (1 échec macOS, **défaut de sûreté**)
`detectMacOSElements` repliait sur `getMockElements()` : cinq éléments inventés (« OK »,
« Cancel »…) présentés comme un instantané réel, donc un bureau imaginaire offert au modèle.
Repli devenu un no-op honnête. Le scénario DISPLAY de GK21 est borné à Linux par une sonde (la
variable ne gouverne la pile d'accessibilité que sous X11/Wayland — le runner macOS capturait
d'ailleurs bien un écran sans DISPLAY) ; un second scénario portable vérifie partout hors Windows
que l'arbre de démonstration ne ressort jamais.

### 7. Doubles de test qui n'atteignaient pas le code — Windows (3 échecs)
- `persistent-checkpoint-manager` : le manager fait `import path from 'path'` (export DEFAULT) ;
  `...actualPath` réintroduisait le VRAI module. Vert sous POSIX par coïncidence de séparateur,
  rouge sous Windows. **Preuve : en changeant le séparateur du double pour `|`, le scénario restait
  vert AVANT et devient rouge APRÈS.** Le double de `path.resolve`, désormais réellement emprunté,
  respecte enfin la règle du segment absolu.
- `onboarding` : isolation par `process.env.HOME`, or `os.homedir()` lit `USERPROFILE` sous Windows
  — le scénario écrivait dans le VRAI profil de la machine. Isolation par le seam explicite
  `SettingsManager({ userSettingsPath })`.

### 8. Budgets dépendants de la machine — macOS (2 OOM + 1 dépassement)
Les scénarios headless lancent le CLI par `spawn(process.execPath, …)` : l'enfant ne reçoit ni
l'`execArgv` du fork Vitest ni aucune consigne et héritait du défaut V8 (~4 Go sur Linux/Windows,
~2 Go sur macos-latest 3 vCPU / 7 Go) → `heap out of memory`, code 134. Plafond explicite.
`macos-latest` partage la contrainte de `windows-latest` : mêmes budgets de temps.

### 9. `balayage` sous Windows (6 échecs)
- Le watchdog lançait `sleep` DANS le sous-shell : le tuer laissait un orphelin par commande
  balayée, gardant des handles ouverts (rmdir `ENOTEMPTY` sur cinq scénarios pourtant réussis).
  `trap` + arrière-plan ; nettoyage du scénario avec `maxRetries`.
- Les deux scénarios `BALAYAGE_ISOLATED_PATH` exigent qu'un PATH traverse `env -i` INTACT, or MSYS
  réécrit toute variable ressemblant à une liste de chemins : c'est la prémisse que le runtime
  casse. Bornés à POSIX par une sonde ; les quatre autres scénarios tournent partout.

## Hors périmètre

`tests/mcp/gk35-stdio-timeout.test.ts` (Windows) est un flake de synchronisation : il a échoué au
premier essai et **réussi au retry** du même job. Le `||` de `.github/workflows/ci.yml` le couvre.

## Vérifications locales (Linux, vrai HOME)

- `npx vitest run tests/scripts/ tests/security/interactive-bash-env-injection tests/speculative/shadow-workspace tests/tools/gk21-… tests/tools/video/film-assemble tests/unit/persistent-checkpoint-manager tests/wizard/onboarding tests/desktop-automation/ tests/cli/gk29-… tests/cli/headless-exit-code tests/commands/dev/dev-lifecycle` → **33 fichiers / 452 tests verts**
- Consommateurs des modules source touchés (38 fichiers) → **942 verts, 1 ignoré**
- `npx tsc --noEmit` → **0**
- `npx eslint` sur les fichiers modifiés → **0 erreur**
- `git diff --check` → propre ; `bash -n` / `sh -n` sur les quatre scripts → OK

## Verdict CI

### Run 1 — `33923453145` (première passe)

| Job | Avant (run `33918143339`) | Après passe 1 |
| --- | --- | --- |
| macOS Node 22 | échec (19 tests) | **succès** |
| macOS Node 20 | échec (19 tests) | échec — 2 tests (OOM headless) |
| Windows Node 20 | échec (15 tests, shard 1) | échec — 1 test (flake `gk35`) |
| Windows Node 22 | échec (15 tests, shard 1) | échec — shards 2-6, **jamais exécutés jusque-là** |
| Ubuntu Node 22 | succès | succès |
| Ubuntu Node 20 | succès | échec — 1 flake `comfyui` (course de 10 ms) |

Les 17 familles de la passe 1 sont fermées. Deux constats :

1. **Le plafond de tas posé en argv n'atteignait pas le processus mesuré.** `tsx` RELANCE un
   petit-fils node avec son propre chargeur ; un drapeau V8 de la ligne de commande du parent ne
   le suit pas — `NODE_OPTIONS`, si. Besoin réel mesuré sous Linux en abaissant le plafond :
   rouge à 1024 Mo, vert à 1536. Les ~2 Go du runner macOS ne suffisaient pas.
2. **Windows a franchi le shard qui l'arrêtait**, ce qui a révélé six familles restées invisibles
   derrière cet arrêt (`npm test -- --shard=1/6 || …` échouant, les shards 2 à 6 n'étaient jamais
   lancés). Aucune n'est une régression : elles n'avaient simplement jamais tourné.

### Passe 2 — familles fermées

| Famille | Racine | Correctif |
| --- | --- | --- |
| headless macOS ×2 | drapeau V8 perdu au relancement tsx | `NODE_OPTIONS`, valeur héritée préservée |
| `lane-ledger` ×24 | `spawnSync(script)` repose sur le shebang, absent de Windows (`EFTYPE`) | borné à POSIX par sonde |
| `bash-tool` ×3 | attendu `bash -c` codé en dur ; le tool passe par `getShellConfiguration()` | attendu dérivé de la même source |
| `conversation-cues` ×2, `codebase-rag` ×2 | chemins `path.join` comparés à des motifs en barres obliques | normalisation / attendus construits par `path.join` |
| `strategy-store-runtime` | NTFS n'a pas de bits POSIX (rend 666) | seule cette assertion bornée |
| `longcat-runner` | deux démarrages python dans 3 s | budget proportionné à la machine |
| `gk35-stdio-timeout` | budget figé à 400 ms pour un scénario qui mesure une SÉQUENCE | seuils dérivés d'un budget unique, rapports inchangés |
| `comfyui-recipe-runtime` (Ubuntu) | abandon après un délai FIXE de 10 ms, avant la mise en file | abandon déclenché par l'ÉVÉNEMENT, déterministe (5 exécutions) |

### Run 2 — `33925795787` et Run 3 — `33927528320`

| Job | Run `33918143339` (départ) | Run `33925795787` | Run `33927528320` |
| --- | --- | --- | --- |
| Ubuntu Node 20 | succès | **succès** | **succès** |
| Ubuntu Node 22 | succès | **succès** | **succès** |
| macOS Node 20 | échec (19 tests) | **succès** | **succès** |
| macOS Node 22 | échec (19 tests) | échec — 1 test | échec — 1 test |
| Windows Node 20 | échec (15, shard 1) | échec — 2 tests | échec — vague suivante |
| Windows Node 22 | échec (15, shard 1) | échec — 2 tests | échec — vague suivante |
| Build and Package | — | **succès** | **succès** |

Familles fermées au fil des trois runs : `wc` BSD, userland GNU, `/private/var` ×3
(dont l'installateur), PTY macOS, bureau fabriqué, PowerShell `&`, doubles de `path` ×2,
`$HOME` sous Windows, tas de l'enfant CLI, chien de garde orphelin, `EFTYPE` shebang,
bits POSIX NTFS, budgets figés ×3, course d'abandon ComfyUI, parseur PowerShell présent,
`os.killpg` absent de Windows. **Le tas macOS est confirmé résolu** : le même scénario ne
meurt plus en OOM (code 134), il n'excède plus que son budget de temps.

### Run 4 — `33929245982` (HEAD `ee3106333`)

| Job | Run 3 `33927528320` | Run 4 `33929245982` |
| --- | --- | --- |
| Ubuntu Node 20 (**bloquant**) | succès | **succès** |
| Ubuntu Node 22 (**bloquant**) | succès | **succès** |
| Security Audit (**bloquant**) | succès | **succès** |
| Build and Package (**bloquant**) | succès | **succès** |
| macOS Node 20 | succès | **succès** |
| macOS Node 22 | échec — 1 test (`gk29`, 120 s) | échec — 1 test (**autre famille**) |
| Windows Node 20 | échec — vague suivante | échec — 10 tests (shard 3) |
| Windows Node 22 | échec — vague suivante | échec — 1 test (shard 2) |

**Le budget `gk29-headless-resume` est confirmé réparé** : macOS Node 22 ne le cite plus.
Le seul rouge macOS restant est une famille NEUVE, révélée derrière lui.

### Passe 3 — familles fermées

| Famille | Racine | Correctif |
| --- | --- | --- |
| `render-native-fashion-clip` (macOS 22) | **course `Promise.all`** : cinq lectures concurrentes, le message d'erreur venait de la PREMIÈRE promesse rejetée — donc de l'ordonnancement d'E/S, donc de la plateforme (Linux citait `i2v-wan-lightx2v.json`, macOS `upscale-seedvr2.json`) | **code de production** : `allSettled` + verdict dans l'ordre de déclaration ; le préflight nomme désormais TOUS les gabarits absents d'un coup au lieu de les révéler un par un |
| `readme-truth` ×2 (Windows) | `execFileSync(node_modules/.bin/tsx)` : sous Windows ce shim est un script shell (l'exécutable est `tsx.cmd`), `CreateProcess` échoue et rend `status: null` — que le harnais traduisait en « exit 1, stderr vide » pour les 11 commandes citées | spawn de `process.execPath` + l'entrée JS résolue de tsx (`tsx/cli`) ; l'échec de spawn n'est plus effacé (`[no exit status] <message>`) ; `USERPROFILE` posé avec `HOME` |
| `skill-importer` ×2 (Windows) | `os.homedir()` lit `%USERPROFILE%` sous Windows : l'isolation ne posait que `HOME`, l'import écrivait donc dans le VRAI profil — le test A y laissait `imported-git-helper`, que le test B listait ensuite | helper `isolateHome()` (les deux variables) qui **prouve** la redirection (`expect(os.homedir()).toBe(home)`) — l'idiome déjà employé par la suite sœur |
| `doctor-fix` (Windows) | **défaut de production réel** : libuv synthétise `st_mode` à partir du seul attribut lecture-seule, tout objet inscriptible rend `0o666` — doctor déclarait donc TOUT profil Windows « world-writable » et proposait un `chmod 700` incapable de changer une ACL | `permissionBitsAreEnforced()` : sonde d'exécution (mkdtemp + chmod 0o700 + relecture du mode) évaluée seulement dans la branche suspecte, **fail-safe** ; couvre aussi FAT/exFAT/NTFS montés sous Linux. POSIX inchangé |
| `gk16-backup` (Windows) | `chmod 0o555` ne rend pas un répertoire non-inscriptible sur NTFS : la prémisse « l'écriture échoue » est fausse, aucun chemin d'erreur n'était atteint | sonde `directoryRefusesWrites()` — une écriture jetable réelle ; les assertions ne sont ni supprimées ni affaiblies, et sur Linux la sonde rend `true` donc le test s'exécute pour de bon |
| `backup-profile` ×2 (Windows) | (1) attendu écrit en barres obliques littérales alors que le produit rend les séparateurs natifs ; (2) racine de fixture `/home/testuser` non pleinement qualifiée : `path.resolve` y préfixe le lecteur courant, la clé ne correspondait plus au double de `fs` | attendus construits par `path.join` depuis la racine de la fixture ; racine rendue pleinement qualifiée (`C:\home\testuser` sous win32) donc `resolve` idempotent. **Aucun changement produit nécessaire** |
| `bash-tool` (Windows) | `ls -la` n'est pas de la syntaxe PowerShell (`ls` y alias `Get-ChildItem`, `-la` n'est pas un de ses paramètres) : l'échec était syntaxique, pas sécuritaire | commande de listage dérivée de `getShellConfiguration()`, la MÊME source que celle qu'utilise `BashTool` |
| `native-sandbox` (Windows) | `confineSpawn` bâtit sa politique avec `path.resolve(cwd)` : sous le `path` win32 le littéral POSIX devient `<lecteur>:\home\...` | l'assertion porte sur la racine que le code calcule, toujours en un seul jeton argv |
| `reminder-ack-persistence` (Windows) | budget FIXE de 40 ms pour attendre un miroir disque lancé en `void savePendingAcks()` — tenait sur une machine rapide, tombait sur un runner Windows chargé | `whenRemindersPersisted()`, la barrière réelle déjà exportée par le module : déterministe, sans budget de temps |

### Défaut de production trouvé hors périmètre (corrigé)

`src/plugins/marketplace.ts` et `src/plugins/plugin-manager.ts` faisaient `await import(<chemin
absolu>)`. Le chargeur ESM n'accepte que des URL : sous Windows cela lève
`ERR_UNSUPPORTED_ESM_URL_SCHEME` — **aucun greffon ne pouvait s'y charger**. Les deux sites
passent désormais par `pathToFileURL(...).href` (sur POSIX, URL équivalente au chemin nu).
Aucun test ne couvrait ce chemin sous Windows ; il a été trouvé en remontant la piste
(fausse pour `readme-truth`) des imports dynamiques.

### Correctif structurel — les six shards Windows tournent enfin

`npm test -- --shard=N/6 || npm test -- --shard=N/6` faisait échouer l'étape, donc les shards
SUIVANTS n'étaient jamais lancés : Windows n'a jamais eu de mesure complète, et chaque
réparation ne révélait que l'étage suivant, un run à la fois (run 2 → shard 1, run 3 → shard 2,
run 4 → shard 3). Chaque shard est maintenant `continue-on-error` et une étape
« Windows shard verdict » agrège les six `outcome` et échoue si l'un a échoué. Ce n'est **pas**
un assouplissement — le job reste rouge dès qu'un shard est rouge — c'est un inventaire complet
en un seul run.

> **Attendu au prochain run** : Windows peut afficher PLUS de tests rouges qu'au run 4, parce que
> les shards 3→6 (Node 20) et 2→6 (Node 22) n'ont **jamais** été exécutés. Ce serait un inventaire
> qui s'ouvre, pas une régression.

### Ce qui reste ouvert

1. **L'inventaire Windows n'est pas clos.** Les shards 3→6 (Node 20) et 2→6 (Node 22) n'ont
   jamais tourné. Le correctif structurel ci-dessus les fait tourner tous au prochain run :
   c'est la première mesure COMPLÈTE de Windows. Les familles qui en sortiront demandent le
   même traitement — une racine par famille, une sonde plutôt qu'un nom d'OS.
2. **`CODEBUDDY_HOME` ignoré par tout le sous-système skills** (observation de la passe 3, non
   corrigée). L'importeur, la CLI `skills imported`, le registre, `skill-exchange` et
   `skill-sources` codent en dur `os.homedir()/.codebuddy` alors que
   `src/utils/codebuddy-home.ts` fournit l'override partout ailleurs. Ne réparer que
   l'importeur le ferait écrire là où le registre ne lit jamais : c'est un balayage
   coordonné, à mener comme un chantier à part.
3. **Deux familles de prémisses fausses restent à balayer** (repérées, non traitées) : les
   tests qui construisent une prémisse « non-inscriptible » par `chmod` (4 fichiers) et ceux
   qui attendent un miroir asynchrone par un `setTimeout` fixe (66 fichiers). Chacun est un
   faux vert ou un rouge de machine lente en puissance ; aucun n'est visible sous Linux.

## Invariants respectés

- Aucun test désactivé en bloc : chaque garde de plateforme est adossée à une **sonde
  d'environnement** (écriture réelle, relecture de mode, `os.homedir()` prouvé), jamais à un
  simple `process.platform`.
- Les défauts réels de portabilité sont corrigés **dans le code** : préflight non
  déterministe, faux positif « world-writable » de `doctor`, chargement de greffons
  impossible sous Windows.
- `git add` fichier par fichier. La copie de travail principale et `~/.codebuddy` non touchées.
- Vérifications locales : `npx vitest run` sur les 10 fichiers touchés → 126 passés,
  1 ignoré (le `it.skip` préexistant) ; `npm run typecheck` → 0 ; `npm run lint` → 0 erreur ;
  `git diff --check` → propre.

## Passe 4 — régression Linux : le rapport se dénonçait lui-même

**Constat** (run `33941811446`, tous les jobs Test rouges, Ubuntu 20 ET 22 compris) : un
**seul** test échouait — `tests/security/donnees-personnelles.test.ts` — avec `1 failed,
37041 passed`. Aucune régression de code de portabilité : les gardes `describe.skipIf`, les
sondes d'environnement, `pathToFileURL` et les shards Windows n'ont touché aucun test Linux.

**Cause** : ce rapport lui-même. La ligne « invariants » citait en clair le chemin du home de
l'auteur (`CHEMIN_HOME_AUTEUR`), un terme que le garde-fou vie-privée interdit dans tout fichier
suivi. Le garde scanne l'arbre entier ; le rapport neuf ajouté par CIFIX3 introduisait le terme,
absent du tronc — d'où Ubuntu vert sur `codex/audit-systeme-nerveux-2026-09-01` et rouge ici.

**Correctif** : reformuler la ligne sans le chemin littéral (« la copie de travail principale »).
Aucun code produit ni aucun test de portabilité modifié ; le fardeau vit intégralement dans la
prose du rapport. `CI=true npx vitest run tests/security/donnees-personnelles.test.ts` → vert.
