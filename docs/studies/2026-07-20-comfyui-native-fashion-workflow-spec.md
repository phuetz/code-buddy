# Étude — Spec workflow ComfyUI clips fashion 1080×1920/30fps/~12s (2026-07-20)

**Cible** : clips fashion verticaux très haute qualité sur darkstar (2× RTX 3090
24 Go). Étude web sourcée (docs ComfyUI, dépôts HF lightx2v/Comfy-Org/Kijai/
numz, issues GitHub). Le 1080 natif Wan 14B est hors de portée d'une 3090 : la
chaîne est **720×1280 → SeedVR2 1080×1920 → RIFE 30 fps**.

## Chaîne complète (par clip ~12 s)

```
FLUX dev fp8 + LoRA identité → keyframes 1080×1920 (start + jonctions)   ~1-2 min
  ↓ (downscale 720×1280 pour Wan)
3 × [Wan2.2 i2v (ou Fun-Control) fp8 + lightx2v, 81 frames @720×1280]    ~3×6-10 min
  ↓ ColorMatch KJNodes (mkl, réf = frame 0 du clip 1) + trim overlap
Assemblage 192 frames @16 fps
  ↓
SeedVR2 3B fp8 (batch 4n+1, tiled VAE) → 1080×1920 @16 fps               ~10-25 min
  ↓
RIFE VFI (rife49, ensemble, ×2) → encode 30 fps H.264 CRF 17             ~2-4 min
                                                          TOTAL ~45-75 min / 1 GPU
                                            (~25-35 min en pipelinant les 2×3090)
```

## Réglages clés (workflow officiel lightx2v forKJ, lu et vérifié)

- `WanVideoModelLoader` ×2 (high puis low noise), `sageattn`, fp8_e4m3fn_scaled.
- LoRA lightx2v strength 1.0 sur chaque branche ; **le LoRA identité se chaîne
  sur les DEUX branches** (strength 0,7–1,0).
- Samplers : **4 steps, CFG 1.0 strict, euler ; split high 0→2 / low 2→fin** ;
  shift 1.0 (JSON Lightning) vs 5 (exemple Kijai Fun-Control) → à tester.
- 81 frames @16 fps ≈ 5,06 s = segment de base. `WanVideoBlockSwap` 10–20 en
  720×1280. Decode tiled 272×272/144.
- Fun-Control (marche/rotation) : modèles `wan2.2_fun_control_{high,low}_noise_
  14B_fp8_scaled` + DWPose (body+hands, PAS face — le visage vient du LoRA) +
  DepthAnythingV2 vitl fp32 ; **strength 0,5–0,8 et end_percent 0,6–0,8** (les
  derniers steps rendus au LoRA identité). Vidéo de contrôle : se filmer en
  9:16, stock Pexels/Pixabay, ou Mixamo→Blender.

## Chaînage 12 s sans dérive (pièges documentés)

- **Jamais** de chaîne frame extraite → ré-extraite (dérive identité + flou VAE
  cumulés). Parade maîtresse : **régénérer les keyframes de jonction avec FLUX
  + LoRA identité** (pose ≈ dernière frame du segment N) puis **FLF2V**
  (template natif First-Last-Frame) entre keyframes — identité ré-ancrée à
  chaque segment.
- **Dérive couleur/contraste** entre segments : issue Kijai #1541 (non résolue
  côté wrapper) → nœud `ColorMatch` (KJNodes, mkl) sur chaque segment, réf =
  1re frame du clip 1. Prompt d'éclairage identique mot pour mot partout.
- SeedVR2 : `batch_size` en **4n+1** obligatoire (sinon scintillement), VAE
  tiled obligatoire en 1080p, OOM → tiling → blockswap → réduire batch.
- RIFE : `ensemble: true`, jamais interpoler à travers une jonction de segment,
  16→32 fps encodé à 30 (ralenti 6 % invisible) plutôt que drop 32→30 (judder).
  Artefacts connus sur mèches/tulle → mouvements lents au prompt.

## Pilotage API /prompt

- Toujours partir d'un **Export (API)** du graphe (dev mode) — jamais du JSON
  manuel. `class_type` = nom Python d'enregistrement (`WanVideoSampler`,
  `"RIFE VFI"` avec espace, etc.).
- Seeds : `inputs.seed` sur chaque sampler ; le forKJ ship avec `seed: -1` — à
  **écraser systématiquement** (même seed high/low par segment, seed dérivé
  base+i par segment, seeds FLUX des keyframes fixés). `control_after_generate`
  est UI-only. Suivi : `/history/{id}`, WS `/ws`, `/view` (même mécanique que
  le provider ComfyUI existant `src/tools/media-generation-tool.ts`).

## Téléchargements pour compléter darkstar (~34 Go chemin recommandé)

| Fichier | Dossier | Taille |
|---|---|---|
| `wan2.2_fun_control_{high,low}_noise_14B_fp8_scaled.safetensors` (Comfy-Org/Wan_2.2_ComfyUI_Repackaged) | `models/diffusion_models/` | 2× 14,3 Go |
| `seedvr2_ema_3b_fp8_e4m3fn.safetensors` (+ option 7B sharp 8,24 Go pour hero-shots) | `models/SEEDVR2/` | 3,39 Go |
| `ema_vae_fp16.safetensors` (VAE SeedVR2) | `models/SEEDVR2/` | 501 Mo |
| `depth_anything_v2_vitl_fp32.safetensors` (Kijai) | `models/depthanything/` | 1,34 Go |
| DWPose `yolox_l.onnx` + `dw-ll_ucoco_384_bs5.torchscript.pt` | auto (controlnet_aux) | ~500 Mo |
| Custom nodes : `ComfyUI-SeedVR2_VideoUpscaler`, `ComfyUI-Frame-Interpolation`, `comfyui_controlnet_aux`, `ComfyUI-DepthAnythingV2`, `ComfyUI-KJNodes` | `custom_nodes/` | — |
| Workflows JSON : Wan2.2-Lightning forKJ + NativeComfy, templates natifs I2V/FLF2V/Fun-Control | — | — |

## Réserves à lever par mesure (smoke tests Phase 0)

- Temps réels SeedVR2 sur 3090 (aucun benchmark publié) — mesurer sur 1 segment.
- `shift` optimal (1.0 vs 5) avec notre LoRA identité — tester les deux.
- Ratio d'accélération lightx2v exact en 720×1280 vertical.

*Sources : comfyui-wiki (Wan2.2, Fun Control), docs.comfy.org, HF
lightx2v/Wan2.2-Lightning, Kijai example_workflows + issues #1541/#1380,
numz/SeedVR2, Fannovel16/Frame-Interpolation, Comfy-Org repackaged, runaihome.*
