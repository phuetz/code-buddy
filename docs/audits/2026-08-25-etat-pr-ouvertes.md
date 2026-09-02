# État des six PR ouvertes — `phuetz/code-buddy`

Diagnostic du **25 août 2026**. Référence `main` : `63278824` (23/08 23:25).
Méthode : `gh pr view/checks` (lecture seule), `git fetch origin`, `git merge-tree --write-tree`
(simulation de merge, aucune écriture), lecture des fichiers concernés sur `origin/main`,
et corrélation commit par commit entre chaque PR et les commits de `main`.
**Aucune PR n'a été modifiée, ni mergée, ni commentée, ni rebasée. Aucune branche créée.**

> Piège méthodologique signalé : `git diff main...PR` (trois points) part de la *merge-base* et
> compte donc les évolutions de `main` comme du contenu de la PR. Pour #70, qui a absorbé `main`
> le 23/08, seule la comparaison d'**arbres** (`git diff main PR`, deux points) dit la vérité.
> Les chiffres ci-dessous utilisent la comparaison d'arbres.

---

## Synthèse

| PR | Sujet | Âge | État GitHub | CI | Verdict | Effort |
|---|---|---|---|---|---|---|
| **#142** | perf CLI — démarrage à froid, dépendances UI différées | 2 j | CONFLICTING (1 conflit, `src/index.ts`) | **8/8 vertes** | **À trancher par Patrice** (décision produit : écran splash) | 15 min de rebase + relance CI |
| **#132** | `stableStringify` sérialise les `Date` en `{}` | 2 j | **MERGEABLE** / UNSTABLE | **jamais exécutée** (fork externe) | **À merger** (après avoir lancé la CI) | ~0 h |
| **#70** | companion — détresse aiguë (en fait : parapluie pipeline média) | 27 j | CONFLICTING (26 fichiers) | 6/8 rouges (10/08) | **À fermer** — remplacée | 0 h |
| **#69** | Audit Fable 5 batch 2 (55 fixes) | 43 j | CONFLICTING (29 fichiers) | non exécutée | **À fermer** — remplacée par #106 + #120 ; résidu à porter **depuis les branches `codex/portage-*`**, pas depuis cette PR | 0 h pour fermer / **4–6 h** pour le lot résiduel |
| **#68** | Audit Fable 5 batch 1 (26 fixes) | 43 j | CONFLICTING (24 fichiers) | non exécutée | **À fermer** — remplacée par #99 + #108 ; **2 correctifs de sécurité restent non portés** | 0 h pour fermer / **2–3 h** pour le lot sécurité résiduel |
| **#40** | cowork-chat — parité gitnexus-rs (5 gaps) | **103 j** | CONFLICTING (7 fichiers) | rouge (mai, matrice Node 18) | **À fermer** — 4 gaps sur 5 sont sur `main` | 0 h pour fermer / ~1 h si le 5ᵉ gap est voulu |

**Répartition : 1 à merger · 1 à trancher par Patrice · 4 à fermer.**

⚠️ **Ne pas fermer #68 et #69 sans ouvrir d'abord un petit lot de suivi** : cinq correctifs
identifiés (dont deux de sécurité) ne sont, à ce jour, sur aucune branche mergée. Détail plus bas.

---

## #142 — perf(cli) : démarrage à froid

**Ce qu'elle apporte.** Elle diffère le chargement des dépendances UI lourdes et affiche un écran
« Starting Code Buddy… » pendant l'initialisation, pour que le premier cadre visible arrive plus tôt.
Elle ajoute `src/renderers/startup.ts`, `src/ui/loading-screen.ts`, `src/ui/components/StartupScreen.tsx`,
deux fichiers de tests (`tests/renderers/startup.test.ts`, `tests/ui/loading-screen.test.ts`), un banc
de mesure (`docs/perf/_bench-st3c.mjs`) et deux notes de mesure.

**État réel.** 13 fichiers, +1 235/−34. Créée le 23/08 16:53, mise à jour le 23/08 18:15.
`mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`. Plus draft, aucune revue, aucun commentaire.
**CI : 8 jobs sur 8 au vert** (build, security audit, Node 20/22 × ubuntu/macOS/windows).

