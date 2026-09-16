# Audit « installateur inconnu » — Code Buddy 2.0.0 (2026-09-06)

**Rôle joué** : un inconnu qui découvre Code Buddy depuis npm, sans rien savoir du dépôt.
**Worktree** : `~/DEV/cb-install-audit-2026-09-06`, branche `audit/installateur-inconnu-2026-09-06`.
**HOME isolé** : `~/DEV/cb-install-audit-2026-09-06/_qa/inconnu/home` (vide : aucune clé, aucune config).
**Préfixe npm isolé** : `$HOME/.npm-global` · `env -u FORCE_COLOR` · ports ≥ 4200 · aucune clé API réelle.
**LLM** : Ollama local `http://127.0.0.1:11435`, modèle `qwen3.8-ctx32k:latest` uniquement.

Gravité : **A** = bloque l'inconnu · **B** = le fait douter · **C** = cosmétique.

> Rapport ouvert AVANT toute inspection (invariant opératoire), commit `98b4034c6`.

---

## 1. Emballage

| Étape | Durée | Résultat |
| --- | --- | --- |
| `npm run build` | **53,9 s** | exit 0 |
| `npm pack` | **1 min 02,7 s** | `phuetz-code-buddy-2.0.0.tgz` |
| `npm install -g <tgz>` | **2 min 06,6 s** | exit 0 |

Tarball : **8,3 Mo** compressés, **34,0 Mo** décompressés, **5 005 fichiers**.

Le contenu est **exemplaire**. `files[]` étant déclaré dans `package.json`, `.npmignore` est inerte,
mais le résultat est net :

```
   4999 dist/
      2 examples/
      1 README.md
      1 package.json
      1 LICENSE
      1 codebuddy-runtime.json
```

Recherche de ce qui n'aurait rien à y faire — `_qa`, rapports `RAPPORT-`/`AUDIT-`, fixtures,
`__mocks__`, `*.test.*`, `cowork/`, `buddy-sense/`, `buddy-vision/`, `.env`, `.tsbuildinfo` :
**aucune correspondance**. Les `.map` sont **absents** (0), retirés par `prepack`
(`strip-sourcemaps.mjs`). Les 2 490 `.d.ts` (6,3 Mo) sont justifiés : le paquet publie un
`plugin-sdk` typé via `exports`. Les assets utiles sont bien là (9 skills groupées,
`dist/server/mobile/assets/`).

### `packages/companion-core` (workspace)

`@phuetz/companion-core` n'est **ni déclaré en dépendance, ni empaqueté, ni publié**. Le
comportement de l'adaptateur est néanmoins **correct**, vérifié en simulant l'absence du paquet :

```
A. flag absent -> enabled : false
B. flag absent -> load    : null
C. flag=true, paquet absent :
   WARN [companion-core] paquet indisponible, repli sur le chemin historique : Cannot find package
   RESULTAT : null -> repli historique
```

Sans `CODEBUDDY_COMPANION_CORE`, l'adaptateur ne charge rien et **ne dit rien** — conforme.
Conséquence à noter : depuis npm, `CODEBUDDY_COMPANION_CORE=true` est un **flag inerte** (C-7).

> **Limite de protocole, signalée par honnêteté** : le `node_modules` de ce worktree est un lien
> symbolique vers un worktree voisin qui expose le workspace. Un premier test a donc « réussi »
> l'import en résolvant `~/DEV/cb-secu-pwa-2026-09-06/packages/companion-core/dist/index.js`,
> chemin inexistant chez un inconnu. La conclusion ci-dessus provient du test refait avec la
> résolution bloquée.

### Ce que voit l'inconnu à l'installation

`added 1283 packages in 2m` pour **2,7 Go sur le disque** (un CLI livré en 8,3 Mo), précédés de
12 avertissements `deprecated`, puis de 20 lignes d'avertissement `allow-scripts` : npm ≥ 11
**bloque les scripts d'installation par défaut**, donc **18 paquets natifs ne sont pas compilés**
(`better-sqlite3`, `sharp`, `node-pty`, `tree-sitter*`, `onnxruntime-node`, `usearch`…). Ce sont
des `optionalDependencies` et rien ne casse, mais la conséquence est réelle et visible au premier
`doctor` (B-3).

