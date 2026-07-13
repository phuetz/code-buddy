# Étude — Code Explorer + Perception du monde physique (« simuler pour comprendre »)

> Étude approfondie du 2026-07-12. Deux buts : (1) s'assurer que **Code Explorer** est bien intégré dans Code Buddy ; (2) travailler la **perception du monde physique**, avec la piste « **simuler le monde réel pour mieux le comprendre** » (monde virtuel 3D, pilotage Blender).
>
> Méthode : 4 sous-agents Sonnet 5 (audit intégration Code Explorer, cartographie de la pile de perception réelle, recherche web world-models/sim-to-real, recherche web objets 3D + Blender) + vérifications MCP Code Explorer en direct sur ce dépôt + lecture du dépôt `~/DEV/world-model`.

---

## 0. La thèse unificatrice — les deux buts sont deux briques du même projet

Ce n'est pas une coïncidence que les deux buts arrivent ensemble. Ton propre `README.md` du repo **`world-model`** l'écrit noir sur blanc :

> *« World model inspiré de JEPA (Yann LeCun) […]. **Brique d'un projet robot long terme** par Patrice Huetz (le repo **GitNexus** en est **une autre brique**). »*

GitNexus = Code Explorer. Donc :

- **But 1 (Code Explorer)** = le robot comprend **le code** (le sien, celui qu'il écrit/répare).
- **But 2 (perception + world model)** = le robot comprend **le monde physique**.

Et il existe déjà, **dans le code de Code Buddy**, la couture (« seam ») nommée qui doit relier les deux mondes — voir §3. La colonne vertébrale du projet est :

```
        CODE                          MONDE PHYSIQUE
   Code Explorer (gitnexus)      buddy-sense / buddy-vision (capteurs)
          │                                │
          ▼                                ▼
   graphe de code            world model JEPA (prédiction latente)
          │                                │
          └──────────►  Code Buddy  ◄──────┘
                    (agent, self-improvement,
                     mémoire collective CKG)
```

L'étude qui suit montre que **le pont But-1 est déjà construit et fonctionne**, et que **le pont But-2 est à ~70 % scaffoldé mais pas encore raccordé** — et surtout que tu possèdes déjà l'actif manquant (le repo `world-model`).

---

# PARTIE 1 — Code Explorer est-il bien intégré ? (But 1)

## 1.1 Verdict : OUI, l'intégration est réelle et fonctionnelle

Vérifié **en direct** via le serveur MCP `code-explorer` pendant cette étude :

| Preuve live (MCP) | Résultat |
|---|---|
| `list_repos` | Le dépôt `code-buddy` est indexé : **97 812 nœuds / 232 361 arêtes**, 4 673 fichiers, 75 processus. |
| `report` | Grade **E**, hotspot #1 = `cowork/src/main/index.ts` (152 commits) → confirme le god-file déjà connu. |
| `search_code "sensory perception bridge…"` | Retrouve exactement `src/sensory/reactions.ts` (interface `Perception`), `getGlobalEventBus`, `buddy-vision/watch.py`. Recherche sémantique **opérationnelle**. |
| `impact("executePlan", both)` | Renvoie l'analyse upstream+downstream complète (bien au-delà de 18) → l'ancien bug « impact 18 vs 187 » est **corrigé**. |

Le câblage côté Code Buddy (audit du code, avec `fichier:ligne`) :

- **Config MCP** : `.codebuddy/mcp.json` → serveur `code-explorer` = binaire `~/DEV/gitnexus-rs/target/release/gitnexus mcp`, `enabled:true`. Double-nommage `code-explorer`/`gitnexus` toléré par regex (`src/codebuddy/tools.ts:398`).
- **Client réel** : `src/plugins/code-explorer/code-explorer-client.ts` (appelle `MCPManager.callTool` avec préfixe résolu dynamiquement, never-throws) + `CodeExplorerManager.ts` (cycle de vie process, stats).
- **Tool natif LLM** : `code_explorer_ask` (déf. `src/codebuddy/tool-definitions/code-explorer-tools.ts:9-28`, adaptateur `src/tools/registry/code-explorer-tools.ts`, metadata `fleetSafe:true` `src/tools/metadata.ts:1459`).
- **Steering** : `src/services/prompt-builder.ts:427-451` injecte `<code_explorer_priority>` **seulement si connecté** (dégradation propre sinon).
- **Skill bundled** : `src/skills/bundled/code-explorer.skill.md` (explique la sélection de repo obligatoire + tableau « besoin → outil »).
- **CLI** : `buddy code-explorer ask|push-session` (`src/commands/cli/code-explorer-commands.ts`).
- **Pont CKG** : `src/research/code-explorer-source.ts` tire `hotspots`/`find_cycles`/`get_insights` → nœuds `discovery` (via `buddy research ingest-code`).
- **Runner autonome** : `src/agent/autonomous/agentic-coding-runner.ts` injecte `CodeExplorerTool.ask()` comme « evidence » persistée dans les checkpoints.

Les **3 bugs historiques sont corrigés** (re-vérifiés) : impact-both, chargement de la skill bundled en checkout normal (`dist/skills/bundled/`), et l'attente MCP en headless (`getMCPReady()`, `src/index.ts:1012`). Tests : **57/57 verts**.

## 1.2 Les vrais gaps restants (backlog But 1)

| # | Gap | Détail | Effort |
|---|---|---|---|
| **1** | **Index périmé, silencieusement** | L'index date du 2026-07-02 ; **~209 commits** sur `src/` depuis. `CodeExplorerStats.stale` **existe** (`CodeExplorerManager.ts:27`) mais **personne ne le lit**. L'agent raisonne sur un graphe en retard sans le savoir. | Faible |
| **2** | **Pas d'auto-réindexation** | Aucun hook post-commit / check de fraîcheur. Option `CODEBUDDY_CODE_EXPLORER_AUTOINDEX=true` → `gitnexus analyze --incremental` en tâche de fond (fin de session, façon `dreaming.ts`). | Moyen |
| **3** | **Stub mort** | `src/plugins/code-explorer/CodeExplorerMCPClient.ts` = stub « returns empty », réexporté par le barrel mais jamais appelé. Piège pour un futur lecteur. → supprimer ou `@deprecated`. | Faible |
| **4** | **Doc benchmark périmée + jamais exécutée** | `docs/code-explorer-benchmark/README.md:54-61` affirme encore un « known gap, not yet closed » sur `getMCPReady()` **faux depuis le 19 juin**. Et le benchmark A/B (lift réel coût/complétude) n'a **jamais tourné** → aucun chiffre pour étayer le pitch. | Faible (fix doc) / Moyen (lancer) |
| **5** | **Docs orphelines** | `docs/code-explorer-integration.md` n'est lié depuis nulle part (ni README ni CLAUDE.md). CLAUDE.md ne mentionne Code Explorer qu'incidemment. → un paragraphe dédié dans CLAUDE.md (comme buddy-vision, film). | Faible |
| **6** | **`README.md:381` « 31 tools »** | Trompeur : 30 publics + `business` en édition privée. | Trivial |
| **7** | **Collision terminologique** | `readWorldModel()` dans `agentic-coding-runner.ts` = *world model du **code*** (compréhension de codebase), à **ne pas confondre** avec le world model JEPA physique (§3). À documenter pour éviter la confusion quand on branchera le vrai JEPA. | Trivial (doc) |

**Conclusion But 1** : rien de cassé. Ce sont des **finitions** (fraîcheur d'index, hygiène de code mort, cohérence doc) — pas un défaut d'intégration. Le maillon à plus forte valeur est le **#1/#2** (fraîcheur d'index) : un agent qui raisonne sur un graphe à 209 commits de retard prend de mauvaises décisions sans le signaler.

---

# PARTIE 2 — État réel de la perception physique (But 2)

Machine en **production 24/7** (systemd `--user`). État vérifié (code + `journalctl` + `vision.env`).

## 2.1 Ce qui existe et tourne

- **`buddy-sense/` (Rust)** — système nerveux : sens parallèles → thalamus (`bus.rs`, coalescing + attention par salience, vital jamais coalescé) → bridge WebSocket loopback durci. **En prod, seuls `vital` + `audio` live tournent** (`BUDDY_SENSE_ORGANS=vital,audio`, micro live ffmpeg+VAD adaptatif+Smart Turn v3.2+STT sherpa-onnx in-process). `live-screen`/`live-ui`/`neural-vad` : compilés, testés (49 tests), **jamais activés**.
- **`buddy-vision/` (Python)** — yeux sémantiques : MediaPipe FaceLandmarker, state-machines « Vigil » (1 event/transition) → `person_entered`/`person_left`/`drowsy`. Tourne sur la BRIO, `person_*` se déclenchent en continu. La caméra est **exclusivement** côté Python (le Rust ne la capture pas → jamais deux fois le même périphérique).
- **`src/sensory/` (TS)** — perception→cognition : ring buffer court terme (`sensory-memory.ts`) → consolidation périodique (`dreaming.ts` pour les stats capteurs, `episodic-journal.ts` pour le dialogue) → réactions débouncées (VLM local moondream sur keyframe, alertes Telegram, greeting vocal) → **boucle vocale complète** perception→`respond-decider`→cognition→`agent-reply` (l'agent agit sous permission scoped).
- **`src/vision-train/`** — boucle « entraîner le cerveau » : `curriculum.ts` (scènes domain-randomized déterministes + vérité-terrain auto-étiquetée) → `image_generate` → YOLO → `scorer.ts` (précision/rappel, weak-spots) → `ckg-publish.ts` (archive les faiblesses au CKG). **Mode `folder`** (`--images DIR --labels FILE`) = hardware-agnostic, aucune génération.

## 2.2 Ce qui MANQUE (le cœur du But 2)

L'audit est sans appel : **aucune représentation persistante et structurée de l'espace physique**.

- ❌ Pas de carte / occupancy grid / position 3D d'objets.
- ❌ Pas de suivi d'identité inter-transitions (chaque `person_entered` est indépendant — pas de « c'est la même personne que tout à l'heure »).
- ❌ Pas de fusion multi-capteurs (vision Python et audio Rust alimentent le même bus mais ne sont **jamais corrélés** — « la voix vient-elle de la personne détectée ? »).
- ❌ Pas d'état du monde interrogeable (« qu'y a-t-il actuellement dans la pièce ? »).
- ❌ **Aucun world model prédictif branché.** Aucun jumeau numérique. Aucun moteur physique / SLAM.
- ✅ `vision-train` **mesure** les faiblesses de perception, mais ne construit **aucune** représentation du monde.

En un mot : Code Buddy a des **sens** riches, une **mémoire de travail** et une **consolidation** de type sommeil — mais **pas de carte du monde ni de modèle prédictif de ce monde**.

---

# PARTIE 3 — La couture nommée + ton actif existant (`world-model`)

## 3.1 Le seam déjà présent dans le code

C'est la découverte la plus importante de l'étude. Dans `src/agent/self-improvement/experience-source.ts:~115`, la classe `SensorExperienceSource.collect()` **lève une exception volontaire** avec ce commentaire :

> *« the robot 5-senses seam and is not implemented in V1. **Wire a world-model (JEPA) latent prediction-error stream here when sensors are available.** »*

Traduction : Code Buddy a **déjà réservé la place** où doit se brancher un world model JEPA, dont **l'erreur de prédiction** deviendrait un flux d'expérience pour la self-improvement. Ce n'est pas à inventer — c'est à **raccorder**.

## 3.2 Ton repo `world-model` = exactement la brique attendue

`~/DEV/world-model` (`github.com/phuetz/world-model`) est un **world model JEPA en PyTorch, mûr et documenté honnêtement** :

- **Architecture JEPA** : `ObservationEncoder` (CNN) + `ActionEncoder` (MLP) → `LatentDynamicsModel` (z,a)→z′ ; cible = `encode(obs_{t+1})` en stop-gradient ; loss = MSE latent + régularisation isotrope VICReg (`IsotropicLatentRegularizer`). **Prédit dans l'espace latent, pas les pixels** — la thèse LeCun.
- **Progression expérimentale rigoureuse** V1 → V2.0, chaque étape mesurée :
  - V1.5 : passage au réel (Gymnasium CarRacing-v3). Collapse latent identifié (rank effectif 14.7/256), compounding error à h=20 (MSE explose à 119).
  - Expé λ_var=0.15 : **négative assumée** (la reg forte casse la prédiction) → le collapse n'est pas la racine.
  - V1.7 (politique mixte 50/50) : **+57 % de rank effectif**.
  - **V1.8 (teacher-forced rollout k=5)** : **compounding error éliminé** — MSE quasi-plat de h=1 à h=20 (×3 contre ×14 000 pour la baseline). **C'est le checkpoint utilisable.**
  - **V2.0 (planner CEM/MPC latent)** : `src/world_model/planning/cem.py` — 512 samples × 4 itérations × 12 horizon, **tout en latent** (jamais de pixel décodé). Bat random de +16 % (×2 en médian). Ablation : CEM sur V1.5 fait **×3.2 pire** que sur V1.8 → le rollout-training n'est pas optionnel.
- **Déjà branchable au hub** : `scripts/ollama_a2a_spoke.py` — un spoke **A2A** qui s'enregistre au hub Code Buddy (`POST /api/a2a/agents/register`, endpoint `/api/a2a/tasks/send`, AgentCard). Tu as **déjà** relié des services externes à Code Buddy par A2A. Or Code Buddy **expose** `/api/a2a/*` (voir CLAUDE.md « HTTP Server »). Le canal d'intégration existe donc des deux côtés.

**Limites actuelles à connaître** : entraîné sur **CarRacing** (jouet 2D voiture, pas le salon) ; encodeur CNN (sature, le README note « ViT à faire ») ; pas encore raccordé à Code Buddy. Ce n'est pas un blocage — c'est la feuille de route.

---

# PARTIE 4 — Recherche : « simuler pour comprendre » (état de l'art actionnable)

Contraintes du projet : matériel **AMD Ryzen AI / iGPU Strix Halo (gfx1151)**, budget **local/$0** privilégié. Filtre appliqué partout : *qu'est-ce qui tourne vraiment ici ?*

## 4.1 World models — ce qui est embarquable

| Famille | Exemples | Local AMD/$0 ? |
|---|---|---|
| **Latent RSSM** | DreamerV3 (**MIT**, `danijar/dreamerv3`), PlaNet, DreamerV2 | 🟢 seule lignée embarquable ; à échelle réduite (MinAtar) sur CPU — chantier |
| **JEPA (prédiction latente)** | I-JEPA (**CC-BY-NC ❌**), V-JEPA 2 (**MIT ✅**, ViT-L 300M ~600 Mo fp16), VL-JEPA (déc. 2025) | 🟠 V-JEPA 2 encodeur exportable ONNX ; predictor complet = recherche |
| **Génératifs/diffusion** | Genie 1/2/3 (fermé), NVIDIA Cosmos (Apache code, poids datacenter 7-14B), World Labs/Marble (cloud payant), Oasis/Odyssey (fermé, H100) | 🔴 inutilisable localement — **valeur de validation conceptuelle** de la thèse |

**Argument LeCun** (« A Path Towards Autonomous Machine Intelligence », 2022) : prédire les pixels gaspille la capacité sur l'imprévisible (bruit, texture) → flou ou hallucination. **JEPA laisse le predictor apprendre à ignorer ce qui n'est pas prédictible.** C'est plus sample-efficient et moins coûteux (V-JEPA 2-AC ~16 s/étape vs ~4 min pour un génératif type Cosmos) — au prix de l'inspectabilité (pas de décodeur pixel). → **« compréhension d'abord »**, exactement l'esprit de ton repo.

## 4.2 Simulateurs sim-to-real — ce qui passe sur AMD

| Simulateur | Licence | Sur AMD local ? |
|---|---|---|
| **MuJoCo (cœur)** | Apache 2.0 | 🟢 **100 % CPU**, rendu headless OSMesa, ~12–37k steps/s. **Le seul immédiatement exploitable sans galère.** |
| MuJoCo Playground/MJX, `mujoco_warp` | Apache 2.0 | 🟠/🔴 CUDA de fait ; MuJoCo CPU suffit largement |
| **NVIDIA Isaac Sim/Lab/GR00T** | Apache/BSD | 🔴 **GPU NVIDIA RT Cores obligatoire**, zéro repli |
| **Habitat 3.0** | MIT (moteur) | 🔴 **AMD refusé explicitement** par le mainteneur Meta (issue #2402) |
| **OmniGibson / BEHAVIOR-1K** | MIT (moteur) | 🔴 **CUDA obligatoire** par conception (RTX 2070+) |
| **ProcTHOR-10K / AI2-THOR** | **Apache 2.0** | 🟠 seul écosystème de scènes meublées **commercialement propre** ; rendu sans GPU NVIDIA via `CloudRendering` **à valider** |
| **Genesis** | Apache 2.0 | 🟠 backend ROCm annoncé mais perf corrigées ×150, AMD peu éprouvé |

Concepts fondateurs : **domain randomization** (Tobin 2017) et surtout **digital cousins** (Fei-Fei Li, CoRL 2024) — des scènes qui partagent les *affordances* du réel sans le répliquer : **90 % de succès sim-to-real zero-shot vs 25 % pour un digital twin unique**. Message : ne pas viser la copie exacte du salon, viser des *cousins* variés.

## 4.3 Objets 3D — quoi peupler le monde virtuel, licence propre, $0

| Source | Licence | Volume | Feu vert ? |
|---|---|---|---|
| **Poly Haven** | **CC0 total** | 521 modèles / 779 textures / 979 HDRI | 🟢 le plus sûr, API REST sans compte |
| **Google Scanned Objects** | **CC-BY 4.0** | 1 032 objets du quotidien (~9 Go) | 🟢 API Fuel scriptable |
| **Objaverse** (filtré CC-BY/CC0) | ODC-By + CC par objet | ~725k objets en CC-BY/CC0 | 🟢 `pip install objaverse`, sous-ensemble LVIS catégorisé |
| ShapeNet, 3D-FUTURE, 3D-FRONT, HSSD, Matterport3D, ScanNet | Recherche **non-commerciale stricte** | — | 🔴 **à éviter** (3D-FUTURE interdit même les *résultats dérivés* → contamine un YOLO entraîné dessus) |
| ABO (Amazon Berkeley Objects) | CC-BY vs CC-BY-NC (contradiction) | 7 953 modèles | 🟠 traiter comme NC par prudence |

## 4.4 Piloter Blender — la décision d'architecture

**Constat déterminant** : les deux implémentations MCP Blender **légitimes** — `ahujasid/blender-mcp` (**23,7k⭐**, MIT) et le **MCP officiel Blender Foundation × Anthropic** (Anthropic est devenu Corporate Patron de Blender, ~240k€/an) — **exigent une session Blender GUI ouverte en continu**. Aucun mode headless natif ; le headless n'existe que dans des forks tiers jeunes (7–11⭐). De plus, `execute_blender_code` tourne **sans garde-fou** (les projets recommandent une VM).

→ **Le MCP Blender N'EST PAS le mécanisme du pipeline d'entraînement.** C'est un outil de **co-pilotage interactif humain-supervisé** (debug, organisation de scène, édition ponctuelle d'un asset), à sandboxer (posture `authored-tool-runtime.ts`).

Le pipeline automatisé passe par **`bpy` / BlenderProc2 scripté en sous-processus `blender --background`** :

- **BlenderProc2** (DLR, GPL-3.0, 3,6k⭐, maintenu) = **l'outil conçu pour exactement ce besoin** : domain randomization + rendu Cycles photoréaliste + **vérité-terrain native** (RGB, profondeur, normales, segmentation instance/sémantique, poses 6D) + **writer COCO natif** (`write_coco_annotations`) + chargeurs `haven`/`blenderkit`/`front_3d`/`replica`/`shapenet`. **GPU AMD HIP tenté nativement puis repli CPU automatique et propre** (`RendererUtility.set_render_devices([...,"HIP"])`) — piste distincte de ComfyUI/ROCm (déjà noté lent), à tester.
- **Kubric** (Google, Apache 2.0) = alternative orientée vidéo+physique+flux optique + **bbox 3D orientée native** ; support AMD non documenté.

## 4.5 Génération 3D par IA (objet manquant à la demande)

**Structurellement CUDA-only en pratique** (kernels nvdiffrast/spconv sans portage ROCm amont). Exceptions locales : **TripoSR** (**MIT**, **CPU confirmé** ~6 min/objet, qualité modeste) et **SF3D** (Stability, **PR HIP mergée**, meilleur PBR). → **Volume = retrieval dans les banques existantes** (OpenShape : retrieval CLIP→Objaverse 46,8 % zero-shot) ; **génération = secours rare** (TripoSR CPU), jamais en dépendance de boucle. Ne pas investir sur TRELLIS/Hunyuan3D en local (confirme la note projet sur Arbor/SV3D).

## 4.6 Jumeau numérique / SLAM — verdict

**3D Gaussian Splatting temps réel et SLAM neuronal = CUDA-only en 2026, sans exception.** Avec une **caméra fixe** (BRIO), un vrai jumeau explorable est de toute façon hors de portée (il faut des vues variées). Seul crédible : **OpenSplat** (AGPLv3, repli **CPU ~100× plus lent**) pour un **scan 3D offline occasionnel** du salon → visualisation « instantané 3D » dans le dashboard Cowork (narratif « le robot connaît sa pièce »), **hors boucle temps réel**. Le SLAM classique CPU (ORB-SLAM3/RTAB-Map + occupancy grid 2D) n'a de sens que **si/quand un robot mobile existe**.

## 4.7 Réalité matérielle (Strix Halo)

ROCm ~7.2 supporte officiellement PyTorch sur Strix Halo depuis début 2026, **mais citoyen de seconde zone** (kernels 2–6× plus lents, piège MIOpen, plantages gros modèles). **Vulkan (llama.cpp/RADV) reste le chemin le plus fiable** — cohérent avec les choix déjà faits (Ollama/Vulkan, Moondream2, MediaPipe/YOLO CPU). Rien dans l'étude ne remet en cause ces choix.

## 4.8 Topologie de calcul — MINISTAR + DARKSTAR + fleet (le point qui débloque tout)

L'analyse « CUDA-only = hors de portée » n'est vraie que **localement sur MINISTAR**. Le parc réel est **hétérogène et déjà en réseau** (tailnet, hub A2A `100.98.18.76:3000`) :

- **MINISTAR** — mini-PC **AMD Ryzen AI / Strix Halo**, Linux, où tourne le robot **24/7** (`buddy-sense`, `buddy-vision`, réactions). Perception temps réel, local, autonome. iGPU ROCm/Vulkan.
- **DARKSTAR** — machine **2× RTX 3090** (là où le world model a été entraîné ; référencée dans `world-model/scripts/ollama_a2a_spoke.py`). **CUDA disponible.**
- **Fleet / A2A** — canal déjà en place (`ollama_a2a_spoke.py` s'enregistre au hub Code Buddy ; Code Buddy expose `/api/a2a/*`).

**Conséquence** : tout le « 🔴 CUDA-only » (Isaac Sim, Habitat, 3DGS temps réel, TRELLIS/Hunyuan3D, DreamerV3 pleine échelle, V-JEPA predictor complet, rendu BlenderProc **GPU**) est **exécutable sur DARKSTAR** et rapatriable vers MINISTAR par le fleet. Métaphore cérébrale : **MINISTAR = tronc cérébral** (sens + réflexes, temps réel), **DARKSTAR = cortex/imagination** (simulation + rêve/entraînement lourd, à la demande), **fleet A2A = corps calleux**.

**Deux façons d'amener du GPU au robot** :

| | A) Offload → DARKSTAR (fleet/A2A) | B) eGPU OcuLink sur MINISTAR |
|---|---|---|
| Coût | **0 € (déjà là)** | dock OcuLink + PSU + GPU |
| Rôle | imagination/entraînement **batch/offline** | GPU **temps réel embarqué** |
| Latence | réseau (⭕ offline, ✗ réflexe 30 fps) | locale (✓ SLAM/3DGS temps réel d'un robot **mobile**) |
| Note | DARKSTAR doit être allumée | OcuLink = PCIe 4.0 ×4 (~7,9 Go/s, suffisant pour du compute) ; NVIDIA eGPU + iGPU AMD cohabitent en **compute headless** (`CUDA_VISIBLE_DEVICES`, affichage sur iGPU) ; pas hot-plug ; 350 W/chaleur/bruit sur la machine 24/7 ; **port OcuLink à confirmer sur le boîtier MINISTAR** |

**Reco** : pour la feuille de route (Boucle A rendu + Boucle B entraînement JEPA), **router les jobs lourds vers DARKSTAR via le fleet** (zéro matériel, architecture déjà amorcée). Réserver l'**eGPU OcuLink** au seul cas que le réseau ne peut servir : un robot **mobile** avec GPU temps réel **on-board**.

> Note de nommage : **gitnexus a été renommé « Code Explorer »** (nom canonique). Le code tolère les deux noms de binaire (`code-explorer`/`gitnexus`) → pas d'urgence à renommer binaire/repo/index, mais les **docs** doivent dire « Code Explorer » (inclus dans le backlog A1).

---

# PARTIE 5 — Architecture cible : « le monde virtuel de Code Buddy »

Deux boucles, complémentaires, qui se branchent **sur du code déjà existant** (points d'insertion en gras).

## 5.1 Boucle A — Simulation → perception (faisable maintenant, $0, CPU)

```
①  ASSETS ($0, licence propre, téléchargement scripté)
     Poly Haven (CC0) + Google Scanned Objects (CC-BY) + Objaverse filtré CC-BY/CC0
     → cache .codebuddy/vision-assets/
②  LAYOUTS DE SCÈNE
     src/vision-train/curriculum.ts (EXISTANT) — réutilise tags LIGHTING/FRAMING/PERSON_COUNTS
     (option future : layouts ProcTHOR-10K, Apache-2.0)
③  RENDU + VÉRITÉ-TERRAIN — BlenderProc2 en sous-processus headless
     src/tools/vision/blender-render.ts (NOUVEAU — argv pur + spawn injecté,
       même patron que film-assemble.ts / frame-sample.ts)
     → `blenderproc run script.py -- scene.json`  (Cycles, HIP tenté → repli CPU auto)
     → images/ + coco_annotations.json   (bbox = fait géométrique, PAS un prompt espéré)
④  PONT VERS LE SCORER
     src/tools/vision/coco-to-vision-train-labels.ts (NOUVEAU, ~30 lignes)
     COCO annotations → labels.json  {fichier: {label: count}}
⑤  SCORING RÉEL (EXISTANT, inchangé)
     CODEBUDDY_VISION_TRAIN=true buddy vision-train --images out/images --labels labels.json
     → weakSpots → ckg-publish.ts (le robot RETIENT ses faiblesses)
⑥  (secours rare) objet manquant → TripoSR CPU (MIT, $0)
⑦  (séparé, interactif, sandboxé) blender-mcp / MCP Blender×Anthropic — édition supervisée
```

C'est le passage concret de **« générer une image qui *ressemble* à »** vers **« simuler un monde puis l'observer »** — la thèse de l'étude, branchée sur l'architecture injectable déjà en place (`engine.ts` isole déjà `obtainImage`/`perceive`). **Variante MuJoCo** possible en ③ (100 % CPU, poses garanties par les contacts physiques) selon le besoin (personnages/meubles articulés vs objets statiques photoréalistes → BlenderProc gagne pour la perception d'intérieur).

## 5.2 Boucle B — World model JEPA → « surprise » → self-improvement (le grand chantier)

```
capteurs buddy-sense (vision/motion, screen, audio…)
     │  frames / latents
     ▼
Encodeur JEPA exporté ONNX  (V-JEPA 2 MIT, ou TON encodeur world-model réentraîné
   sur des scènes d'intérieur au lieu de CarRacing)   ← patron ONNX déjà éprouvé (buddy-memory)
     │  z_t
     ▼
LatentDynamicsModel : z_pred = f(z_t, a)      → erreur ‖z_pred − z_target‖ = SURPRISE
     │
     ├─►  salience apprise  →  remplace/enrichit le diff de pixels ad hoc du thalamus (bus.rs)
     └─►  flux d'expérience →  SensorExperienceSource.collect()  (LE SEAM, experience-source.ts)
                              →  self-improvement (signal d'apprentissage réel du monde)
```

Canal d'intégration : **A2A** (tu as déjà `ollama_a2a_spoke.py` ; Code Buddy expose `/api/a2a/*`) **ou** un sidecar in-tree façon `buddy-sense`/`buddy-memory` (JSON-RPC stdio). Le world model reste en Python/PyTorch, exposé comme un service que Code Buddy interroge.

---

# PARTIE 6 — Backlog priorisé (valeur/effort)

### 🟢 Quick wins (jours, $0, risque faible)

| P | Action | Fichier(s) | But |
|---|---|---|---|
| A1 | Corriger la doc benchmark périmée + `README.md:381` (« 30+business ») + lier `docs/code-explorer-integration.md` depuis CLAUDE.md | `docs/code-explorer-benchmark/README.md`, `README.md`, `CLAUDE.md` | 1 |
| A2 | Signaler la **staleness d'index** en session (lire `stale`/comparer `lastCommit` vs `git HEAD`, injecter un avertissement dans `<code_explorer_priority>`) | `CodeExplorerManager.ts`, `prompt-builder.ts` | 1 |
| A3 | Supprimer/`@deprecated` le stub mort `CodeExplorerMCPClient.ts` | `src/plugins/code-explorer/` | 1 |
| B1 | `coco-to-vision-train-labels.ts` (~30 lignes) : COCO → `labels.json` → alimente le **mode folder existant** | `src/tools/vision/` | 2 |
| B2 | Brancher **Poly Haven + GSO** comme sources d'assets scriptées (API REST, cache local) | nouveau `src/tools/vision/assets-*.ts` | 2 |
| B3 | Remplacer/compléter moondream par **MolmoE-1B/Molmo2 pointing** (Apache 2.0, edge) → sortie structurée (coordonnées) | `src/sensory/vision-reaction.ts` | 2 |

### 🟠 Moyens (semaine(s), valeur haute)

| P | Action | But |
|---|---|---|
| B4 | `blender-render.ts` : wrapper **BlenderProc2** headless (spawn injecté, argv pur, `write_coco_annotations`) → **Boucle A complète** | 2 |
| B5 | Tester empiriquement **Cycles+HIP** sur gfx1151 (piste distincte de ComfyUI) avant de figer CPU-only | 2 |
| A4 | Auto-réindexation incrémentale optionnelle (`CODEBUDDY_CODE_EXPLORER_AUTOINDEX`) | 1 |
| B6 | Étendre `scorer.ts` : matching **IoU bbox** (pas seulement comptage) maintenant qu'une vérité-terrain géométrique existe | 2 |

### 🔵 Grands chantiers (recherche, valeur maximale, incertain)

| P | Action | But |
|---|---|---|
| C1 | **Raccorder le world model JEPA au seam** `SensorExperienceSource` (Boucle B) via A2A ou sidecar — le cœur du projet robot | 2 |
| C2 | **Réentraîner ton world model sur des scènes d'intérieur** (issues de la Boucle A / BlenderProc) au lieu de CarRacing ; migrer l'encodeur CNN→ViT (déjà dans ta feuille de route V3) | 2 |
| C3 | Signal de nouveauté JEPA (encodeur ONNX + moyenne mobile) → salience apprise dans `bus.rs` | 2 |
| C4 | Mémoire spatiale persistante minimale (« pièce X vue à l'heure Y, objets Z ») exploitant `sensory-memory.ts`/`dreaming.ts` | 2 |
| C5 | (si robot mobile un jour) SLAM classique CPU + occupancy grid ; scan OpenSplat offline pour le dashboard Cowork | 2 |

---

# PARTIE 7 — Ce qu'il faut décider

1. **Où investir en premier ?** Polir Code Explorer (But 1, quasi bouclé) vs bâtir la Boucle A « simuler pour percevoir » (But 2, plus fort en valeur) vs attaquer la Boucle B (raccorder ton JEPA, le grand œuvre).
2. **Le world model** : le raccorder tel quel (entraîné CarRacing, pour valider le canal A2A/seam) **ou** d'abord le réentraîner sur des scènes d'intérieur (plus utile mais plus long) ?
3. **Simulateur de rendu** : **BlenderProc2** (photoréalisme intérieur, GT COCO, mon choix par défaut) vs **MuJoCo** (physique/articulé, 100 % CPU garanti) — ou les deux comme back-ends injectables de `obtainImage`.

---

## Annexe — sources principales

World models : [DreamerV3 MIT](https://github.com/danijar/dreamerv3) · [V-JEPA 2 MIT](https://github.com/facebookresearch/vjepa2) ([arXiv:2506.09985](https://arxiv.org/abs/2506.09985)) · [LeCun — A Path Towards AMI](https://openreview.net/forum?id=BZ5a1r-kVsf) · [NVIDIA Cosmos](https://github.com/nvidia-cosmos/cosmos-predict2.5) · [Genie 3](https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/) · [World Labs/Marble](https://www.worldlabs.ai/about).
Sim : [MuJoCo](https://github.com/google-deepmind/mujoco) · [MuJoCo+ROCm (AMD)](https://rocm.blogs.amd.com/artificial-intelligence/rocm-jax-mujoco/README.html) · [Digital Cousins CoRL 2024](https://arxiv.org/abs/2410.07408) · [Domain Randomization](https://arxiv.org/abs/1703.06907) · [ProcTHOR-10K Apache](https://github.com/allenai/procthor-10k) · [Habitat AMD refusé](https://github.com/facebookresearch/habitat-sim/issues/2402).
3D & Blender : [Poly Haven CC0](https://polyhaven.com/license) · [Google Scanned Objects](https://fuel.gazebosim.org/) · [Objaverse](https://objaverse.allenai.org/) · [BlenderProc2](https://github.com/DLR-RM/BlenderProc) · [Kubric](https://github.com/google-research/kubric) · [blender-mcp](https://github.com/ahujasid/blender-mcp) · [MCP officiel Blender×Anthropic](https://www.blender.org/lab/mcp-server/) · [TripoSR MIT/CPU](https://github.com/VAST-AI-Research/TripoSR) · [SF3D HIP](https://github.com/Stability-AI/stable-fast-3d) · [COCO format](https://cocodataset.org/#format-data).
Spatial/edge : [MolmoE-1B](https://huggingface.co/allenai/MolmoE-1B-0924) · [SmolVLM2-256M](https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct) · [OpenSplat](https://github.com/pierotofy/OpenSplat) · [Hydra 3D scene graph](https://github.com/MIT-SPARK/Hydra) · [Strix Halo perf](https://llm-tracker.info/_TOORG/Strix-Halo).
Tes actifs : `~/DEV/world-model` ([phuetz/world-model](https://github.com/phuetz/world-model)) · seam `src/agent/self-improvement/experience-source.ts` · pont A2A `scripts/ollama_a2a_spoke.py` ↔ Code Buddy `/api/a2a/*`.