**Nature du conflit.** Un seul fichier, `src/index.ts`, **un seul hunk**, et c'est un bloc d'imports :

```
<<<<<<< origin/main
import { getConfigManager } from './config/toml-config.js';
import { getHiddenCliCommands } from './config/feature-surface.js';
=======
import { isLoadingScreenDisabled } from './ui/loading-screen.js';
>>>>>>> PR#142
```

`main` a bougé de 10 commits depuis la merge-base `aaa4224c`, dont quatre touchent `src/index.ts`
(#140 profils core/all, #143 durcissement aide CLI, #139 `mcp serve`, #134 onboarding 60 s).
Ce sont des ajouts d'imports adjacents, **pas un travail refait autrement** : le sujet de #142
(différer les imports UI) n'a aucun équivalent sur `main`. La résolution est mécanique : garder
les trois imports.

**Verdict — à trancher par Patrice.** Le code est prêt et prouvé ; ce qui bloque est éditorial.
La description acte, mesures à l'appui, que le gain est un **first-paint −31 %** (770 → 528 ms) mais
un **agent-ready +10 %** (860 → 947 ms) : l'agent n'est pas plus rapide, un `render()` s'intercale, et
l'utilisateur voit désormais un écran de chargement. Les réserves de la revue adversariale ont été
levées (marqueur `ui-render` restauré, `--help` re-mesuré en paires entrelacées → −5,5 %, échec
d'`initializeRenderers()` rendu bruyant, splash désactivable par `CODEBUDDY_NO_LOADING_SCREEN=1`
ou `--no-loading-screen`). **La question ouverte est : veut-on cet écran splash ?**
Le journal de coordination le dit noir sur blanc au 24/08 : « #142 = feu vert Patrice (splash) ».
Effort une fois la décision prise : ~15 min (rebase du bloc d'imports) + une relance CI.

---

## #132 — fix(utils) : `stableStringify` et les `Date`

**Ce qu'elle apporte.** Deux lignes de production et 52 lignes de tests. `sortKeys()` traitait une
`Date` comme un objet quelconque : `Object.keys(date)` étant vide, elle était sérialisée en `{}`
au lieu de son ISO. Le correctif est `if (value instanceof Date) return value;` placé avant le tri
des clés, ce qui laisse `JSON.stringify` faire son travail natif.

**État réel.** 2 fichiers, +54/−0. Créée le 23/08 03:08, mise à jour le 24/08 02:31.
`mergeable: MERGEABLE`, `mergeStateStatus: UNSTABLE`. Auteur externe (`mikemikimike`), PR depuis un fork.
1 commentaire, 0 revue. **CI : `gh pr checks` renvoie « no checks reported » et le `statusCheckRollup`
est vide — la CI n'a jamais tourné sur cette branche.** C'est cohérent avec un fork dont les workflows
attendent une approbation. Le `UNSTABLE` vient de là, pas d'un échec.

**Bug vérifié sur `main` aujourd'hui.** `src/utils/stable-json.ts` sur `origin/main` ne contient
aucun traitement des `Date` : le bug est réel et non corrigé ailleurs. L'issue liée **#123 est toujours
ouverte**.

**Conflit.** Aucun.

**Verdict — à merger.** Correctif minimal, ciblé, avec une preuve TDD décrite (branche retirée →
4 tests rouges ; branche remise → 9 verts). Une seule réserve, honnête : l'auteur indique lui-même
n'avoir pu lancer ni `typecheck`, ni `lint`, ni `format:check`, ni `build` dans son environnement, et
**la CI du dépôt n'a jamais tourné dessus**. La seule chose à faire avant merge est donc de déclencher
les workflows sur ce fork. Effort ≈ 0 h.

---

## #70 — feat(companion) : ressources de crise

**Ce qu'elle apporte — et ce que dit son titre.** Le titre décrit un détecteur de détresse aiguë
(idéation suicidaire, FR+EN, robuste au STT) qui injecte un bloc de guidage prioritaire orientant
vers 3114 / SOS Amitié / 15-112. **Ce correctif est sur `main` depuis le 16 juillet** :
`git merge-base --is-ancestor 9542c896 origin/main` répond oui ; `src/companion/crisis-safety.ts`
existe sur `main` et son historique porte exactement le commit `9542c896 feat(companion): route acute
distress to crisis resources` du 2026-07-16.
La PR elle-même est en réalité la branche parapluie `feat/mysoulmate-media-pipeline` : pipeline média
MySoulmate, LoRA d'identité Lisa, scripts influenceur/gpuNode, outils vidéo, commandes CLI, 62 études.

**État réel.** 622 fichiers déclarés par GitHub, +110 179/−2 576. Créée le 29/07, mise à jour le 23/08
21:26 (la branche a absorbé `main` ce soir-là). `CONFLICTING` / `DIRTY`.
**CI : 6 jobs de test sur 8 en échec** (dernier run du 10/08), build « skipping », security audit verte.
Comparaison d'arbres avec `main` : 750 fichiers diffèrent, dont **354 présents dans la PR et absents
de `main`**, concentrés sur `scripts/influencer` (52), `scripts/gpuNode` (45), `docs/studies` (28),
`scripts` (26), `src/lora` (13).

**Nature du conflit.** 26 fichiers, dont `CLAUDE.md`, `README.md`, `docs/FABLE5-CODEX-COORDINATION.md`
(add/add), `src/index.ts`, `src/agent/execution/agent-executor.ts`, `src/memory/collective-knowledge-graph.ts`,
`src/companion/reply-augment.ts`, `src/sensory/hybrid-reply.ts`. **Le travail a été refait autrement**,
et méthodiquement : sept PR de découpe ont été mergées les 22–23/08 —
#103 (LSP + mentions @fichier), #104 (`cost`, `changelog`, `import`), #107 (`buddy explain`),
#109 (outils CKG via MCP + first-run ChatGPT), #111 (modules studio vidéo : ComfyUI, Google Flow,
quality gates, plans long-form), #121 (câblage des outils video studio), #145 (companion/voix, lot c,
19 fichiers). Vérifié sur `main` : `src/tools/video/` contient bien `comfy-client.ts`,
`google-flow-driver.ts`, `long-form-production.ts`, `visual-gate-report.ts`… ; `src/mcp/mcp-ckg-tools.ts`,
`src/commands/explain.ts|cost.ts|changelog.ts|import.ts` sont présents.

