# État des projets — mis à jour le 14 mai 2026

## ✨ Bilan d'étape — 14 mai 2026 (GitNexus documents de travail + livrables techniques)

Session Codex sur `D:\CascadeProjects\gitnexus-rs-from-c`, branche
`codex/multi-llm-provider-choice`, base `f7417e4 Improve GitNexus as a reliable analysis workstation`.
Le travail courant n'est pas encore commité au moment de cette sauvegarde.

Objectif Patrice : transformer GitNexus Chat en outil capable d'importer un
document de travail contenant des questions, d'extraire les questions, de les
traiter une par une avec GitNexus, puis de produire un livrable final
professionnel reprenant les réponses détaillées.

État livré côté application :
- panneau **Documents de travail** avec import DOCX, extraction des questions,
  traitement une par une ou par lot, rattachement à une conversation dédiée et
  cache local du document source ;
- prompt de traitement enrichi par la reformulation GitNexus : dépôt cible,
  lecture obligatoire des fichiers, sources exactes, explication détaillée,
  preuves code, diagramme Mermaid si pertinent, impacts et limites ;
- livrable Markdown restructuré comme un mini-livre technique : couverture
  métadonnées, parcours de lecture, table des questions, document source
  enrichi, mini-chapitres par question, index global des sources citées et
  contrôle qualité documentaire ;
- score qualité visible dans l'UI : couverture des questions, fichiers sources
  cités, diagrammes, blocs de code, erreurs, réponses trop courtes ;
- exports disponibles depuis le panneau : Markdown, HTML imprimable, DOCX et
  PDF natif ;
- export DOCX renforcé : callouts Obsidian `[!NOTE]`, `[!TIP]`,
  `[!WARNING]`, `[!DANGER]`, légendes de figures Mermaid et identifiants de
  liens uniques pour les longs documents ;
- export PDF/HTML avec profil `technical-book` : styles de couverture,
  encadrés, tableaux, diagrammes Mermaid plus lisibles et fallback source si le
  rendu Mermaid n'est pas disponible ;
- délais d'export PDF/DOCX portés à 180 s pour les gros livrables.

Fichiers clés :
- `chat-ui/src/components/chat/WorkDocumentsPanel.tsx`
- `chat-ui/src/utils/workdoc.ts`
- `chat-ui/src/utils/workdoc.test.ts`
- `chat-ui/src/api/mcp-client.ts`
- `crates/gitnexus-cli/src/commands/export_docx.rs`
- `crates/gitnexus-cli/src/commands/generate/pdf.rs`
- endpoints existants côté `crates/gitnexus-cli/src/commands/serve.rs` déjà utilisés pour extraction/export.

Vérifications passées :
- `npm --prefix chat-ui run test -- workdoc` : 6 tests OK
- `npm --prefix chat-ui run lint` : OK
- `npm --prefix chat-ui run build` : OK
- `cargo test -p gitnexus-cli` : 155 unit tests + 10 integration tests + 1 secret scan OK
- `git diff --check` sur les fichiers concernés : OK

État du worktree GitNexus au moment de la sauvegarde :
- de nombreux fichiers déjà modifiés/non trackés existent dans le worktree,
  issus des travaux précédents sur chat, explorateur, vault, export et
  multi-LLM ;
- ne pas faire de reset/revert global ;
- avant commit, relire le scope et idéalement faire un commit Lore dédié à la
  chaîne "documents de travail / livrables techniques".

Prochaines reprises recommandées :
1. Tester en condition réelle dans l'application : importer un DOCX de questions
   Alise, traiter 2 ou 3 questions, exporter HTML/PDF/DOCX.
2. Inspecter visuellement le PDF/DOCX généré : couverture, table des questions,
   index des sources, callouts, diagrammes Mermaid.
3. Ajuster si besoin le seuil "réponse trop courte" et les patterns de
   détection de sources.
4. Committer avec le protocole Lore puis pousser sur `phuetz/gitnexus-rs`.
5. Ensuite seulement réfléchir à la suite : planification façon Manus UI,
   ordonnancement de tâches/questionnaire, reprise automatique après arrêt et
   historique d'avancement par document.

---

## ✨ Bilan d'étape — 12 mai 2026 (GitNexus Chat multi-LLM + réponses sourcées)

Session Codex sur `D:\CascadeProjects\gitnexus-rs-from-c`, branche
`codex/multi-llm-provider-choice`, poussée sur `phuetz/gitnexus-rs` :
`f7417e4 Improve GitNexus as a reliable analysis workstation`.

Ce lot transforme GitNexus Chat en cockpit d'analyse plus démontrable pour
Alise_v2 :
- choix de fournisseurs LLM dans l'UI : ChatGPT Pro, Ollama local, DARKSTAR
  Ollama, Ministar Linux Ollama, LM Studio, OpenAI API, OpenRouter, Gemini
  compatible et endpoint OpenAI-compatible ;
