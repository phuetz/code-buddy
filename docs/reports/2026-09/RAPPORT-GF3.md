# RAPPORT GF3 — PRIV2 a-t-il changé une valeur exécutée ?

Revue en **lecture seule** du diff `DIFF-PRIV2-CODE.diff` (2 298 lignes, **82 fichiers, 169 hunks**),
lu **intégralement** par tranches. Vérifications croisées faites dans le dépôt de revue
`~/DEV/cb-gf3-2026-09-04` (clone au commit `f42783007`, PRIV2 déjà appliqué) avec `grep`/`sed`/`cat`.
Aucune commande de modification, aucun test lancé, aucun service touché.

**Quatre catégories** (la troisième est un ajout nécessaire : la mission n'a pas de case pour
« test renommé des DEUX côtés, qui prouve exactement la même chose ») :

| Catégorie | Sens |
| --- | --- |
| **DOC** | commentaire, docstring, `description` de schéma, placeholder d'UI, texte d'aide → sans effet sur une comparaison |
| **VALEUR EXÉCUTÉE** | change ce qu'un programme compare, ouvre, appelle ou sérialise |
| **TEST COHÉRENT** | fixture ET attente renommées ensemble → la preuve est intacte |
| **TEST AFFAIBLI** | une attente remplacée par une valeur qui ne prouve plus la même chose |

---

## 1. Les 5 lignes les plus dangereuses (en tête du tableau)

| fichier:ligne | avant | après | catégorie | risque |
| --- | --- | --- | --- | --- |
| `scripts/miroir-actifs.sh:18` | `DEST="${MIROIR_DEST:-/data/backups/<machine-hôte>}"` | `DEST="${MIROIR_DEST:-/data/backups/hub}"` | **VALEUR EXÉCUTÉE** | **CRITIQUE** |
| `src/protocols/a2a/index.ts:403` | `spokeName.toLowerCase().includes('<machine-hôte>')` | `spokeName.toLowerCase().includes('hub')` | **VALEUR EXÉCUTÉE** | **ÉLEVÉ** |
| `scripts/influencer/systemd/codebuddy-flow-daily.service:13` | `--project-url https://labs.google/fx/fr/tools/flow/project/<uuid>` | `--project-url ${FLOW_PROJECT_URL}` | **VALEUR EXÉCUTÉE** | **ÉLEVÉ** |
| `src/tools/video-studio-tool-helpers.ts:119` (+ `src/tools/video-flow-handoff-tool.ts:261`) | `pickBoolean(record, ['<machine-hôte>'], 'capacity.<machine-hôte>')` | `pickBoolean(record, ['localGpu'], 'capacity.localGpu')` | **VALEUR EXÉCUTÉE** | **MOYEN-ÉLEVÉ** |
| `src/commands/handlers/fleet-handler.ts:328` | `` `ws://<ip-maillée-tiretée>:3000/ws` → `<ip-maillée-tiretée>:3000` `` | `` `ws://203.0.113.10:3000/ws` → `<ip-maillée-tiretée>:3000` `` | **DOC** (mais régression du but de PRIV2) | **MOYEN** |

### Détail des cinq

**1. `scripts/miroir-actifs.sh:18` — la sauvegarde des actifs irremplaçables change de cible.**
Le script fait `mkdir -p "$DEST"` puis `rsync` des personas/LoRA, masters vidéo, livres, clips Flow.
Constat sur la machine (lecture seule) : `/data/backups/<machine-hôte>` **existe et pèse 40 Go** ;
`/data/backups/hub` **n'existe pas**. Une exécution sans `MIROIR_DEST` crée donc un arbre neuf et
vide, recopie 40 Go, et **abandonne silencieusement le miroir existant** — qui cesse d'être mis à
jour sans qu'aucun message ne le dise. C'est la seule substitution qui touche un chemin de
sauvegarde. Le dépôt est public mais le script est exécuté sur la machine de l'auteur : le nom
`<machine-hôte>` devait être retiré du dépôt, pas du **défaut** — la bonne forme aurait été de garder
`MIROIR_DEST` obligatoire (comme `MISSION_FILE` ailleurs dans le même lot) plutôt que de substituer
un défaut neuf.

