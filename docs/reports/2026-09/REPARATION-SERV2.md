# Réparation SERV2 — écarts assumés de SERV1

Date : 2026-09-04  
Agent : lane Codex (création du rapport, interrompue aussitôt après) puis **Fable 5.1** (reprise et exécution)  
Branche : `fix/serv2-ecarts-2026-09-04`, base `7c93412ee`  
Clone : `~/DEV/cb-serv2-2026-09-04` — original `~/code-buddy` interdit en écriture  
HOME temporaire : `_qa/serv2/home` (gitignoré)  
Source : `docs/reports/2026-09/RAPPORT-SERV1.md`, section « Reste ouvert »  
Statut : **les trois écarts sont fermés**

## Périmètre

1. Restituer les compteurs d'usage fournis par le provider sur `/v1/chat/completions`, avec estimation explicitement signalée en repli.
2. Aligner la documentation sur le serveur à port unique et figer l'absence de promesse d'un port WebSocket 3001.
3. Aligner la documentation et les tests sur le comportement CORS standard des origines non autorisées.

## Garde-fous tenus

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf` hors du clone, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local `qwen3:4b-instruct` seul, chargé avant la première mesure (`ollama ps` : `24 GB`, `100% GPU`, contexte `262144`).
- Aucun service systemd. Ports 3000/3001/8188/8189/9222 jamais touchés (vérifié avant et après). Seuls **3620** et **3621**, libres, ont servi ; les deux processus lancés étaient les miens et sont refermés.
- Dépôt PUBLIC : tous les chemins écrits en `~/…`, aucun nom de machine, aucune IP. `tests/security/donnees-personnelles.test.ts` = 7/7 vert à chaque étape.

## Journal

| Étape | Action |
|---|---|
| 1 | Reprise des deux fichiers laissés par la lane Codex (rapport + réservation), colonne `Agent` corrigée, HOME QA déclaré ignoré. Commit `25c942569`. |
| 2 | Mesure `ss -ltnp` sur un `buddy server --port 3620` réel + relevés CORS et usage **avant** correctif. |
| 3 | Écart 1 : test rouge 4/4 → chaîne de mesure → vert 4/4 → preuve Ollama réelle. Commit `d09b3d214`. |
| 4 | Écart 2 : test docs rouge 9 → correction de neuf documents → vert 12. Commit `9a6d19c91`. |
| 5 | Écart 3 : contrat serveur figé (mutation-prouvé), doc rouge 4/4 → verte. Commit `cdd35b65e`. |
| 6 | `npm run build`, vérifications finales, arrêt des serveurs, `ss -ltn` de contrôle. |

---

## Écart 1 — `usage.prompt_tokens` estimé (`len/4`) — **FERMÉ** (`d09b3d214`)

### Le défaut

`/v1/chat/completions` calculait `Math.ceil(texteUtilisateur.length / 4)` et publiait le résultat
comme `usage.prompt_tokens`, sans le moindre signalement. Le tour réel envoie en plus le prompt
système, l'historique et les rounds d'outils : l'écart est de trois ordres de grandeur. Un client
OpenAI qui facture, plafonne ou trace sur ce champ était trompé **sans avoir aucun moyen de le savoir**.

### Pourquoi le compteur réel n'arrivait pas

La chaîne était coupée en trois endroits, et le premier n'avait jamais été remarqué :

1. `provider-openai-compat.ts` ne demandait pas `stream_options: { include_usage: true }`. Sans cette
   option, un serveur OpenAI-compatible n'envoie **aucun** bloc `usage` sur un flux. Vérifié en direct
   contre Ollama :

   ```
   $ curl … -d '{… "stream":true}'                          → dernier chunk : pas de "usage"
   $ curl … -d '{… "stream":true,
                 "stream_options":{"include_usage":true}}'   → "usage":{"prompt_tokens":14, …}
   ```

   Conséquence de bord : `observeChunk` dans le provider alimentait déjà `usageInputTokens` pour les
   métriques de tour (TTFT1) — ce champ était donc **toujours vide**. Le correctif le remplit aussi.
2. `StreamingHandler.accumulateChunk` sortait par un retour anticipé sur `!chunk.choices?.[0]`, or le
   chunk d'usage ne porte justement **aucun** `choices`. Le bloc était vu puis jeté.
3. Rien ne remontait ces compteurs de l'exécuteur jusqu'à la route HTTP.

### Le correctif

- `provider-openai-compat.ts` demande `stream_options.include_usage` (échappatoire
  `CODEBUDDY_STREAM_USAGE=false` pour une passerelle qui refuserait un paramètre inconnu).
- `StreamingHandler` capture le bloc **avant** le retour anticipé et l'expose par `getProviderUsage()`,
  qui ne rend jamais une estimation locale.
- `AgentExecutor` somme ces compteurs sur tous les rounds d'outils (même sémantique que la
  comptabilité de coût existante) et les publie **une fois par tour** via `recordTurnProviderUsage` —
  avec `undefined` quand le provider s'est tu, pour ne jamais rejouer la mesure du tour précédent.
- `CodeBuddyAgent.getLastTurnUsage()` les expose ; `runAgentCompletion` les porte dans
  `ServerAgentCompletion.usage` ; la route les rend tels quels.
- Repli honnête : `buildOpenAIUsage()` conserve l'estimation `len/4` mais **l'annonce** —
  `usage.estimated: true`, en JSON comme dans le dernier chunk SSE.

### Preuves

Test serveur avec provider fictif (`tests/server/serv2-openai-usage.test.ts`) : **4 rouges avant
correctif**, 4 verts après — compteurs rendus sans drapeau, estimation marquée, dans les deux
transports.

Preuve réelle, Ollama local `qwen3:4b-instruct`, `buddy server --port 3620` :

```
AVANT  {"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}
APRÈS  {"usage":{"prompt_tokens":16778,"completion_tokens":7,"total_tokens":16785}}
SSE    …"finish_reason":"stop"}],"usage":{"prompt_tokens":16494,"completion_tokens":6,…}
REPLI  (CODEBUDDY_STREAM_USAGE=false, port 3621)
       {"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11,"estimated":true}}
```

Le repli rend les **mêmes** chiffres qu'avant — c'est bien le même calcul — mais il ne se fait plus
passer pour une mesure.

---

## Écart 2 — « 3000 HTTP + 3001 Gateway WS » — **FERMÉ** (`9a6d19c91`)

### La mesure

```
$ ss -ltnp | grep <pid de `buddy server --port 3620`>
LISTEN 0 511 127.0.0.1:3620 0.0.0.0:*  users:(("MainThread",pid=…,fd=38))
$ ss -ltn | grep :3621
(rien)
$ curl -i -H 'Upgrade: websocket' -H 'Sec-WebSocket-Key: …' http://127.0.0.1:3620/ws
HTTP/1.1 101 Switching Protocols
```

**Un processus, un port, `/ws` dessus.** Rien d'autre n'est lié.

### Ce que la lecture du code confirme

`DEFAULT_GATEWAY_CONFIG.port = 3001` appartient à la bibliothèque `src/gateway/`, que **rien**
n'instancie hors de `src/gateway/` et de ses tests — `buddy server` ne la démarre jamais. Le `/ws`
du serveur enregistre `authenticate`, `chat`, `stop`, `execute_tool`, `ping`, `status`, `avatar.*`,
`peer:*` ; la poignée de main `connect` → `hello_ok` → `auth` → `session_*` / `presence` que la doc
lui attribuait appartient à la bibliothèque, pas à ce point d'entrée. Deux mensonges pour le prix
d'un : le port **et** la liste des messages. Les deux sont corrigés.

`3001` reste une **convention de flotte** pour un SECOND processus du même binaire, ce que
`docs/deployment.md` disait déjà correctement (« They are separate processes of the same binary, not
two listeners in one process »).

### Documents corrigés

`CLAUDE.md`, `AGENTS.md`, `docs/infrastructure.md`, `docs/features.md`, `docs/getting-started.md`,
`docs/fleet-guide.md`, `docs/cowork/05-settings-server.md` (qui promettait un `port + 1` que
`ServerBridge` ne fait pas), `cowork/ARCHITECTURE.md` et la compétence `code-buddy`.
**`README.md` ne mentait pas** — il ne cite jamais 3001 ; c'est le test qui l'a établi, pas une
lecture rapide.

### Le test qui rougit

`tests/docs/serv2-ports-serveur.test.ts` : **9 rouges avant correctif, 12 verts après**. Il interdit
la citation de `3001` dans les dix documents qui décrivent UN `buddy server`, exige que CLAUDE.md et
AGENTS.md énoncent le port unique et le `/ws`, et vérifie que `docs/deployment.md` garde la
convention du second processus (seul endroit où `3001` est légitime, avec la recette de fumée du
guide de flotte qui lance explicitement `--port 3001`).

---

## Écart 3 — origine HTTP non listée : 200 sans en-tête, pas 403 — **FERMÉ** (`cdd35b65e`)

### La mesure

```
$ curl -i -H 'Origin: http://127.0.0.1:3620' …/api/health
HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://127.0.0.1:3620

$ curl -i -H 'Origin: https://evil.example' …/api/health
HTTP/1.1 200 OK            ← corps servi, AUCUN Access-Control-Allow-Origin

$ curl -i -X OPTIONS -H 'Origin: https://evil.example' …/api/health
HTTP/1.1 200 OK            ← préflight sans ACAO non plus
```

C'est le comportement CORS standard et correct : **le navigateur** refuse de rendre le corps à la
page appelante, le serveur ne refuse rien. Le seul refus côté serveur est sur le WebSocket
(`403 Forbidden origin`, GHSA-5wcw-8jjv-m286), et un client sans en-tête `Origin` (curl, CLI, pair de
flotte) passe.

Aucun document n'écrivait littéralement « 403 » ; le mensonge était par omission — « origin-hardened »
sans distinguer les deux surfaces. C'est la pire des formes : on croit protéger ce qui ne l'est pas.

### Le correctif documentaire

`CLAUDE.md`, `AGENTS.md`, `docs/deployment.md` et `docs/infrastructure.md` séparent désormais les deux
surfaces et tirent la conséquence à voix haute : **CORS n'est pas un contrôle d'accès**, le contrôle
d'accès c'est le JWT et le réseau.

### Les deux tests

- `tests/server/serv2-cors-origine-non-listee.test.ts` fige le comportement (origine listée → ACAO ;
  non listée → 200 sans ACAO et corps réellement servi ; préflight idem ; sans `Origin` → servi).
  Ce test est vert d'emblée, donc il fallait prouver qu'il peut rougir : muter la garde en
  `origin: (origin, cb) => cb(null, true)` dans `src/server/index.ts` le fait échouer **2/4** ; source
  restaurée par `git checkout --`, revert vérifié, 4/4 vert.
- `tests/docs/serv2-cors-doc.test.ts` : **4 rouges avant correctif**, 4 verts après.

---

## Vérifications

```
npx vitest run tests/server tests/docs tests/security
 Test Files  114 passed (114)
      Tests  1519 passed (1519)

npx tsc --noEmit -p .                          → code 0
npm run build                                  → code 0
npx eslint <les 9 fichiers modifiés/ajoutés> --max-warnings=0   → code 0
git diff --check                               → code 0
tests/security/donnees-personnelles.test.ts    → 7/7
```

Les tests `tests/docs/revue-gemini-docs.test.ts` exigent un `dist/` compilé (ils exécutent le CLI) :
sans build ils rendent 16 rouges **environnementaux**, sans rapport avec ce chantier. Le comptage
ci-dessus est pris **après** `npm run build`, comme la lane DOCFIX3 avant nous.

Suites voisines contrôlées après l'écart 1 : `tests/agent` 206 fichiers / 2 683 verts,
`tests/agent/streaming` + `tests/codebuddy` 23 fichiers / 279 verts.

Commits : `25c942569` (réservation), `d09b3d214` (écart 1), `9a6d19c91` (écart 2), `cdd35b65e`
(écart 3). Aucun push.

## Reste ouvert

- `stream_options.include_usage` est envoyé à **tous** les fournisseurs OpenAI-compatibles. Ollama,
  vLLM, LM Studio et les passerelles hébergées l'honorent ou l'ignorent ; une passerelle exotique qui
  refuserait un paramètre inconnu se désarme par `CODEBUDDY_STREAM_USAGE=false`. Non éprouvé sur les
  quinze fournisseurs — seul Ollama a été mesuré en vrai, le reste repose sur la spécification OpenAI.
- Le provider natif Gemini et le backend ChatGPT-Responses ont leur propre chemin : `getLastTurnUsage()`
  y rend `undefined`, donc l'estimation **marquée** s'applique. Correct, mais moins précis.
- La liste des messages `/ws` corrigée dans CLAUDE.md décrit `src/server/websocket/handler.ts` à ce
  jour ; aucun test ne la fige encore.

## Bilan (10 lignes)

1. Écart 1 fermé : `usage.prompt_tokens` passe de `8` (deviné) à `16778` (mesuré par Ollama) sur la même requête.
2. La cause première n'était pas dans la route : `stream_options.include_usage` n'était jamais demandé, donc aucun fournisseur ne renvoyait ses compteurs.
3. Le repli existe toujours et s'annonce : `usage.estimated: true`, prouvé en direct avec `CODEBUDDY_STREAM_USAGE=false`.
4. Écart 2 fermé : `ss -ltnp` montre **un seul** listener (3620), rien sur 3621, `/ws` en `101 Switching Protocols` sur le même port.
5. `DEFAULT_GATEWAY_CONFIG.port = 3001` n'est lié par personne — la bibliothèque `src/gateway/` n'est jamais instanciée par `buddy server`.
6. Neuf documents corrigés ; `README.md` ne mentait pas, le test l'a établi plutôt qu'une lecture.
7. Écart 3 fermé : origine non listée → `200` sans `Access-Control-Allow-Origin`, corps servi ; le refus 403 n'existe que sur le WebSocket.
8. Rouge collé avant chaque correctif : 4 (usage), 9 (ports), 4 (doc CORS) ; le test CORS serveur, vert d'emblée, est mutation-prouvé 2/4.
9. Vérifié : 114 fichiers / 1 519 tests verts ; `tsc` 0 ; `npm run build` 0 ; ESLint ciblé 0 ; `git diff --check` 0 ; données personnelles 7/7.
10. Ouvert : `include_usage` non éprouvé hors Ollama ; Gemini natif et ChatGPT-Responses restent en estimation marquée ; la liste des messages `/ws` n'est pas figée par un test.