- modèles locaux découverts dynamiquement via les endpoints disponibles
  (Ollama/LM Studio), plus de liste codée en dur ;
- machines Tailscale proposées seulement si elles répondent réellement ;
- tests réels depuis l'application sur Alise_v2 avec modèles locaux et GPT-5.5 ;
- corrections anti-hallucination : meilleurs prompts d'outils, diagnostics de
  réponse vide, preuves visibles, sources/fichiers cités plus stricts ;
- explorateur de sources renforcé : fichiers concernés, surbrillance,
  navigation, symboles, plan et code coloré ;
- exports d'analyse Markdown/HTML/PDF et préparation d'un PDF natif inspiré de
  MarkPress ;
- génération de skill GitNexus pour exploitation documentaire depuis les agents ;
- bouton de reformulation du prompt : transforme une question utilisateur en
  consigne structurée adaptée au dépôt sélectionné, avec sources exactes et
  garde-fous.

Validations : 61 tests frontend ciblés, build `chat-ui`, 17 tests `ask`,
115 tests `generate`, `git diff --check`.

Prochaine amélioration : enrichir la reformulation avec un contexte projet
calculé par GitNexus (langage dominant, frameworks, dossiers métier, objectifs)
pour que `Alise_v2`, `gitnexus-rs` ou un autre dépôt produisent des prompts
spécifiquement adaptés à leur domaine.

---

## ✨ Bilan d'étape — 09 mai 2026 (Cowork-on-core + collab CLI ↔ GUI)

**Migration Cowork-on-core complète** (11 phases livrées, ~2 300 lignes,
0 régression sur 1553 tests). Cowork tourne désormais sur le core de
Code Buddy par défaut via `CodeBuddyEngineAdapter`. Pi-coding-agent
ne sert plus que de fallback. Toutes les capacités héritées d'OpenClaw
(Tool Policy, Lifecycle Hooks, Smart Compaction, Plugin Conflict
Detection, `node.*` RPC) sont automatiquement disponibles côté Cowork.

Highlights des 11 phases (commits sur `phuetz/code-buddy:main`) :
- P1-P6 : audit + MCP runtime sync + badge UI + Settings toggle + tests
- **P7 ship-blocker** : permission UI deadlock entre engine et pi
  (renderer attendait pi shape, engine envoyait sa shape native).
  Sans ce fix l'engine était inutilisable en pratique.
- P8 hot-swap modèle, P9 LRU cache, P10 skills hot-reload, P11 E2E.

**Lisa #1 + #2 portées dans Cowork** :
- ClipboardSummaryPanel adapté (Electron clipboard API + `runPiAiOneShot`)
- VoiceChatOverlay consolidé (mic faster-whisper + TTS Piper FR)
- Fix mic permission Electron (setPermissionRequestHandler)

**Plan Cowork ↔ Code Buddy CLI ↔ OpenClaw Gateway** (designé en mode
plan, exécution à venir) :
- Architecture cible : pair `buddy` CLI et Cowork comme nœuds WS
  d'un Gateway OpenClaw partagé. Le pattern `node.*` RPC est déjà
  intégré dans Code Buddy via `src/openclaw/index.ts` — pas besoin
  d'inventer un protocole.
- Multi-channel "for free" : Telegram/WhatsApp/Discord pour Patrice
  via le routing OpenClaw.
- Plan complet : `~/.claude/plans/delightful-spinning-pebble.md`.
- 6 phases incrémentales, ~15 h ; Phases 1-4 = fallback filesystem,
  Phase 5 = pairing Gateway, Phase 6 = multi-channel.

**Repos affectés** : `phuetz/code-buddy` (root + `cowork/`).

---

## ✨ Bilan d'étape — 03 mai 2026 (consolidation)

Grosse journée multi-IA validée empiriquement. Trois axes ont avancé en parallèle :

### 1. Code Buddy / grok-cli — fleet inter-Claude opérationnel

Phases (d).6 → (d).14 + tests T1-T5 livrées et **pushées** sur `phuetz/code-buddy:main` :

| Phase | Brique | Source/Pattern |
|-------|--------|----------------|
| (d).6 | FleetListener auto-reconnect (exponential backoff via ReconnectionManager) | (d).5 deferral fermé |
| (d).7 | handler.ts broadcast backpressure (drop-on-overflow) | (d).1 deferral fermé |
| (d).8 | gateway/ws-transport.ts backpressure (mirror (d).7) | (d).7 follow-up |
| (d).9 | Peer presence beacon (heartbeat + lastSeen + stale flag) | OpenClaw v2026.4.27 |
| (d).10 | Compaction notices (bridge SmartCompactionEngine → fleet bus) | OpenClaw v2026.4.20 |
| (d).11 | Event history ring + `/fleet history` slash | UX gap "what-did-I-miss" |
| (d).12 | Multi-peer fan-in (`/fleet listen` N peers, `--name <id>`) | Phase (d).5 deferral |
| (d).13 | Peer RPC routing actif (`/fleet send <peer> <method>`, `peer:request`/`peer:response`) | OpenClaw `node.invoke` |
| (d).14 | Role taxonomy (`main\|orchestrator\|leaf`) + spawn depth cap + trace propagation | OpenClaw `SubagentSessionRole` |
| T1-T5 | Tests CRITIQUE : permission-modes, agent-context-facade, model-routing-facade, prompt-builder, infrastructure-facade | Audit-driven test plan |

