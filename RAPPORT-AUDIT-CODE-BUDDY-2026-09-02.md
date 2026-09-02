# Audit de fiabilité Code Buddy — 2026-09-02

Dépôt : `/home/patrice/DEV/code-buddy-audit`, branche `audit-complet` (base `b50d4d6f5`).
Critère directeur : **ce qui casse, ment ou gêne dans l'usage quotidien réel.**
Méthode : quatre enquêtes parallèles ciblées (outils, fournisseurs, mémoire/compaction,
ressources 24/7) + vérifications transverses (gardes orphelines, seuils, démarrage, run
headless réel sur Ollama local), **preuve par exécution exigée** pour tout défaut « avéré » ;
correctifs **rouge → vert** pour ce qui était corrigeable sans risque. Aucun appel LLM payant,
aucun contact avec `/home/patrice/code-buddy` (production) ni `~/.codebuddy`.

État final : `npm run typecheck` vert ; suites ciblées vertes (mémoire 195, codebuddy 248,
fleet 624, companion 469, tools complet, tool-surface 4/4) ; ESLint sur les fichiers touchés :
0 erreur ; 6 commits nommés (voir §3).

---

## 1. Ce que j'ai regardé — et ce que j'ai délibérément laissé de côté

### Regardé (et pourquoi)

| Zone | Raison |
|---|---|
| Mémoire persistante + compaction (`src/memory/`, `src/context/`) | Perdre un souvenir sans le dire est le pire défaut d'un compagnon ; seul l'oubli Ebbinghaus avait été audité. 12 preuves d'exécution (round-trips réels). |
| Couche fournisseurs (`src/codebuddy/`, 15 providers) | Un basculement silencieux est un faux succès coûteux. 14 preuves avec `fetch` mocké (429, stream coupé, JSON malformé). |
| Les ~110 outils (`src/tools/`, `src/codebuddy/tool-definitions/`) | Motif « enregistré d'un côté, jamais consommé de l'autre ». Croisement mécanique par script des 4 sources (définitions LLM, dispatch, registres, métadonnées) + exécutions réelles. |
| Ressources longue durée (`src/server/`, `src/fleet/`, compléments `src/companion/`) | `buddy server` tourne des semaines chez toi. Balayage timers/appends/tableaux + preuves de croissance. |
| Gardes exportées jamais appelées (tout `src/`) | Famille n°2. Scan mécanique puis tri manuel des candidats sérieux. |
| Usage réel | Démarrage CLI mesuré ; run headless réel sur `qwen3.8-ctx32k` (Ollama local, $0) : trivial et agentique. |

### Laissé de côté (et pourquoi)

- **`src/sensory/` + cœur `src/companion/`** — audité en profondeur le 2026-09-01 (15 défauts corrigés, 480 tests verts). J'ai seulement cherché ce que cet audit avait manqué : trouvé `safety-ledger` sans rotation (corrigé) et `percepts`/rotations déjà traités.
- **Boucle agentique `agent-executor.ts`** — audit CB16 du 2026-08-25 (6 défauts corrigés). Non refait ; j'ai vérifié par exécution les chemins adjacents (sélection d'outils, sanitisation indirectement via suites).
- **UX/messages d'erreur CLI** — DEFAUTS-UX / DEFAUTS-ERREURS du 2026-08-25, frais.
- **Cowork (GUI Electron)** — RAPPORT-AUDIT-COWORK-2026-08-30 existe ; app séparée.
- **`buddy-sense/`, `buddy-vision/`, `buddy-memory/` (Rust/Python)** — dépendants du matériel, hors périmètre TS ; le côté TS de ces ponts a été couvert.
- **Self-improvement, council, science, film** — opt-in default-off (byte-identical sans env var) : un défaut y gêne moins le quotidien. Exception : le seuil « film muet » cité en exemple est **déjà corrigé** (`src/tools/video/film-project.ts:361`).
- **`npm test` complet (~27K)** — trop long ; suites ciblées des zones modifiées à la place.
- **Sécurité offensive** (injection, sandbox escape) — hors mandat fiabilité.

