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

## Addendum — chaîne LoRA → MetaHuman (question Patrice « MetaHuman peut-il générer depuis les LoRA ? »)

**Non directement** (LoRA = poids diffusion 2D ; MetaHuman = rig 3D). **Pas de
flux Epic « photo/IA → MetaHuman » en 2026** (vérifié : MetaHuman hors Early
Access depuis UE 5.6/06-2025, Creator in-engine, mais AUCUNE création depuis
photo). Le pont = « Mesh to MetaHuman » qui exige un **maillage 3D de tête** en
entrée ; la topologie de sortie est TOUJOURS le template MetaHuman propre (donc
le mesh d'entrée n'a qu'à donner le volume/les proportions). Auto-rig + texture
= services cloud Epic.

### Reconstruire la tête 3D depuis nos portraits LoRA — classé
1. **KeenTools FaceBuilder (RECOMMANDÉ)** : multi-photos (face/¾/profils = ce
   que le LoRA produit) → topologie propre + texture blend + **transfert natif
   forme+skin+UV vers MetaHuman**. 14,90 $/mois, commercial OK, Blender, GPU
   léger. Le chemin le plus court et propre.
2. Reallusion Headshot 3 + CC5 (photo→3D→export MetaHuman ; 149/329 $, pipeline
   perso complet).
3. RealityScan 2.0 (photogrammétrie, gratuit <1 M$) — mais images IA pas
   métriquement cohérentes → alignement fragile. Repli.
4. HRN (Apache-2.0, 3090 OK) / EMOCA-DECA (FLAME, licence NON-COMMERCIALE =
   bloquant) — proxy de forme seulement.
5. Hunyuan3D-2 (6-16 Go, 3090 OK) — bloc de volume, topologie soupe.

### Voie hybride inverse (render MetaHuman → LoRA) — FAISABLE, la meilleure
Aucun outil unique nommé, mais composition standard : MRQ rend le MetaHuman +
passes **depth/normal/openpose** → ComfyUI FLUX **img2img + LoRA Lisa +
ControlNet depth(0,75) + openpose(0,6), denoise ~0,45** → identité Lisa
photoréaliste en gardant géométrie/pose/cohérence 3D. Vidéo = AnimateDiff/
vidéo-diffusion conditionné structure (le point dur = cohérence temporelle).

### POC (après priorités actuelles + espace disque désormais OK)
- **POC-1 (ressemblance, priorité)** : 6 vues Lisa cohérentes → FaceBuilder
  (essai 15 j) → tête 3D → transfert MetaHuman. Juge : ressemble-t-il de face/¾ ?
- **POC-2 (photoréalisme)** : 1 frame MetaHuman → ComfyUI FLUX img2img + LoRA +
  ControlNet depth, balayer denoise 0,35/0,45/0,6. Calibre la voie hybride.
Faire POC-1 d'abord. Éviter RealityScan/reconstruction neuronale sur images IA.

*Sources : metahuman.com, unrealengine.com (5.6), 80.lv, keentools.io,
reallusion, realityscan.com, HRN/EMOCA/Hunyuan3D repos, workflows ComfyUI
FLUX img2img+ControlNet.*