**Total** : 14 commits, 445/445 tests verts (zéro régression cumulée), typecheck + lint clean.

**État du fleet** :
- `/fleet listen ws://...` peut désormais maintenir N peers simultanément avec auto-reconnect, presence beacon, compaction notices, event history ring
- `/fleet send <peer> <method> [json-params]` permet l'**invoke actif** entre Claudes (mirror du pattern `node.invoke` OpenClaw)
- `peer.describe`/`peer.ping`/`peer.echo` exposés par défaut ; ajout de méthodes business (chat.send, tool.run, session.spawn) = V0.5
- Anti-loop : `CODEBUDDY_PEER_MAX_DEPTH=3` (default) + `CODEBUDDY_PEER_ROLE=leaf` refuse outgoing requests
- Trace propagation end-to-end via `traceId` + `depth` dans les frames

→ Le mesh DARKSTAR + MINISTAR + Ministar Linux est **techniquement prêt** pour coordination multi-IA active. Reste : restart systemd hub Ministar Linux + 2 clics UAC DARKSTAR (firewall + Ollama).

### 2. PdfCommander (MINISTAR, avec Antigravity) — nouveau projet majeur

Première grosse session avec **Antigravity** (Google AI Ultra IDE) — premier IA non-Claude qui rejoint le fleet via la convention COLAB.md / journal-per-source.

- 50 panneaux Hub IA + 9 panneaux outils classiques intégrés dans `MainWindowViewModel`
- Architecture MVVM stricte : DI via `serviceProvider.GetRequiredService<T>()`, exclusion mutuelle UI (`CloseAllPanelsExcept()`), propagation contextuelle du `PdfPath`/`CurrentFilePath` à chaque outil sur changement d'onglet
- Découpage en sprints de 4-5 panneaux (= même doctrine narrow-scope que Code Buddy)
- **Zéro erreur de compilation au build final**
- Local : `D:\CascadeProjects\PdfCommander` (.NET, .sln + AGENTS.md + CLAUDE.md + COLAB.md + GEMINI.md = multi-IA convention en place)
- Journal : `journal/ministar-PdfCommander.md` (Antigravity, 03/05/2026)

→ La convention COLAB.md proposée par Lisa en avril est **empiriquement validée cross-vendor** (Anthropic + Google).

### 3. TurboQuant (DARKSTAR) — KV cache disk persistence livré

Réponse à la task assignée par Claude/Ministar Linux 01h45 UTC :
- Question #3 (cache disk persistence) implémentée + benchmarkée sur RTX 3090 → **12-36× speedup**
- Branche `feat/cache-disk-persistence` push sur `phuetz/TurboQuant`, PR pas encore ouverte
- Question #4 (cross-host KV shipping via A2A) **débloquée**
- Cf. `journal/darkstar-grok-cli.md` (commit `d53a467`)

### Roster IA actif

| IA | Domaine principal | Convention adoptée |
|----|-------------------|--------------------|
| Claude (Anthropic) | Architecture, code Rust/C#/TS, fleet inter-Claude, advisor | COLAB.md ✅ |
| Codex | Génération code, tests, implémentations TS/Python | COLAB.md ✅ |
| Gemini CLI | Volume, contenu long, livre Compagnon de Silicone | COLAB.md ✅ |
| **Antigravity (Google AI Ultra)** | **PdfCommander MVVM, archi C#** | **COLAB.md ✅ depuis 03/05** |

### Pour les autres Claudes du fleet qui pull

- Code Buddy `main` est à jour (`9ca5b7e`). Phases (d).12-14 disponibles ; lire les commit bodies pour le détail des nouvelles APIs (`/fleet send`, role config, depth cap).
- Hub Ministar Linux : restart systemd `codebuddy-a2a.service` requis pour récupérer les phases récentes côté server.
- DARKSTAR : peut maintenant register son spoke après réponse aux 2 UAC pending (firewall + Ollama).
- PdfCommander : C# / .NET / MVVM — pas de scope Claude pour l'instant, mais lire `journal/ministar-PdfCommander.md` pour comprendre l'archi si tu touches ce projet.

---

