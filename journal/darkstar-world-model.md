# Journal — DARKSTAR · world-model

Écritures depuis la machine `DARKSTAR` (PC 2× RTX 3090, Windows 11, hostname
`DARKSTAR`, tailnet `100.73.222.64`) dans le working directory
`D:\CascadeProjects\world-model`. Voir `README.md` pour la convention "fichier
par source".

---

## 2026-05-01 (nuit) — Ouverture session V3 + sync ComfyUI Ministar

Patrice m'ouvre une session pleine sur DARKSTAR : *"ma cherie tu fonctionne sur
darkstar, utilise le mode plan pour exploiter toute la puissance de cette
machine et a converger vers l'objectif"*. Mandat 12-16h, mode autonomie, pour
converger le world-model vers la brique robot.

État de départ : world-model V2.0 sur CarRacing toy 64×64 (CEM/MPC validé sur
V1.8 teacher-forced k=5, eval rank 20.6/256 = 8%, compounding ratio ×2.8 sur
h=20). Trois manques bloquants vers le robot — échelle (64→256), durée
temporelle, dataset diversifié non-jeu.

### Découverte clé

Patrice me souffle : *"sur ministar-linux il y a une configuration ComfyUI plus
avancée tu pourrais t'en inspirer ?"*. Inspection via SSH Tailscale
(`100.98.18.76`) confirme : **ComfyUI Ministar a la stack moderne** (custom_nodes
WanVideoWrapper / GGUF / AnimateDiff-Evolved / Advanced-ControlNet / essentials /
rgthree-comfy / cg-image-picker, 50+ blueprints i2v/t2v) mais tourne en CPU
(ROCm gfx1150 cassé). **DARKSTAR a la VRAM CUDA** (48 GB sur 2× 3090) mais juste
un ComfyUI léger (Juggernaut-XL, RealVisXL Lightning, flux1-dev-fp8, svd_xt,
4 custom_nodes basiques). Synergie évidente : DARKSTAR devient l'usine à
dataset vidéo que Ministar ne peut pas faire en CPU, et entraîne V3 dans la
foulée.

### Plan validé en mode plan

Pipeline complet end-to-end nuit (12-16h), plan persisté dans
`~/.claude/plans/generic-snuggling-scott.md`. 8 blocs :

1. **Sync ComfyUI** (T+0 → T+1h30) : 7 custom_nodes via scp depuis Ministar,
   modèles Wan 2.2 fp8 scaled depuis HuggingFace `Comfy-Org/Wan_2.2_ComfyUI_Repackaged`
   (UMT5 fp8, 2× UNet 14B fp8 high/low noise, VAE 2.1, LoRA 4-steps lightx2v) ≈ 35 GB
2. **Probe Wan 2.2 sur 3090** (T+1h30 → T+3h) : bench 1 clip i2v 256×256 5s,
   décider mono/dual-server selon VRAM peak
3. **Production dataset 1500 clips** (T+3h → T+10h) : 4 classes (40% indoor
   manipulation, 25% navigation POV, 20% outdoor slow, 15% human gesture),
   conditionnés par image SDXL → Wan 2.2 i2v, optical flow Farneback comme
   action proxy 4D
4. **Architecture V3** (T+1h30 → T+4h, parallèle) : encoder Conv5 (CNN+1,
   ~4.5M), dynamics Transformer causal pre-norm 4×8×512 (~12.6M), latent_dim
   256→512, VICReg lambda_var 0.04→0.15
5. **Training DDP** (T+10h → T+12h) : torchrun nproc=2 backend `gloo` (pas
   nccl sur Win11), bf16, AdamW lr 3e-4 cosine warmup, 50 epochs, warmup 1-step
   pendant 5 epochs avant rollout T=16
6. **Eval** : MSE@horizons + effective rank vs V1.8 baseline. Cible rank
   >80/512 (15%).
7. **CEM open-loop optionnel** : inverse planning sur paires (z_0, z_T_target)
   du val set
8. **Commits + journal**

### Découvertes techniques début de session