---

## 2. Premier lancement

| Commande | Durée | Verdict |
| --- | --- | --- |
| `buddy --version` | 1,37 s | `2.0.0` |
| `buddy --help` | ~1,4 s | 184 lignes, s'ouvre sur 6 démos |
| `buddy doctor` | **0,48 s** | 16 passed, 7 warnings, 0 errors — exit 1 |
| `buddy doctor --fix` | 1,11 s | 2 corrigés, exit 0 |
| `buddy whoami` | 0,23 s | net |
| `buddy onboard` (non-TTY) | immédiat | exit 2, message exemplaire |

### Les 104 sous-commandes existent réellement

Plutôt qu'un échantillon de 10, **les 104 sous-commandes** listées par `--help` ont été appelées
avec `--help`. Toutes retournent exit 0 — mais ce contrôle seul ne prouve rien, car une commande
**inexistante** retourne elle aussi exit 0 en affichant le help global (C-1) :

```
$ buddy zzz-inexistante --help
Pour commencer — 6 démos qui montrent le cœur agent de code :
EXIT=0
```

Le test a donc été validé sur l'en-tête : les 104 renvoient bien `Usage: buddy <cmd>`.
**Aucune commande annoncée n'est manquante.** Et sans `--help`, la faute de frappe est bien traitée :

```
$ buddy doctro
Commande inconnue « doctro ». Voir buddy --help
EXIT=1
```

### `buddy doctor` sur un home vide

```
  ⚠️  Not ready to chat yet — Ollama is running (22 models) but no model is currently selected
      — --fix to select qwen3:4b-instruct ($0; tool-calling, 2.3 GiB < 23.0 GiB free RAM)
  ⚠️ Node.js version: v18.19.1 — OK for the CLI (>= 18), but the Cowork desktop app needs >= 22
  ⚠️ SQLite (better-sqlite3): native module unavailable — sessions remain persisted as JSON files,
     but DB-backed memory, cache, and indexed search are disabled. Install optional SQLite support
     with `npm install better-sqlite3` […]
  ⚠️ ChatGPT OAuth: not signed in (run `buddy login` […])
  ⚠️ .codebuddy directory: not found [fixable]
  Summary: 16 passed, 7 warnings, 0 errors
  2 issue(s) can be auto-fixed with --fix
```

C'est **la meilleure page du produit** : un verdict en une ligne, la raison du choix du modèle, et
`--fix` qui tient sa promesse (`Selected local Ollama model … — try: buddy try`). L'exit 1 malgré
« 0 errors » est **intentionnel et commenté** dans la source (utilité en CI) — visuellement
contradictoire seulement (C-6).

Deux réserves : le conseil `npm install better-sqlite3` est **inapplicable tel quel** à une
installation globale (il faudrait `npm install -g` dans le préfixe, ou `--allow-scripts`) — B-4.

### `buddy` sans argument, sans clé

```
No AI provider configured. Sign in with ChatGPT now (OAuth, no API key, $0 marginal cost)? [Y/n] n
❌ ERROR ❌ No AI provider configured.
   1. Recommended — ChatGPT OAuth […] : buddy login
   2. Local & free — start Ollama and install a coding model:
      ollama pull qwen2.5-coder:7b
   3. More providers — run the full wizard […] : buddy onboard
   After option 1 or 2, run  buddy try  for the one-minute coding demo.
   Check anytime:  buddy doctor   (add --fix to auto-configure a running Ollama).
```

Exhaustif et actionnable. Seule scorie : le texte dit « start Ollama » alors qu'Ollama **tourne**
(le `doctor` le détecte, lui) — message statique là où le doctor est dynamique (C-5).

`buddy onboard` en pipe/CI : `exit 2` avec « needs an interactive terminal » et trois solutions
non interactives. En TTY, il détecte les voies $0 (`✓ Ollama (local, $0) — running · 22 models`).
Aucune option non interactive (`--yes`) n'existe, mais le message la remplace correctement.