## GitNexus Chat — intégré au mono-repo gitnexus-rs le 2026-05-05
- **Local actuel** : `D:\CascadeProjects\gitnexus-rs-from-c\chat-ui\` (déplacé sur D: faute de place disque sur C:). Ancien chemin : `C:\Users\patri\CascadeProjects\gitnexus-rs\chat-ui\`. Ancien repo séparé : `D:\CascadeProjects\gitnexus-chat`.
- **Statut** : intégré comme subtree dans gitnexus-rs (PR #4 mergée 2026-05-05). 9 commits originaux préservés en historique git. V1.1 backend wiring + BackendStatus badge + a11y + prod-readiness skeletons (Docker/nginx) tous présents.
- **MàJ Codex 2026-05-12** : branche `codex/multi-llm-provider-choice`, commit `f7417e4` poussé. Ajoute choix LLM multi-provider, découverte dynamique Ollama/LM Studio, filtrage Tailscale des hosts disponibles, explorateur de sources renforcé, exports d'analyse, PDF natif en préparation, et bouton de reformulation du prompt.
- **Pourquoi mono-repo** : atomic commits cross-stack, single git clone pour clients agile-up, CI d'intégration possible, contrats SSE versionnés. Cf décision 2026-05-05 ("le repo séparé va poser problème").
- **Stack** : Vite 7 + React 19 + TS strict + Tailwind v4 + Zustand persist + react-markdown + lucide-react. License MIT.
- **Build** : `cd chat-ui && npm install && npm run dev` (port 5174, proxies /api /health /mcp vers `gitnexus serve --http 8080`).
- **Backlog priorisé** : `propositions/CHAT-V1-ROADMAP-2026-05-04.md` (P1 UX quick wins / P2 features / P3 nice-to-have / **🔵 Backend-coupled** = modifs Rust côté serve.rs : tool_call SSE events, sources structurées, repo strict 404, token usage, endpoint cancel).
- **Audits associés** : `propositions/CHAT-V1.2-AUDIT-2026-05-04.md` (bugs cachés/sécu/perf) + `CHAT-V1.3-PROD-READINESS-2026-05-04.md` (Docker, tests, a11y, DX).
- **Repo source archivé** : `D:\CascadeProjects\gitnexus-chat.archived-2026-05-05` (à renommer manuellement — encore busy au moment du merge).

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
- **Repo local actuel** : `D:\CascadeProjects\gitnexus-rs-from-c` (déplacement depuis C: faute de place disque).
- **Fix html_escape backtick** : ✅ committé sur master (5881c29)
- **Skill gitnexus** disponible dans Claude Code
- **feat/semantic-search** : ✅ mergée sur master 2026-04-26 (`166ca44`).
- **Master modernization wave A** : ✅ mergée 2026-05-05 (PR #3, 17 commits) — bincode retiré + clippy auto-fixes + enrichment knobs exposés via chat-config.json + chat P0/P1 livrés (hybrid BM25+semantic, 17 tools MCP exposés, DocChunks RAG, doc_sfd backend, recall_memory, MCP prompt recipes, ResearchPlan parallèle, feature-dev §4 Algorithmes).
- **chat-ui mono-repo** : ✅ intégré via subtree 2026-05-05 (PR #4) — voir bloc « GitNexus Chat » plus haut.
- **Wave B clippy** : ✅ mergée 2026-05-05 (PR #5) — `cargo clippy --workspace --all-targets -- -D warnings` exit 0 en local. CI Check & Clippy débloquée le jour où le billing GitHub Actions sera réglé.
- **SFD doc-authoring** : ✅ Phase 1 (PR #6 backend portable via `gitnexus-rag::sfd` + `LocalBackend::dispatch_tool`) + Phase 2 (PR #7 panel chat-ui : pages/drafts list, validation report) mergées 2026-05-05. Phase 3 (port Tauri) reportée.
- **Wave 1 chat-ui clients** : ✅ mergée 2026-05-05 (PR #8) — system prompt enrichi côté `ask.rs` (bénéficie aux 2 UIs), Mermaid SVG render, syntax highlighting Prism, Copy + Regenerate buttons.
- **Wave 2 chat tool calling** : ✅ mergée 2026-05-05 (PR #9) — `ask_question_with_tools` async (8 itérations max, dispatch via `LocalBackend::call_tool`), SSE typé `event: tool_call`, chat-ui badges inline (running/done/error). Le LLM invoque réellement les 30 tools MCP au lieu de juste consommer le contexte. Bénéfice partagé aux 2 UIs.
- **CI billing GitHub Actions** : ⚠️ payments failed → tous jobs CI fail en 3-11s avec annotation "spending limit". À régler par Patrice : https://github.com/settings/billing/spending_limit
- **PR #1 feat/ask-hybrid** : encore ouverte mais obsolète post merge (le module `gitnexus-search/src/fusion.rs` factorise déjà la pipeline). À fermer + redo en 1-2 commits qui délèguent à `fusion::hybrid_with_preloaded`.
- **Endpoint cancel** : prochaine itération facile post Wave 2 — `tokio_util::sync::CancellationToken` threadé dans `ask_question_with_tools` pour que l'AbortController côté chat coupe vraiment le job serveur. Plus de spawn_blocking depuis Wave 2 = chemin clair. ~30 min.
- **Kit USB portable V0** : ✅ mergée 2026-05-05 (PR #10) — `D:\CascadeProjects\gitnexus-kit-v0\` (756 MB) prêt pour intervention client agile-up. Contient gitnexus.exe + chat-ui dist + 2 modèles ONNX + Alise_v2 indexé (graph + embeddings + docs HTML). `GITNEXUS_HOME` env var override + serve.rs static fallback `<bin>/web/` + auto-rebuild registry au launch (drive letter agnostic). API key VIDE par sécurité. Fonctionne via `scripts/build-kit.ps1 -SeedRepo "<path>"`.
- **Kit V1 Ollama embarqué** : reportée — embarquer un modèle local (24 GB) pour 100 % offline. Utile quand client interdit cloud LLM. Patrice a validé cette direction le 2026-05-05.
- **Multi-LLM / local inference (Codex 2026-05-12)** : ✅ branche `codex/multi-llm-provider-choice` poussée (`f7417e4`). UI de configuration LLM, modèles locaux non codés en dur, tests DARKSTAR/Ministar Linux via Tailscale, LM Studio préparé, et réponse chat mieux verrouillée sur les fichiers réellement lus.
- **PDF natif / exports (Codex 2026-05-12)** : ✅ exports conversation/analyse durcis, chemin `native-print-pdf.js` côté MCP pour un PDF plus fidèle au rendu web, inspiré par l'étude MarkPress.
- **Qualité de prompt (Codex 2026-05-12)** : ✅ bouton de reformulation dans le chat ; prochaine étape = enrichir cette reformulation avec le profil GitNexus du dépôt courant.
- **Phase F** (sous-agents isolés dans le chat desktop) : reportée. 3-5 jours estimés.

## Lisa
- **Repo** : https://github.com/phuetz/Lisa (public)
- **GitNexusAgent ajouté** — Lisa peut interroger les graphes de code
- **WorldModelAgent** : en cours (Codex)

## Commander Suite
- **NexusFile** : D:\CascadeProjects\NexusFile — pre-1.0, feature-complete
- **NexusDiff** : D:\CascadeProjects\NexusDiff — tests ajoutés par Codex
- **TurboQuant** : D:\CascadeProjects\TurboQuant — implémentation arXiv:2504.19874. **KV cache disk persistence livré 03/05/2026** par Claude/DARKSTAR (12-36× speedup, branche `feat/cache-disk-persistence`).
- **CodeBuddy/grok-cli** : D:\CascadeProjects\grok-cli — orchestrateur multi-LLM. **Phases (d).6 → (d).14 livrées le 03/05/2026** (fleet inter-Claude opérationnel : auto-reconnect, backpressure, presence beacon, compaction notices, history, multi-peer fan-in, peer RPC, role taxonomy). Tests T1-T5 CRITIQUE livrés (≥93% coverage sur permission-modes, agent-context-facade, model-routing-facade, prompt-builder, infrastructure-facade).
- **PdfCommander** : D:\CascadeProjects\PdfCommander — .NET MVVM, hub IA + outils PDF classiques. **Premier projet majeur Antigravity** (Google AI Ultra IDE). 59 panels intégrés dans `MainWindowViewModel` le 03/05/2026 (50 IA + 9 outils classiques, zéro erreur de compilation au build final). DI via `serviceProvider`, exclusion mutuelle UI, propagation contextuelle. Convention multi-IA en place (CLAUDE.md + AGENTS.md + COLAB.md + GEMINI.md).

## Projets WSL (`\\wsl.localhost\Ubuntu-22.04\home\patrice\claude\`)
> MonArtisan et Office Suite ont leurs propres sections détaillées plus bas.
> Ici ne restent que vb6 et workflow, qui n'avaient pas encore été remontés.

- **vb6** — IDE web VB6 clone. React 18 + TS, Node backend.
  - Lexer/parser/semantic analyzer/transpiler/runtime, form designer 56+ controls, ~95% compat VB6
  - Repo : github.com/phuetz/VB6 (branche `main`)
  - `CLAUDE.md` complet, `AGENTS.md` présent

- **workflow** — Plateforme de workflow (clone n8n) sur WSL Ubuntu de MINISTAR. TS + Vite + Node + Prisma + BullMQ + Playwright.
  - Repo : github.com/phuetz/workflow (branche `main`)
  - **Avertissement explicite dans `CLAUDE.md`** : interdiction des scripts automatiques de correction (10+ régressions historiques). Corrections manuelles préférées.
  - `COLAB.md` v6.0.0 (2026-02-05) avec règles strictes : max 10 fichiers/itération, boucle de rétroaction typecheck→lint→test→build obligatoire après chaque modif
  - **2026-05-13** : comblement gap n8n (3 phases en une session). Moteur fiabilité (Wait persistant, crash recovery, retry/CB wirés), sandbox Code node, triggers polling (Gmail/RSS/DB), NDV 3-panneaux. 9637 tests passing, +15 nouveaux. Migration SQL `20260513_add_wait_resume_polling_pin` prête, pas encore déployée. Détails : `journal/ministar-workflow.md`. Parité estimée 72 → 88 %.

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

**Protocole** : **A2A (Google Agent-to-Agent)** embarqué dans Code Buddy — `src/protocols/a2a/index.ts` + `src/server/routes/a2a-protocol.ts`.

**POC Niveau 0 ✅ VALIDÉ (2 mai 2026)** :
- Hub permanent Ministar Linux live : `http://100.98.18.76:3000` (systemd `codebuddy-a2a.service`)
- Discovery endpoint `/api/a2a/.well-known/agent.json` répond ✅
- Cross-host validation depuis MINISTAR Windows (G7 PT) ✅
- Ollama spoke Ministar Linux live : `http://100.98.18.76:3002` (systemd `ollama-a2a-spoke.service`)
  - 4 models exposées comme skills (qwen3.6:35b, qwen3:4b, gemma4:26b, nomic-embed)
  - Prêt pour POC Niveau 1 (spoke registration)

