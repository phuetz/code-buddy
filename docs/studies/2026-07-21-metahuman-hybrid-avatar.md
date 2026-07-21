# Étude — MetaHuman / UE 5.8 pour l'influenceuse AI (2026-07-21)

Darkstar : **UE 5.8 confirmé installé** (`D:\Program Files\Epic Games\UE_5.8`,
35,7 Go, éditeur + `UnrealEditor-Cmd.exe` headless + plugin MetaHuman + Quixel
Bridge + Fab). ⚠️ D: n'a que 5 Go libres — projet + rendus sur C: (173 Go).

## Verdict : POC sur la voie HYBRIDE 3D→diffusion, PAS un pivot MetaHuman-pur

**Le MetaHuman résout à la racine notre douleur n°1** (dérive
identité/pose/décor : un avatar 3D ne dérive jamais). Mais MetaHuman **pur**
coûte trop cher pour du « fashion indiscernable » : maîtrise UE raide
(semaines/mois), look CG résiduel en MOUVEMENT, et simulation tissu/marche =
maillon faible. En STILL cadré + path tracing, c'est « presque photo » ; en
motion fashion, « clairement CG ».

**La bonne voie = le 3D comme couche de CONTRÔLE, la diffusion comme moteur de
RENDU** : le squelette 3D pin la pose/caméra/décor, notre LoRA pin le visage,
la diffusion n'ajoute que la peau photoréaliste. On GARDE notre moteur
diffusion et notre LoRA v3 ; on ajoute dessous un underlay 3D qui ne dérive
jamais.

## Licence (à re-confirmer sur l'EULA live)
- MetaHuman utilisable commercialement (YouTube/film monétisé) : OUI standard.
- Identité INVENTÉE (pas un scan de personne réelle) : OK. Double numérique
  d'une vraie personne sans droits : interdit — notre cas est propre.
- Contrainte historique : assets liés à Unreal (pas d'export vers un autre
  MOTEUR pour le rendu final). **Notre pipeline rend DANS UE (Movie Render
  Queue → frames) puis post-traite ces pixels en diffusion → ne déclenche PAS
  la restriction** (on ne redistribue pas le mesh, on post-traite notre footage).
- À vérifier : unrealengine.com/eula (section MetaHuman) + fiche Fab.

## Capacités confirmées
- **MetaHuman Animator** : capture faciale (iPhone/vidéo) + **Audio-to-Face**
  (lip-sync depuis l'audio seul — idéal influenceuse qui parle, $0).
- Body mocap markerless : Move.ai, Rokoko Vision 3.0 (single-video → FBX/BVH
  squelette UE5), Mixamo (marche/poses gratuites). ⚠️ démarche mannequin +
  drapé = maillon faible du markerless.
- **Movie Render Queue pilotable headless** (Python + CLI) → rendu batch
  quotidien scriptable.
- 2×3090 : UE n'accélère pas UN rendu sur 2 GPU → **UE sur un 3090, ComfyUI/
  diffusion sur l'autre** (parfait pour l'hybride).

## POC borné (~1-2 semaines de ramp UE)
1. **Mesh-to-MetaHuman depuis le visage FLUX de Lisa** → 3D et diffusion
   partagent la MÊME identité.
2. 5 plans fashion posés (Sequencer), rendu 1080×1920 Lumen + AOV depth/normal.
3. ComfyUI : render UE en img2img (denoise 0,4-0,6) + ControlNet depth+openpose
   + LoRA Lisa v3 → photoréaliser.
4. **Critère de succès** : sur 5 poses/décors, visage identique + pose/décor
   non dérivés (là où le full-diffusion dérive) + peau photoréaliste. Si OK →
   courte vidéo (ControlNet temporel / Wan i2v initialisé par le render UE).

Ne PAS toucher la sim corps/tissu ni le rendu MetaHuman final tant que le POC
stills n'a pas prouvé que la dérive est réglée.

## Position dans la stratégie
Voie complémentaire, pas un remplacement. Le full-diffusion (rapide) reste le
défaut pour la cadence ; l'hybride 3D devient l'option « contrôle parfait » pour
les plans signature / lieux récurrents / futurs clips parlés lip-syncés. À
lancer APRÈS les priorités actuelles (LoRA v3 en prod, lieux signature, voix).
Prérequis : libérer de l'espace disque darkstar.

*Sources vérifiées : dev.epicgames (MetaHuman Animator, Mesh-to-MetaHuman,
Movie Render Queue), move.ai, rokoko.com. Licence/réalisme : à re-confirmer
sur l'EULA live (non fetchable).*
