# Kaggle — GPU cloud piloté par agent ($0)

Voie validée le 2026-08-10 (décision Patrice « ok pour Kaggle ») : l'API Kaggle
(`kaggle kernels push/status/output`) permet à un agent de lancer un entraînement
dans le cloud et de rapatrier l'artefact **sans aucun clic humain**. Quota
gratuit : ~30 h GPU + 20 h TPU par semaine. Boucle prouvée le jour même :
`best.pt` YOLOv8 entraîné sur Kaggle et rapatrié (CPU — voir verrou GPU).

## Prérequis (gestes humains, une fois)
1. Jeton API : kaggle.com → Settings → API → Create New Token → coller le
   `KGAT_…` dans `~/.kaggle/access_token` (chmod 600).
2. **Vérification téléphone du compte** : sans elle, les kernels tournent SANS
   GPU (repli CPU silencieux malgré `enable_gpu: true`) et SANS réseau (pip
   vers PyPI refuse). C'est le verrou principal.

## Règles apprises (chaque échec du 10/08 a payé la sienne)
- `ultralytics` n'est PAS dans l'image Kaggle → l'installer depuis un dataset
  de wheels embarqué (`pip install --no-index --find-links /kaggle/input/...`).
  Dépendance non évidente à embarquer aussi : `nvidia-ml-py`.
- **Mode hermétique par défaut** : poids (`yolov8n.pt`) et dataset dans le
  dataset Kaggle — aucun téléchargement au run, reproductible même sans réseau.
- Après `kaggle datasets create|version`, ATTENDRE que le contenu soit
  réellement visible (`kaggle datasets files … | grep <nouveau fichier>`) avant
  de pousser le kernel — le statut `ready` peut décrire la version précédente.
- Les statuts de kernel sont en MAJUSCULES (`KernelWorkerStatus.ERROR`) —
  matcher insensible à la casse (`${STATUS,,}`).
- Lister `/kaggle/input` AVANT toute installation : le log d'erreur de pip ne
  dit pas si le dataset est monté.
- **Choisir la carte via `machine_shape`** dans kernel-metadata.json :
  `NvidiaTeslaT4` (sm_75, SUPPORTÉE par le torch 2.10 de l'image) — jamais la
  P100 par défaut (sm_60, `no kernel image available` avec torch ≥ 2.10).
- Après vérification téléphone, le réseau des kernels FONCTIONNE aussi — mais
  garder le mode hermétique par défaut (reproductible, insensible aux pannes).

## Preuve finale (10/08, kernel v8)
`GPU disponible : True (Tesla T4)` — 3 époques YOLOv8 sur CUDA, `best.pt`
rapatrié automatiquement. Boucle agent complète validée.

## Usage
```bash
cd scripts/kaggle && bash lancer-smoke.sh   # pousse, surveille, rapatrie best.pt
```
Production vision-train : remplacer le smoke-dataset par le dataset des
weak-spots CKG (`buddy vision-train --ckg`) et `device=0` une fois le GPU
débloqué. Voir `src/vision-train/`.