**Ce qui reste vraiment.** Les 354 fichiers absents de `main` sont massivement des **artefacts de
production média** (scripts influenceur/gpuNode/trailers/lisa-studio, `src/lora/*`, études `docs/studies`,
docs de lancement de chaînes) — pas du cœur produit. Le dernier commentaire déposé sur la PR par
l'auteur du portage l'énonce : « 19 portés dans #145, 121 déjà sur main, 482 hors périmètre
(artefacts/duplications) […] Cette PR peut être fermée (décision Patrice). »

**Verdict — à fermer.** Le correctif du titre est sur `main` depuis 40 jours ; le reste a été porté
par sept PR nommées ci-dessus. Fermer libère 622 fichiers de bruit dans la revue.
*Fait non établi* : je n'ai pas vérifié si les 354 fichiers d'artefacts média existent ailleurs
(dépôt privé, worktree local). Si ce n'est pas le cas, ils ne survivront pas à la fermeture de la
branche — à confirmer avant de fermer.

---

## #69 — Audit Fable 5 batch 2 (fleet + memory + tools + sensory + cowork)

**Ce qu'elle apporte.** 55 correctifs issus d'un audit à 11 agents, sur cinq sous-systèmes : fleet-council
(rate-limit et backpressure `peer:request`, rejet des requêtes en vol à la déconnexion, multiplexage RPC,
scoreboard indexé), memory-CKG (chargement incrémental du ledger, embeddings persistés, kill du sidecar
Rust, rédaction du ledger), tools-registry-executor (dispatch bash gardé, coût par round, contexte JIT
persistant, index RAG/BM25), sensory-robot (réaction speech gatée par token, bridge fail-closed, rétention
disque bornée), cowork-gui (réponses d'approbation distantes appliquées, clés API rédactées, turn-journal
fsync batché).

**État réel.** 154 fichiers, +10 772/−2 392, 60 commits. Créée le 13/07, mise à jour le 23/08 01:43.
`CONFLICTING` / `DIRTY`. **Aucune CI n'a jamais été exécutée sur `integration/audit-batch2`.**
Merge-base : `48d9ca97` (13/07) — **313 commits de `main` ont été poussés depuis.**

