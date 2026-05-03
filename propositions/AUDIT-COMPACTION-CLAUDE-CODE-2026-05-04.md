# Audit comparatif compaction — Claude Code source vs Code Buddy

> **Date** : 2026-05-04 (nuit du 03→04)
> **Auditeur** : Claude Sonnet/Opus 4.7 sur MINISTAR via session Code Buddy
> **Contexte** : Patrice a étudié le code source Claude Code (publié il y a ~1 mois par un dev Anthropic, ~50000 forks GitHub) et m'a demandé de comparer la compaction de conversation entre Claude Code et notre `SmartCompactionEngine` Code Buddy. Audit read-only, ciblé compaction, pour informer les phases suivantes.

## Sources comparées

| Côté | Path |
|------|------|
| **Claude Code (référence)** | `D:/CascadeProjects/claude-code-source-code-main/src/commands/compact/` + `src/services/compact/` |
| **Code Buddy (notre actuel)** | `D:/CascadeProjects/grok-cli/src/context/smart-compaction.ts` + `context-manager-v2.ts` + `transcript-repair.ts` |

---

## 1. Trigger auto-compact

| | Claude Code | Code Buddy |
|---|-------------|-----------|
| Calcul | `getAutoCompactThreshold(model) = contextWindow − AUTOCOMPACT_BUFFER_TOKENS (13_000)` | `autoCompactPercent` ou `autoCompactThreshold` (tokens absolus) |
| % effectif typique | ~78–82% du context window | ~85% (default `CODEBUDDY_AUTOCOMPACT_PCT`) |
| Override env | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `CODEBUDDY_AUTOCOMPACT_PCT` |
| Per-model | **OUI** — buffer fixe de 13K + réserve dynamique de sortie soustraite | **NON** — % fixe global |

**Différence-clé** : Claude Code = buffer fixe + réserve sortie dynamique → adaptatif par modèle. Code Buddy = % fixe global → prédictif mais moins fin sur petits/gros context windows.

## 2. Stratégie de compaction

| | Claude Code | Code Buddy |
|---|-------------|-----------|
| Approches | 3 chemins selon flag `REACTIVE_COMPACT` : (1) Session Memory rapide, (2) Reactive streaming LLM, (3) Legacy microcompact + LLM | 4 stratégies déterministes : `truncate` (<20% reduction), `hybrid` (20-50%), `summarize` (50-70%), `aggressive` (>70%) |
| Sélection | Préfère TOUJOURS summarize (ou session-memory), truncate en fallback PTL retry épuisé | `determineStrategy(currentTokens, targetTokens)` calcule ratio puis choisit |
| Modèle de summarize | Claude lui-même via `queryModelWithStreaming` | Probablement Claude aussi via `EnhancedContextCompressor` |

**Différence-clé** : Claude Code = réactif, un chemin optimal à la fois (LLM toujours préféré). Code Buddy = proactif, sélection déterministe selon ampleur du déficit. Code Buddy est plus prévisible ; Claude Code plus flexible mais plus coûteux en API si reactive.

## 3. Préservation de messages

| | Claude Code | Code Buddy |
|---|-------------|-----------|
| System prompt | Toujours conservé (rebuilt depuis options + tools) | `preserveSystem: true` (config) |
| Tool definitions | Réinjecté **post-compaction** via `POST_COMPACT_SKILLS_TOKEN_BUDGET` (25K) | Conservé via `preserveToolCalls: true` (config) |
| Recent conversation | Via `getMessagesAfterCompactBoundary` (concept) | `minMessages: 4` (config) |
| Last tool_call+tool_result | **Implicitement conservé** si dans messages gardés (pas de rule spécifique) | Validation amont via `validateToolCallOrder()` + `transcript-repair.ts` (post) |
| Images/documents | Strippées avant summarize, markers `[image]` injectés | Pas de logique image-specific visible |
| Files (read results) | Diff-against-preserved : réinjecte SEULEMENT les nouveaux fichiers post-compact | Pas trouvé d'équivalent |

**Différence-clé** : Claude Code = granulaire, **réinjecte dynamiquement post-compact** (skills, files). Code Buddy = stricte en amont (validate avant) + repair en aval (transcript-repair pour orphan tool results). Claude Code accepte plus de "perte temporaire" ; Code Buddy prévient les orphans dès la validation.

## 4. UX pendant compaction