---

## 3. Avec Ollama — le point noir

### 3.1 Sous Node 18, le CLI ne démarre pas du tout (A-1)

```
$ buddy -p "Écris un haiku sur la mer"
INFO  Auto-detected provider: ollama (model: qwen3.8-ctx32k:latest)
You are running Node.js 18.19.1.
Playwright requires Node.js 20 or higher.
EXIT=1   (5,8 s)
```

Cause tracée jusqu'au bout :

```
registry/browser-tools.js → browser/playwright-tool.js → playwright-core
playwright-core/lib/bootstrap.js:11  →  process.exit(1)
```

`src/tools/browser/playwright-tool.ts:8` importe **une valeur** (`chromium`) statiquement, et le
registre d'outils l'importe au démarrage de toute commande. Les `await import('playwright')
.catch(() => null)` du reste du code **ne protègent pas** : `process.exit()` est synchrone, il tue
le processus avant tout rejet.

Or quatre sources annonçaient Node ≥ 18 : `package.json` `engines`, `README.md`,
`docs/getting-started.md` (deux fois) et `buddy doctor` (« OK for the CLI (>= 18) »). La CI, elle,
ne teste plus que `[20.x, 22.x]` — **personne ne mesurait ce plancher**, d'où l'invisibilité pour
`tsc` et pour la suite de tests. Node 18 est le node d'`apt` sur Ubuntu 22 : l'inconnu tombe dessus.

**Corrigé** (`b8ee57cb1`) : la déclaration est alignée sur le comportement réel (Node ≥ 20),
message `doctor` compris, avec un test. La correction de fond — rendre l'import de `playwright-core`
paresseux pour que les outils navigateur soient vraiment optionnels — dépasse un correctif de doc.

### 3.2 Sous Node 24 : 14 min 27, exit 0, sortie vide (A-2)

```
$ buddy -p "Écris un haiku sur la mer"
INFO  Auto-detected provider: ollama (model: qwen3.8-ctx32k:latest)
ELAPSED=14:27.17
EXIT=0
```

Rien d'autre. Pas de haiku, pas d'erreur, **exit 0**. C'est le pire cas : succès annoncé, livrable
vide.

Le contrôle écarte la thèse « le modèle ne sait pas répondre ». Même modèle, même prompt, appel
direct à Ollama :

```json
"content": "Vague sur le sable,  \nL'écume danse un instant —  \nle ciel disparaît."
"done_reason": "stop"
```

Le modèle répond. Code Buddy n'affiche rien.

### 3.3 La cause : le transport natif Ollama est câblé sur le port 11434 (A-4)

```
src/codebuddy/providers/ollama-native-transport.ts:67
  return url.includes(':11434') || url.includes('ollama');
```

Le même test de port est répété **5 fois** (`provider-openai-compat.ts:582,583,741,742,905`). Mon
Ollama écoute sur **11435** — cas parfaitement légitime (seconde instance, port occupé). Code Buddy
retombe donc sur `/v1`, et voici ce que `/v1` renvoie pour ce modèle :

```
content:   ''
reasoning: 'We need respond in French likely. User asks: "Écris un haiku sur la mer"…'
```