**Nature du conflit.** 29 fichiers, dont `.github/workflows/ci.yml`, `buddy-sense/src/senses/video.rs`,
`buddy-vision/watch.py`, cinq fichiers `cowork/src/main/`, `src/agent/execution/agent-executor.ts`,
`src/memory/collective-knowledge-graph.ts`, `src/server/websocket/handler.ts`, `src/tools/bash/bash-tool.ts`.
**Le travail a été refait autrement, en deux temps.**
1. *Re-port* : le contenu a été rebasé début août sur les branches `codex/portage-*-july-2026`
   (fleet-lifecycle, fleet-saturation, tools-rag, memory, jit-tools), chacune relue (4× GO-avec-réserves)
   avec ses quatre correctifs de suivi appliqués (`49c67a1b`, `3ac59d6f`, `af927dad`, `ad92fdf0`).
2. *Merge partiel* : deux PR de découpe ont été mergées le 23/08 —
   **#106** (`13fca4af`, 33 fichiers) et **#120** (`f8f39d00`, 19 fichiers). #120 cite explicitement
   des `cherry picked from` pointant sur les SHA de `codex/portage-memory-july-2026`
   (`379c0c8b`, `b5797122`, `668b07ae`, `5bc9a752`).

**Correspondance commit par commit** (corrélation par sujet + inspection du code sur `main`) :
portés → capacité et rate-limit pair, multiplexage WS, rejet à la fermeture, ledger CKG incrémental,
capture caméra persistante, dédup des probes, turn-journal fsync, workflows atomiques, rédaction des clés
provider, réponses d'approbation distantes, bridge fail-closed, payloads bornés, rétention disque,
réaction speech gatée, sidecar Rust tué, mémoires multi-lignes, `normalizeName` désambiguïsé.
Vérifications directes sur `main` : `assertFleetCapacity` en `peer-chat-bridge.ts:68`,
`RATE_LIMITS.peerRequestsPerMinute` en `handler.ts:985`.
Le lot `agent-executor` est **ré-implémenté autrement** sur `main` (`IncrementalMessageTokenCounter`,
`totalInputTokensForCost` accumulé par round, annulation par `AbortSignal` en
`agent-executor.ts:701-764`, `runJitContextDiscovery` dans la boucle) — ce qui explique les 15 hunks
en conflit et rend le merge de la PR contre-productif.

**Ce qui n'est porté nulle part (vérifié dans le code de `main`) :**
- `7d781a18 fix(tools): route bash through guarded dispatch` — `src/agent/tool-handler.ts:1454` appelle
  toujours `this.bash.executeStreaming(...)` en direct. La commande est bien revalidée en aval, mais
  la couche au-dessus (crochets, RunStore, télémétrie, auto-repair) est court-circuitée.
- `e3ca59f7 fix(self-improve): re-gate archived skills on restore` — `skill-mutator.ts:273 restore()`
  sur `main` fait `renameDirWithRetry` puis `reload` **sans repasser par le gate de sécurité** ; la
  version portée (`fa2e191b`) appelle `safetyGateSkill(content)` et refuse une compétence redevenue
  dangereuse. C'est un trou réel dans le pare-feu des skills.
- `187abfe1 fix(council): sanitize fleet peer answers` — aucun appel à un sanitizer trouvé sous
  `src/council/` ni `src/fleet/`.
- Non retrouvés non plus, par corrélation de sujet : `f861941f` (reconstruction BM25),
  `a51546a5` / `29ecb540` (RAG idempotent + feedback live), `0c63facc` (compaction adaptative),
  `865972a1` / `eb897240` (scoreboard indexé, cache des latences).
  *Fait non établi* : pour ces cinq derniers je me suis arrêté à la corrélation de sujets, sans lire
  le code de `main` ligne à ligne — ils peuvent avoir été réécrits sous un autre nom.

