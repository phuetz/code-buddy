# POC — PanoWorld 3D → insertion LoRA (2026-07-22)

**Idée Patrice** : utiliser PanoWorld (reconstruction 3D d'intérieurs) pour
faire évoluer/insérer les LoRA de personnage dedans. Unifie le world-model et
le pipeline influenceuse : un splat 3D navigable = lieu signature dont le
personnage ne dérive JAMAIS, sous n'importe quel angle. Supérieur aux plaques
2D (tous les angles) et complémentaire de MetaHuman (décor 3D vs perso 3D).

## Architecture cible
1. PanoWorld → splat 3D de l'appartement (`.ply`, gsplat).
2. Rendu du splat depuis une trajectoire caméra → RGB + **depth** + normal par frame.
3. **ControlNet depth + LoRA Lisa/Ambre** (ComfyUI) → personnage photoréaliste
   dans l'intérieur 3D exact, géométrie cohérente.
4. Vidéo : mouvement de caméra → depth par frame → i2v guidé → perso qui
   navigue un vrai appartement 3D.
Boucle robot : perso navigant l'appartement = données pour le world-model AUSSI.

## État des assets (vérifié 22/07)
- ✅ Splats reconstruits : `D:\DEV\PanoWorld\evaluation-data\outputs\gpu-*\codebuddy_scene\...\point_cloud.ply` (208 Mo, 2M gaussiennes, scene00415).
- ✅ Env gsplat : `~/.conda-envs/panoworld` (WSL darkstar) confirmé.
- ✅ Runner : `scripts/gpu-runners/panoworld-runner.py`.
- ⏳ ControlNet depth FLUX (Shakker-Labs) : en téléchargement (dossier controlnet était vide).
- ❌ Script de rendu du splat : `render_probe.py`/`render_rollouts.py` étaient dans un scratchpad local (à retrouver ou réécrire — render depuis pose arbitraire, sortie RGB+depth).

## À faire (prochaine session, build propre)
1. Réécrire un `render_splat_views.py` (env panoworld WSL, env vars build CUDA
   de `panoworld-wsl.sh` : CUDA_HOME, CC/CXX conda, TORCH_CUDA_ARCH_LIST=8.6) :
   charge le .ply, rend N poses (orbite/trajectoire) → RGB + depth 720×1280.
2. Workflow ComfyUI : Krea2/FLUX + LoRA Lisa v3 + ControlNet depth (image du
   splat en depth) → Lisa dans l'appartement. Balayer force ControlNet 0,5-0,8.
3. Juger : identité tenue + décor 3D cohérent sur 3-4 angles.
4. Si OK → vidéo (trajectoire caméra → depth par frame → i2v guidé).

## Pièges connus (mémoire panoworld-worldmodel-rank)
- Quoting bash→PowerShell→WSL→python : passer le Python en base64.
- gsplat 1.5.3 exige les env vars build (sinon `gsplat._C=None`).
- PowerShell remonte tqdm stderr en NativeCommandError → exit 1 FAUX.
- `Start-Process` détaché échoue en SSH non-interactif → foreground SSH maintenu.
