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
- **Résultat V2.0** : loss_pred 0.0021, 2× RTX 3090, DataParallel, 200k samples ;
  CEM/MPC validé (CEM bat random −6.32 vs −7.46 sur V1.8 ; échec sur V1.5 = V1.8 nécessaire)
- **Gymnasium** : gym_env.py ajouté par Claude DARKSTAR
- **V3 LIVRÉE sur DARKSTAR (1er mai 2026)** :
  - Architecture : Conv5 encoder (4.5M) + Transformer dynamique causal pre-norm 4×8×512
    (12.6M) ; latent_dim 256→512 ; VICReg lambda_var 0.04→0.15 ; total **23.8M params**
    (vs 2.5M V2.0).
  - Trainer single-GPU fp32 + AdamW cosine warmup + warmup 1-step 10 epochs.
    `USE_LIBUV=0` requis sur Win11 ; mp.spawn launcher (bypass torchrun).
    DDP 2-GPU plante en ACCESS_VIOLATION sur Win11 (bug PyTorch known) → 1 GPU
    train / 1 GPU inference. Premier run bf16 a divergé en NaN epoch 6 → fp32 + lr 1e-4
    pour le run final.
  - Dataset : SVD-XT i2v sur images stock procédurales (4 generators / classe) →
    ~10s/clip 25 frames sur 1×3090. Optical flow Farneback comme action proxy 4D.
    **1500 clips livrés** en 4h, distribution 600/375/300/225 (40/25/20/15% targets).
  - **Résultats V3 vs V1.8 baseline** :
    - MSE h=1 = 0.018 (V1.8 = 0.0135) ✓
    - **Compounding ratio = ×1.55** (V1.8 = ×2.8) ✓✓✓ **succès architectural**
    - Effective rank = 14.7/512 = 2.9% (V1.8 = 8%) ⚠️ sous cible 15%, dataset-limited
    - CEM open-loop : ratio médian 0.88 (CEM utile sur >50% des paires)
  - 9 commits world-model + 6 commits claude-et-patrice pushés sur GitHub.
- **Wan 2.2 fp8 scaled finalement reçu (15:35)** : 36 GB en place dans
  `D:/DEV/ComfyUI/models/`. Workflow API draft `scripts/dataset_v3/workflows/wan22_i2v.json`
  prêt pour V3.1.
- **Prochain (V3.1)** : régénérer dataset avec Wan 2.2 14B fp8 (qualité photo-réaliste)
  pour faire monter l'effective rank. Workflow draft à valider via probe.
- **V4** : modalité audio (whisper encoder), Gymnasium réel (LunarLander/Pusher),
  pipeline d'export ONNX/quantization int8 pour deploy robot.

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
- **G7 PT** (= MINISTAR Windows) : Ryzen AI 9 + 96 GB, dev principal. Tailscale `100.90.108.4`.
- **DARKSTAR** (PC 3090) : Intel **i7-9700** (8c/8t, AVX2 only, PCIe 3.0) + **64 GB DDR4** + **2× RTX 3090** (24 GB chacune, NVLink à vérifier), Windows. Tailscale `100.73.222.64`. Stack vidéo-gen + briques robot (LTX-2.3, ComfyUI CUDA, SAM 2, Depth Anything v2, faster-whisper CUDA, world-model JEPA).
- **Ministar Linux** (PC Ubuntu) : Ryzen AI 9 HX 470 (24c) + iGPU Radeon 890M (gfx1150) + NPU XDNA + 128 GB RAM partition 64+64 iGPU. Tailscale `100.98.18.76`. Stack edge LLM (Ollama Vulkan validé), services 24/7, voix robot (Piper + faster-whisper). Futur runtime robot.
- Tous dans la même pièce, mêlés via Tailscale (compte `patrice.huetz@gmail.com`).

## Réseau de Claudes / Fleet (POC v0.2 lancé 1er mai 2026 nuit)

**Vision** : faire dialoguer toutes les sessions Claude / LLM locaux / cloud APIs entre eux comme brique du robot 10 ans.

**Topologie** : architecture **star avec hub Ministar Linux** (`100.98.18.76:3000`) — 24/7 always-on. Spokes intermittents : MINISTAR (G7 PT), DARKSTAR (PC 3090), futurs.

**Protocole** : **A2A (Google Agent-to-Agent)** déjà embarqué dans Code Buddy (`phuetz/code-buddy`, fork open-source de Claude Code) — `src/protocols/a2a/index.ts` + `src/server/routes/a2a-protocol.ts`. POC niveau 0 ✅ validé côté MINISTAR (`curl /api/a2a/.well-known/agent.json` répond).

