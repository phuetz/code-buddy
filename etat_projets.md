# État des projets — mis à jour le 26 avril 2026

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
> MonArtisan et Office Suite ont leurs propres sections détaillées plus bas.
> Ici ne restent que vb6 et workflow, qui n'avaient pas encore été remontés.

- **vb6** — IDE web VB6 clone. React 18 + TS, Node backend.
  - Lexer/parser/semantic analyzer/transpiler/runtime, form designer 56+ controls, ~95% compat VB6
  - Repo : github.com/phuetz/VB6 (branche `main`)
  - `CLAUDE.md` complet, `AGENTS.md` présent

- **workflow** — Plateforme de workflow. TS + Vite + Node + Playwright.
  - Repo : github.com/phuetz/workflow (branche `main`)
  - **Avertissement explicite dans `CLAUDE.md`** : interdiction des scripts automatiques de correction (10+ régressions historiques). Corrections manuelles préférées.
  - `COLAB.md` v6.0.0 (2026-02-05) avec règles strictes : max 10 fichiers/itération, boucle de rétroaction typecheck→lint→test→build obligatoire après chaque modif

## Livre "Le Compagnon de Silicone"
- **Local** : \\wsl.localhost\Ubuntu-22.04\home\patrice\claude\livre\Le_Compagnon_de_Silicone\
- **Chapitres écrits** : 01 (La nuit des 500 pages)
- **En cours** : Gemini écrit ch.3,4,5,6,7,8,9,10,11

## Hardware Lab
- **G7 PT** (ce PC) : Ryzen AI 9 + 96 GB, dev principal
- **DARKSTAR** (PC 3090) : 2× RTX 3090, entraînement world model
- **PC Ubuntu** : Ryzen AI 470 Pro + 128 GB, futur cerveau robot
- Tous dans la même pièce, réseau local à brancher

## MonArtisan
- **Local** : `~/claude/MonArtisant` (G7 PT WSL)
- **GitHub** : https://github.com/phuetz/MonArtisan (privé, branch `main`)
- Plateforme française de mise en relation artisans / clients (lead gen + devis).
- Stack : Next.js 14 App Router, Prisma multi-provider (SQLite/Turso/PG/MySQL),
  NextAuth credentials JWT 30j, Stripe (abos + crédits), SendGrid, Twilio, S3.
- Monorepo pnpm + Turbo. Une seule app (`apps/web`), 3 packages partagés.
- **5 commits livrés en chaîne le 25 avril** (`02e06a9..46fdb0f`) :
  stabilisation MVP → GED (OCR/viewer/PDF signé) → Sécurité+UX (2FA TOTP, SSE
  messaging, analytics) → Scaling (FormBuilder dynamique, SMS critiques).
- État : lint/typecheck/build/161 tests verts. Déployable en l'état.
- Reste avant prod sérieuse : tests API (couverture quasi-nulle sur les nouvelles
  routes), perf audit (DocumentViewer charge ~1MB react-pdf), audit a11y modals.

## Office Suite (`~/claude/office/`)
- **Repo local** : `/home/patrice/claude/office/office-suite/`
- **Pile** : React 19 + TS strict + MUI v7 + TipTap (Word) + react-spreadsheet (Excel) + custom (PowerPoint)
- **VBA bridge livré dans la nuit du 25-26 avril** : Alt+F11 fonctionne dans Excel, Word et Access. Voir `journal.md`.
- **Branche** : `master` (autre agent travaille sur `worktree-agent-a6efc83c`)
- **Commits VBA** : `1364844` (vb6-engine vendor) → `01e01bb` (Excel) → `2bca623` (Word) → `52daddb` (Access foundation) → `8611cc9` (Access designers)
- **AccessEditor** : maintenant fonctionnel (Tables designer + datasheet, Queries SQL+résultat live, Forms record-bound, Reports banded). Ne renvoie plus à `<ComingSoon />`.
- **Tests** : 30 tests VBA/Access verts. Suite globale d'office-suite n'a pas régressé.
- **TODO suivant** : visual drag-and-drop Form Designer ; SqlParser JOIN/agrégats ; FormulaEvaluator branché à WorksheetFunction ; setActiveSheet/setActiveCell wired sur le hook Excel ; Selection.TypeParagraph sans parens (fix parser amont).
- **Note** : le dossier racine `office/` n'est PAS un repo git — sous-repos `office-suite/` + `erp-crm-system/` + `deep_research/`

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