**2. `src/protocols/a2a/index.ts:403` — l'heuristique « toujours allumé » ne désigne plus la bonne machine.**
`scoreSpokeForSkill()` ajoute `+5` aux spokes dont le NOM contient `<machine-hôte>` ou `linux`. Or les
spokes s'auto-nomment `ollama-<hostname>` (`scripts/ollama_a2a_spoke.py:78`,
`self.spoke_name = name or f"ollama-{self.hostname}"`), et `detect_hostname()` renvoie le **vrai**
nom de machine. Après PRIV2 : `ollama-<machine-hôte>` ne matche plus rien → **perd son bonus** ; à
l'inverse tout nom contenant `hub` (y compris `github-…`) le gagne. `findBestSpokeForSkill` retombe
alors sur la fraîcheur du heartbeat (`+3`) et l'ordre d'insertion. Le test
`tests/protocols/a2a-skill-selection.test.ts` reste vert parce que sa fixture a été renommée
`ollama-hub` : **le test ne peut pas voir la régression de production**.

**3. `scripts/influencer/systemd/codebuddy-flow-daily.service:13` — échec silencieux, pas échec bruyant.**
systemd substitue `${FLOW_PROJECT_URL}` dans `ExecStart`. L'unité ne déclare **ni** `Environment=`
**ni** `EnvironmentFile=` pour cette variable (seulement `PYTHONUNBUFFERED` et
`PYTHONDONTWRITEBYTECODE`). Sans drop-in opérateur, la variable est vide et le service lance
`flow-daily.py --resume --project-url ""` : le travail quotidien démarre, consomme sa fenêtre,
et vise un projet vide. Le commentaire ajouté explique quoi faire, mais un commentaire n'empêche
pas le démarrage. Comparer avec `flow-crame.py` (point 8 du tableau) qui, lui, **s'arrête** avec un
message — c'est la bonne forme, non appliquée ici.

**4. `src/tools/video-studio-tool-helpers.ts:119` — rupture de contrat de fil, sans alias de compatibilité.**
`parseHybridCapacity` exige désormais `capacity.localGpu` et **n'accepte pas** l'ancien
`capacity.<machine-hôte>` — alors que la clé voisine accepte les deux formes
(`pickBoolean(record, ['google_flow', 'googleFlow'], …)`). `pickBoolean` lève
`capacity.localGpu must be a boolean` si la clé manque. Trois outils agents traversent ce parseur :
`video_route` (`video-route-tool.ts:88`), `video_flow_handoff` (`video-flow-handoff-tool.ts:122`),
`video_trailer_plan` (`video-trailer-plan-tool.ts:75`). Même rupture pour
`<machine-hôte>_available` → `local_gpu_available` (`video-flow-handoff-tool.ts:261`). Tout appel, plan
sauvegardé ou script externe portant l'ancienne clé **échoue** au lieu de dégrader.
*Atténuation vérifiée* : le renommage est **symétrique** (schéma JSON `required`, parseur, types,
producteurs, tests) — un appel NEUF est correct ; et `capacity` **n'entre pas** dans
`handoffSha256` (le champ `unsigned` de `google-flow-handoff.ts:190-206` ne contient que
`remainingCreditsBefore/After`), donc **aucun artefact signé existant ne devient invérifiable**.

