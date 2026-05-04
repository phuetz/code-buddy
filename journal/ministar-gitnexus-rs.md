# Journal — MINISTAR · gitnexus-rs

Écritures depuis la machine `MINISTAR` (G7 PT, Windows) dans le working directory
`C:\Users\patri\CascadeProjects\gitnexus-rs`. Voir `../README.md` pour la convention
"fichier par source".

---

## 2026-04-29 — Ouverture du fichier + rôle coordinateur

Ouverture de mon journal de coordination. Patrice m'a confié hier soir le rôle
de coordinateur des sessions multi-IA (« je vais laisser cette session ouverte
c'est toi qui va coordonner tout »). Cette session vit dans `gitnexus-rs` mais
sa mission est plus large : tenir l'état général, briefer les autres Claudes,
maintenir la cohérence à travers les dépôts.

**Contexte** : panne Claude hier soir → Patrice s'est couché tôt → réveil 2h du
matin → reprise en mode plan + ultrathink. Trois chantiers livrés cette nuit
en autonomie pendant qu'il dort :

### Chantier 1 — Méthodologie Doc Q/R technique (claude-et-patrice/methodologie/)

Extraction de l'expérience Alise multi-barèmes (Reponses-Questions-Impacts-v7.pdf,
accueilli en réunion CCAS 28/04) en méthodologie réutilisable.

**Livrables** :
- `METHODOLOGIE-DOC-QR-TECHNIQUE.md` — 573 lignes, 9 sections, 9 pièges éprouvés
- `QUICKSTART.md` — démarrer un nouveau projet en 30 min
- `kit/` — 4 scripts Python génériques (build_qr_md / build_qr_pdf / build_companion / render_mermaid) + CSS qualité conseil + 3 cover templates + config schema + skeleton md + README kit

**Métriques** : 1 111 LOC Python (vs 2 783 LOC Alise originaux = -60% par compaction config-driven), 11 fichiers kit + 1 doc principal + 1 quickstart.

### Chantier 2 — Document propositions chat gitnexus-rs (claude-et-patrice/propositions/)

Audit du chat desktop via Explore agent (~45 fichiers / ~3500 lignes lus) +
comparaison vs Cursor / Claude Code / Cline → 15 propositions classées en
3 vagues avec effort/impact/justification chiffrés.

**Roadmap proposée** :
- **Vague A** (5 j/h, 1 sem) — quick unblocks (merge feat/semantic-search, memory cleanup, config UI, tool streaming)
- **Vague B** (12-15 j/h, 2-3 sem) — sub-agents Phase F + LLM-driven tools + streaming artifacts + cross-message context + error handling
- **Vague C** (25-35 j/h, 1-2 mois) — continuous docs (synergie méthodo) + graph-aware refactoring + dead code reports + VS Code plugin

**Statut** : `propositions/AMELIORATION-CHAT-GITNEXUS-2026-04-29.md` (315 lignes), à valider au matin par Patrice. Pas d'implémentation engagée.

### Chantier 3 — Capitalisation (etat_projets.md + journal + memory)

- `etat_projets.md` — ajout de 2 sections : « Méthodologie Doc Q/R technique » + « Roadmap chat gitnexus-rs »
- `journal/ministar-gitnexus-rs.md` — ce fichier
- (Bientôt) memory `methodology_doc_qr.md` — pour que je m'en souvienne dans les futures sessions

### État du repo `claude-et-patrice` après cette session

Avant : 75+ branches archivées, methodology absente, propositions chat absentes.

Après :
- `methodologie/` (nouveau dossier) — 13 fichiers
- `propositions/` (nouveau dossier) — 1 fichier (avec espace pour les briefs futurs)
- `etat_projets.md` — +2 sections
- `journal/ministar-gitnexus-rs.md` — nouveau

Tout en local pour l'instant. Push à valider par Patrice au réveil (discipline COLAB — la doc reste shared-write).

### Pour la prochaine session

- Si Patrice valide les propositions chat : créer les **briefs courts** par proposition Vague A (~2.5h estimé) dans `propositions/briefs/` selon le pattern `nuit_25avril_gitnexus.md`
- Vérifier que la branche `feat/semantic-search` est encore prête pour merge (bench, tests, no conflits avec master)
- Surveiller les sessions Claude parallèles via `git log` (notamment grok-cli qui a vu V2.C4 + V3.A + V3.C livrés ces jours-ci, V3.B encore ouvert)

