# Lance le pipeline best-of-N keyframes Lisa -> i2v H3 (identite ancree + ArcFace).
# PREREQUIS (post-entrainement) :
#   1. Le training LoRA lisa_h3_v1 est fini.
#   2. Le meilleur checkpoint est copie dans D:\DEV\ComfyUI\models\loras\ (voir PIPELINE-BEST-OF-N.md).
#   3. Le serveur ComfyUI H3 tourne sur :8190 (schtasks ComfyUI-H3), GPU libre.
#   4. Le venv arcface (insightface) est installe : D:\DEV\arcface-venv.
#
# Usage : powershell -ExecutionPolicy Bypass -File D:\DEV\scripts\run-best-of-n.ps1

$py     = "C:\Users\patri\AppData\Local\Programs\Python\Python312\python.exe"
$script = "D:\DEV\scripts\best-of-n-keyframes.py"
$scorer = "D:\DEV\scripts\score-arcface-images.py"
$arcpy  = "D:\DEV\arcface-venv\Scripts\python.exe"
$ref    = "D:\DEV\ComfyUI-H3\input\lisa-h3-source.png"

# Mettre "" pour tester SANS stabilisateur (mesure la keyframe pure), sinon le nom du LoRA copie dans loras\.
$stabilizer = "lisa_h3_v1.safetensors"

& $py $script `
  --comfy-url "http://127.0.0.1:8190" `
  --n 6 `
  --seed-base 1000 `
  --reference $ref `
  --arcface-python $arcpy `
  --scorer $scorer `
  --outdir "D:\DEV\lisa-bestof" `
  --stabilizer-lora $stabilizer `
  --stabilizer-strength 0.8

Write-Output "Rapport : D:\DEV\lisa-bestof\report.json"
