# Pipeline best-of-N keyframes Lisa → i2v H3

> **La loi mesurée (11/08)** : le LoRA H3 seul plafonne à **0,36 ArcFace**. Le vrai
> levier d'identité est la **keyframe krea2** (0,576), dont le score **se propage**
> en i2v H3 (0,48-0,50 stable sur 5 s). Ce pipeline industrialise ça : générer
> plusieurs keyframes, garder la meilleure à l'ArcFace, l'animer, mesurer.

## Ce que fait le pipeline (`best-of-n-keyframes.py`)

1. **Génère N keyframes krea2** (seeds distincts) — `krea2_turbo_fp8_scaled` + LoRA
   `lisa-krea2`, 8 pas euler/simple cfg 1 (workflow Turbo officiel).
2. **Score ArcFace** chaque keyframe vs `lisa-h3-source.png` → garde **la meilleure**
   (des 0,65+ existent dans la distribution — c'est tout l'intérêt du best-of-N).
3. **i2v H3** `MiniMaxH3ImageToVideo` (`first_frame` = meilleure keyframe) +
   **LoRA stabilisateur optionnel** (le nouveau `lisa_h3_v1`, 125 réfs).
4. **Valide** : extrait 3 frames (début/milieu/fin) + ArcFace → `report.json`.

Tout passe par l'API ComfyUI. Le script n'utilise le GPU que via le serveur H3.

## Séquence complète (après l'entraînement LoRA)

```powershell
# 0. Le training lisa_h3_v1 est fini (moniteur notifie).
#    Choisir le meilleur checkpoint (voir "Choix du checkpoint" ci-dessous),
#    le copier là où le serveur H3 voit ses LoRA :
Copy-Item "D:\DEV\ai-toolkit\output\lisa_h3_v1\lisa_h3_v1.safetensors" `
          "D:\DEV\ComfyUI\models\loras\lisa_h3_v1.safetensors"

# 1. Lancer le serveur ComfyUI H3 (GPU libre) — via la tâche planifiée existante :
schtasks /run /tn "ComfyUI-H3"
#    (attendre ~30 s que le serveur réponde sur http://127.0.0.1:8190)

# 2. Copier les scripts sur gpuNode (une fois) dans D:\DEV\scripts\ :
#    best-of-n-keyframes.py, score-arcface-images.py, run-best-of-n.ps1

# 3. Lancer le pipeline :
powershell -ExecutionPolicy Bypass -File D:\DEV\scripts\run-best-of-n.ps1

# 4. Lire le rapport :
Get-Content D:\DEV\lisa-bestof\report.json
```

## Choix du checkpoint LoRA

Le training sauve tous les 250 pas (`output\lisa_h3_v1\*.safetensors`). Le LoRA seul
plafonnant vite, **ne pas présumer que le dernier est le meilleur**. Deux options :

- **Rapide** : tester `lisa_h3_v1` (final) comme stabilisateur ; si l'i2v ArcFace ne
  gagne rien vs sans stabilisateur (`--stabilizer-lora ""`), c'est que la keyframe
  porte déjà tout — garder le pipeline keyframe pur.
- **Rigoureux** : lancer le pipeline avec `--skip-i2v` pour chaque checkpoint en
  stabilisateur d'une même keyframe, comparer les ArcFace i2v.

## Réglages qui bougent l'aiguille

| Levier | Effet mesuré |
|---|---|
| **N keyframes** (`--n`) | plus grand = plus de chances d'un 0,65+ (best-of-N) |
| **Résolution i2v native** (`--i2v-width/height`, 768×1344) | **levier n°1** — l'identité ne s'exprime qu'en natif |
| **`--stabilizer-strength`** | 0,6-0,9 ; trop fort fige, trop faible n'aide pas |
| **Prompt keyframe** | doit décrire la Lisa canonique (brune, col roulé bordeaux) |
| **best-of-N sur l'i2v aussi** | plusieurs seeds i2v, garder la vidéo la plus stable |

## Garde-fous

- **Cache ComfyUI** : un même nom de fichier LoRA ⇒ résultat servi du cache. Le
  script génère des noms de keyframes distincts ; pour les LoRA, **toujours un nom
  distinct par checkpoint** si tu compares plusieurs.
- **Serveur orphelin** : lancer par tâche planifiée (stdout→fichier), jamais par ssh
  direct (stdout mort ⇒ tqdm plante en `Errno 22`). Ne jamais `pkill` le ComfyUI de
  prod (:8188/:8189) qui porte les LoRA d'identité.
- **Un seul job GPU à la fois** : ce pipeline attend que l'entraînement soit fini.

## Fichiers

- `best-of-n-keyframes.py` — l'orchestrateur (stdlib seule).
- `score-arcface-images.py` — scorer ArcFace buffalo_l (existant).
- `run-best-of-n.ps1` — lanceur paramétré.
- venv ArcFace : `D:\DEV\arcface-venv` (insightface + onnxruntime, CPU).
- Référence identité : `D:\DEV\ComfyUI-H3\input\lisa-h3-source.png`.