**Verdict — à fermer, mais pas à jeter.** La PR est un parapluie de 43 jours, sans CI, à 313 commits
de `main`, dont le cœur (`agent-executor`) a été réécrit entre-temps. Ce qui l'a remplacée :
**#106 et #120**, elles-mêmes alimentées par les branches `codex/portage-*-july-2026`.
Le résidu ne doit **pas** être extrait de cette PR mais de ces branches, déjà rebasées, relues et testées.
Attention : ces branches sont désormais elles aussi en retard (base du 16/07 ou du 09/08, 136–139 commits
de `main` manquants) — *fait non établi* : je n'ai pas vérifié qu'elles s'appliquent encore proprement.
Effort : 0 h pour fermer ; **4–6 h** pour un lot « tools/RAG + self-improve + council » repris de
`codex/portage-tools-rag-july-2026`, `codex/portage-jit-tools-july-2026` et `codex/portage-memory-july-2026`.

---

## #68 — Audit Fable 5 batch 1 (sécurité + voix + providers)

**Ce qu'elle apporte.** 26 correctifs sur trois sous-systèmes. Sécurité : revalidation de chaque saut
de redirection contre le SSRF, `NODE_OPTIONS`/`NODE_PATH` retirés de l'allowlist et ajoutés à la denylist,
secrets scrubbés avant écriture du journal d'audit, `isSafeUrlSync` fail-closed, Guardian `deny` en mode
autonome, sous-clé HKDF par enregistrement pour le chiffrement des sessions, IDs d'approbation distante
en `crypto.randomUUID` avec liaison initiateur/répondeur. Voix : cache de route de l'agent groundé, cache
TTS borné, barge-in sur les annonces, fragments supersédés préservés. Providers : préservation du system
prompt en compression « enhanced » et sur Gemini natif, `tools:[]` omis, usage ChatGPT remonté.

**État réel.** 77 fichiers, +4 826/−685, 28 commits. Créée le 13/07, mise à jour le 23/08 01:43.
`CONFLICTING` / `DIRTY`. **Aucune CI n'a jamais été exécutée sur `integration/audit-batch1`.**
Merge-base `48d9ca97` (13/07), **313 commits de retard**.

**Nature du conflit.** 24 fichiers : les quatre providers, six fichiers `src/security/`, sept fichiers
`src/sensory/` (zone voix), `fetch-tool`, `image-tool`, `web-search`, plus quatre tests dont deux en add/add.
**Le travail a été refait autrement dans les trois zones.**

*Sécurité.* `src/security/safe-fetch.ts` sur `main` est un **add/add** : `main` a sa propre implémentation,
**plus forte** que celle de la PR. Elle boucle sur les redirections en `redirect: 'manual'`, appelle
`assertRedirectTargetIsSafe(currentUrl)` à chaque saut, **et** épingle l'IP résolue par un dispatcher
undici (`createPinnedDispatcher`) — ce que la PR ne faisait pas. Les tests correspondants sur `main`
sont `ssrf-redirect.test.ts` et `ssrf-dns-pinning.test.ts`. Le reste du lot sécurité a été mergé par
**PR #99** (`7accd5a7`, 22/08) : scrub de l'audit log, Guardian fail-closed, HKDF v2, IDs d'approbation
courts — plus `3989a1dc fix(security): scrub secrets from audit logs` sur `main`.

*Providers/contexte.* Mergé par **PR #108** (`30222212`, 23/08), qui cite les cherry-picks des SHA
exacts de la PR : `6b6eec45` (system prompt en compression enhanced), `0ffaf660` (`tools:[]` omis),
`42470952`, `64db4573` (images multimodales), `3977805b` (noms d'outils en transcript-repair),
`36ee15bd`, `a069f5bb`, `3c30c61d` (barge-in). Plus `72090dec` (usage ChatGPT) et `ccfe4cc0`
(paramètres reasoning OpenAI) directement sur `main`.

*Voix.* `main` a réécrit l'architecture entre-temps (barge-in AEC ciblé, coordinateur de tour,
`activeAborts`), et les correctifs de la PR y sont couverts par d'autres moyens :
`CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS` est lu en `voice-loop.ts:976` (≡ `397c7b38` cache de route) ;
`sayNow` accepte `options.signal` avec le commentaire « the signal lets barge-in kill this player too »
(≡ `9d7df24f` interruption des annonces) ; `speech-reaction.ts` a `joinVoiceTurnFragments` et gère
`superseded = pendingSpeech` (≡ `8cdb4668`) ; `tests/sensory/voice-interrupt.test.ts` existe sur `main`,
issu de `af7619f9`/`3acdc1b3`/`0c073643`, pas de la PR. Le `mouthGeneration` de la PR n'a pas d'équivalent
et n'en a plus besoin. Le cache TTS borné est porté (`602f0fab`).