---

## 2. Les défauts, classés par gêne quotidienne réelle

Tous « avérés » = démontrés par exécution (sortie collée ou test committé). `fichier:ligne`
sur l'état de base ; « ✅ corrigé » renvoie au §3.

### Gravité 1 — le compagnon perd ou invente des souvenirs

**1.1 ✅ `remember()` répondait « Stored » en jetant le souvenir** — `src/memory/facts-memory.ts:199` + `src/memory/persistent-memory.ts:431-492`.
Le `catch` de la réconciliation LLM retournait `currentFacts` **sans le nouveau fait** ; l'appelant annonçait `stored`. Preuve e2e : `status: stored`, `recall: null`, `on disk: false`. Comme `codex-auth.json` existe chez toi, **chaque** `remember` passait par ce chemin : toute erreur réseau/quota = souvenir perdu avec confirmation positive. C'est le cousin exact du bug STT d'hier.

**1.2 ✅ Valeur multi-ligne : tout sauf la 1ʳᵉ ligne perdue au redémarrage** — writer `persistent-memory.ts:1102` vs parseur `:350-357`. Preuve : `WROTE "ligne 1\nligne 2 CRUCIALE\n…"` → `READ "ligne 1 importante"`. Invisible en session (Map RAM complet), visible au prochain boot.

**1.3 ✅ Tags jamais re-parsés — `pinned` ne protégeait plus rien après restart** — `persistent-memory.ts:1103-1105` écrit `  Tags: …`, aucune branche de parse : refondus dans la valeur au 1ᵉʳ reload, détruits au 2ᵉ (avec 1.2).

**1.4 ✅ Amnésie totale sur erreur de lecture transitoire** — `persistent-memory.ts:287-289`. Fichier illisible au chargement (EACCES…) → « start fresh » silencieux → le save suivant réécrivait tout le fichier depuis l'état vide. Preuve : historique remplacé par le gabarit + le seul nouveau souvenir.

