# Code Buddy 2 — Vision & 10 innovations (2026-07-15)

> Audit prospectif : où en est Code Buddy 1.1, qu'est-ce qui l'empêche de dominer,
> et quelles 10 innovations font de Code Buddy 2 un produit qui surpasse
> Claude Code, Cursor, OpenAI Codex CLI, Gemini CLI, Devin et Windsurf.
> Chaque innovation est découpée en vague Codex autonome (spec dans `~/cb2-<slug>/SPEC-CB2.md`,
> branche `cb2/<slug>`), développée par **Codex gpt-5.6-sol**.

## 1. Audit — état des forces (V1.1)

Ce que Code Buddy a déjà et que AUCUN concurrent n'offre en un seul produit :

| Atout | Où | Équivalent concurrent |
|---|---|---|
| Fleet multi-AI (peers qui s'observent et s'invoquent) | `src/fleet/` | aucun |
| Auto-amélioration gatée (tools/skills/lessons authored) | `src/agent/self-improvement/` | aucun |
| Mémoire collective bi-temporelle (CKG + moteur Rust) | `src/memory/collective-knowledge-graph.ts`, `buddy-memory/` | aucun |
| Perception (vision/audio/écran) + companion vocal Lisa | `buddy-sense/`, `src/sensory/`, `src/companion/` | aucun |
| Coût marginal $0 (OAuth ChatGPT/xAI + local Ollama) | `buddy login`, routing | Codex CLI (partiel) |
| Gates de preuve (Verifier, diff-review fail-closed, dev-loop) | `src/review/`, `src/agent/dev-loop/` | aucun |
| Council multi-modèles avec scoreboard appris | `src/council/` | aucun |
| Studios média (film, vidéo, voix, widgets) | `src/agent/film/`, `src/tools/video/` | aucun |

## 2. Audit — faiblesses structurelles

Mesures (audit du 2026-07-15) : `src/` = 2 226 fichiers / 792 K lignes, **28 fichiers
> 1 500 lignes** (pire : `agentic-coding-runner.ts` 8 551 l, `computer-control-tool.ts`
6 587 l, `index.ts` 3 709 l) ; Cowork : `preload/index.ts` **9 644 l / 677 appels IPC**,
`gui-operate-server.ts` 6 883 l. `src/knowledge/` (le knowledge graph, différenciateur
clé) = **29 fichiers, 0 test**. Duplication `src/`↔`cowork/src/` déjà divergente
(`retry.ts`, `result-aggregator.ts`, `model-routing.ts`). ~30 endpoints serveur inline
sans `requireScope`. Renderer principal 3,15 Mo, node_modules 2,8 Go. Bon point : la
dette n'est pas éparse (87 TODO sur 792 K lignes) mais **structurelle** ; le transport
(`client.ts`, `context-manager-v2.ts`) est propre — la fragilité est dans l'orchestration.

