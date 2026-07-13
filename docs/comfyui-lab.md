# Laboratoire ComfyUI (Cowork)

Le **Laboratoire ComfyUI** est intégré à l’Atelier Flow. Il ne génère rien : il cartographie les
capacités locales et prépare un plan manuel pour six parcours classés par priorité :

1. couvertures et storyboards ;
2. animatique Wan ;
3. cohérence des personnages avec FLUX.2 Klein, Qwen Image Edit ou adaptateurs compatibles ;
4. musique ACE-Step ;
5. avatar parlant ;
6. objets et décors 3D.

## Calcul de l’état

Le catalogue est défini dans `cowork/src/shared/comfy-lab-manifest.ts`. Chaque parcours déclare des
groupes de modèles, nœuds et workflows. Le main process :

- résout `COMFYUI_ROOT`, ou les emplacements locaux standards `~/ComfyUI`, `~/DEV/ComfyUI` et
  `~/.codebuddy/comfyui` ;
- ignore les liens symboliques et les fichiers modèle de taille nulle ;
- inventorie les workflows JSON locaux avec des plafonds de fichiers ;
- sonde uniquement `http://127.0.0.1:<COMFYUI_PORT>/system_stats` et `/object_info`, avec délai,
  taille de réponse et redirections bornés ;
- affiche le device déclaré par ComfyUI et signale explicitement le **CPU fallback** ;
- marque un parcours `Prêt` si tous ses prérequis sont présents, `Partiel` si une installation ou
  certains signaux existent, sinon `Manquant`.

Ces états attestent une présence technique, pas une performance, une qualité ni un droit d’usage.
Chaque carte rappelle donc coût de calcul, stockage, licence à vérifier et limites créatives.

## Frontière de sécurité

Les seules actions mutables sont :

- **Ouvrir ComfyUI**, uniquement si la sonde IPv4 loopback répond ;
- **Copier le plan**, dont le texte est construit par le main process depuis un identifiant de cas
  d’usage fermé.

Il n’existe aucun canal pour télécharger, installer, importer, exécuter ou mettre en file un
workflow. Le renderer ne choisit ni URL, ni commande, ni chemin racine. Aucune route distante et
aucun secret ne sont exposés.