**1.5 ⚠️ AVÉRÉ, non corrigé — la réconciliation LLM a le droit de SUPPRIMER des souvenirs, sans archive** — `facts-memory.ts:181-196` (action `DELETE` appliquée telle quelle), `persistent-memory.ts:433` (`memories.clear()` + repopulation), et le même schéma dans `autoCapture` (`:1223-1248`, **à chaque tour de conversation**). Preuve : LLM mocké renvoyant des DELETE → 2 souvenirs préexistants (« répondre en français », « garder ESM ») détruits définitivement. Ce chemin contourne TOUTES les protections de l'oubli Ebbinghaus (archive, fail-closed, `preferences`/`pinned` épargnés). Effets annexes prouvés : clés renommées (`fact-<ts>` si `colonIdx≥50`), tags écrasés. *Non corrigé car c'est une décision de conception (interdire DELETE ? l'archiver ?) — recommandation en §4.*

**1.6 ⚠️ AVÉRÉ — memory.md : dernier-écrivain-gagne entre serveur 24/7 et CLI** — `persistent-memory.ts:1066-1143` (réécriture complète sans verrou ni tmp+rename), aggravé par `flushAccessMetadata` (`:700-735`, un simple `recall` déclenche un save complet 10 s plus tard). Preuve : deux instances, A écrit, B écrit → le souvenir de A disparaît. `session-store.ts` a réglé ce bug exact avec `withSessionLock` ; la mémoire, plus précieuse, ne l'a pas.

**1.7 ⚠️ AVÉRÉ — les outils mémoire ignorent le cwd de session** — `src/tools/registry/memory-tools.ts:31,156,398,484` (`getMemoryManager(undefined, botId)`, jamais `context.cwd`) + `persistent-memory.ts:69` (chemin projet relatif à `process.cwd()`). Preuve : `remember` avec `context.cwd=<tmp>` → succès annoncé, écrit dans le `.codebuddy/` du process. Touche Cowork, `buddy server`/voix (cwd systemd), sessions après `cd`. `lessons_propose`/`user_model_observe` ont reçu ce correctif (`lessons-tools.ts:51`), memory-tools non. *Non corrigé : 23 consommateurs partagent le singleton (prompt-builder compris) — un keying par cwd partiel créerait une divergence écriture/lecture pire que le statu quo. Chantier à part entière.*

### Gravité 2 — l'assistant ment sur ce qu'il a répondu (fournisseurs)

**2.1 ✅ Gemini : erreur réseau mi-stream → réponse DUPLIQUÉE sans erreur** — `provider-gemini-native.ts:1038-1045`. Le repli non-stream rejouait tout après les chunks déjà émis : `"Bonjour, voici le débBonjour, voici le début et la fin…"`, 2 requêtes facturées, zéro erreur.

**2.2 ✅ Réponse HYBRIDE de deux modèles** — `client.ts:780-809`. Un secours de stream qui échoue après émission passait au secours suivant qui rejouait tout : `"[FB1] La capitale de la France est P[FB2] La capitale…Paris."` présenté comme UNE réponse.

**2.3 ✅ Gemini 429/5xx : aucun retry, jamais** — `provider-gemini-native.ts:482` levait l'erreur **sans `.status`** ; `RetryPredicates.llmApiError` (`src/providers/_shared/retry.ts:87-107`) lit `.status`. Preuve : 429 → 1 seul fetch. Combiné à 2.5, un 429 transitoire basculait immédiatement de fournisseur.

**2.4 ✅ (visibilité) Stream coupé net = troncature muette** — `provider-gemini-native.ts:921-1037` : fin de connexion sans `finishReason` → chunk final `stop` inconditionnel ; ligne SSE malformée → `catch {}` (`:843-859`), trou de contenu invisible. Corrigé en **warn explicite** (le `finish_reason` reste `stop` pour ne pas casser les consommateurs).

**2.5 ⚠️ AVÉRÉ — bascule inter-fournisseurs invisible + coût imputé au mauvais modèle** — `client.ts:599-607`, `:727-735` (toute erreur, même 400, déclenche le repli) ; `getCurrentModel()`/`isSubscriptionAuth()` continuent d'annoncer le primaire ; `codebuddy-agent.ts:1988-1993` tarife via `getCurrentModel()` → le `$0` d'un primaire ChatGPT-OAuth s'applique à une réponse servie par un secours **payant** (et inversement). Preuve : contenu du secours, identité du primaire. Nuance : listes cross-provider opt-in, mais le **pool de credentials même-fournisseur est actif par défaut** (`client.ts:446-455` → `provider-fallback.ts:93-138`) et un profil peut porter un autre modèle. Seule trace : `logger.warn` stderr — invisible en `--output json` et dans la conversation.

**2.6 ⚠️ AVÉRÉ — Gemini fabrique du texte et le présente comme la réponse du modèle** — `provider-gemini-native.ts:620-641` (blocage SAFETY → paragraphe français codé en dur « Je ne peux pas répondre… »), `:572-607` (MALFORMED_FUNCTION_CALL épuisé → texte anglais inventé). Ces textes entrent dans l'historique et polluent les tours suivants.

**2.7 ⚠️ AVÉRÉ — 404 modèle Gemini → swap silencieux vers `gemini-2.5-flash`** — `provider-gemini-native.ts:510-527` ; variante constructeur `client.ts:428-435` (demandé `grok-4` sur endpoint Gemini → `getCurrentModel() = gemini-2.5-flash`).

**2.8 ⚠️ AVÉRÉ — troncatures muettes équivalentes sur les 2 autres chemins de stream** — ChatGPT Responses : `provider-chatgpt-responses.ts:362` + boucle SSE (~`:1040`) : fermeture sans `response.completed` → contenu partiel, `finish: stop` ; OpenAI-compat : `provider-openai-compat.ts:1052-1064` : fermeture sans `[DONE]` → générateur termine normalement ; zéro chunk → 2ᵉ requête non-stream silencieuse (double facturation du prompt possible).

**2.9 ⚠️ AVÉRÉ (biais) — le chemin streaming ignore `chunk.usage`** — `agent-executor.ts:1479-1480`, `:1688-1690` : tokens estimés, jamais l'usage réel (remises `cached_tokens` invisibles ; le stream Gemini ne parse de toute façon aucun `usageMetadata`).

### Gravité 3 — des outils promis au modèle qui n'existent pas (et l'inverse)

**3.1 ✅ `apply_patch` : exigé par WritePolicy strict, invisible pour le LLM** — dispatch réel OK (`src/tools/registry/text-editor-tools.ts:384-405`), métadonnées présentes (`metadata.ts:69-74` « required by WritePolicy strict mode »), `alwaysInclude` dans 2 fichiers — mais **aucune définition LLM** : le sélecteur l'éjectait en silence (`tool-selector.ts:385-390`), `tool_search` ne pouvait pas le trouver. En `buddy dev` (strict par défaut), le refus d'édition dit « Use apply_patch » vers un outil que le modèle ne voit pas.

**3.2 ✅ `memory_propose` : ordonné par le prompt système, inexistant** — `prompt-builder.ts:537-551` ordonne de l'appeler à chaque tour ; force-inclus (`tool-selection-strategy.ts:112-133`) ; jamais défini. La boucle « agent propose, humain valide » était inerte.

**3.3 ✅ Invariant ajouté** : `alwaysInclude ⊆ surface exposée` (`tests/tools/tool-surface.test.ts`) — la famille entière ne peut plus se reproduire en silence.

**3.4 ⚠️ AVÉRÉ — `remind` : « la voie propre de l'agent » selon CLAUDE.md, inatteignable** — `src/tools/registry/remind-tools.ts:16` dispatché, zéro définition/métadonnée. Un « rappelle-moi demain 9h » traité par le tour agent vocal retombe sur bash. À trancher : exposer, ou corriger CLAUDE.md.

**3.5 ⚠️ Famille dispatch-only avec métadonnées** (intention d'exposition jamais consommée) : `csv_analyze` (fini, testé, mort partout), `docs_search`, `community_search`, `knowledge_graph`, `screen_memory`, `deploy`, `markdown_convert`. + `replace_memory`. À trier oubli/choix. `tool_search` absent de `getBuiltinToolNames()` (`tools.ts:179` vs `:389-410`) — un agent custom avec `fleetDispatchProfile` perdrait l'échappatoire.

**3.6 ⚠️ Divers prouvés** : `recall` sans `key` → `success:true "No memory found for key "undefined""` ; `src/agent/plan-mode.ts:62-79` : échafaudage mort avec noms d'outils fantômes (`grep`, `glob`) — à supprimer.

### Gravité 4 — le serveur 24/7 fuit lentement

**4.1 ✅ `dispatchedTasks` : fuite mémoire déclenchable À DISTANCE** — `src/fleet/peer-chat-bridge.ts:405`. Chaque `peer.dispatch` garde prompt + résultat complets pour toujours (`clearDispatch` : zéro appelant). Preuve : 300 dispatches → 300 états retenus, même en échec. Corrigé : cap 500 + TTL 15 min.

**4.2 ✅ Timer orphelin `metrics-collector`** — `src/metrics/metrics-collector.ts:472` : `setInterval` anonyme 10 s jamais nettoyé (preuve : 6 collectes après `shutdown()`).

**4.3 ✅ `safety-ledger` sans rotation** — `src/companion/safety-ledger.ts:182`, appendé à chaque snapshot caméra du robot. Corrigé : rotation 1 Mio → `.1`, échec de rename propagé.

**4.4 ✅ CKG : ligne déchirée + append = deux événements perdus** — `collective-knowledge-graph.ts:967-976`. Corrigé (détection du dernier octet, isolation dans le même write).

**4.5 ⚠️ AVÉRÉS, non corrigés (décisions de rétention à prendre)** :
- `~/.codebuddy/fleet-model-performance.jsonl` : aucune rotation, **tout** relu et gardé en RAM à chaque mtime (`model-scoreboard.ts:125-194`) — lu par le routage voix. Preuve : 20 000 outcomes → 2,6 Mo, 20 000 records en RAM.
- `cleanupOldSessions()` jamais appelé (`session-store.ts:424`) — `MAX_SESSIONS=50` est du code mort, le répertoire sessions grossit sans borne.
- Ledger CKG : append-only sans compaction (réel : 6,1 Mo chez toi, replay au boot du chemin TS ; le snapshot existe côté engine Rust opt-in).
- `audit-logger.ts:79,115` : nom daté figé au boot, pas de rotation. `metrics-YYYY-MM-DD.jsonl` sans purge. `council-deliberation-health.jsonl`, log admin gateway (`gateway.ts:811`), `shadow-twin.ts:156`, `outcome-capsule.ts:259`, `widget-engine.ts:51` : append-only sans rotation (fréquences faibles).
- `segment-archive` (zoom ON) : purge par répertoire de session, mais `sessionId` régénéré à chaque process (`context-manager-v2.ts:240`) → un dossier par run, jamais purgé globalement.
- GC des peer-sessions opportuniste (boot + prochain appel seulement) ; `heartbeat-monitor.ts:61` : body `fetch` jamais consommé (30 s × semaines — à confirmer sous charge).

### Gravité 5 — compaction, sessions, gardes fantômes (contexte)

**5.1 ⚠️ AVÉRÉ — un `--resume` repart sans le contexte des actions passées** — `session-store.ts:347-384` : seuls `toolCallName`/`toolCallSuccess` persistés ; arguments relus `"{}"`, sorties d'outils absentes. Silencieux.

**5.2 ⚠️ AVÉRÉ — `SESSION_ENCRYPTION=true` : écrit, jamais déchiffré** — `session-facade.ts:132-151` : l'historique devient UN blob `{__encrypted:true}` qu'aucun code ne sait relire (grep exhaustif). Une option « sécurité » qui détruit la relisibilité. Opt-in, mais piège armé.

**5.3 ⚠️ AVÉRÉ — transcript-repair détruit un résultat d'outil orphelin** — `transcript-repair.ts:56-74` : un résultat réel (« FAIL … ») dont l'appel a été compacté est supprimé (le cas inverse, lui, est honnête : `[result lost during compaction]`). Alternative sûre : rétrograder en message system.

**5.4 ⚠️ AVÉRÉ — le résumé de compaction par défaut plafonne à 5 sujets × 50 caractères** — `enhanced-compression.ts:738-765` ; preuve : 9 instructions utilisateur sur 30 sans aucune trace. Le filet (`recoverFullContext`) est en RAM (`maxArchives: 5`) et le filet durable (`CODEBUDDY_CONTEXT_ZOOM`) est off par défaut. Le marqueur `[Context Summary - N earlier messages]` est honnête sur le comptage, pas sur le contenu.

**5.5 ⚠️ Gardes jamais câblées (doc ≠ réalité)** — `src/security/guardian-agent.ts` : le « Guardian Agent » documenté dans CLAUDE.md comme dernier maillon de la chaîne de confirmation n'est importé **que par les tests** (`evaluateToolCall`/`shouldUseGuardian` : zéro appelant en prod ; preuve grep committée dans ce rapport). `src/context/pruning/` (TTLManager, soft-trim, hard-clear) : module entier jamais importé — les tests verts valident du code mort (le vrai TTL vit dans `tool-output-masking.ts`). `two-phase-compaction.ts` : idem.

### Gravité 6 — frictions diverses (mesurées)

- **Démarrage CLI : sain.** `node dist/index.js --version` : 0,07 s (3 runs), `--help` 0,06 s — le lazy loading fonctionne.
- **Headless local réel : fonctionne, exit code correct.** `-p "2+2?"` sur `qwen3.8-ctx32k` : réponse `4`, 93 s de mur dont l'essentiel est le prefill de **6 975 tokens** d'entrée (prompt système + outils) sur un 27B iGPU — c'est le matériel, pas le CLI ; mais chaque tour agentique repaie ce prefill (le smoke agentique a produit le bon fichier, check vert, en > 7 min). Pour l'usage local quotidien, réduire l'entrée par tour est LE levier.
- **`buddy onboard` : faux succès TTS** — `src/wizard/onboarding.ts:720-751` demande « Which TTS provider? », affiche `TTS: <provider>` dans le résumé, et écrit le choix uniquement dans `.codebuddy/config.json`… que **rien ne lit** (`writeConfig` `:303-322` ; grep : aucun consommateur de `ttsEnabled`/`ttsProvider` hors wizard ; la config TTS réelle passe par `--tts-provider` ou companion). Le provider/modèle, eux, sont correctement persistés (`persistProviderSelection` → user-settings.json, vérifié apparié sur les 4 chemins).

### Vérifié SAIN (preuves exécutées — pour ne pas re-chasser)

Boucle de repli à zéro chunk (client + OpenAI-compat propagent après émission) ; `CODEBUDDY_COUNCIL_ROUTING` off = no-op strict (scoreboard jamais touché) ; détection de stratégie client (5 sentinelles sans recouvrement) ; 429/403 OpenAI-compat jamais convertis en réponse vide ; repli de modèle ChatGPT-OAuth borné aux 400/404 ; **invariant outil n°1 tient** (0 outil exposé sans dispatch, 213→215) ; métadonnées RAG complètes ; 33 alias tous résolus ; outils du quotidien sans faux succès (`str_replace` introuvable → échec propre, fuzzy ne force pas, `bash` = code de sortie réel, `search` rejette au lieu de « No results ») ; writeback mémoire réinjecté chaque tour (même singleton) ; round-trip `context_expand` intègre (zoom ON) ; CKG multi-écrivains sans perte, lecture incrémentale correcte ; memory.md corrompu au milieu → dégradation gracieuse ; compaction principale déterministe (aucun LLM sur la voie CLI) et messages système préservés ; purge disque peer-sessions réelle ; rotations reminder-log/idle/rule-runs/voice-loop en place ; tous les timers companion/fleet unref+clear ; buffers sensoriels bornés ; tts-cache borné ; WebSocket/SSE nettoyés ; fail-closed de l'oubli confirmé (audit antérieur).

---

## 3. Corrigé dans ce lot (rouge → vert)

Chaque correctif : test rouge d'abord (committé), correctif, suites de zone vertes.

| Commit | Correctif | Preuve rouge → verte |
|---|---|---|
| `fix(memory): ne plus perdre un souvenir…` | 1.1 reconcile propage l'échec (les 2 appelants ont un repli d'écriture directe) ; 1.2 continuations indentées ; 1.3 branche `Tags:` + `createMemory(tags)` | e2e : `stored/recall null/disque false` → `disque true` ; round-trips multi-ligne + `pinned` ; tests/memory 190→195 verts |
| `fix(tools): exposer apply_patch et memory_propose…` | 3.1/3.2 définitions LLM + baseline 215 ; 3.3 invariant `alwaysInclude ⊆ exposé` | invariant rouge (2 manquants) → 4/4 ; tests/tools complet vert |
| `fix(providers): intégrité des streams…` | 2.1 repli seulement à zéro chunk ; 2.2 pas de 2ᵉ secours après émission ; 2.3 `.status` sur erreurs HTTP Gemini ; 2.4 warns troncature/ligne SSE perdue | 3 tests rouges (duplication, hybride, status undefined) → codebuddy 248 verts |
| `fix(server): borner trois ressources…` | 4.1 cap+TTL dispatchedTasks ; 4.2 timer metrics ; 4.3 rotation safety-ledger | 800 dispatches → ≤500 ; 6 collectes post-shutdown → 0 ; rotation `.1` ; fleet 624 + companion 469 verts |
| `fix(ckg): isoler l'append d'une ligne déchirée` | 4.4 | entrée postérieure perdue → les 2 entrées parsables |
| `fix(memory): garde anti-amnésie…` | 1.4 scope dégradé ⇒ reload+fusion avant save, sinon refus fail-closed | historique remplacé par le gabarit → historique + nouveau présents |

Non corrigé volontairement (défauts caractérisés, correctif = décision de conception ou chantier) : 1.5, 1.6, 1.7, 2.5–2.9, 3.4–3.6, 4.5, 5.1–5.5, onboarding TTS. Un correctif hasardeux dans un singleton à 23 consommateurs ou dans la politique de repli ferait pire que le défaut.

---

## 4. Les trois choses qui amélioreraient le plus l'usage quotidien

**1. Rendre la mémoire du compagnon digne de confiance, jusqu'au bout.**
Le plus grave est corrigé (faux « Stored », multi-ligne, `pinned`, amnésie), mais il reste
deux trous structurels : **(a)** interdire au réconciliateur LLM l'action `DELETE` non
archivée (1.5) — une hallucination « obsolète » détruit aujourd'hui une préférence sans trace,
à chaque tour via `autoCapture` ; le plus simple : convertir DELETE en archivage Ebbinghaus
(le mécanisme existe déjà, restaurable via `/memory restore`) ; **(b)** verrouiller
`saveMemories` multi-process (1.6) en réutilisant `withSessionLock` + tmp+rename — le serveur
24/7 et le CLI se marchent dessus aujourd'hui. Avec ça, la promesse « Lisa se souvient »
devient vraie sous toutes les coutures.

**2. Rendre visibles les bascules et troncatures de fournisseur — et facturer le vrai modèle.**
Un abonné $0 peut payer sans le savoir (2.5) et une réponse tronquée passe pour complète
(2.8). Concrètement : quand un repli sert la réponse, émettre un événement visible dans la
conversation (« ⚠ réponse servie par X/Y ») et imputer le coût au modèle réel ; marquer
`finish_reason` (ou au minimum un warn, comme fait pour Gemini) sur les fins de stream sans
événement terminal côté ChatGPT-Responses et OpenAI-compat ; remplacer les textes fabriqués
Gemini (2.6) par une vraie erreur typée. Les tests mocks de cet audit (committés) donnent le
harnais.

**3. Solder la famille « promis mais pas branché » sur les surfaces quotidiennes.**
Le motif dominant du dépôt reste vivant : `remind` inatteignable pour l'agent vocal (3.4),
les outils mémoire qui écrivent dans le mauvais projet hors CLI (1.7), l'onboarding qui
annonce un TTS que rien ne lit, le Guardian documenté mais jamais câblé, `cleanupOldSessions`
jamais appelé. Chacun est petit ; ensemble ils font l'écart entre « la doc dit » et « le
produit fait ». Le nouvel invariant de test (3.3) verrouille désormais une partie de la
famille ; étendre l'idée (toute directive du prompt système → outil réellement exposé ;
tout module `src/` testé → au moins un importeur de prod) transformerait cet audit ponctuel
en garde permanente.

---

*Preuves d'exécution : scripts rejouables dans le scratchpad de session (agent-tools/,
agent-providers/, agent-memory/, agent-server/) ; sorties clés citées ci-dessus ; tests
committés dans `tests/`. Aucun chiffre de ce rapport n'est estimé : tout est mesuré ou
marqué « à confirmer ».*
