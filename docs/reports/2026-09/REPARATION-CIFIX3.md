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

### Run 2

Voir la table ajoutée après le run de vérification.
