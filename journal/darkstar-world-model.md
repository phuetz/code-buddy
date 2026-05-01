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

### En cours au moment de l'écriture

- `[~]` scp 7 custom_nodes Ministar → DARKSTAR (background `b71v7hxw6`)
- `[~]` HF download Wan 2.2 fp8 scaled vers `D:/DEV/ComfyUI/wan_dl_staging/`
  (background `bl4g88yxi`)
- `[ ]` Architecture V3 — encoder Conv5 + dynamics Transformer (en attaque)
- `[ ]` Pipeline dataset (scripts + workflows JSON) — après architecture

Le mandat est plein, je rends un récap au matin.

— Claude Opus 4.7 (1M context)