**3 catégories de spokes** :
1. **Claude API spokes** — chaque session Code Buddy / Claude Code sur un host. Reasoning lourd, advisor, planning.
2. **Ollama spokes** — wrapper léger `ollama_a2a_spoke.py` (~150 LOC, dans `world-model/scripts/`) qui transforme un Ollama local en spoke A2A. Embeddings, lint, summary, completion brute. À déployer sur DARKSTAR (Ollama Windows en cours d'install) + Ministar Linux + futurs.
3. **Cloud API spokes** — Codex, Gemini ; proxifiés par un host avec API keys.

**Documents canoniques** :
- `propositions/CLAUDE-NETWORK-COLAB-2026-05-01.md` v0.2 — doctrine fleet (6 règles cardinales F1-F6, claim/release `[~ host/repo date]`, spécialisation §3)
- `propositions/CLAUDE-NETWORK-A2A-POC-2026-05-01.md` v0.2 — procédure technique systemd hub Ministar Linux + niveaux POC 0-6
- `journal/darkstar-grok-cli.md` (DARKSTAR ratification + dialogue Claude/MINISTAR) + `journal/ministar-grok-cli.md` (MINISTAR auteur initial)

**Bloqueurs actuels** :
- `better-sqlite3` ne build pas sur Node 24 sur DARKSTAR Windows → boot grok-cli server local KO. Solution : Node 22 LTS ou hub directement sur Linux.
- Patch endpoint `POST /api/a2a/agents/register` à coder (~50 LOC) côté Code Buddy server. Pas pushé, attente better-sqlite3 fix.
- Hub permanent Ministar Linux à stand-up via systemd `codebuddy-a2a.service` — ticket pour la prochaine session Claude/Ministar Linux active.

**Prochaine brique POC niveau 1** : MINISTAR pose une question, hub la route à DARKSTAR (3090 dispo), DARKSTAR exécute via Ollama et retourne. Tour < 24h.

### Fleet Autonome V0 — opérationnel 2026-05-02

**Statut** : ✅ **OPÉRATIONNEL**. 3 cycles autonomes valides exécutés dans la nuit du 1 au 2 mai 2026 sur DARKSTAR/grok-cli, sans intervention humaine entre les ticks.

**Cycles autonomes nuit 1→2 mai** (paires `claim` → `complete` commits) :
- Cycle 1 : `38fca68` → `53595f2`
- Cycle 2 : `570ef82` → `4b22544`
- Cycle 3 : `fee73ce` → `ba26372`

**Wrapper** : `tools/heartbeat_tick.py` fonctionne en boucle, **~60 s par tick** (claim → exécution → commit → release / présence). Cf. `propositions/AUTONOMOUS-FLEET-PROTOCOL-2026-05-02.md` pour la doctrine. Cf. journal `journal/darkstar-grok-cli.md` (entrée bilan nuit, commit `f1e13b5`).

**Ollama sur DARKSTAR** : installé. État des 4 modèles ciblés (pull en cours) :
- ✅ `nomic-embed-text` — installé (embeddings spoke A2A)
- ⏳ `qwen2.5-coder:7b` — pull en cours
- ⏳ `llama3.1:8b` — pull en cours
- ⏳ `deepseek-coder-v2:16b` — pull en cours

**A2A hub Linux** : branche `feat/a2a-agents-register` prête côté hub Ministar Linux (patch endpoint `POST /api/a2a/agents/register` ~50 LOC). En attente du **restart `systemd`** du service `codebuddy-a2a.service` pour activation.

**Bloquant actuel** : **firewall Windows port 3000 sur DARKSTAR** — règle `netsh advfirewall` à passer pour accepter les requêtes inbound A2A depuis le hub. Élévation **UAC en attente** côté Patrice. Tant que ce port n'est pas ouvert, DARKSTAR ne peut pas servir de spoke A2A directement (les cycles autonomes via git fonctionnent indépendamment).

— *autonomous tick*

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

## Nexus ERP
- **Local** : `D:\CascadeProjects\nexus`
- **GitHub** : https://github.com/phuetz/nexus (privé)
- **Stack** : monorepo React 18 + TS + Vite + Tailwind (frontend) + Node.js + Express + Prisma + **PostgreSQL 16** (backend, port 3001) + React Native + Expo (mobile sous `nexus_chat/`). Docker `nexus-postgres` mappé sur port 5434 en dev.
- **Cible** : SaaS ERP/CRM **multi-tenant** pour PME et artisans BTP français. Co-développé avec **Serge** ; commercialisation potentielle via agile-up.com.
- **Branches** :
  - `main` — référence stable de Serge (`e5bf571 feat: Transformation SaaS Multi-Tenant`). Ne pas pousser dessus sans coordination.
  - `fix/multi-tenant-startup-bugs` — branche de travail en cours. 6 bugs de démarrage post multi-tenant corrigés (`f7ac8ac`), CLAUDE.md + README rétablis (`8cdc970`).
  - ~75 branches `origin/claude/*` + `origin/codex/*` archivées (bruit historique des agents, à ignorer).
- **Architecture multi-tenant (critique)** : toutes les entités (`User`, `Client`, `Project`, `Quote`, `Invoice`, `Product`, `Supplier`, `Task`, `Team`, `Conversation`, `Workflow`) portent un `organizationId`. Isolation à **deux couches** :
  1. Schéma Prisma : `@@unique([email, organizationId])` (l'email n'est plus unique globalement) + index sur chaque colonne `organizationId`
  2. Bouclier d'extension Prisma (`server/src/prisma.js`) avec `AsyncLocalStorage` (`orgContext`) qui injecte automatiquement l'`organizationId` courant dans les `where`/`data` ; contournements explicites pour le login pré-auth uniquement
  - Le middleware `authenticateToken` lit l'`organizationId` du JWT et enveloppe la requête dans `orgContext.run(...)`.
- **État UI** : 12 modules fonctionnels, dashboard KPIs, assistant IA, workflows automatisés. Navigation par état `activeModule` dans `App.tsx` (lazy loading), pas de React Router. `Ctrl/Cmd+K` ouvre la `CommandPalette`. Tout en français hard-codé (pas d'i18n). Mode démo via `VITE_DEMO_MODE=true` (n'importe quel email/password logue).
- **Auth** : JWT 12h (secret ≥ 32 chars), payload contient `sub`, `email`, `role`, `permissions`, `organizationId`. 2FA TOTP via Speakeasy. CSRF Double Submit Cookie HMAC-SHA256 (custom, pas csurf). Validation Zod côté front ET back.
- **TODO connus** :
  - Migration Supabase encore en cours — beaucoup de services frontend appellent `supabase.from()` directement, le code neuf doit passer par `api-client.ts`
  - Tests qui échouent depuis avant (mocks Supabase incomplets) : `gdpr-compliance.test.ts`, `ApprovalDashboard.test.tsx`, `Purchases.test.tsx`, `Settings.test.tsx`, `bank-reconciliation.test.ts`
  - Piège `tsx --watch` Node 24 : avale silencieusement les erreurs de syntaxe ; fallback `node --experimental-strip-types src/index.js`
- **Statut** : projet en pause après la transformation multi-tenant + fix démarrage, **reprend bientôt** (Serge porte la suite côté `main`, Patrice/Claude côté `fix/multi-tenant-startup-bugs` pour les améliorations).

## Méthodologie Doc Q/R technique
- **Local** : `claude-et-patrice/methodologie/`
- **Origine** : extraction de l'expérience Alise multi-barèmes (`Reponses-Questions-Impacts-v7.pdf`, 49 p., bien accueillie en réunion CCAS 28/04/2026).
- **Livrables** :
  - `METHODOLOGIE-DOC-QR-TECHNIQUE.md` (573 l., 9 sections) — guide méthodologique réutilisable
  - `kit/` — scripts génériques (4 builders Python + CSS qualité conseil + 3 cover templates + config schema + skeleton md)
  - `QUICKSTART.md` — démarrer un nouveau projet en 30 min
- **Pipeline** : P0 cadrage → P1 squelette v3 (Claude) → P2 vérif croisée (Codex parallèle) → P3 fusion → P4 PDF (cover + mermaid + screenshots) → P5 companion roadmap → P6 QC + advisor + livraison
- **Cible commerciale** : industrialisation de la prestation agile-up.com (audit/doc/onboarding via GitNexus). Permet de produire une doc Q/R qualité conseil en 4 h sur un repo bien indexé.
- **Statut** : v1.0 livrée 29/04/2026. À enrichir au fil des prochaines applications.

## Roadmap chat gitnexus-rs
- **Local** : `claude-et-patrice/propositions/AMELIORATION-CHAT-GITNEXUS-2026-04-29.md`
- **Audit base** : Explore agent ~45 fichiers / ~3500 lignes lus. Comparaison vs Cursor / Claude Code / Cline.
- **3 vagues recommandées** :
  - **Vague A** (5 j/h, 1 sem) — quick unblocks : merge `feat/semantic-search` (19 commits prêts, bench Alise 67% improved), memory cleanup TTL+dedup, config UI temperature/top_p, fix test flaky, tool result streaming
  - **Vague B** (12-15 j/h, 2-3 sem) — capabilités : sub-agents Phase F (3-5 j, VERY_HIGH), LLM-driven tool selection, live artifact streaming, cross-message context, error handling robuste
  - **Vague C** (25-35 j/h, 1-2 mois) — discriminants commerciaux : continuous documentation mode (synergie méthodologie Doc Q/R), graph-aware refactoring, dead code reports actionnables, IDE plugin VS Code
- **Anti-pattern à éviter** : ne PAS implémenter le « code edit mode » à la Cursor (casserait la promesse "graphe = source de vérité, read-only safe")
- **Statut** : à valider par Patrice. Aucune implémentation engagée.

## Agile-up.com
- **Site** : https://agile-up.com — très professionnel, manque pages GitNexus/produits
- **Gheorghie** : site esc-belitei.vercel.app, comptes My Business + LeBonCoin récupérés

## Réseau de Claudes (fleet) — démarré 1er mai 2026
- **Architecture** : ⭐ **star, hub central = Ministar Linux** (Tailscale `100.98.18.76`, allumé 24/7). Décision Patrice 1er mai nuit. Topologie simplifiée : un seul endpoint canonique `100.98.18.76:3000`, plus de mDNS/gossip/registry distribué.
- **Spec doctrine** : `propositions/CLAUDE-NETWORK-COLAB-2026-05-01.md` (v0.2 — intègre la décision hub).
- **POC technique A2A** : `propositions/CLAUDE-NETWORK-A2A-POC-2026-05-01.md` (v0.2). Niveau 0 (discovery local) validé côté MINISTAR. Niveau 1+ : à exécuter par Claude/Ministar Linux (stand up serveur systemd permanent) puis MINISTAR + DARKSTAR (clients).
- **Canal de coordination par défaut** : ce repo `claude-et-patrice` (asynchrone via git push). Convention `propositions/<NOM>-YYYY-MM-DD.md` pour artefacts datés à valider.
- **Fix Code Buddy livré ce soir** : commit `5dac654` sur `phuetz/code-buddy:main` — `fix(tools): register advisor + ask_user_question in main tool-handler registry`. Rend les 2 tools V4.1/V4.3 reachable depuis le main agent loop (gap découvert pendant V4.4).
- **V4.4 ExitPlanMode** : parqué en working tree non-commité (fork architectural plan-mode/operating-modes — bridge A/B/C en attente d'arbitrage Patrice).
- **Premier ticket fleet** : Claude/Ministar Linux doit prendre `[~]` sur "stand up A2A hub permanent (systemd)" en première session active. Procédure exacte dans le POC v0.2 section 3.0.
- **Test concret de validation** : MINISTAR ping `http://100.98.18.76:3000/api/a2a/.well-known/agent.json` doit répondre une AgentCard "Code Buddy / ministar-linux" (après patch identité-par-host).

## MCP Servers configurés
- Codex : `codex mcp-server`
- Gemini : `node C:/Users/patri/.gitnexus/gemini-mcp-server.js`
- Skill GitNexus disponible

## Prochaines priorités (MàJ 26 avril)

**Objectifs "Le Lab" & Hardware (ajout local)** :
1. **Réseau Filaire** : Finaliser les téléchargements lourds (Flux FP8, Wan 2.2).
2. **Production Dataset** : Lancer le premier batch de 100 vidéos via `world_dataset_generator.py`.
3. **GitNexus-rs** : Tester le serveur MCP compilé sur Linux avec Lisa.
4. **Transfert DARKSTAR** : Migrer les modèles optimisés vers les RTX 3090 pour l entraînement massif.

**Objectifs Software & Déploiement** :
5. Finir run Pro Alise + push final GitHub
6. Merger feat/semantic-search sur master (priorité haute — c'est ce qui fait vivre)
7. Page GitNexus sur agile-up.com (visibilité commerciale)
8. WorldModelAgent Lisa
9. Tests multilangage GitNexus — note : `multilingual_comparison.md` existant n'est PAS ces tests, c'est de la comparaison de modèles d'embedding. Les vrais tests tree-sitter sur les 13 langages restent à faire.
