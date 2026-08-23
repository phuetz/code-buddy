# Audit des 60 premières secondes — 2026-08-23

## Protocole

Audit exécuté le 23 août 2026 dans `node:22` (`v22.23.2`, npm `10.9.8`,
Linux x64), avec un `HOME` et un `CODEBUDDY_HOME` jetables, sans clé API,
sans Ollama et sans credentials OAuth. Chaque parcours source a été copié
dans le système de fichiers éphémère du conteneur, sans le `node_modules`
lié du worktree. Les durées sont celles d’un chronomètre milliseconde autour
de chaque commande et incluent le réseau npm lorsqu’il est utilisé.

Le point de départ était `origin/main` (`20e271a1`). Le paquet npm déclaré par
la source est `@phuetz/code-buddy@1.8.0`.

## Commandes promises et périmètre

| Surface documentée | Vérification | Résultat |
| --- | --- | --- |
| `curl -fsSL …/install.sh \| sh` | Script distant puis `install.sh` du worktree | Les deux installent bien le paquet, mais le script distant affichait encore `buddy try` comme « zero-config ». Le script local est corrigé et re-testé. |
| `npm install -g @phuetz/code-buddy` / `npx @phuetz/code-buddy@latest` | Installation globale de `@latest` ; le nom exact non scopé a aussi été testé | Le registre fournit `1.6.1`, pas `1.8.0`. `code-buddy` renvoie HTTP 404. |
| `git clone`, `npm install`, `npm run build`, `npm link` | Copie propre équivalente, `npm ci`, build et `npm link` | OK ; le build source et le binaire `buddy` répondent. Le clone n’a pas été répété inutilement. |
| `docker compose up -d` | Non exécuté | Parcours VPS/24-7 : il nécessite `.env`, `JWT_SECRET` et un provider ; le démarrer n’est pas un smoke test CLI et aurait créé un service persistant. |
| `buddy --version`, `buddy --help`, `buddy try`, `buddy onboard`, `buddy login --help`, `buddy doctor` | Exécutées publiées et depuis la source | Voir les tableaux ci-dessous. |
| `buddy login`, `buddy whoami`, `buddy`, `buddy --prompt`, `buddy --yolo` | Non exécutées sans login/provider | Elles nécessitent OAuth, Ollama ou une clé ; les commandes de diagnostic sans credential ont été exécutées. |
| `brew/apt/choco install ripgrep`, `ollama pull`, `doctor --fix` | Non exécutées | Commandes dépendantes de l’OS ou d’un runtime absent ; leur absence est signalée par `doctor`. |

## Parcours publié — état avant correction

Le paquet `code-buddy` demandé littéralement n’existe pas. La version scopée
`1.8.0` annoncée par le worktree n’était pas encore publiée.

| Commande | Résultat réel | Durée | Friction |
| --- | --- | ---: | --- |
| `npm install -g code-buddy` | `E404 Not Found`, aucun binaire | 176 ms | Nom de paquet impossible à deviner pour un nouvel utilisateur. |
| `npm install -g @phuetz/code-buddy@1.8.0` | `ETARGET No matching version found` | 142 ms | La version source n’est pas encore dans le registre. |
| `npm install -g @phuetz/code-buddy` | OK, `1292 packages`, version installée `1.6.1` | 30.818 s | Le paquet stable est en retard sur la source ; plusieurs avertissements de dépréciation npm. |
| `buddy --version` | `1.6.1`, code 0 | 43 ms | Révèle le décalage seulement après installation. |
| `buddy --help` | Code 0, aide longue avec 60+ commandes | 69 ms | Lisible mais trop large pour une première découverte. |
| `buddy try` | Code 1 : `No AI provider configured` et chemins login/Ollama | 300 ms | Le paquet publié ne contient pas la commande `try` dédiée de la source et son message n’explique pas le démo isolé. |
| `buddy onboard` avec stdin fermé | Affiche `Choice [1]:`, puis code 0 sans configuration | 52 ms | Prompt bloquant en TTY, faux succès en pipe/CI. |
| `buddy login --help` | Aide correcte, code 0 | 55 ms | Aucun problème observé. |
| `buddy doctor` | 4 passed, 14 warnings, 0 errors, code 0 | 79 ms | « Not ready » n’est pas reflété dans le code de sortie du paquet ; le hint OAuth utilise `/login chatgpt`, une syntaxe de session et non une commande shell. |

Le test `curl | sh` distant a installé `1.6.1` en 40.862 s et imprimait le
même mauvais ordre : `buddy try` « 60-second zero-config demo » avant toute
authentification.

## Parcours source — avant / après