Synthèse (détail mécanique dans `2026-07-15-codex-backlog.md`, qui reste le backlog
de maintenance — les vagues CB2 n'y touchent pas) :

1. **Périmètre géant, découvrabilité faible** — ~110 tools, dizaines de commandes,
   features opt-in par env vars : la puissance existe mais ne se voit pas.
2. **Le cœur propose, il ne prouve pas encore _avant_ d'écrire** — le diff-review gate
   vérifie la forme, le Verifier vérifie _après_ ; rien n'exécute le code proposé
   _avant_ qu'il ne touche le working tree.
3. **Compaction avec perte** — `ContextManagerV2` résume et jette ; pas de retour
   exact vers un segment compacté.
4. **Mémoire collective mono-machine** — le CKG est partagé entre process locaux,
   pas entre les pairs de la fleet.
5. **Mono-repo** — le contexte JIT, Code Explorer et l'impact s'arrêtent aux
   frontières du repo courant.
6. **Le produit ne se mesure pas dans le temps** — le capability-benchmark ne tourne
   que dans la boucle self-improve ; aucune courbe de capacité par modèle/provider.
7. **Les sessions sont des journaux, pas des états** — on peut relire, pas rebrancher.
8. **Dette de sécurité serveur** (scopes inline, path traversal mobile, rate-limit XFF)
   — traitée par le backlog maintenance, pré-requis de crédibilité commerciale.
9. **Cowork : 53 erreurs tsc**, e2e du composeur désactivé — vitrine fragile.
10. **L'intention n'est pas versionnée** — le « done » du dev-loop est prouvé contre
    des critères éphémères, pas contre une spec qui vit avec le code.

## 3. Les 10 innovations de Code Buddy 2

### INNOV-1 — Shadow Workspace : exécution spéculative (`cb2/shadow-workspace`)
Chaque écriture proposée est d'abord appliquée dans un **worktree fantôme** où
typecheck + tests ciblés s'exécutent ; le diff n'atteint le vrai working tree que
prouvé vert. L'agent ne propose plus du code plausible, il propose du code **déjà validé**.
Opt-in `CODEBUDDY_SHADOW_WORKSPACE`. Personne (Cursor y a renoncé en CLI) ne l'a.

### INNOV-2 — Time-Travel Sessions (`cb2/time-travel`)
Timeline persistée de chaque tour (messages, tool calls, diffs, checkpoint id) ;
`buddy replay <session> --at N` re-matérialise l'état exact (fichiers + contexte)
et `--fork` ouvre une branche de session. Les concurrents ont des logs ; CB2 a des
**états navigables**.

### INNOV-3 — Intent Ledger : la spec vivante (`cb2/intent-ledger`)
Toute tâche non triviale génère une **spec falsifiable versionnée**
(`.codebuddy/intents/`) ; le Verifier du dev-loop s'y adosse ; `buddy intents drift`
détecte la dérive code↔spec en continu. Le « done » devient un contrat, pas une opinion.

### INNOV-4 — CKG fédéré (`cb2/ckg-federation`)
Le ledger CKG se synchronise entre pairs de la fleet (`peer.ckg.sync`, delta-based,
provenance par peer, corroboration cross-agents déjà native). Ce qu'un agent apprend,
**toute la flotte le sait**. Fail-closed, opt-in, allowlist de types de nœuds.

### INNOV-5 — Self-Benchmark nightly (`cb2/self-benchmark`)
Le banc de capacité tourne en tâche de fond planifiée, score chaque modèle/provider
actif, historise (JSONL), détecte les régressions de capacité et alimente le
ModelScoreboard. **Le seul agent qui sait quand il devient plus bête** — et qui
re-route en conséquence.

### INNOV-6 — Contexte hiérarchique zoom-in (`cb2/context-zoom`)
La compaction devient **sans perte récupérable** : les segments compactés sont
archivés indexés, un tool `context_expand` permet au LLM de dézoomer un segment
précis à la demande. Résumé de résumés + rappel exact = contexte quasi illimité.

### INNOV-7 — GUI générative par défaut (`cb2/generative-ui`)
Généralisation des widgets génératifs : toute réponse structurée peut produire son
**interface server-rendered** (tableaux interactifs, dashboards, formulaires) inline
dans Cowork, réutilisable comme un skill. L'app qui fabrique son UI.

### INNOV-8 — Pair-programming perceptif (`cb2/perceptive-pair`)
Le screen-sense (déjà câblé) apprend à reconnaître les **situations d'erreur à
l'écran** (stack trace, terminal rouge, dialog d'erreur) et propose de l'aide
proactive (voix/notification), débouncée et opt-in. L'agent qui **voit que tu bloques**.

### INNOV-9 — Skill Exchange signé (`cb2/skill-exchange`)
Export/import de skills authored avec **manifeste signé** (hash, provenance,
re-scan firewall à l'import), registre git partageable, stats d'usage. La brique
de l'écosystème — et de la monétisation.

### INNOV-10 — Workspace multi-repo (`cb2/multi-repo`)
Un `workspace.json` fédère N repos ; le contexte JIT, la recherche et l'impact
deviennent **cross-repo**. L'agent raisonne sur l'écosystème entier
(code-buddy + gitnexus-rs + NexusFile…), pas sur un dossier.

## 4. Pourquoi ça surpasse les concurrents

- **Claude Code / Codex CLI / Gemini CLI** : excellents exécutants mono-session,
  mono-repo, sans perception, sans mémoire collective, sans preuve pré-écriture.
  CB2 les dépasse sur INNOV-1/2/3/4/6/10.
- **Cursor / Windsurf** : IDE-centrés, cloud-first, pas de voix, pas de fleet,
  pas d'auto-amélioration. CB2 les dépasse sur INNOV-5/7/8/9 + le $0 local.
- **Devin** : cloud opaque et cher. CB2 est local-first, prouvable (gates),
  extensible (skills signés) et gratuit à la marge.

## 5. Exécution — vagues Codex gpt-5.6-sol

- 1 innovation = 1 worktree `~/cb2-<slug>` + branche `cb2/<slug>` depuis `main`,
  spec complète dans `SPEC-CB2.md`, développée par `codex exec` (gpt-5.6-sol,
  `--dangerously-bypass-approvals-and-sandbox`), logs dans `~/cb2-logs/`.
- Watchdog anti-stall (le backend Codex cale parfois à 0 % CPU — mémoire du
  2026-07-05) : relance idempotente si le log gèle > 15 min, 3 relances max.
- Règles communes imposées par les specs : opt-in par env var (défaut = zéro
  changement de comportement), ESM `.js`, `logger`, tests dans `tests/`,
  Conventional Commits, `npm run typecheck` + tests ciblés verts avant commit.
- Intégration : revue humaine (Patrice) branche par branche, puis merge → `main`
  comme les campagnes précédentes (technique Genspark, mémoire 2026-07-05).