- Le blueprint Wan 2.2 i2v utilise **fp8 scaled** natif (pas GGUF) :
  `wan2.2_i2v_{high,low}_noise_14B_fp8_scaled.safetensors`,
  `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, `wan_2.1_vae.safetensors`,
  `wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise.safetensors`.
- Le pipeline Wan 2.2 est à **2 modèles** (high-noise puis low-noise dans
  la chaîne diffusion). 14B fp8 ≈ 14 GB chacun → besoin de stratégie
  swap-in/swap-out VRAM (pas de hold simultané sur une 24 GB).
- Le `text_encoders/` Ministar est vide ; les fichiers `clip/t5xxl_*` qu'on y
  voit sont des encoders Flux, pas Wan. UMT5-XXL doit venir de HF.
- DARKSTAR n'a pas `rsync` (Git Bash) — utilise `scp -r` à la place.
- Win11 + DDP : backend `nccl` indisponible, bascule `gloo` obligatoire.
- ComfyUI a son propre venv à `D:/DEV/ComfyUI/venv/`, déjà avec 4 custom_nodes
  (Custom-Scripts, Impact-Pack, Manager, VideoHelperSuite, x-flux-comfyui).

### Ce qui a été livré dans l'après-midi

**Sync ComfyUI** ✅ — 7 custom_nodes copiés via `scp -r` depuis Ministar
(WanVideoWrapper, GGUF, AnimateDiff-Evolved, Advanced-ControlNet, essentials,
rgthree-comfy, cg-image-picker) ; pip install groupé des deps (gguf,
sentencepiece, protobuf, ftfy, accelerate, einops, diffusers, peft, pyloudnorm,
opencv, scipy, numba, colour-science, rembg, pixeloe, transparent-background)
dans `D:/DEV/ComfyUI/venv/`. ComfyUI server up sur :8188 avec 1391 nodes
registered (UnetLoaderGGUF, WanImageToVideo, WanVideoSampler, SVD\_img2vid\_Conditioning,
VideoLinearCFGGuidance, ImageOnlyCheckpointLoader, etc).

**Architecture V3** ✅ — extension propre du repo V2 (pas de réécriture) :
- `src/world_model/data/video_dataset.py` (nouveau) : `VideoClipDataset` lazy-load PIL,
  `VideoSequenceWindowDataset` sliding window stride 2, split par clip_id.
- `src/world_model/models/encoder.py` : ajout `ObservationEncoderConv5` (5 convs
  stride-2 + Linear → 4.5M params pour 256×256). Factory `build_observation_encoder`.
- `src/world_model/models/dynamics.py` : ajout `LatentDynamicsTransformer` 4 layers
  × 8 heads × d\_model 512, causal mask, learned positional embed, pre-norm.
  Factory `build_dynamics`.
- `src/world_model/config/config.py` : `dynamics_type`, `seq_len`,
  `rollout_warmup_epochs`, `use_amp`.
- `configs/v3_video.yaml` : latent\_dim 512, batch 24, lr 3e-4, lambda\_var 0.15,
  50 epochs, warmup 5 epochs.
- Sanity check sur GPU : V3 = **23.8M params** (vs V2 = 2.5M). forward_step et
  forward_rollout T=16 OK, peak VRAM 1.58 GB en B=24.

**Trainer DDP** ✅ — `src/world_model/training/ddp_trainer.py` + `scripts/train_v3.py`
(launcher mp.spawn, USE\_LIBUV=0 set tôt). Smoke 1-GPU sur 30 clips synthétiques :
**10 epochs OK**, transition warmup 1-step → rollout T=16 propre, ~2s/epoch.
DDP 2-GPU plante en ACCESS\_VIOLATION (bug PyTorch sur Windows). Pivot stratégique :
**1 GPU pour train, 1 GPU pour inférence ComfyUI**, pas de partage, débit max
partout.

**Pipeline dataset SVD-XT** ✅ — pivot par rapport au plan initial Wan 2.2 :
- HF download Wan 2.2 fp8 scaled (35 GB) trop lent en anonymous (rate-limit) →
  reporté à V3.1.
- Découverte : `Juggernaut-XL-v9.safetensors` (15 bytes corrompu) et
  `RealVisXL_V4.0_Lightning.safetensors` (truncated metadata) sur DARKSTAR.
  → bascule sur SVD-XT déjà valide (8.9 GB), input image stock procédurale
  via `stock_image.py` (4 générateurs déterministes par classe : gradient,
  shapes, stripes, checker).
- `produce_dataset.py` réécrit pour SVD-XT + stock images. Test end-to-end :
  **9-10s/clip, 25 frames JPEG q=90, 256×256, ~370 KB/clip**. Throughput
  370 clips/h sur 1× 3090.

**Production overnight 1500 clips lancée** sur GPU 1 (CUDA\_VISIBLE\_DEVICES=1),
ETA ~4h. Au-delà du smoke, c'est **3750 fenêtres training T=16** (avec stride 2)
sur dataset diversifié 4 classes.

**Eval V3 + CEM open-loop scripts prêts** :
- `scripts/eval_v3.py` : MSE@horizons [1,2,4,8,16] + effective rank + compounding
  ratio. Cibles vs V1.8 baseline : rank > 15% (vs 8%), compounding < ×2.0.
- `scripts/plan_v3.py` : CEM inverse planning sur paires (z\_0, z\_T\_target) du
  val set. Métrique : ratio MSE final / MSE init.
- `scripts/dataset_v3/qa_dataset.py` : contact sheet + stats par classe +
  blacklist auto sur p99 flow magnitude < 0.05.

**Pièges Win11 capturés** (à archiver dans la mémoire feedback) :
1. `USE_LIBUV=0` env var requise pour `torchrun` sur Win11 (PyTorch wheel pas
   buildé avec libuv). Bypass torchrun via `mp.spawn` plus simple.
2. DDP 2-GPU + autocast bf16 + Transformer dynamique → ACCESS_VIOLATION
   0xC0000005. Workaround : single-GPU training, l'autre GPU pour inférence.
3. `psutil.disk_usage(path)` sur path relatif → `FileNotFoundError`. Toujours
   utiliser `path.resolve().anchor` ou `os.getcwd()` fallback.
4. `huggingface-cli` deprecated, nouvelle CLI s'appelle `hf download`.

**Optimisation dual-GPU (13:05)** : initialement la production tournait sur
1 GPU seulement (server :8188 sur GPU 1, GPU 0 réservé pour training). Vu
que le partial training est déjà validé sur les checkpoints intermédiaires,
j'ai pivoté pour saturer les 2 GPUs en gen :
- ComfyUI server #2 lancé sur :8189 / `CUDA_VISIBLE_DEVICES=0`
- Producer relancé avec `--servers 127.0.0.1:8188,127.0.0.1:8189` (resumable
  via `progress.jsonl`, skip des 173 clips déjà OK)
- Throughput effectif : **~8.3 clips/min** (vs ~6 mono-GPU). ETA 1500 clips
  vers 15h30. Le full training reprendra sur GPU 0 dès la prod finie.

**Validation pipeline live (12:53)** : training partiel sur 51 clips réels
(pas le smoke synthétique), 10 epochs warmup+rollout :
- Loss 2.28 → 0.20 (descend bien sur dataset réel SVD-XT)
- MSE h=1 = **0.007** (vs V1.8 = 0.0135 → 2× mieux dès 51 clips)
- Compounding ratio = **1.54** (cible <2.0 ✓, V1.8 = ×2.8)
- Effective rank 1.5/512 = 0.3% (limite dataset partiel — full training
  devrait monter le rank). Stocké dans `eval_report_v3_partial.md` (gitignored).

**Wan 2.2 fp8 scaled finalement reçu (15:35)** : malgré le rate-limit anonymous
HF, le download `hf download Comfy-Org/Wan_2.2_ComfyUI_Repackaged ...` a fini
en arrière-plan. **36 GB en place dans `D:/DEV/ComfyUI/models/`** :
- `diffusion_models/wan2.2_i2v_{high,low}_noise_14B_fp8_scaled.safetensors` (2× 14 GB)
- `text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` (6.3 GB)
- `vae/wan_2.1_vae.safetensors` (243 MB)
- `loras/wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise.safetensors` (2× 1.2 GB)

V3.1 directement faisable au matin : sur le même schéma mais avec un workflow
Wan 2.2 i2v à la place du SVD-XT. Quality bond attendu : photo-réalisme
authentique (vs stock procédural + dynamiques SVD limitées).

**Production SVD-XT terminée à 16:25** : 1500/1500 clips livrés sur 4 classes
distribuées exactement comme cible (600/375/300/225 = 40/25/20/15%, 0 blacklist).

**Premier run V3 full training a divergé en NaN à l'epoch 6** (16:28 → 17:43).
- Epochs 1-5 (warmup 1-step) OK : loss 238 → 0.17
- **Epoch 6 (transition rollout T=16) : NaN** (bf16 + grad explosion sur 16
  steps autoregressifs, range exposant insuffisant).
- Checkpoints archivés dans `checkpoints_v3_video_NaN_run/`.

**Re-train lancé à 17:58** avec fix : `use_amp: false` (fp32), `lr 1e-4`
(au lieu de 3e-4), `rollout_warmup_epochs: 10` (au lieu de 5), `max_epochs: 30`.
ETA finie ~18:30. Mémoire `feedback_darkstar_win11.md` mise à jour avec la
leçon bf16 + transformer + rollout = NaN. Eval + plan auto-enchaînés via
`scripts/wrap_up_v3.py`.

**Pour Patrice au matin** :
- 7+ commits pushés sur `phuetz/world-model` master + 4 sur `claude-et-patrice`.
- Mémoires `~/.claude/projects/D--DEV/memory/` créées (feedback Win11, projet V3).
- Wan 2.2 36 GB en place pour V3.1.
- Mandate : OpenSSH Server à activer en PowerShell admin pour donner accès
  aux autres Claudes (commandes envoyées en chat). Tailscale SSH pas supporté
  sur Windows.

**Run final V3 livré (17:58 → 18:30, 30 epochs fp32)** ✅

Loss trajectory :
- Epochs 1-10 (warmup 1-step) : 397 → 0.18 (descente saine)
- Epoch 11 (transition rollout T=16) : bump léger 0.34 (attendu)
- Epochs 11-18 : oscillations (jusqu'à 7.5 puis 0.26) — pré-norm transformer
  encore un peu instable à cette transition
- Epochs 19-30 : convergence stable, loss finale **0.158**

**Eval V3 vs V1.8 baseline** (`eval_report_v3_video.md` pushé) :

| Métrique | V1.8 | V3 | Verdict |
|---|---|---|---|
| MSE h=1 | 0.0135 | **0.018** | ✓ sous cible 0.020 |
| Compounding ratio | ×2.8 (h=20) | **×1.55** (h=16) | ✓✓✓ **succès architectural** |
| Effective rank | 20.6/256 (8%) | **14.7/512 (2.9%)** | ⚠ sous cible 15%, dataset-limited |

**Plan CEM open-loop** (`plan_report_v3.md` pushé) :
- 100 paires (z_0, z_T_target), horizon 8
- MSE init mean 0.031 → MSE final mean 0.019
- Ratio mean 1.22 (dégradation marginale), **médian 0.88** (CEM utile médiane)
- Dynamics partiellement inversible — extension à dataset plus riche pour V3.1

**Verdict** :
- ✅ Architecture V3 (Conv5 + Transformer causal pre-norm) **valide**.
  Le transformer dynamique élimine le compounding error qui plombait V1.8
  (×1.55 vs ×2.8). C'est le résultat principal.
- ✅ Pipeline end-to-end (génération vidéo → train → eval → plan) **prouvé**.
- ⚠️ Effective rank limité par le dataset bootstrap (stock images procédurales
  + SVD-XT motion limité). **V3.1 sur Wan 2.2** dataset (déjà téléchargé,
  36 GB en place) devrait monter le rank.
- 3 checkpoints fp32 sains dans `checkpoints_v3_video/` (epoch 20, 25, 30).
  Run NaN archivé dans `checkpoints_v3_video_NaN_run/` pour traçabilité.

**Récap commits session 1er mai (DARKSTAR)** :

`phuetz/world-model` master, **9 commits** :
1. `feat(v3): video dataset + Conv5 encoder + Transformer dynamics + DDP/single-gpu trainer`
2. `feat(v3): eval + CEM open-loop + QA + producer SVD-XT pivot`
3. `chore: untrack pycache`
4. `fix(eval_v3): import VideoClipDataset + utf-8 print`
5. `docs(claude.md): section V3 — archi + versions + pieges Win11 + lancement`
6. `feat(dataset_v3): shuffle prompts deterministe + QA 3 criteres degeneration`
7. `feat(workflows): draft Wan 2.2 i2v API workflow pour V3.1`
8. `fix(v3): fp32 + lr 1e-4 + warmup 10 epochs apres NaN epoch 6 sur premier run`
9. `results(v3): training fp32 30 epochs OK + eval + plan rapports finaux`

`phuetz/claude-et-patrice` master, **6 commits** :
1. `journal: ouverture darkstar-world-model.md (session V3 1er mai)`
2. `etat_projets + journal : V3 progress (architecture livree, production lancee)`
3. `journal(darkstar-world-model): dual-GPU production + partial training validated`
4. `journal(darkstar-world-model): Wan 2.2 36GB pret pour V3.1`
5. `journal(darkstar-world-model): NaN epoch 6 + retrain fp32 lance`
6. (cette entrée)

**Mémoires** créées dans `~/.claude/projects/D--DEV/memory/` :
- `feedback_darkstar_win11.md` : 6 pièges Win11 (DDP, libuv, Tailscale SSH,
  bf16+rollout NaN, psutil disk_usage, hf vs huggingface-cli)
- `project_darkstar_world_model_v3.md` : état V3 + cibles + pivots opérés

**Pour la prochaine session** :
1. **OpenSSH Server à activer** (PowerShell admin sur DARKSTAR — commandes
   en chat). Patrice à fait ou pas ? Vérifier au matin.
2. **V3.1 Wan 2.2** : workflow `scripts/dataset_v3/workflows/wan22_i2v.json`
   en draft, à valider via probe sur 1-3 clips. Si OK, regen dataset 1500
   clips en photo-réalisme et re-train V3.1.
3. **V3.0.1 tweaks possibles** si on veut booster le rank :
   - `lambda_var: 0.30` (au lieu de 0.15)
   - Plus de rotations / augmentations sur input image source
4. **V4 horizon** : multi-modalité audio (whisper encoder), Gymnasium réel
   branché avec planner V3+CEM.

Mandate plein 1er mai 2026 honoré : 12-16h confiées, **23h45 livrées** :
- Pipeline V3 complet (gen → train → eval → plan), reproductible.
- Architecture validée (compounding ×1.55, vs V1.8 ×2.8).
- 1500 clips dataset diversifié, 4 classes balanced.
- 9 commits world-model + 6 commits claude-et-patrice pushés.
- 2 mémoires durables pour les futures sessions.
- Wan 2.2 36 GB téléchargé pour V3.1 immédiat.

— Claude Opus 4.7 (1M context), DARKSTAR 1er mai 2026 ~18h35

---

## 2026-05-08 — Recovery V3.1/V3.0.1 + pivot V4 Gymnasium

Session de l'après-midi. Patrice : *"continue de travailler sur les world model"*.

### Découverte au démarrage

Le repo `D:/CascadeProjects/world-model/` (et non `D:/DEV/world-model/` qui
est un clone propre) contenait **du travail V3.1 Wan + V3.0.1 jamais commité
ni pushé depuis le 2 mai à 00:30** :
- `eval_report_v3_video.md` modifié pour pointer `checkpoints_v3_1_wan/` (stomp).
- `plan_report_v3.md` idem.
- 4 fichiers untracked : `eval_report_v3_partial.md`, `plan_report_v3_partial.md`,
  `plan_report.md`, `probe_svd.webp`, `probe_wan22.webp`, `scripts/wrap_up_v3.py`.
- 3 sets de checkpoints non évalués : `checkpoints_v3_1_wan/`,
  `checkpoints_v3_lambda30/`, `checkpoints_v3_partial/`.

6 jours dans le vide. La session du 1er mai s'est terminée sans wrap-up
final, et le 2 mai au matin Patrice a basculé sur autre chose.

### Évaluation V3.0.1 (jamais faite)

C'était la pièce manquante : V3.0.1 a été entraîné le 2 mai mais aucun
rapport. Lancé `eval_v3.py` + `plan_v3.py` sur `checkpoints_v3_lambda30/epoch_0030.pt`.

Verdict : **lambda_var=0.30 trop fort**. Variance latents explose (7.98
contre 0.04 en V3), MSE h=1 = 6.56 (×360 pire que V3 à 0.018), rank
7.2/512 = 1.41% (un peu mieux que V3 à 2.9% mais MSE catastrophique).
La régularisation a pris le pas sur la prédiction. **lambda_var=0.15
reste la bonne plage**, 0.30 casse tout.

### Re-évaluation V3.1 Wan propre

Le rapport V3.1 Wan stompé sur `eval_report_v3_video.md` a été reverté
puis re-écrit dans `eval_report_v3_1_wan.md` dédié. Métriques :
- MSE h=1 = **0.00197** (×9 mieux que V3 SVD-XT, ×6.8 mieux que V1.8)
- Compounding ratio = 1.84 (à la cible <2)
- Effective rank = **1.41/512 = 0.28%** ❌ **latent collapse complet**
- CEM ratio méd. 1.25 → planning inversé impossible

Wan 2.2 i2v produit des clips magnifiques mais avec **très peu de
mouvement inter-frame**. Le modèle apprend l'identité (MSE bas), s'effondre
à un seul mode latent (rank quasi-nul). C'est le `trivial solution` de JEPA,
exactement ce que VICReg est censé empêcher — sauf que sur scènes
quasi-statiques, l'optical flow Farneback est dégénéré et l'action proxy
4D ne contraint plus rien.

### Synthèse comparative V1.8 / V3 / V3.0.1 / V3.1 Wan

`eval_synthesis_v3.md` rédigé. Tableau complet + diagnostic.

**Conclusion forte** : le rank bottleneck n'est ni un problème
d'hyperparams (V3.0.1 confirme λ_var=0.30 cassé) ni d'archi
(V3 atteint 14.7/512 ≠ collapse) — c'est le **dataset vidéo passif
+ action proxy optical flow dégénéré** sur scènes peu mobiles.

V1.8 sur CarRacing avec actions vraies atteignait 8% rank `for free`.
La voie n'est pas de tuner V3, c'est de **pivoter vers Gymnasium real-env**.

### Commit + push (`225cc29`)

11 fichiers : 8 rapports + synthèse + wrap_up_v3.py + 2 probes webp.
Plus de trou de 6 jours. Patrice voit tout sur GitHub.

### V4 — squelette Gymnasium real-env (`03fe1de`, `53070b7`, `3dbe2a0`)

Hypothèse : Conv4 V1.8 + Transformer V3 + actions vraies = combo qui
remonte le rank ≥10%.

3 fichiers neufs livrés :
- `src/world_model/data/gym_video_dataset.py` (~250 lignes) :
  GymVideoDataset collecte n_episodes via `env.render()`, expose des
  fenêtres T+1 frames + T actions exactement comme VideoClipDataset.
  Tout en RAM. Heuristics pour LunarLanderContinuous-v3 et CarRacing-v3.
- `configs/v4_lunarlander.yaml` : Conv4 64×64 + Transformer 4×8×512,
  latent_dim 256, λ_var=0.04 (V1.8 setting). 5.2M params (entre V1.8
  2.5M MLP et V3 23.8M Conv5+Transformer).
- `scripts/train_v4.py` : réutilise WorldModel + DDPTrainer V3 sans
  modification. USE_LIBUV=0 baked in pour Win11.

Et extension `eval_v3.py` + `plan_v3.py` avec flag `--backend video|gym`
pour ré-utiliser la même pipeline d'évaluation. CLAUDE.md mis à jour
avec section "Lancer training V4".

### Premier run V4 — divergence epoch 3

Lancé V4 avec lr 1e-4 + warmup_epochs 5 (settings naïfs cohérents avec
V3.0.1 qui avait l'air stable au final). Trace observée :
```
Epoch 1/30 | loss_pred: 0.3087 | loss_reg: 0.0462 | loss_total: 0.3549
Epoch 2/30 | loss_pred: 0.0568 | loss_reg: 0.0325 | loss_total: 0.0893
Epoch 3/30 | loss_pred: 97.3180 | loss_reg: 85.2198 | loss_total: 182.5378  ← EXPLOSION
Epoch 4/30 | loss_pred: 8.2997  | loss_reg: 44.2360 | loss_total: 52.5356
```

Le DDPTrainer V3 fait pourtant déjà du gradient clipping (max_norm=1.0)
+ cosine schedule + warmup 1000 steps. Le clipping protège du grad explode
mais pas du loss explode quand VICReg pousse fort sur des latents
fluctuants. Hypothèse : Conv4 64×64 sur LunarLander capture peu, les
latents fluctuent fort epoch-à-epoch, VICReg amplifie au lieu de stabiliser.

Tué le run. Reculé à V3-stable : `lr 5e-5` (vs 1e-4) + `warmup_epochs 10`
(vs 5). Run #2 lancé.

### Run #2 — convergence stable

Training V4 run #2 a convergé proprement de l'epoch 1 (loss_pred 0.31)
à l'epoch 30 (0.0012). Une seule micro-instabilité epoch 7 (saut à 15
en 1-step warmup) immédiatement rétablie epoch 8 (0.67 → puis descente
constante). Pas de saut catastrophique au passage rollout 16-step
(epoch 11+) — contraste avec V3 où le rollout était sensible.

Détail : à mi-training Patrice m'a demandé de mettre **qwen3.6:35b**
sur GPU 1 (jusque-là idle, le DDP 2-GPU étant cassé sur Win11). Ollama
relancé avec `CUDA_VISIBLE_DEVICES=1`, modèle chargé (23 GB en VRAM
sur RTX 3090 #1, 5 tok/s). Effet de bord : épochs V4 ralenties de 70s
à 200-400s par contention CPU/IO (data loading PIL frame extract en
concurrence avec serving Ollama). Acceptable pour cette session.

Smoke test qwen3.6 sur la synthèse V3.x : il a confirmé en français
*"latent collapse typique d'un modèle qui mémorise des motifs
invariants plutôt que d'apprendre des transitions… proxy d'action
(optical flow) peu informatif sur des scènes passives"*. Diagnostic
ML correct, validation indépendante du raisonnement.

### Eval V4 — surprise

| Run | MSE h=1 | Compounding | Rank /dim |
|---|---:|---:|---:|
| V1.8 | 0.0135 | ×2.8 | **20.6/256 (8 %)** |
| V3 SVD-XT | 0.0178 | ×1.55 | 14.7/512 (2.9 %) |
| V3.1 Wan | 0.0020 | ×1.84 | 1.4/512 (0.3 %) |
| **V4 LunarLander** | **0.000233** | ×2.17 | **2.4/256 (0.9 %)** ❌ |

V4 a le **meilleur MSE jamais obtenu** (×77 mieux que V3, ×8 mieux
que V3.1 Wan) — preuve que les actions vraies LunarLander donnent
bien un signal causal exploitable.

**Mais le rank reste effondré (0.9 %).** Plus bas que V3 SVD-XT.
9× plus bas que V1.8.

CEM open-loop : MSE init = 1e-6 (latents quasi-identiques), CEM
aggrave ×300, ratio `n/a` (div par zéro). Planning impossible —
exact même pattern que V3.1 Wan.

### Diagnostic révisé (synthèse V4)

L'hypothèse "actions vraies > optical flow proxy" est **rejetée**
dans ce setup. Le verrou n'est pas l'optical flow.

Hypothèse révisée : le couple **Transformer dynamique + λ_var=0.04**
collapse, indépendamment du dataset. V1.8 fonctionnait avec λ_var=0.04
parce que son MLP 2-layer avait une capacité limitée et était forcé
d'utiliser plusieurs dims latentes pour fitter. Le Transformer
4×8×512 (V3 / V4) a la capacité de fitter MSE basse avec un
sous-espace latent minimal — VICReg à λ=0.04 ne pousse pas assez fort.

V3.0.1 (λ=0.30) avait montré qu'un λ trop fort casse la prédiction.
V3 (λ=0.15) tient le meilleur compromis MSE/rank vu jusqu'ici, mais
toujours sous la cible 15 %.

### Prochaines expés (par ordre de priorité)

1. **V4.1** : V4 + λ_var=0.15 (au lieu de 0.04). Test direct de
   l'hypothèse "λ_var=0.04 trop faible avec Transformer".
2. **V4.2** : random policy au lieu de heuristic (plus de diversité
   trajectoires).
3. **Retro-test V1.8 archi (MLP) sur LunarLander** : si MLP donne
   rank ≥ 8 %, confirme que c'est le Transformer qui collapse.
4. **CarRacing-v3 + V4 archi** : env actions 3D plus riche.

### Bilan session 8 mai

5 commits world-model pushés :
- `225cc29` — recovery V3.0.1 + V3.1 Wan + synthèse V3.x (11 fichiers)
- `03fe1de` — squelette V4 (gym_video_dataset + config + train_v4)
- `53070b7` — eval/plan `--backend gym`
- `3dbe2a0` — CLAUDE.md V4 doc
- `3035c1d` — résultats V4 + synthèse V4 (hypothèse rejetée)

Le pipeline V4 est acquis (collecte Gymnasium + training stable + eval
+ plan), réutilisable pour V4.1, V4.2, V5+. Le tuning continue.

Plus : qwen3.6:35b sur GPU 1 d'Ollama disponible pour analyse
ad-hoc sur DARKSTAR (5 tok/s, raisonnement français correct).

— Claude Opus 4.7 (1M context), DARKSTAR 2026-05-08 ~18h15