Sur `/v1`, ce modèle « thinking » place tout dans `reasoning` et laisse **`content` vide** ; le
transport ne lit que `content` (`ollama-native-transport.ts:217,235` — le champ `thinking` est
d'ailleurs **déclaré ligne 35 puis jamais lu**). D'où la sortie vide.

Le paradoxe : `CODEBUDDY_PROVIDER=ollama` et `OLLAMA_HOST` étaient tous deux fournis, et Code Buddy
**affiche** « Auto-detected provider: ollama ». Il sait que c'est Ollama ; seul le routage du
transport l'ignore, parce qu'il interroge le port au lieu du fournisseur résolu.

### 3.4 Le garde anti-stall tue la voie « $0 locale » (A-5)

Second prompt, dans un dossier de trois fichiers (`alpha.txt`, `beta.js`, `gamma.md`) :

```
$ buddy -p "liste les fichiers du dossier courant"
ERROR Agent turn failed {"errorType":"LlmStallError","error":"LLM stream stalled: no data received
for 120s (backend accepted the request but stopped responding). Retry the turn; tune with
CODEBUDDY_LLM_STALL_TIMEOUT_MS."}
```

**17 min 24**, aucun outil exécuté, aucune confirmation présentée, les trois fichiers intacts.
Le message d'erreur est en revanche **excellent** : il nomme la panne, sa nature et la variable de
réglage.

La mesure explique tout — et elle vient du produit lui-même :

```
$ buddy cost --latency
Provider  Modèle                 Tours  TTFT p50   Tokens
qwen      qwen3.8-ctx32k:latest      1  863560ms   5,604
```

**TTFT = 863 s** pour **5 604 tokens** de prompt. Code Buddy envoie ~5 600 tokens de prompt système
et de définitions d'outils pour « écris un haiku » ; sur un 27B servi sans GPU adéquat, l'évaluation
du prompt dépasse largement le seuil de 120 s sans premier token. Le contrôle direct (prompt de
61 tokens) prend ~16 s de calcul sur la même machine : le facteur est bien le volume de prompt, pas
le modèle.

Conséquence pour l'inconnu : la voie « **local & free** » recommandée par le README, le `doctor`,
`onboard` et le message d'absence de fournisseur **n'aboutit pas** sur une machine modeste — tantôt
en silence (exit 0), tantôt après 17 minutes d'attente. Aucun retour visuel n'est donné pendant
l'attente (B-6).

### 3.5 Observabilité (`buddy run`)

`buddy run list` fonctionne, mais un run **terminé** depuis 30 minutes reste `[RUNNING]` :

```
Recent runs (2)
  [RUNNING] run_mtq0nkps_3abba9  2026-09-06 16:18:38  (running)  headless prompt
  [RUNNING] run_mtpznt37_b5afc2  2026-09-06 15:50:49  (running)  headless prompt
```

`buddy run trajectory <id>` est d'une honnêteté désarmante — et c'est bien le problème : il ne
restitue **rien** d'un run de 14 minutes (B-2).

```
  Appels d'outils: 0        Tokens in/out: 0 / 0        Durée: 0ms
  Ended:   non journalisé: endedAt
── Non journalisé ────────────────────────
  - audit JSONL (auditLogger.init n'est appelé nulle part en production)
```

La dernière ligne est un constat d'inachèvement livré **à l'utilisateur final**.

---

## 4. Serveur

Démarrage en **~2 s**, journal clair, avertissements actionnables (fleet fail-closed, dépôt
d'autonomie non configuré). `buddy server --port 4201 --host 127.0.0.1` avec `JWT_SECRET`.

| Route | Sans jeton | Avec jeton |
| --- | --- | --- |
| `/api/health` | 200 | — |
| `/api/chat/completions` | 401 `No authentication token provided` | accepté (LLM trop lent pour conclure) |
| `/v1/chat/completions` | 401 | idem |
| `/api/sessions` | 401 | **403 `Required scope(s): sessions`** |

L'auth est propre et les scopes sont fins. **Comment l'inconnu obtient-il un jeton ?** Par
`buddy fleet token --user <nom>` (avec `JWT_SECRET`), qui affiche le jeton sur stdout et la recette
sur stderr. Mais `docs/getting-started.md:423` renvoie pour cela à `docs/security.md`, **qui ne
contient pas l'information** ; et la commande n'est découvrable que sous `fleet`, un mot qui
n'évoque rien à qui veut simplement appeler l'API OpenAI-compatible (B-8).

### PWA mobile : 500 + trace complète (A-3)

Avec `CODEBUDDY_MOBILE_PWA=true` :

| Route | Résultat |
| --- | --- |
| `/__codebuddy__/mobile/` | **500** |
| `/__codebuddy__/mobile/manifest.webmanifest` | **500** |
| `/__codebuddy__/mobile/sw.js` | **500** |
| `/__codebuddy__/mobile/assets/app.js` | 200 |
| `/__codebuddy__/mobile/status` | 200 |

La coquille HTML, le manifeste et le service worker — c'est-à-dire **la PWA** — sont morts, et la
réponse expose la trace complète avec les chemins absolus du serveur :

```json
{"code":"INTERNAL_ERROR","message":"Not Found","status":500,
 "details":{"stack":"NotFoundError: Not Found\n    at createHttpError (…/node_modules/send/index.js:861:12)…"}}
```

Les assets étaient pourtant bien installés. La cause, isolée par un banc minimal :
`res.sendFile(cheminAbsolu)` fait appliquer par `send` sa politique *dotfile* à **chaque segment**
du chemin — et une installation npm globale vit précisément sous un dossier caché
(`~/.nvm/versions/node/…`, `~/.npm-global`) :

```
plain   HTTP 200 <h1>ok</h1>
hidden  HTTP 500 {"e":"Not Found","status":404}
```

Seul `/assets/*` survivait, servi par `express.static`, dont la politique porte sur le chemin
relatif au `root`. **Dix suites de tests couvrent cette PWA** — toutes montent le routeur depuis la
copie de travail du dépôt, qui n'a aucun segment commençant par un point.

**Corrigé** (`5f34b0d06`) : service par `{ root }`, avec un test qui sert les trois fichiers depuis
un root `.npm-global` (il échoue sans le correctif, vérifié).

La trace est gatée par `NODE_ENV === 'production'` : pas de fuite en production, mais le défaut
expose les chemins alors même que l'authentification est active (B-7).

### Flotte

`buddy fleet describe|status --server-url … --token …` fonctionne sur les deux serveurs (4201 et
4202), 19 méthodes exposées. `docs/fleet-guide.md` est **honnête** : il dit d'emblée que le jeton
est requis et que `--no-auth` n'accorde pas `peer:invoke`. La découverte automatique
(`discoverPeers()` Tailscale) est côté Cowork, pas côté CLI — la doc ne promet donc rien de faux.

Sans jeton, en revanche, le message envoyait l'inconnu sur une fausse piste (B-1) :

```
Serveur Fleet indisponible sur http://127.0.0.1:4201 (HTTP 401). Lancez-le avec `buddy server` puis réessayez.
```

Le serveur tournait. **Corrigé** (`df3174e36`) : un 401/403 est nommé pour ce qu'il est et pointe
vers `buddy fleet token`, les autres échecs gardant le message d'origine.

### Divers serveur

`buddy sensory status` et `buddy rules list` répondent proprement (exit 0). Mais `sensory status`
affiche « Serveur : serveur non joignable » **sans dire quelle URL** il a interrogée, et n'offre
aucune option de port : avec deux serveurs actifs sur 4201/4202, il vise 3000 en dur et l'inconnu
n'a aucun moyen de le diagnostiquer (B-5). Au démarrage, le pont A2A annonce par ailleurs
`defaultModel:"qwen3:4b"` en dur, sans rapport avec le modèle configuré (C-3).

---

## 5. Docs — chaque commande citée, exécutée telle quelle

`README.md`, 100 premières lignes : la seule erreur est « Three commands (**Node.js ≥ 18**) »
(A-1, corrigé). Les commandes citées existent toutes.

`docs/getting-started.md` : « Node.js 18.0.0 or higher » (même défaut, corrigé). Le reste tient
remarquablement bien. Deux affirmations vérifiables ont été testées **au mot près** :

```
$ buddy changelog        # hors dépôt Git
Ce dossier n'est pas un dépôt Git : … La commande `buddy changelog` nécessite un checkout Git ;
une installation npm pack n'inclut pas `.git`.
EXIT=1
```

C'est exactement ce que la doc annonce. De même `buddy --init` crée bien `.codebuddy/` **et**
`AGENTS.md` comme promis. `buddy onboard` en pipe se comporte comme documenté. `buddy improve
status` et `buddy cost --latency` répondent comme annoncé.

**La documentation de ce produit est fiable** : hors le plancher Node, aucun écart entre ce qui est
écrit et ce qui s'exécute. Le seul renvoi creux est `security.md` pour le jeton (B-8).

---

## 6. Nettoyage

Serveurs 4201 et 4202 arrêtés par PID ; préfixe npm isolé (`_qa/inconnu/home/.npm-global`, 2,7 Go)
supprimé. `_qa/` est gitignoré.

---

## Tableau des frictions

| # | Étape | Friction | Grav. | Correctif |
| --- | --- | --- | --- | --- |
| A-1 | Premier lancement | Node 18 annoncé supporté (4 sources) mais le CLI meurt : le registre d'outils importe `playwright-core` statiquement, qui `process.exit(1)` sous Node < 20 | **A** | **`b8ee57cb1`** (déclaration + doctor + test). Fond : rendre l'import paresseux |
| A-2 | `buddy -p` | 14 min 27, **exit 0, sortie vide** — le même modèle en direct rend un haiku | **A** | Traiter une réponse finale vide comme un échec (message + exit ≠ 0) |
| A-3 | Serveur / PWA | 500 + trace complète sur toute install sous dossier caché (`~/.nvm`, `~/.npm-global` = la norme) | **A** | **`5f34b0d06`** (`{ root }` + test dotdir) |
| A-4 | `buddy -p` | Transport natif Ollama décidé par `url.includes(':11434')` (5 endroits) : tout autre port retombe sur `/v1`, où `content` est vide pour un modèle *thinking* | **A** | Router sur le fournisseur résolu / `OLLAMA_HOST`, et lire `reasoning`/`thinking` en repli de `content` |
| A-5 | `buddy -p` | Anti-stall 120 s incompatible avec la voie « $0 locale » : TTFT mesuré 863 s pour 5 604 tokens de prompt | **A** | Seuil adaptatif tant qu'aucun token n'est arrivé, et réduire le prompt initial sur modèle local |
| B-1 | Flotte | « Lancez-le avec `buddy server` » sur un 401 — le serveur tournait | **B** | **`df3174e36`** (+ test) |
| B-2 | `buddy run` | Run terminé figé en `[RUNNING]` ; `trajectory` ne restitue rien (0 token, 0 ms) et avoue « auditLogger.init n'est appelé nulle part en production » | **B** | Écrire `endedAt` en fin de run et brancher `auditLogger.init` |
| B-3 | Emballage | 1 283 paquets / **2,7 Go** pour un CLI de 8,3 Mo ; 18 paquets natifs non compilés (npm ≥ 11 bloque les install-scripts) | **B** | Documenter `--allow-scripts` dans l'installation, alléger les optionnelles |
| B-4 | `doctor` | Conseille `npm install better-sqlite3`, inapplicable à une install globale | **B** | Proposer `npm install -g --allow-scripts=better-sqlite3 @phuetz/code-buddy` |
| B-5 | `sensory status` | « serveur non joignable » sans nommer l'URL testée ; aucune option de port | **B** | Afficher l'URL et accepter `--server-url` |
| B-6 | `buddy -p` | Aucun retour visuel pendant 14–17 min | **B** | Indicateur d'attente (« évaluation du prompt… ») dès le premier tour |
| B-7 | Serveur | Trace + chemins absolus renvoyés au client par défaut, alors que l'auth est active | **B** | Masquer `details.stack` dès que l'auth est activée, pas seulement en `NODE_ENV=production` |
| B-8 | Serveur / docs | `getting-started` renvoie à `security.md` pour le jeton : l'info n'y est pas ; `buddy fleet token` n'est trouvable que sous « fleet » | **B** | Documenter le jeton dans `security.md` et l'aliaser (`buddy server token`) |
| C-1 | `--help` | `buddy <inexistante> --help` → exit 0 + help global (sans `--help`, le message est correct) | C | Valider la commande avant que `--help` ne court-circuite |
| C-2 | `doctor --fix` | `user-settings.json` écrit avec une liste `models` Grok alors que `provider: ollama` | C | N'écrire que les clés pertinentes |
| C-3 | Serveur | Pont A2A : `defaultModel:"qwen3:4b"` en dur | C | Reprendre le modèle configuré |
| C-4 | Transverse | CLI mêlant français et anglais (`sensory status` en FR, `rules list` en EN) | C | Choisir une langue par surface |
| C-5 | Premier lancement | « start Ollama » alors qu'Ollama tourne (message statique vs `doctor` dynamique) | C | Réutiliser la détection du doctor |
| C-6 | `doctor` | « 0 errors » puis exit 1 (intentionnel, commenté) | C | Nommer la sortie « not ready » dans le résumé |
| C-7 | Emballage | `CODEBUDDY_COMPANION_CORE=true` inerte depuis npm (paquet non publié) | C | Publier le paquet ou marquer le flag « source uniquement » |

---

## Les 5 frictions qui feraient abandonner l'inconnu

1. **Node 18 : le CLI ne démarre pas** (A-1). Il installe en suivant le README, tape sa première
   commande, et lit « Playwright requires Node.js 20 » — un message qui ne parle ni de Code Buddy
   ni de ce qu'il a demandé. Le README lui avait pourtant dit « Node.js ≥ 18 ».
2. **Quatorze minutes, puis rien, et exit 0** (A-2). Aucun message, aucune erreur, aucun haiku.
   Il ne peut même pas savoir qu'il y a eu un problème : le produit lui dit que tout s'est bien
   passé.
3. **La voie « $0 locale » n'aboutit pas** (A-5). C'est celle que le README, `doctor`, `onboard` et
   le message d'accueil recommandent tous. Après 17 minutes, il obtient `LlmStallError`.
4. **Le port 11435 suffit à casser Ollama** (A-4). Il a pourtant renseigné `OLLAMA_HOST` *et*
   `CODEBUDDY_PROVIDER=ollama`, et le produit lui confirme « Auto-detected provider: ollama ».
   Rien ne lui permet de deviner que seul le port `11434` active le bon transport.
5. **La PWA mobile renvoie une trace Node** (A-3). La fonctionnalité mise en avant pour le
   téléphone répond 500 sur son écran d'accueil, dans **toute** installation npm standard.

Le point commun des cinq : ce n'est pas la qualité du code, c'est que **rien n'a jamais été exécuté
depuis un paquet installé**. Chacun de ces défauts est invisible depuis la copie de travail — le
plancher Node parce que la CI est passée à 20/22, la PWA parce que le dépôt n'a pas de dossier
caché dans son chemin, le transport Ollama parce que le poste de dev écoute sur 11434.

---

## Bilan

L'emballage est ce que j'ai vu de mieux : 8,3 Mo, zéro `.map`, zéro test, zéro rapport, rien qui
n'ait à y être. La documentation est fiable au mot près — `buddy changelog` hors dépôt Git répond
exactement la phrase annoncée. `buddy doctor` est excellent : verdict en une ligne, raison du choix
du modèle, `--fix` qui tient sa promesse. Les messages d'erreur sont, presque partout, meilleurs que
la moyenne du marché : le non-TTY d'`onboard`, l'absence de fournisseur, le `LlmStallError`
nomment la panne *et* la sortie.

Ce qui manque n'est pas du soin, c'est **une exécution depuis le paquet installé**. Les cinq
défauts bloquants vivent tous dans l'écart entre la copie de travail et le tarball déployé : un
plancher Node que plus rien ne mesure, une PWA que dix suites de tests couvrent sans jamais la
servir depuis un dossier caché, un transport Ollama qui reconnaît un port plutôt qu'un fournisseur.
Aucun n'aurait survécu à un seul `npm install -g` suivi d'un `buddy -p`.

Le plus coûteux reste le second : **exit 0 avec une sortie vide**. Un produit peut être lent, il ne
peut pas annoncer un succès sans livrable — c'est la seule panne qui empêche l'utilisateur de
comprendre qu'il y a une panne.

Trois correctifs ont été appliqués ici (plancher Node, PWA sous dossier caché, message 401 de la
flotte), chacun avec son test et son commit. Les deux vrais chantiers restent ouverts : rendre
`playwright-core` réellement optionnel, et faire du routage Ollama une décision de fournisseur.

INSTALL: 5 A, 8 B
