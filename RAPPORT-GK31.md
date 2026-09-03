# RAPPORT-GK31 — Le README public de Code Buddy : ce qu'un inconnu comprend en 30 secondes, et rien que du vrai

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-selfdescribe-2026-09-02`
Branche : `docs/gk31-readme-inconnu-2026-09-03`
HEAD au départ : `af2ace177` (`Merge GK25 …`)
Réservation : `107929b07`
HEAD produit : voir le dernier commit de ce rapport
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du README (réservation `107929b07`).
Contrainte : texte seulement — aucun modèle local, aucune API, aucun service.

## Mission

Réécrire le README public pour qu'un inconnu (dirigeant de PME, développeur, curieux d'IA) comprenne en 30 secondes ce que Code Buddy fait **aujourd'hui**, avec uniquement des faits sourcés.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API, aucun service, aucun modèle local.
- ComfyUI 8188/8189 non touché. Original `~/code-buddy` interdit.
- Aucune donnée personnelle, aucun chemin privé, aucun nom de machine, aucun chiffre non sourcé.
- Un commit conventionnel par lot, fichiers nommés un par un.
- `package-lock.json` retouché par `npm install --ignore-scripts` (1848 paquets, 34 s, comme GK1) puis restauré (`git checkout -- package-lock.json`).

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 13:20 | Rapport créé **avant inspection**. Coordination réservée (`107929b07`). |
| 13:21 | Inspection README (543 lignes, anglais). Test des 30 secondes. |
| 13:22 | Lecture `REVUE-DOCS-GEMINI.md`, `REPARATION-DOC1.md`, parcours GK (lecture seule). |
| 13:23 | `npm install --ignore-scripts` dans le clone (pas de `node_modules` au départ). Lockfile restauré. |
| 13:24 | `--help` réel : `try`, `film`, `loop`, `server`, `voice`, `fleet`, `doctor`, `login`, `gui`. `film from-prompt --short` et `loop --verify-cmd` confirmés. |
| 13:25 | Archive `docs/archive/README-avant-2026-09-03.md` (`45f5df094`). |
| 13:26 | README réécrit (`f7014c504`). |
| 13:27 | Test `tests/docs/readme-truth.test.ts` + assouplissement des compteurs d'images (`af2af4dfd`). |
| 13:28 | `donnees-personnelles` rouge sur `la machine GPU de l'auteur` / `[IP Tailscale rédigée]` préexistants → rédactions (`d7172ebb6`). |
| 13:29 | Union ciblée 4 fichiers / 23 verts. ESLint ciblé 0. `git diff --check` 0. |

## Fichiers lus