**Ce qui n'est porté nulle part (vérifié dans le code de `main`) :**
- `53cc9b22 fix(security): block NODE_OPTIONS/NODE_PATH injection into child processes` — sur `main`,
  `NODE_PATH` et `NODE_OPTIONS` sont **toujours dans l'allowlist** `SAFE_ENV_VARS`
  (`src/tools/bash/security-patterns.ts:194-195`), `NODE_PATH` est dans `CORE_VARS`
  (`src/security/shell-env-policy.ts:50`), et **ni l'un ni l'autre n'est dans `BLOCKED_ENV_VARS`**
  (`src/security/env-blocklist.ts`, qui bloque pourtant `LD_PRELOAD`, `DOTNET_STARTUP_HOOKS`, etc.).
  `NODE_OPTIONS` accepte `--require`/`--import` : c'est de l'exécution de JS arbitraire dans chaque
  sous-processus node/npm/npx que l'agent lance. **C'est le résidu le plus sérieux des six PR.**
- `50fab813 fix(security): fail closed in isSafeUrlSync` — sur `main`,
  `ssrf-guard.ts:346 isSafeUrlSync()` renvoie encore `{ safe: true }` pour tout nom d'hôte non-IP
  (« Cannot verify hostname without DNS — return safe »). **Ce point demande un arbitrage** : le bilan
  du 23/08 a mesuré qu'un fail-closed strict casse `sensory-rules-engine.ts:95`, qui valide en synchrone
  les URL de webhook — toute règle webhook à nom de domaine serait refusée à l'écriture. Il faut donc
  soit un chemin async pour les webhooks, soit une exception explicite.

**Verdict — à fermer.** Ce qui l'a remplacée : **PR #99** (lot sécurité mergeable), **PR #108**
(lot providers/contexte, cherry-picks nominatifs de ses commits), l'implémentation SSRF propre de `main`
(`safe-fetch.ts` + épinglage DNS), et la réécriture de la voix (`af7619f9`, `3acdc1b3`, `0c073643`).
La PR n'a jamais eu de CI, a 313 commits de retard, et sa zone voix est architecturalement incompatible
avec `main`. **Mais fermer sans porter les deux correctifs ci-dessus serait perdre du vrai travail de
sécurité.** Effort : 0 h pour fermer ; **2–3 h** pour un lot « sécurité résiduelle » (`NODE_OPTIONS`
depuis `53cc9b22` ou depuis `codex/portage-security-july-2026`, + arbitrage `isSafeUrlSync`/webhooks).

---

## #40 — feat(cowork-chat) : parité avec le chat-ui de gitnexus-rs

**Ce qu'elle apporte.** Cinq gaps UX du chat de Cowork face au chat-ui de gitnexus-rs :
(1) bouton *Regenerate* au survol des messages assistant, (2) textarea auto-grow 44→200 px,
(3) `HealthBadge` permanent dans la Titlebar (poll `/health` avec backoff), (4) badges d'outils
en tête du message + scroll vers le `ToolUseBlock`, (5) rendu Mermaid inline (import paresseux + DOMPurify).
~795 LOC dont 31 tests sur les helpers purs.

**État réel.** 19 fichiers, +2 247/−7, 5 commits. Créée le **14 mai 2026** — 103 jours.
`CONFLICTING` / `DIRTY`. **CI intégralement rouge** (run de mai : security audit, security_scan,
SonarCloud, matrice Node 18/20 sur les trois OS) ; la matrice de CI a changé depuis (Node 20/22).
Merge-base `160826b5` (14/05) : **2 070 commits de `main` ont été poussés depuis.**

**Nature du conflit.** 7 fichiers : `cowork/package.json` + `package-lock.json`, `ChatView.tsx`,
`MessageCard.tsx`, `Titlebar.tsx`, `message/ContentBlockView.tsx`, et
`message/MermaidBlock.tsx` en **add/add** — signature nette d'un travail refait ailleurs.
Vérification fichier par fichier sur `origin/main` :