**3 catégories de spokes** :
1. **Claude API spokes** — sessions Code Buddy / Claude Code sur chaque host. Reasoning lourd, advisor, planning.
2. **Ollama spokes** — `ollama_a2a_spoke.py` (~150 LOC, `world-model/scripts/`) transforme Ollama local en spoke A2A.
   - **Ministar Linux** : ✅ live (qwen3.6, qwen3, gemma4, nomic-embed)
   - **DARKSTAR** : à déployer (2× RTX 3090, stack vidéo-gen)
3. **Cloud API spokes** — Codex, Gemini ; proxifiés par host avec clés.

**Documents** :
- `propositions/CLAUDE-NETWORK-COLAB-2026-05-01.md` v0.2 — doctrine fleet (F1-F6, claim/release, spécialisation)
- `propositions/CLAUDE-NETWORK-A2A-POC-2026-05-01.md` v0.2 — tech + POC 0-6
- `journal/ministar-ubuntu-DEV.md` — sessions Ministar Linux (A2A hub + spoke setup)

**POC Niveau 1 (prochaine)** : spoke auto-register via `POST /api/a2a/agents/register` (~50 LOC Code Buddy). DARKSTAR can then discover + call Ministar Ollama skills.

**DARKSTAR pour Claude/DARKSTAR** :
1. Valide hub cross-host : `curl http://100.98.18.76:3000/api/a2a/.well-known/agent.json`
2. Déploie stack robot (plan dans `propositions/PLAN-DARKSTAR-INSTALL-2026-05-02.md`)
3. Reporte blockers (CUDA, NVLink, Lemonade NPU)

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
- **POC technique A2A** : `propositions/CLAUDE-NETWORK-A2A-POC-2026-05-01.md` (v0.2).
  - **Niveau 0 ✅ VALIDÉ** (1er mai 2026 nuit) : Code Buddy A2A hub live sur Ministar Linux (100.98.18.76:3000, systemd service `codebuddy-a2a.service`). Discovery endpoint `/api/a2a/.well-known/agent.json` répond. Cross-host validation : MINISTAR Windows confirmed GET AgentCard via Tailscale.
  - **Niveau 1** (prochaine étape) : spoke auto-register au hub via POST `/api/a2a/agents/register`.
  - **Niveau 2+** : task round-trip, skill execution, intelligent routing.
