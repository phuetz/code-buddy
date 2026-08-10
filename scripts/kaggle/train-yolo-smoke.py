# Pilote Kaggle GPU — fine-tuning YOLOv8 pour le chantier vision-train de Code Buddy.
# Preuve de boucle : push API -> run GPU -> artefact recuperable. Le smoke entraine
# 3 epoques sur coco128 (auto-telecharge par ultralytics, aucun dataset a pousser).
# La version production remplacera coco128.yaml par le dataset des weak-spots CKG.
import shutil
import subprocess
import sys
from pathlib import Path

# Installation HORS-LIGNE depuis le dataset de wheels (les kernels d'un compte
# non vérifié téléphone n'ont pas d'accès réseau — appris au run v2).
import os
print("Contenu de /kaggle/input :")
for root, dirs, files in os.walk("/kaggle/input"):
    print(" ", root, files[:6])
subprocess.run([sys.executable, "-m", "pip", "install", "--no-index",
                "--find-links", "/kaggle/input/codebuddy-wheels",
                "ultralytics", "ultralytics-thop", "py-cpuinfo", "nvidia-ml-py"], check=True)

import torch
from ultralytics import YOLO

print(f"GPU disponible : {torch.cuda.is_available()}"
      f" ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})")

model = YOLO("/kaggle/input/codebuddy-wheels/yolov8n.pt")
results = model.train(data="/kaggle/input/codebuddy-wheels/smoke-dataset/data.yaml", epochs=1, imgsz=320, device=0 if torch.cuda.is_available() else "cpu",
                      project="/kaggle/working/runs", name="vision-train-smoke")

best = Path(results.save_dir) / "weights" / "best.pt"
out = Path("/kaggle/working/best.pt")
shutil.copy(best, out)
metrics = results.results_dict if hasattr(results, "results_dict") else {}
print("METRICS:", metrics)
print(f"Artefact : {out} ({out.stat().st_size} octets)")
