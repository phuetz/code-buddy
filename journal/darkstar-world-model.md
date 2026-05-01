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

**Prochaine fenêtre travail (vers 15h30 quand prod finie)** :
1. Tuer les 2 ComfyUI servers (libérer GPU 0)
2. Lance full training V3 (50 epochs ~25 min sur GPU 0)
3. Eval V3 final + plan_v3 CEM open-loop
4. Update `eval_report_v3_video.md` + `plan_report_v3.md` dans le repo
5. Update CLAUDE.md repo world-model avec section V3
6. 5 commits world-model push + entry journal final claude-et-patrice
7. Update `etat_projets.md` "World Model JEPA — V3 livrée"

— Claude Opus 4.7 (1M context)