| Commande | Avant, depuis `origin/main` | Après, source corrigée | État |
| --- | --- | --- | --- |
| `npm ci` | Code 0, 20.192 s ; avertissements peer/deprecation et 56 vulnérabilités npm | Code 0, 20.453 s ; mêmes avertissements/vulnérabilités | OK, dette restante documentée |
| `npm run build` | Code 0, 22.919 s | Code 0, 22.971 s | OK |
| `npm link` | Non rejoué sur le premier passage | Code 0, 326 ms | OK |
| `buddy --version` | `1.8.0`, via `npx tsx`, code 0 en 364 ms | `1.8.0`, code 0 en 70 ms | OK |
| `buddy --help` | Code 0 en 314 ms ; mélange anglais/français visible dans `loop` | Code 0 en 50 ms, 167 lignes ; help global spot-checké sans français | Corrigé ; encore volumineux mais non bloquant |
| `buddy try` sans provider | Code 2 en 342 ms ; message correct mais sans installation/démarrage Ollama explicites | Code 2 en 83 ms ; affiche ChatGPT OAuth, URL Ollama, `ollama serve`, `ollama pull` et ne tente aucun provider payant | Corrigé ; échec attendu sans brain |
| `buddy onboard` non interactif | Code 0 en 394 ms après affichage d’un prompt | Code 2 en 56 ms avec message expliquant le besoin d’un terminal et les alternatives | Corrigé |
| `buddy login --help` | Code 0 en 318 ms | Code 0 en 49 ms | OK |
| `buddy doctor` sans provider | Code 0 en 453 ms ; headline prête mais conseil `/login chatgpt` | Code 1 en 106 ms ; « Not ready », `buddy login` et statut scriptable | Corrigé |
| `install.sh` dans le conteneur | Le script distant imprimait « zero-config », 1.6.1 en 40.862 s | Script du worktree : code 0, 1.6.1 en 30.558 s, ordre login → try → onboard honnête | Corrigé ; version publiée toujours en retard |

Les codes 1/2 de `doctor`, `try` et `onboard` après correction sont
intentionnels : ils indiquent respectivement « pas prêt », « aucun provider
gratuit disponible » et « commande interactive appelée sans terminal ».

## Native dependency — vérification réelle

`better-sqlite3` a été déplacé de `dependencies` vers
`optionalDependencies`. Avec toutes les autres dépendances installées, son
répertoire a été déplacé hors de `node_modules` dans un conteneur jetable :

- `npm run build` : code 0 en 22.658 s ;
- import direct : `ERR_MODULE_NOT_FOUND` (absence volontaire) ;
- `npx tsx src/index.ts --help` : code 0 ;
- `doctor` : code 1, avertissement explicite « DB-backed features … unavailable »
  avec instructions `build-essential python3` / `xcode-select --install` ;
- `try` : code 2 avec son guidage sans provider.

Cela vérifie que la CLI de première installation tolère l’absence de SQLite.
Un essai séparé avec `npm ci --omit=optional` a bien omis SQLite, mais le build
échoue encore sur des imports TypeScript d’autres optionnels absents
(`playwright`, `@google/generative-ai`, `nut-js`, `tree-sitter`, etc.). Ce
n’est pas le chemin npm documenté et reste une tâche distincte si l’on veut
un build source complètement dépourvu de tous les optionnels.

## Frictions corrigées

1. Le nom npm documenté est maintenant explicitement scopé et utilise `@latest`.
2. `onboard` refuse proprement les pipes/CI au lieu de terminer avec un faux 0.
3. `doctor` donne des commandes shell exécutables et échoue si aucun provider
   n’est prêt, sans échouer pour les seuls avertissements facultatifs.
4. `try` explique le prérequis réel et reste borné/rapide sans réseau, clé ou
   login ; le chemin Ollama indique maintenant `serve` et `pull`.
5. SQLite natif est optionnel et son absence est diagnostiquée sans casser
   `help`, `doctor` ou `try`.
6. Le help global ne mélange plus le français et l’anglais sur la commande
   `loop`.
7. L’installateur shell reprend le même ordre honnête que le README.

Commits correspondants : `ea579f76`, `b5a95f72`, `7728af87`, `2b523eb1`,
`fb32b5ab`, `b5234ac7`, `7635778a`, `8a4a393c`.

## Vérifications finales

- `npx tsc --noEmit` : code 0.
- ESLint ciblé sur les fichiers source/tests touchés : code 0 ; `src/index.ts`
  a aussi été nettoyé d’un warning `no-explicit-any` préexistant.
- Tests Vitest ciblés (`try`, onboarding, doctor, utility, first-run) : **5
  fichiers, 31 tests passés**.
- `sh -n install.sh` : code 0.
- Liens locaux de première installation testés (`docs/install.md`,
  `docs/getting-started.md`, `install.sh`, capture `try`, capture OAuth) : OK.

## À reprendre après la prochaine publication npm

La publication est volontairement hors périmètre de cette mission. Avant de
considérer le parcours public terminé, publier la version source puis relancer
dans un conteneur propre :

```bash
npm view @phuetz/code-buddy@1.8.0 version
npm install -g @phuetz/code-buddy@1.8.0
buddy --version
buddy --help
buddy try
buddy onboard
buddy login --help
buddy doctor
curl -fsSL https://raw.githubusercontent.com/phuetz/code-buddy/main/install.sh | sh
```

Il faudra aussi exécuter une vraie réussite de `buddy try` avec un compte
ChatGPT OAuth ou un Ollama contenant un modèle, puis décider si l’aide de 167
lignes mérite un mode « first run » plus court. Aucun publish npm, push ou PR
n’a été effectué pendant cet audit.