**5. `src/commands/handlers/fleet-handler.ts:328` — l'adresse privée a survécu, et le commentaire est devenu faux.**
La substitution n'a porté que sur l'**entrée** de l'exemple, pas sur la **sortie** : le JSDoc dit
maintenant `ws://203.0.113.10:3000/ws` → `<ip-maillée-tiretée>:3000`, ce que `deriveDefaultPeerId`
(`u.host.replace(/\./g, '-')`) ne produira jamais — il rendrait `203-0-113-10:3000`. Double défaut :
(a) le commentaire ne décrit plus la fonction ; (b) **c'est la seule et dernière trace de
l'adresse du maillage privé dans tout le dépôt** (vérifié : `grep -rn '<ip-maillée-tiretée>'` → 1 occurrence,
`grep -rn '100\.98\.18\.76'` → 0). Et le garde-fou neuf **ne peut pas l'attraper** : `RE_IP_MAILLEE`
attend des **points**, la forme survivante a des **tirets**. Sans effet exécuté, mais PRIV2 rate
ici précisément la cible qu'il s'était donnée.

---

## 2. Tableau complet des hunks (hors les 5 ci-dessus)

### 2.1 VALEUR EXÉCUTÉE — le reste (38 hunks)

| fichier:ligne | avant | après | catégorie | risque |
| --- | --- | --- | --- | --- |
| `src/tools/video/hybrid-video-router.ts:16,23,57,83,84,97,100` | `'<machine-hôte>-comfyui'` / `capacity.<machine-hôte>` | `'localGpu-comfyui'` / `capacity.localGpu` | VALEUR EXÉCUTÉE | **FAIBLE** — union de types + valeur `route.primary`. Vérifié : `buildGoogleFlowHandoff` **jette** sur toute route non `google-flow-*` (`google-flow-handoff.ts:164`), donc la chaîne renommée n'atterrit jamais dans un handoff signé ; aucune comparaison littérale ailleurs |
| `src/codebuddy/tool-definitions/multimodal-tools.ts:516,656,693,765` | `<machine-hôte>` dans `properties` + 3× `required` | `localGpu` | VALEUR EXÉCUTÉE | MOYEN — contrat JSON Schema vu par le LLM, `additionalProperties:false`. Cohérent avec le parseur (point 4) |
| `src/codebuddy/tool-definitions/multimodal-tools.ts:709` | `<machine-hôte>_available` | `local_gpu_available` | VALEUR EXÉCUTÉE | MOYEN — idem, opération `export` |
| `src/tools/video-flow-handoff-tool.ts:51,169,185` | `<machine-hôte>` / `<machine-hôte>_available` | `localGpu` / `local_gpu_available` | VALEUR EXÉCUTÉE | MOYEN — schéma + `required` |
| `src/tools/video-route-tool.ts:25,73` | `<machine-hôte>` | `localGpu` | VALEUR EXÉCUTÉE | MOYEN — schéma + `required` |
| `src/tools/video-trailer-plan-tool.ts:31,55` | `<machine-hôte>` | `localGpu` | VALEUR EXÉCUTÉE | MOYEN — schéma + `required` |
| `src/tools/video/google-flow-plan-export.ts:91,204` | `<machine-hôte>Available` → `capacity.<machine-hôte>` | `localGpuAvailable` → `capacity.localGpu` | VALEUR EXÉCUTÉE | FAIBLE — interface interne, producteurs renommés ensemble |
| `src/tools/metadata.ts:1025` | mot-clé `'<machine-hôte>'` | `'localGpu'` | VALEUR EXÉCUTÉE | FAIBLE — indexé par BM25 (`src/tools/tool-search.ts:61` tokenise `keywords`) : une requête « <machine-hôte> » ne remonte plus `video_route` |
| `src/tools/video-route-tool.ts:136` | mot-clé `'<machine-hôte>'` | `'localGpu'` | VALEUR EXÉCUTÉE | FAIBLE — idem via `getMetadata()` |
| `scripts/mysoulmate/export-google-flow-batch.ts:63` | `!argv.includes('--no-<machine-hôte>')` | `!argv.includes('--no-localGpu')` | VALEUR EXÉCUTÉE | FAIBLE-MOYEN — **drapeau CLI renommé sans alias** : un `--no-<machine-hôte>` tapé par habitude est ignoré silencieusement et vaut « GPU local disponible ». Aucun appelant `--no-<machine-hôte>` trouvé dans le dépôt |
| `scripts/trailers/produce-book-trailer.ts:432` | `<machine-hôte>: false` | `localGpu: false` | VALEUR EXÉCUTÉE | FAIBLE — appelant aligné sur l'interface |
| `scripts/influencer/flow-crame.py:19,55-63` | `FLOW_PROJECT_ID = 'FLOW_PROJECT_ID_REDACTED'` | `os.environ.get('FLOW_PROJECT_ID','')` + `SystemExit` | VALEUR EXÉCUTÉE | FAIBLE — **amélioration** : l'avant était DÉJÀ caviardé (donc `FLOW_PROJECT_URL` pointait vers `.../project/FLOW_PROJECT_ID_REDACTED`, silencieusement faux, et le garde `if FLOW_PROJECT_ID in url` (l.136, l.294) ne matchait jamais). PRIV2 transforme un faux silencieux en arrêt explicite |
| `scripts/fix-research.sh:5-8` | (aucun garde) | `if [ -z "${DIAGNOSTIC_FILE:-}" ] … exit 2` | VALEUR EXÉCUTÉE | FAIBLE — amélioration ; refuse de tourner sans le diagnostic. `$DIAGNOSTIC_FILE` est interpolé dans le prompt entre guillemets doubles : correct |
| `scripts/flow-fix.sh:3` + `scripts/run-{ambre-editorial,automne,base-visionai,collecteur,dossier-medecin,flow-25k,kit-publication,ninon,publication,raccordement,vestiaire,voix-eleven}.sh:3` (**12 fichiers**) | `P=/tmp/claude-1000/…/scratchpad/mission-X.txt` | `P="${MISSION_FILE:?…}"` | VALEUR EXÉCUTÉE | FAIBLE — amélioration : le chemin en dur était un scratchpad de session mort ; l'avant faisait `cat: fichier introuvable` puis lançait `codex exec ""`. L'après s'arrête |