| | Claude Code | Code Buddy |
|---|-------------|-----------|
| Feedback | Tightly coupled UI : `onCompactProgress`, `setStreamMode('requesting')`, `setSDKStatus('compacting')` | Loosely coupled : EventEmitter `compaction:start`/`:strategy`/`:complete` |
| Preview avant apply | **NON** — affichage post-fait via `userDisplayMessage` | **NON** explicite |
| Undo | **NON** (mais `abortController` permet annulation en-cours) | **NON** (stateless) |
| Spinner/progress | `chalk.dim` text discret + suggestion "you could upgrade model" | À charge du listener (UI ou bridge fleet (d).10) |
| Warning thresholds | Pas trouvé | `warningThresholds` + `triggeredWarnings: Set` (warn proactif avant compact) |

**Différence-clé** : Claude Code montre "en direct" via callbacks UI. Code Buddy notifie post-facto via events. Code Buddy a déjà des warnings proactifs (avantage). Aucun ne propose preview/undo.

---

## Files clés cités

**Claude Code source** :
- `src/commands/compact/compact.ts:230–248` (buildDisplayText, UX feedback)
- `src/services/compact/autoCompact.ts:72–91` (trigger threshold logic)
- `src/services/compact/compact.ts:145–200` (image strip, preservation)

**Code Buddy** :
- `src/context/smart-compaction.ts:153–239` (main compact logic + 4 strategies)
- `src/context/smart-compaction.ts:366–379` (determineStrategy)
- `src/context/context-manager-v2.ts:42–67` (config + thresholds)
- `src/context/transcript-repair.ts` (orphan tool result repair)
- `src/fleet/compaction-bridge.ts` (Phase (d).10 — fleet broadcast des events)

---

## 3 améliorations actionnables narrow

### #1 — Adaptive buffer tokens per model — *scope M*
**Pourquoi** : Claude Code soustrait 13K + réserve dynamique de sortie ; Code Buddy utilise un % fixe global. Les gros modèles (Claude 3.5 Sonnet 200K) laissent plus de slack inutile (~15K reserve gaspillée), petits modèles (Claude 3 Haiku 100K) manquent de marge.

**Comment** : Refactor `getAutoCompactThreshold()` pour lire `model.contextWindow` et appliquer buffer proportionnel OU lookup table (`{ 'claude-sonnet-4-6': 13_000, 'claude-haiku-4-5': 8_000, 'gemini-2.5-flash': 10_000, 'grok-3': 12_000, ... }`). Config : ajouter `autoCompactBufferTokensByModel?: Record<string, number>`.

### #2 — Preview mode before apply — *scope M*
**Pourquoi** : Ni Claude Code ni Code Buddy n'offrent "voir le résumé avant remplacement". Users risquent de perdre du contexte crucial. Claude Code réinjecte post-facto (skills, files), Code Buddy résume seulement. Preview = dry run avec résumé affiché + ACK user.

**Comment** : Option config `previewCompaction?: boolean`. Si vrai, appeler summarize, émettre event `compaction:preview` avec le résumé candidat, attendre user ACK (slash `/compact-confirm` ou `/compact-cancel`) avant apply effectif. Auto-apply après timeout configurable (default 30s).

### #3 — Unified `lastToolCall+toolResult` preservation rule — *scope S*
**Pourquoi** : Code Buddy skip les orphans via `validateToolCallOrder()`, mais ne **garantit pas** que la dernière paire tool_call+tool_result reste intacte si truncation des last N messages coupe au milieu.

**Comment** : Dans `truncateMessages()` (smart-compaction.ts:384+), après sélection des messages à garder, scanner from end pour trouver la dernière paire `(assistant.tool_use → tool_result)` et étendre le set de retention pour l'inclure entièrement. Pattern : "anchor on last tool boundary, extend retention if needed".

---

## Recommandation pour Patrice

Ordre d'attaque suggéré (du plus narrow au plus structurant) :

1. **#3** (S) — fix narrow, low risk, ferme une vraie possibilité de bug. ~120 LOC + 8 tests. **Premier ship recommandé.**
2. **#1** (M) — table lookup + config. ~200 LOC + 12 tests. Aligne notre threshold avec la sophistication Claude Code.
3. **#2** (M) — UX feature, plus visible. ~250 LOC + 15 tests. Améliore la confiance user dans la compaction (debug + audit).

Total cumul : ~600 LOC + 35 tests si on fait les 3 ; ~1.5 séances narrow réparties.

## Notes pour les autres Claudes du fleet

- Claude Code source dispo localement sur G7 PT (= MINISTAR Windows) : `D:/CascadeProjects/claude-code-source-code-main/`
- Patrice ne fait PAS de copier-coller — étude inspirationnelle seulement
- Cette compaction n'est PAS le bottleneck immédiat de Code Buddy ; les 3 améliorations sont qualité/UX, pas correctness
- L'infra fleet inter-Claude (Phases (d).6 → (d).16a, livrées 2026-05-03 + push) reste le chantier principal

---

*Audit complété en ~600 mots de rapport (Explore agent), formaté en doc structuré pour archive fleet.*