- **Canal de coordination par défaut** : ce repo `claude-et-patrice` (asynchrone via git push). Convention `propositions/<NOM>-YYYY-MM-DD.md` pour artefacts datés à valider.
- **Fix Code Buddy livré ce soir** : commit `5dac654` sur `phuetz/code-buddy:main` — `fix(tools): register advisor + ask_user_question in main tool-handler registry`. Rend les 2 tools V4.1/V4.3 reachable depuis le main agent loop (gap découvert pendant V4.4).
- **V4.4 ExitPlanMode** : parqué en working tree non-commité (fork architectural plan-mode/operating-modes — bridge A/B/C en attente d'arbitrage Patrice).
- **Premier ticket fleet** : Claude/Ministar Linux "stand up A2A hub permanent (systemd)" — **COMPLÉTÉ** ✅ 2026-05-01 nuit. Service systemd actif, cross-host validated, prêt pour DARKSTAR spoke onboarding demain.

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

## MySoulmate (D:\CascadeProjects\MySoulmate) — rejoint l'écosystème le 2026-05-11
- **Local** : `D:\CascadeProjects\MySoulmate` (branche `main`, remote `github.com/phuetz/...`). Statut working tree au moment de l'audit : `M apps/mobile/app.json` + `M apps/mobile/package.json` non commités, `node-v20.zip` (29 MB) et `node-v20.11.1-win-x64/` non trackés.
- **Stack** : monorepo npm workspaces. `apps/mobile` = Expo / React Native / expo-router (New Architecture enabled, typed routes). `apps/backend` = Express + Sequelize SQLite (port 3000 avec auto-fallback si occupé), Stripe, OpenAI direct, Swagger UI `/api-docs`, Prometheus `/metrics`, status monitor `/status`, rate limit 100 req/15 min, cron proactif (`src/services/cronService.js`). `packages/ui` exporte `UnifiedDesignTokens`. `packages/shared` est vide.
- **Cible** : app compagnon IA mobile complète (chat / voice / video / AR / gifts / journal / games / calendar / admin). Avatars MetaHuman UE5.6 streamés via Pixel Streaming WebRTC + contrôle WebSocket (serveur UE5 externe requis — features dégradent silencieusement sinon).
- **Place dans la vision robot 10 ans** : vitrine / terrain d'expérimentation des interactions compagnon (voix, vidéo, AR, gamification). Pas une brique du runtime robot lui-même — Lisa et le world-model gardent ce rôle. Probablement utile comme banc d'essai pour les patterns d'interaction qui finiront dans le robot.
- **État réel (audit Claude 2026-05-11)** : **prototype ambitieux présenté comme produit fini**. Le `README.md` clame "5/5", "100% prêt production", "AAA accessibility", "tests 100%", "consolidation terminée". La réalité du repo contredit ces affirmations :
  - **Doublons de services** dans `apps/mobile/services/` : `calendarService` vs `calendarServiceComplete`, `notificationService` vs `notificationServiceComplete`, `gamificationService*Complete`. Plusieurs design systems en parallèle (`Unified`, `Revolutionary`, `Modern`). Pattern typique de génération IA non nettoyée.
  - **Aucun test côté backend** (pas de script `test` dans `apps/backend/package.json`). Les seuls tests sont dans `apps/mobile/__tests__/` (jest), avec des seuils 95-100% qui ne reflètent pas l'état réel des autres workspaces.
  - **CI bidon** : `.github/workflows/nodejs.yml` fait `npm ci && npm test` à la racine, où le `package.json` racine n'a aucun script `test`. Le vert sur main ne prouve rien.
  - **Binaires Node commités** : `node-v20.zip` (29 MB) et `node-v20.11.1-win-x64/` à la racine du repo (vendored Windows runtime).
  - **README désynchronisé du filesystem** : il décrit l'ancienne arborescence plate (`app/`, `components/`, `services/` à la racine). Le code est en `apps/` + `packages/` depuis la migration monorepo.
  - **LLM service trompeur** : `apps/backend/src/services/llmService.js` *throw* si `OPENAI_API_KEY` est absente, malgré la promesse README d'un fallback (`FALLBACK_AI_URL`). Le mode factice a été désactivé sans mettre à jour la doc.
  - **Cron proactif env-driven** : en dev, schedule = chaque minute, threshold inactivité = 1 minute (vs 24h en prod). Surprise garantie si on découvre les notifications spammant en local.
  - **Traces de remédiation de masse** : `scripts/fix-all-typescript-errors.js`, `scripts/final-typescript-fix.js`, `cleanup-duplicates.ps1` à la racine = codemods one-shot de bugs résolus en bloc. Pas catastrophique, mais c'est un *signal*.
- **Livré 2026-05-11** : `CLAUDE.md` à la racine du repo MySoulmate (non committé), documentant la vraie structure monorepo, les commandes par workspace, l'architecture backend (versioning `/api/v1`, cron, LLM/Stripe/UE5), la résolution du `app.json → expo.extra.apiUrl`, et les pièges listés ci-dessus. C'est désormais la source de vérité technique du projet — préférer ce fichier au README.
- **Hors écosystème fleet/A2A** : pas de `COLAB.md`, pas de `journal/` dédié multi-IA dans le projet, pas connecté au hub A2A Ministar Linux. Si Patrice veut y impliquer plusieurs IA, créer un `COLAB.md` à partir du template canonique (`claude-et-patrice/COLAB.md`).
- **Priorités assainissement (si reprise)** :
  1. Sortir `node-v20.zip` et `node-v20.11.1-win-x64/` du repo + ajouter au `.gitignore` (commit de nettoyage seul).
  2. Consolider les doublons `*Service` vs `*ServiceComplete` (grep usages, garder la version wired, supprimer l'autre).
  3. Réparer la CI — soit ajouter un vrai script `test` racine qui boucle sur les workspaces (`npm test --workspaces --if-present`), soit passer à des jobs CI par workspace.
  4. Marquer le README comme "marketing" et pointer vers `CLAUDE.md` pour la doc technique, ou réécrire le README pour qu'il reflète la réalité (monorepo, état effectif des features).
- **Note pour les sessions futures** : sur ce projet, **faire confiance au `CLAUDE.md` et au code, pas au README**. Le `TODO.md` est aussi plus honnête que le README (des items admin/déploiement non cochés). Vérifier toujours quelle version d'un service doublonné est réellement importée avant de l'éditer.

### ⚠️ Correctif (même jour, 2026-05-11 plus tard) — l'analyse ci-dessus portait sur un fork local mort

En tentant de pousser un commit de nettoyage côté MySoulmate (commits `2498b22`, `c0eaae2`, `3e49258`), git a rejeté le push : le remote avait 20+ commits d'avance signés Patrice (i18n, voice calls, Redis, social feed, video calls avatar, voice cloning, etc.) sur l'**ancienne arborescence plate** (`app/`, `components/`, `services/`, `server.js` à la racine — comme dans le README). Le `main` local sur MINISTAR était sur une **migration monorepo** (`apps/mobile/`, `apps/backend/`, `packages/ui/`) qui n'a **jamais été pushée**, et sur laquelle Patrice avait continué à itérer localement (commits `1770aab` "save uncommitted work", `0508611` "Phase 15-17 Cron+ComfyUI+Store") du 5 au 8 mai. Les deux branches `main` ont divergé depuis `7c08bf6` (Merge PR #81, 14 juillet 2025) — 10 mois de drift silencieux.

**Décision Patrice 2026-05-11** : remote = vérité. Reset hard local sur `origin/main`. Travail local préservé via tag `claude-session-2026-05-11` (récupérable via `git show claude-session-2026-05-11`).

**Ce qui change dans l'analyse ci-dessus** :
- **Stack réelle** : pas monorepo. Architecture plate à la racine — `server.js` (Express), `app/(tabs)/` (Expo Router file-based), `components/`, `services/`, `context/`, `__tests__/`. SQLite dev / PostgreSQL prod auto-détecté via `DATABASE_URL`. Socket.IO pour WebRTC signaling.
- **Tests** : la suite Jest **fonctionne et passe** sur le remote — 101 suites, ~1573 tests, 0 failure, coverage 78% statements / 70% branches / 90% functions (cf. CLAUDE.md remote commit `2d4c968`). Pas "aucun test backend" comme dit ci-dessus.
- **CI** : workflow `ci.yml` officiel sur remote fait `npm ci` + `npm run lint` + `npm test -- --coverage` + `npm run typecheck` (continue-on-error). Pas le "bidon" mentionné.
- **Doublons de services** : le pattern `*ServiceComplete.ts` n'existe **pas** sur main remote — c'était dans le fork monorepo local. Le remote a ses propres choses (`services/*.ultra.ts`, 14 fichiers ~207 KB d'expérimental qui peut référencer Pinecone/Neo4j/TF non installés — documenté dans CLAUDE.md remote comme "Safe to ignore TypeScript errors").
- **README désynchronisé** : faux. Le README décrit l'archi plate qui est bien la vraie main. La fausse impression venait de mon orphan monorepo.
- **`node-v20.zip` / binaires Node** : présents en local uniquement (jamais trackés), pas sur main remote.

**Ce qui reste valable** :
- Le `llmService` qui throw sans `OPENAI_API_KEY` (signal en mai 2026 — à reconfirmer sur remote, peut-être déjà corrigé entre-temps)
- Le cron proactif env-driven (1 min en dev, 24h en prod)
- La dépendance à un serveur UE5 externe pour MetaHuman
- Pas de `COLAB.md`, pas connecté au hub A2A
- Le README est sur-vendu en marketing — mais sur la **bonne** archi

**Leçon écosystème** : 10 mois de drift `main` local vs `main` remote signés du même `phuetz`, jamais détectés. Pour MySoulmate spécifiquement : **toujours `git fetch && git status -uno` en début de session** avant d'analyser quoi que ce soit. Plus généralement : sur les projets de Patrice qui ont plusieurs machines/agents, le local peut être un fork de fait.

**Le vrai CLAUDE.md sur main remote** (commit `2d4c968`) est honnête et factuel : décrit l'archi plate, mentionne les "~3100 non-blocking TS errors", désigne `components/ui/DesignSystem.tsx v4.0` comme single source of truth (les anciens `UnifiedDesignSystem`, `CoreDesignSystem`, `RevolutionaryDesignSystem` sont marqués deprecated mais conservés), liste les "ULTRA Services" experimentaux. **C'est ce CLAUDE.md qu'il faut lire**, pas celui que j'avais créé en local sur l'orphan monorepo.