### 2.2 DOC — sans effet exécuté (28 hunks)

| fichier:ligne | avant → après | catégorie | risque |
| --- | --- | --- | --- |
| `buddy-sense/src/senses/live_audio.rs:880` | commentaire « (including <machine-hôte>) » retiré | DOC | nul |
| `cowork/src/main/fleet/fleet-bridge.ts:6-7` | commentaire d'en-tête, exemple d'URL | DOC | nul — aucune URL par défaut dans le fichier |
| `cowork/src/renderer/components/FleetPanel.tsx:198,214,248` | `placeholder=` ×2 + texte d'état vide | DOC | nul — un `placeholder` HTML n'est pas une `value` |
| `cowork/src/renderer/components/settings/SettingsRemoteBackend.tsx:206` | `placeholder="ws://<ip-lan-privée>:3001"` → `203.0.113.10` | DOC | nul |
| `scripts/blenderproc/README.md:34,36` | « <machine-hôte> » → « le hub » | DOC | nul |
| `scripts/gpuNode/start-lisa-krea2-training.ps1:38` | commentaire | DOC | nul |
| `scripts/ollama_a2a_spoke.py:29,42` | docstrings | DOC | nul — `detect_hostname()` calcule le nom à l'exécution, ne le compare à aucun littéral |
| `scripts/influencer/flow-crame.py:116` | message `print(WARN …)` | DOC | nul |
| `scripts/fix-research.sh:12,17` | prose de mission (Parkinson → revue de littérature ; « 45 809 articles » → « plusieurs dizaines de milliers ») | DOC | nul — texte de prompt |
| `src/agent/autonomous/fleet-tick-handler.ts:86` · `src/config/toml-config.ts:527` · `src/fleet/autonomous-tick-broadcaster.ts:43` · `src/fleet/types.ts:85` · `src/fleet/fleet-listener.ts:58` | JSDoc d'exemples (`<machine-hôte>/grok-cli`, URL WS) | DOC | nul |
| `src/commands/handlers/fleet-handler.ts:1905` | texte d'aide `/fleet autonomous` : `host = "<machine-hôte>/grok-cli"` → `"hub/grok-cli"` | DOC | nul — chaîne d'aide, pas une valeur par défaut |
| `src/commands/handlers/heartbeat-handler.ts:16` | commentaire d'en-tête | DOC | nul |
| `src/memory/adapters/network-memory-adapters.ts:92` | commentaire | DOC | nul |
| `src/agent/hermes-memory-providers.ts:271,281,291` | champs `remediation` (texte affiché) | DOC | nul — jamais comparés |
| `src/agent/hermes-parity-manifest.ts:335` | champ `notes` (prose du manifeste) | DOC | nul — vérifié : aucun test n'assure ce champ |
| `src/providers/turboquant-provider.ts:45` · `src/utils/config-validation/schema.ts:298` | exemple `<ip-lan-privée>` → `203.0.113.20` en JSDoc / `.describe()` | DOC | nul — `.describe()` est du texte d'aide zod, pas une valeur par défaut ni une contrainte |
| `src/codebuddy/tool-definitions/multimodal-tools.ts:516,740` · `src/tools/video-route-tool.ts:26,84` · `src/tools/video-flow-handoff-tool.ts:51` · `src/tools/video-trailer-plan-tool.ts:31` | champs `description` des schémas (« <machine-hôte> local GPU worker » → « Local GPU worker ») | DOC | nul — texte de prompt, pas une comparaison |

