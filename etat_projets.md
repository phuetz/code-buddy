# État des projets — mis à jour le 23 avril 2026

## Alise_v2 (CCAS)
- **Doc HTML** : complète, 23+ modules enrichis via GitNexus
- **GitHub** : https://github.com/phuetz/alise-v2-docs (privé)
- **Local** : D:\taf\Alise_v2\.gitnexus\docs\index.html
- **3 bugs corrigés** (RootController, Layout, AutofacConfig) dans E:\20260420\V4.0\
- **Bug courrier masse corrigé** : RegleCourriers.cs ligne 377
- **Run Pro en cours** : gemini-2.5-pro enrichissement des process (PID actif)

## World Model JEPA
- **Repo** : https://github.com/phuetz/world-model (public)
- **Résultat** : loss_pred 0.0021, 2× RTX 3090, DataParallel, 200k samples
- **Gymnasium** : gym_env.py ajouté par Claude DARKSTAR
- **Prochain** : replay buffer prioritaire, vrai environnement CartPole/LunarLander

## GitNexus (gitnexus-rs)
- **Repo local** : C:\Users\patri\CascadeProjects\gitnexus-rs
- **Fix html_escape backtick** : ✅ committé sur master (5881c29)
- **Skill gitnexus** disponible dans Claude Code
- **feat/semantic-search** : 16 commits d'avance sur master, prête sur le fond
  (ONNX inference réel, embed CLI, store on-disk, LLM reranker, MCP+desktop wiring,
  ~30 tests inline, bench Alise_v2 = 67% strictly improved). Avant merge : 3 chantiers
  → nettoyage pollution Git (target-codex, .codex-target, .omx, .playwright-mcp),
  README.md/.fr.md à mettre à jour (reranker + commandes embed/--hybrid/--rerank),
  sortir docs/inject-architecture.md et livre/07-le-lab.md hors scope.
- **Phase F** (sous-agents isolés dans le chat desktop) : reportée, pas un blocker
  pour le merge semantic. 3-5 jours estimés, autre branche.

## Lisa
- **Repo** : https://github.com/phuetz/Lisa (public)
- **GitNexusAgent ajouté** — Lisa peut interroger les graphes de code
- **WorldModelAgent** : en cours (Codex)

## Commander Suite
- **NexusFile** : D:\CascadeProjects\NexusFile — pre-1.0, feature-complete
- **NexusDiff** : D:\CascadeProjects\NexusDiff — tests ajoutés par Codex
- **TurboQuant** : D:\CascadeProjects\TurboQuant — implémentation arXiv:2504.19874
- **CodeBuddy/grok-cli** : D:\CascadeProjects\grok-cli — orchestrateur multi-LLM

## Projets WSL (`\\wsl.localhost\Ubuntu-22.04\home\patrice\claude\`)
> Découverts le 26 avril en regardant ce qui n'était pas remonté dans ce dépôt.
> Les Claudes ayant bossé dessus n'ont rien écrit ici — à corriger pour les
> prochaines sessions (briefer chaque projet pour pousser un récap dans
> `journal.md` quand un jalon est atteint).

- **vb6** — IDE web VB6 clone. React 18 + TS, Node backend.
  - Lexer/parser/semantic analyzer/transpiler/runtime, form designer 56+ controls, ~95% compat VB6
  - Repo : github.com/phuetz/VB6 (branche `main`)
  - `CLAUDE.md` complet, `AGENTS.md` présent

- **office** — Suite Office web (Word/Excel/PowerPoint/Access). React 19 + TS.
  - VBA câblé sur Excel/Word/Access via snapshot vendoré du pipeline VB6 (`office-suite/src/vb6-engine/`). Alt+F11 ouvre l'éditeur VBA dans chaque app.
  - Access v1 livré : Tables (designer + datasheet), Queries (SQL + grid), Forms (record-bound), Reports (banded + Print Preview), VBA Modules
  - Sous-repos : `office-suite/` (github.com/phuetz/office-suite, branche `master`) + `erp-crm-system/` + `deep_research/`
  - Le dossier racine `office/` n'est PAS un repo git — chaque sous-projet a le sien

- **workflow** — Plateforme de workflow. TS + Vite + Node + Playwright.
  - Repo : github.com/phuetz/workflow (branche `main`)
  - **Avertissement explicite dans `CLAUDE.md`** : interdiction des scripts automatiques de correction (10+ régressions historiques). Corrections manuelles préférées.
  - `COLAB.md` v6.0.0 (2026-02-05) avec règles strictes : max 10 fichiers/itération, boucle de rétroaction typecheck→lint→test→build obligatoire après chaque modif

- **MonArtisant** (dossier) / **MonArtisan** (repo) — Plateforme FR mise en relation artisans/clients (type MaxTravaux).
  - Particuliers : jusqu'à 5 devis via formulaire multi-étapes ; Artisans : leads qualifiés zone/métier ; Admins : modération + routage
  - Stack : Next.js 14 (App Router), monorepo Turbo + pnpm, Prisma + PostgreSQL, NextAuth, Stripe (abos + crédits), SendGrid, Twilio, S3/R2, reCAPTCHA v3, Sentry. Tests : Vitest + Playwright (5 projets : chrome/firefox/webkit + mobile)
  - Repo : github.com/phuetz/MonArtisan (branche `main`) — note l'écart d'orthographe dossier vs repo
  - `COLAB.md` 2026-02-15 : statut "COMPLET — toutes phases implémentées, code poussé"

## Livre "Le Compagnon de Silicone"
- **Local** : \\wsl.localhost\Ubuntu-22.04\home\patrice\claude\livre\Le_Compagnon_de_Silicone\
- **Chapitres écrits** : 01 (La nuit des 500 pages)
- **En cours** : Gemini écrit ch.3,4,5,6,7,8,9,10,11

## Hardware Lab
- **G7 PT** (ce PC) : Ryzen AI 9 + 96 GB, dev principal
- **DARKSTAR** (PC 3090) : 2× RTX 3090, entraînement world model
- **PC Ubuntu** : Ryzen AI 470 Pro + 128 GB, futur cerveau robot
- Tous dans la même pièce, réseau local à brancher

## Agile-up.com
- **Site** : https://agile-up.com — très professionnel, manque pages GitNexus/produits
- **Gheorghie** : site esc-belitei.vercel.app, comptes My Business + LeBonCoin récupérés

## MCP Servers configurés
- Codex : `codex mcp-server`
- Gemini : `node C:/Users/patri/.gitnexus/gemini-mcp-server.js`
- Skill GitNexus disponible

## Prochaines priorités
1. Finir run Pro Alise + push final GitHub
2. ✅ ~~Committer fix html_escape dans gitnexus-rs~~ FAIT
3. Merger feat/semantic-search sur master (priorité haute — c'est ce qui fait vivre)
4. Page GitNexus sur agile-up.com (visibilité commerciale)
5. WorldModelAgent Lisa
6. Tests multilangage GitNexus — note : `multilingual_comparison.md` existant n'est PAS
   ces tests, c'est de la comparaison de modèles d'embedding. Les vrais tests
   tree-sitter sur les 13 langages restent à faire.