---

*Coordinateur depuis 28-29/04/2026 (MINISTAR · gitnexus-rs).*

---

## 2026-05-04 — Modernisation gitnexus-rs (nuit, mode économie)

Patrice a lancé un "moderniser gitnexus-rs" avec **17% de limites Claude restantes** + reset dans 3h. Mandat : utiliser un max de tokens sans cramer pour rien.

### Plan initial annulé après diagnostic

Plan proposé : commit branche actuelle + merger `feat/semantic-search` (priorité haute selon `etat_projets.md`). **Plot twist** : `feat/semantic-search` est déjà mergée dans master (commit `166ca44`, antérieur au `etat_projets.md`). Tout le travail preflight (untrack artifacts, README, fix flag, fix flaky tempfile) est dans master depuis. La todo `etat_projets.md` était périmée.

### Pivot vers audit modernisation

Repivoté vers un audit + 2 quick wins + rapport pour demain.

**Pushé / mergeable demain** :
- **PR #2** — `feat/enrichment-config-exposure` ouverte (3 commits, exposition knobs enrichment dans chat-config.json)
- **PR #3** — `chore/modernization-quickwins` ouverte :
  - `605e4c5` retire `bincode` workspace dep (vestigial — aucun crate ne l'importe)
  - `cccb54a` applique `cargo clippy --fix` sur ingest/mcp/cli/desktop (11 fichiers, 22 inserts / 21 dels, idiomatique : `Iterator::last`→`next_back`, `get(0)`→`first`, `strip_prefix`, collapsible if, unused imports)
  - Plus `/next-steps.md` + `/questions/` ajoutés à `.gitignore`
  - Validé : `cargo check --workspace` clean, `cargo test --workspace --lib` = 626 passed / 0 failed / 1 ignored

### Inventaire audit

- **27 warnings clippy** au démarrage, exit 0 → ~12 après PR #3 (les restants ont besoin de décision humaine : refactor signature 8/7 args, type aliases, Default field assignment)
- **`bincode = "1"`** = seule dep workspace 100% unused (supprimée)
- **MSRV 1.75** → bump 1.80 envisageable (let_chains, lazy_cell)
- **axum 0.7 → 0.8** = candidat Vague C (touche `serve.rs` HTTP transport MCP)
- **Pin `cxx-build = "=1.0.138"`** confirmé sacro-saint (kuzu compat Windows LNK2019)

Rapport complet : `propositions/MODERNIZATION-GITNEXUS-2026-05-04.md` (3 vagues progressives A/B/C).

### Pour la prochaine session (Patrice au réveil)

1. **Rapide** : merger PR #2 et PR #3 si revue OK (`gh pr merge 2 --merge && gh pr merge 3 --merge`)
2. **Nettoyer** `etat_projets.md` : retirer ligne "merger feat/semantic-search" + item #2 "fix html_escape ✅"
3. Si envie de continuer : Vague B (12 warnings restants + MSRV 1.80 + petgraph 0.7) — détaillé dans le rapport
4. Installer `cargo-outdated` + `cargo-audit` pour les futurs audits

### Notes

- Tâche `Vague A: memory cleanup TTL+dedup` créée mais NON démarrée — risque de laisser un état intermédiaire avec si peu de tokens
- Conventions COLAB respectées : journal écrit ici (jamais dans monolithique), `git pull --rebase` avant écriture
- Contexte humain : Patrice voulait rentabiliser ses limites avant reset hebdo, pas démarrer une grosse refonte. Mandat tenu — 2 PRs prêtes + roadmap claire pour qu'il démarre frais demain.

— *Claude Opus 4.7 (1M context), nuit 03→04 mai 2026, MINISTAR.*

---

## 2026-05-04 — Démarrage projet `gitnexus-chat` (suite de la nuit)

Patrice a redirigé : "si y a un problème de licence, développe notre propre version en React". Décision actée : option (1) du rapport `CHAT-OPENWEBUI-2026-05-04.md` = web app standalone séparée du desktop, MIT license, commercialisable agile-up.

Mode plan utilisé pour scoper. Plan validé immédiatement, exécution en 6 étapes.

### V0 livré

Path : `D:\CascadeProjects\gitnexus-chat\` — git init local, **pas de push GitHub** (à confirmer demain).

| Étape | Fait |
|---|---|
| 1. Init Vite | `npm create vite@latest . -- --template react-ts` + `npm install` (153 packages) |
| 2. Tailwind v4 + deps | `tailwindcss @tailwindcss/vite zustand react-router-dom react-markdown remark-gfm lucide-react clsx` |
| 3. Structure | 13 fichiers source : ChatPanel/ChatSidebar/ChatMessages/ChatMessage/ChatInput/Markdown + use-chat.ts + chat-store.ts (Zustand persist) + mcp-client.ts mock + types/chat.ts |
| 4. Mock chat flow | sendMessage → store → faux delay 800ms → canned response markdown. Persist localStorage OK. |
| 5. Docs | README.md (roadmap V0→V3) + LICENSE MIT + CLAUDE.md + COLAB.md |
| 6. Git | `git init -b main`, commit `6f74bac` "feat: initial scaffold (Vite 7 + React 19 + TS strict + Tailwind v4)" |

**Build clean validé** : `tsc -b && vite build` = 357 KB / **110 KB gzip**. Un fix TS strict (`erasableSyntaxOnly` interdit les parameter properties) résolu en cours de route.

### Choix arrêtés (cohérents avec le desktop)

- Stack identique au desktop (React 19 + Tailwind v4 + Zustand)
- Port dev `5174` (pour ne pas collisionner avec gitnexus-desktop sur 1421 ni Vite par défaut 5173)
- License MIT (vs PolyForm-NC du gitnexus-rs) — commercial-friendly
- Backend visé V1 : `gitnexus serve --http 8080` (HTTP transport MCP existant)
- Alternative à Open WebUI sans copier code (stack incompatible Python+Svelte → React, et licence OWUI fair-source bloquante)

### Pour le réveil de Patrice

1. `cd D:\CascadeProjects\gitnexus-chat && npm run dev` → http://localhost:5174 → vérifier UI
2. Tester : "Nouvelle conversation" → taper un message → recevoir mock response → reload → message persisté ✓
3. Si OK : décider si on push GitHub `phuetz/gitnexus-chat` (public ou privé d'abord ?)
4. Démarrer V1 = brancher backend réel

### Total session 2026-05-04 (vue d'ensemble)

3 livrables PRs/branches pushés sur `phuetz/gitnexus-rs` :
- PR #2 enrichment-config-exposure
- PR #3 modernization-quickwins (bincode + clippy + fmt)

3 docs publiés sur `phuetz/claude-et-patrice` :
- `propositions/MODERNIZATION-GITNEXUS-2026-05-04.md`
- `propositions/CHAT-OPENWEBUI-2026-05-04.md`
- `etat_projets.md` mis à jour avec section gitnexus-chat

1 nouveau projet local : `D:\CascadeProjects\gitnexus-chat\` V0 squelette commité (pas pushé GitHub).

### Audit post-V0 (mode plan)

Patrice a demandé un audit "tout est complet ?". Audit lecture-seule via plan mode → 4 trous moyens trouvés (doc vs code) :

1. README/CLAUDE.md disaient "TypeScript strict" mais `"strict": true` absent du tsconfig
2. README mentionnait Shiki (pas installé en V0)
3. `package.json` version 0.0.0 vs README "v0.0.1"
4. `index.html` lang="en" + title "gitnexus-chat" alors que UI française

Plus 1 mineur : pas de `.env.example` documentant `VITE_MCP_URL`.

Tous fixés en commit `f68db9d` :
- `"strict": true` ajouté dans tsconfig.app + tsconfig.node, build reste clean 110 KB gzip
- Mention Shiki déplacée en V2 roadmap
- Bump 0.0.0 → 0.0.1
- `lang="fr"` + `<title>GitNexus Chat</title>`
- `.env.example` créé

`git log --oneline` gitnexus-chat : 2 commits propres (`6f74bac` scaffold, `f68db9d` audit fixes).

— *Claude Opus 4.7 (1M context), 03→04 mai 2026, MINISTAR.*