### 2.3 TEST COHÉRENT — renommage symétrique, preuve intacte (97 hunks)

Tous vérifiés : la fixture **et** l'attente sont modifiées dans le même hunk, avec la même valeur.

| fichier | nb hunks | vérification |
| --- | --- | --- |
| `tests/fleet/fleet-chat-helper.test.ts` | 28 | `registerPeer('hub-linux')` + attentes `"hub-linux-1"` alignées |
| `tests/tools/video/google-flow-handoff.test.ts` | 6 | fixtures `capacity.localGpu` |
| `tests/fleet/task-router.test.ts` | 8 | `peer('hub')` + `expect(plan.primary.peerId).toBe('hub')` |
| `tests/fleet/fleet-handler.test.ts` | 5 | `machineLabel`/`hostname` fixtures + attentes |
| `tests/memory/collective-knowledge-graph.test.ts` | 4 | `agentId: 'hub/code-buddy'` + `expect(hits[0].agentId)` |
| `tests/daemon/autonomous-loop.test.ts` | 4 | `agentId` du store + `listPresence()['hub-linux/code-buddy']` |
| `tests/protocols/a2a-skill-selection.test.ts` | 5 | `ollama-hub` contient `hub` → `+5` ; `ollama-gpuNode` non → **le test discrimine toujours** |
| `tests/tools/list-peers-tool.test.ts` | 3 | `machineLabel` fixture + attente |
| `tests/daemon/autonomous-loop-self-improve.test.ts` | 2 | idem store/présence |
| `tests/fleet/cost-tracker.test.ts` | 3 | `peerId:'hub'` + `summary.todayByPeer.hub` |
| `tests/agent/model-tier.test.ts` | 3 | mock tailscale + `label` attendu |
| `cowork/.../autonomy-queue-model.test.ts` | 2 | tri vérifié : `Number(b.fresh)-Number(a.fresh) \|\| a.name.localeCompare(b.name)` → ordre inchangé (`hub/fleet` frais avant `old/agent` périmé, comme `<machine-hôte>/fleet` avant) |
| `tests/agent/autonomous/fleet-llm-routing.test.ts` | 2 | `OLLAMA_HOST='203.0.113.10:11434'` + attente `http://203.0.113.10:11434/v1` : prouve la même normalisation |
| `tests/protocols/a2a-skill-routing.test.ts` | 2 | `registerRemote(…, 'http://203.0.113.14:3002')` + `expect(url).toBe('http://203.0.113.14:3002/api/a2a/tasks/send')` |
| `tests/protocols/a2a-remote-agents.test.ts` | 2 | carte + `getAgentCard(...)?.name` |
| `tests/tools/{video-route,video-trailer-plan,video-flow-handoff}-tool.test.ts`, `tests/tools/video/{cinematic-trailer-plan,google-flow-plan-export,google-flow-result-import,hybrid-video-router}.test.ts`, `tests/scripts/run-flow-generation.test.ts` | 12 | fixtures `capacity.localGpu` / `localGpuAvailable` / `local_gpu_available` |
| `tests/fleet/{autonomous-tick-broadcaster,colab-store,fleet-listener,fleet-registry}.test.ts` | 8 | fixtures + attentes |
| `tests/mcp/mcp-ckg-tools.test.ts`, `tests/memory/buddy-memory-engine.test.ts`, `tests/protocols/a2a-codebuddy-executor.test.ts`, `tests/voice/kyutai-local-voice.test.ts` | 4 | fixtures + attentes (`expect(JSON.parse(received)).toEqual({text:'Bonjour depuis Hub.'})`) |
| `tests/scripts/influencer/test_flow_crame_send.py` | 2 | **renforcement** : `os.environ.setdefault('FLOW_PROJECT_ID','projet-de-test')` pour pouvoir importer, + 2 tests neufs (arrêt sans variable, aucun UUID en dur dans le script) |
| `tests/security/donnees-personnelles.test.ts` | 4 | **renforcement** : +4 motifs regex (RFC 1918 /16, /8, RFC 6598, UUID de projet Flow), +6 contre-épreuves (boucle locale, RFC 5737 ×2, numéro de version, `100.12.x` hors plage, UUID hors contexte), + `<machine-hôte>` ajouté aux `INTERDITS` |
| `tests/server/exposure-diagnostic.test.ts:23` | 1 | `'<ip-maillée-tiretée>'` → `'203.0.113.10'` dans `it.each`. Vérifié : `diagnoseServerExposure` ne discrimine que par `isLoopbackHost` (`exposure-diagnostic.ts:41-43`) — les deux adresses sont également non-loopback, **la preuve est identique**. (Le fichier est de surcroît dans `FICHIERS_PLAGES_PRIVEES` : la substitution n'était même pas nécessaire) |

### 2.4 TEST AFFAIBLI (1 hunk)

| fichier:ligne | avant | après | catégorie | risque |
| --- | --- | --- | --- | --- |
| `tests/security/donnees-personnelles.test.ts` — bloc `DETECTION_FIXTURES` | **16** fixtures de détection | **11** fixtures | **TEST AFFAIBLI** | MOYEN |

**Dix** fixtures ont été **supprimées** dans le même hunk qui en ajoute cinq :
`<terme-emploi-1>`, `<terme-emploi-2>` (accentué), `<terme-emploi-2>` (non accentué), `<terme-emploi-3>`,
`<terme-emploi-3>`, `<terme-emploi-4>`, `<terme-employeur>`, `<terme-emploi-5>`,
le préfixe réseau `<préfixe-du-maillage-privé>`, et le nom de machine GPU `<machine-gpu>`.

Or ces **dix termes restent actifs** dans `INTERDITS` (vérifié lignes 125-142 du fichier final).
Le garde-fou continue donc de les interdire à l'exécution — **sa portée n'est pas réduite**, c'est
la **preuve** qui l'est : plus rien n'atteste que le détecteur rougit sur ces motifs. En particulier
les paires accentué/non-accentué (`chômage`/`chomage`, `pôle`/`pole`) ne sont plus couvertes, et
`<machine-gpu>` comme `<préfixe-du-maillage-privé>` — qui n'ont AUCUN rapport avec le périmètre de PRIV2 — perdent leur
témoin sans contrepartie.

Nuance honnête : le détecteur est une boucle générique unique
(`INTERDITS.filter(t => contenu.toLowerCase().includes(t))`), donc une seule fixture de sous-chaîne
suffit techniquement à l'exercer, et six subsistent. Le hunk **ajoute** par ailleurs quatre motifs
regex neufs et six contre-épreuves (voir 2.3) : le bilan net du fichier est un **renforcement**.
Il n'empêche que dix témoins ont été retirés sans que leur terme le soit — c'est une suppression
de surface de preuve, pas un échange.

---

## 3. Compte par catégorie

| Catégorie | Hunks | Part |
| --- | ---: | ---: |
| **TEST COHÉRENT** (fixture + attente renommées ensemble) | **97** | 57,4 % |
| **VALEUR EXÉCUTÉE** | **43** | 25,4 % |
| **DOC** | **28** | 16,6 % |
| **TEST AFFAIBLI** | **1** | 0,6 % |
| **Total** | **169** | 100 % |

Répartition des 43 VALEUR EXÉCUTÉE par gravité :

| Gravité | Hunks | Contenu |
| --- | ---: | --- |
| **CRITIQUE** | 1 | destination de sauvegarde (`miroir-actifs.sh`) |
| **ÉLEVÉ** | 2 | heuristique de routage A2A ; `ExecStart` systemd à variable vide |
| **MOYEN-ÉLEVÉ** | 2 | parseurs `capacity` sans alias de compatibilité |
| **MOYEN** | 12 | schémas JSON `required` + propriétés renommées (cohérents entre eux) |
| **FAIBLE** | 26 | union de types jamais sérialisée, mots-clés BM25, interfaces internes alignées, **et 15 hunks d'amélioration** (13 scripts qui s'arrêtent au lieu de tourner à vide, `flow-crame.py`, `fix-research.sh`) |