| Gap | Sur `main` ? | Porté par |
|---|---|---|
| 1 · Regenerate | **oui** — `MessageCard.tsx:305-310` (`onRegenerate`, `data-testid=message-regenerate-*`) et `ChatView.tsx:947` (« P1.1 — Regenerate an assistant response ») | implémentation native de `main`, pas le hook `use-regenerate.ts` de la PR (absent) |
| 2 · Textarea auto-grow | **oui** — `cowork/src/renderer/hooks/use-textarea-autogrow.ts` | **PR #105** `feat(cowork-chat): chat-ui parity with gitnexus-rs (rebased from PR #40)`, mergée le 22/08 |
| 3 · HealthBadge | **oui** — `components/HealthBadge.tsx` + `hooks/use-backend-status.ts` | **PR #105** |
| 4 · Badges d'outils inline | **non** — aucun `ToolBadgeStrip`/`toolBadge` sous `cowork/src` | — (`e7ecc73b feat(cowork): stream live tool output in the ToolUseBlock card` couvre une partie du besoin autrement) |
| 5 · Mermaid inline | **oui** — `components/message/MermaidBlock.tsx` | `5bc5b296 feat(cowork): render mermaid diagrams inline in chat (ported from code-explorer)` |

**Verdict — à fermer.** Quatre gaps sur cinq sont sur `main`, dont deux par une PR qui se nomme
explicitement « rebased from PR #40 » (**#105**). Rebaser 2 070 commits pour un seul gap restant n'a
aucun sens. Effort : 0 h pour fermer ; ~1 h pour reprendre le seul `ToolBadgeStrip` + le scroll-to
sur `main` si Patrice y tient (les helpers purs `tool-status.ts` de la PR sont réutilisables tels quels).

---

## Ce qu'il faut retenir

1. **Une seule PR attend une décision de Patrice : #142.** Elle est verte sur 8 jobs, son conflit
   tient en trois lignes d'imports, et son seul obstacle est un choix produit — accepter ou non un
   écran « Starting Code Buddy… » qui améliore le *first-paint* de 31 % sans rendre l'agent plus rapide.
2. **Une seule PR est prête à merger : #132.** Deux lignes, un bug réel encore présent sur `main`,
   issue #123 ouverte. Il manque juste de déclencher la CI (contribution externe depuis un fork).
3. **Les quatre autres sont des parapluies périmés dont le contenu a été porté ailleurs**, et ce
   portage est documenté et traçable : #40 → #105 ; #68 → #99 + #108 ; #69 → #106 + #120 ;
   #70 → #103, #104, #107, #109, #111, #121, #145.
4. **Cinq correctifs n'ont survécu nulle part.** Par ordre de gravité :
   `NODE_OPTIONS`/`NODE_PATH` toujours autorisés dans les sous-processus (#68) ;
   `restore()` d'une compétence archivée sans repasser le gate de sécurité (#69) ;
   dispatch bash streaming hors des crochets/RunStore (#69) ;
   réponses des pairs du council non assainies (#69) ;
   `isSafeUrlSync` fail-open sur les noms de domaine (#68, **arbitrage requis** — le fail-closed casse
   les webhooks de `sensory-rules-engine`).
   Ils doivent être repris depuis les branches `codex/portage-*-july-2026` (déjà rebasées et relues),
   pas depuis les PR elles-mêmes, **avant** de fermer #68 et #69.

## Faits que je n'ai pas établis

- Je n'ai exécuté **aucune** suite de tests ; tous les états de CI cités viennent de `gh pr checks`.
- Je n'ai pas vérifié les 55 correctifs de #69 un par un : j'ai corrélé les sujets de commit puis lu
  le code de `main` pour un échantillon (fleet, memory, sensory, agent-executor, skill-mutator, bash).
  Cinq correctifs « tools/RAG/scoreboard » sont classés absents sur la seule corrélation de sujets.
- Je n'ai pas vérifié que les branches `codex/portage-*-july-2026` s'appliquent encore proprement sur
  le `main` du jour (elles ont 136 à 139 commits de retard).
- Je n'ai pas vérifié si les 354 fichiers d'artefacts média de #70 existent ailleurs que sur sa branche.
