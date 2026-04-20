# World Model — JEPA

Réflexion de Patrice sur les world models, weekend 18-20 avril 2026.
Document consolidé 18 pages : analyse scientifique + architecture cible + prompts Claude Code.

## Architecture cible
- **JEPA** (Yann LeCun) : prédiction dans l'espace latent, pas reconstruction pixel
- **LeWorldModel** : V1 légère, stable, entraînable sur dataset synthétique

## Composants
- `ObservationEncoder` : images → vecteur latent z
- `LatentDynamicsModel` : prédit z_{t+1} à partir de z_t + action  
- `WorldModel` : orchestrateur
- `IsotropicLatentRegularizer` : stabilise l'espace latent

## Hardware prévu
- Entraînement : PC 2× RTX 3090 (48 GB VRAM)
- Inference : PC Ubuntu Ryzen AI 470 Pro (128 GB RAM)

## Principe directeur
> "Construire petit, propre et mesurable. Une V1 compacte qui apprend correctement
> sur un monde synthétique vaut mieux qu'une imitation incomplète d'un système vidéo géant."