Couverture : les 169 hunks des 82 fichiers ont été lus. **Rien n'a été laissé de côté.**
Vérifications croisées faites dans le dépôt de revue : fonction de scoring A2A, corps de
`deriveDefaultPeerId`, `pickBoolean`/`parseHybridCapacity` et leurs 3 appelants, champ `unsigned`
hashé de `google-flow-handoff.ts`, consommateurs de `HybridVideoEngine`, index BM25
`tool-search.ts`, `isLoopbackHost`/`diagnoseServerExposure`, tri de `summarizeAutonomyQueue`,
état final de `INTERDITS`, recherche exhaustive de `<machine-hôte>` sur `git ls-files` (**zéro
occurrence résiduelle** hors le fichier garde-fou), et existence réelle de `/data/backups/<machine-hôte>`
(40 Go) contre l'absence de `/data/backups/hub`.

---

## 4. Conclusion (trois lignes)

**Oui, PRIV2 a changé des comportements exécutés** : 43 hunks sur 169 touchent une valeur comparée,
ouverte, appelée ou sérialisée — dont quinze sont des améliorations volontaires (scripts qui
échouent bruyamment au lieu de tourner à vide) et vingt-six des renommages internes symétriques
et inoffensifs.

**Deux régressions réelles et une rupture de contrat doivent être corrigées avant publication** :
`scripts/miroir-actifs.sh:18` détourne la sauvegarde des actifs irremplaçables vers un répertoire
inexistant alors que les 40 Go du miroir vivent dans l'ancien ; `src/protocols/a2a/index.ts:403`
retire le bonus « toujours allumé » à la machine qui le portait réellement, sans qu'aucun test ne
puisse le voir puisque sa fixture a été renommée en même temps ; et
`scripts/influencer/systemd/codebuddy-flow-daily.service:13` démarre avec une URL de projet vide
au lieu de refuser de démarrer.

**Le but même de PRIV2 est manqué en un point** : `src/commands/handlers/fleet-handler.ts:328`
conserve l'adresse du maillage privé sous forme `<ip-maillée-tiretée>`, invisible pour le garde-fou neuf
dont la regex n'attend que des points — et un seul test a perdu de la surface de preuve
(dix témoins retirés de `DETECTION_FIXTURES` alors que leurs dix termes restent interdits).