- `README.md` (avant/après)
- `REVUE-DOCS-GEMINI.md`, `REPARATION-DOC1.md`
- `docs/getting-started.md` (install)
- `docs/first-run-audit-2026-08-23.md` (via clone E18, lecture seule)
- `RAPPORT-GK1.md`, `RAPPORT-GK3.md`, `RAPPORT-GK4.md`, `RAPPORT-GK17.md` (clones d'origine, lecture seule)
- `RAPPORT-E15.md` (`buddy loop --verify-cmd`)
- `REPARATION-E18.md`
- `tests/docs/public-screenshots.test.ts`, `tests/docs/cowork-public-docs-privacy.test.ts`, `tests/security/donnees-personnelles.test.ts`
- `src/index.ts` (commandes lazy), `src/commands/film.ts`, `src/commands/loop-cli.ts`
- `package.json` (`engines.node >=18.0.0`, version `2.0.0`), `cowork/package.json` (`engines.node >=22`), `LICENSE`

## Test des 30 secondes (README avant, 543 lignes)

Langue : anglais (conservée).

| Fenêtre | Ce que je comprends | Ce qui me perd | Ce qui me fait douter |
|---|---|---|---|
| 0–10 s | Produit d'agent de code, « free, on your own machine », badges npm/CI/licence. | Badges `$0 with your subscriptions`, « 64 providers », parenthèse OmniRoute (24+gateway). Un dirigeant de PME n'a pas de carte mentale pour ça. | Le chiffre 64 et le `$0` sont collés au même souffle que ChatGPT Plus / SuperGrok. |
| 10–20 s | Un GIF : un modèle local raisonne puis crée un fichier. Promesse locale. | Sept puces d'un coup : 200+ tools, App Studio, Darwin-Gödel, Video Studio, Fleet, companion 20+ canaux. | Quatre produits différents (IDE, studio vidéo, flotte, robot) avant toute commande d'install. |
| 20–30 s | Toujours dans le hero. Lien « proof.md ». | Pas encore d'install. TOC de 9 ancres. | Je ne sais pas si je dois `curl \| sh`, `npm i -g`, Docker, ou cloner. |

Après 30 s je n'ai toujours pas tapé une commande. L'install n'arrive qu'à la ligne 197, derrière des captures Telegram, un tableau « Feature tour », et `buddy try` présenté comme zéro-config alors que E14 a montré l'inverse sans provider.

## Comparaison aux README de référence (connaissance, sans copie)

| Projet | Ce qu'il fait en 30 s | Écart de Code Buddy (avant) |
|---|---|---|
| **Aider** | Une phrase (« pair programming in your terminal »), `pip install`, `aider`. Les features viennent après le premier succès. | Ici le catalogue précède l'install. |
| **OpenHands** | Qu'est-ce que c'est, puis 2–3 commandes pour un agent qui édite un dépôt. Limites dites plus bas. | Ici les limites sont noyées dans « Honest about scope » + un doc de parité Hermes. |
| **Goose (Block)** | « Your local AI agent », install, puis le reste. Local-first sans inventaire de 60 providers. | Ici « 64 providers / 30 free-tier » est la deuxième phrase. |

La réécriture suit cette forme : accroche vraie → cinq commandes déjà courues → trois lignes d'install → opt-in / pas prêt → licence → getting-started.

## Démos GK retenues

Aucune durée, aucun nom de machine, aucun modèle d'inventaire hôte dans le README public.

| # | Parcours (lecture seule) | Commande dans le README | `--help` réel |
|---|---|---|---|
| 1 | GK1 chat Ollama `$0` ; E14 `buddy try` sans provider sort avec le mode d'emploi | `CODEBUDDY_PROVIDER=ollama buddy try` | `try` : « ChatGPT OAuth or local Ollama » |
| 2 | GK4 `film from-prompt --short` (3 scènes 9:16, ffmpeg + Piper optionnel) | `buddy film from-prompt "…" --short` | `from-prompt --short` : 9:16, ~3 scènes |
| 3 | E15 / GK3 `buddy loop --verify-cmd "npm test"` | `buddy loop "make the tests pass" --verify-cmd "npm test"` | `--verify-cmd <shell>` : exit 0 = CONFIRMED |
| 4 | GK17 deux `buddy server` + JWT + `peer.chat` | `JWT_SECRET=dev buddy server --port 3410` (deux ports) | `server --port`, `fleet token` |
| 5 | Voice / companion opt-in (CONV/SENSE, `buddy voice`) | `buddy voice --mode plan` ; 24/7 = `CODEBUDDY_SENSORY=true buddy server` | `voice --mode plan` (défaut `default`) |

## Installation E18/GK1

Parcours source vérifié (E14/E18 `first-run-audit` + GK1 `npm install` 1848 paquets exit 0) :

```
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install
npm run build && npm link
```

Node ≥ 18 (`package.json` engines). Cowork ≥ 22 (`cowork/package.json`) — dit **opt-in / pas le premier run**.

Honnêteté reprise d'E14 : le paquet npm publié **peut laguer** cet arbre ; `curl | sh` installe la release publiée, pas ce checkout.

## Captures existantes

Seules deux images déjà suivies :

- `docs/qa/code-buddy-studio/cowork-demo-moneyshot.gif` (+ mp4 lié)
- `docs/assets/showcase-try.gif`

Aucune image inventée. Le test `public-screenshots` exigeait 30 images et 24 ancres : plancher remplacé par « résolubles, moins de 10 images ».

## Commandes et variables citées

Toutes éprouvées via `npx tsx src/index.ts <cmd> --help` (HOME isolé `_qa/gk31/home`, gitignoré). Exit 0.

Commandes top-level dans `buddy --help` : `try`, `film`, `loop`, `server`, `voice`, `fleet`, `doctor`, `login`, `gui`, `install-gui`.

Variables lues par `src/` : `CODEBUDDY_PROVIDER`, `CODEBUDDY_SENSORY`, `CODEBUDDY_TTS_VOICE`, `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`, `CODEBUDDY_SELF_IMPROVE`, `JWT_SECRET`, `YOLO_MODE`.

## Écarts

| Id | Constat | Voie | Commit |
|---|---|---|---|
| R1 | README-catalogue (543 lignes) : l'inconnu n'atteint pas l'install en 30 s ; chiffres non sourcés (64 providers, 200+ tools, `$0.0001`) | Réécriture | `f7014c504` |
| R2 | Aucun test n'empêchait de citer une commande absente de `buddy --help` | `tests/docs/readme-truth.test.ts` | `af2af4dfd` |
| R3 | `public-screenshots` exigeait 30 images / 24 ancres → force le catalogue | Assouplir les compteurs, corriger `cowork/README.md` (casse Linux) | `af2af4dfd` |
| R4 | `donnees-personnelles` rouge : `la machine GPU de l'auteur`, `[IP Tailscale rédigée]` dans des fichiers déjà suivis | Rédaction (aide companion, rapports, coordination) | `d7172ebb6` |

## Tableau final « scénario → attendu → obtenu → correctif → commit »

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| Rapport avant inspection | Fichier créé, HEAD `af2ace177` | `RAPPORT-GK31.md` + réservation | — | `107929b07` |
| Archive | Copie bit-à-bit 543 lignes | `docs/archive/README-avant-2026-09-03.md` identique (`cmp`) | — | `45f5df094` |
| 30 s + 5 démos + 3 cmd install | README anglais court, faits GK, pas d'image inventée | ~140 lignes, 2 GIF existants, getting-started, BUSL 1.1 | Réécriture | `f7014c504` |
| `readme-truth` | Commandes ⊂ `buddy --help` ; env lues par `src/` | 4/4 verts | Test nouveau | `af2af4dfd` |
| Screenshots publics | Liens/images résolubles | 5/5 verts (plancher 30 retiré) | Test ajusté | `af2af4dfd` |
| Lien Cowork | `[Cowork Desktop](docs/cowork.md)` | 13/13 `cowork-public-docs-privacy` | Casse du libellé | dans `f7014c504` (fix follow-up dans le fichier) |
| Données personnelles | 0 terme interdit | 1/1 vert après rédactions | `la machine GPU de l'auteur` / IP | `d7172ebb6` |

## Vérifications

```
npx vitest run tests/docs/readme-truth.test.ts \
  tests/docs/public-screenshots.test.ts \
  tests/docs/cowork-public-docs-privacy.test.ts \
  tests/security/donnees-personnelles.test.ts
```

4 fichiers / **23 passed**. ESLint ciblé `--max-warnings=0` : 0. `git diff --check` : 0.

`--help` réel (extrait) : `try`, `film from-prompt --short`, `loop --verify-cmd`, `server --port`, `voice --mode plan`, `fleet token`, `doctor --fix` — tous exit 0.

`npx tsc --noEmit` **non relancé** : seuls des fichiers markdown, un test, `.gitignore`, et deux chaînes d'aide companion ont changé.

## Commits

| SHA | Message |
|---|---|
| `107929b07` | `docs(gk31): réserver le README public et créer le rapport avant inspection` |
| `45f5df094` | `docs(gk31): archiver le README public avant réécriture` |
| `f7014c504` | `docs(gk31): réécrire le README public pour un inconnu en 30 secondes` |
| `af2af4dfd` | `test(gk31): vérifier que les commandes et variables du README existent` |
| `d7172ebb6` | `fix(privacy): retirer le nom d'hôte et l'IP privés des fichiers suivis` |

## Points ouverts

- Le README ne prouve plus le chat Ollama en live dans *cette* session (consigne : texte seulement). La commande est celle des parcours GK1/E14, vérifiée `--help`.
- `CHANGELOG.md` conserve encore « Darkstar » : fichier **exempté** par `donnees-personnelles.test.ts`. Hors zone GK31.
- `npm install -g` / `curl | sh` restent documentés dans `docs/install.md` comme canaux publiés, pas comme le premier run de ce tree.
- Suite Vitest complète non lancée.
- Aucun push.
