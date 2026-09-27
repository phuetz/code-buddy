# Reprise sécurité PR #259 — relecture indépendante

Mission du 2026-09-27 sur `fix/securite-2-3-0`, base `d3565567a`, correctif `74b921c59`.
Les reproductions emploient exclusivement des HOME `_qa/` et des jetons fictifs. Aucun push ni tâche de fond.

| Constat | Traitement | Preuve |
|---|---|---|
| R1 `understand_video cloud:true` lisait un jeton et le préparait pour Gemini | Garde `checkSecretFileAccess` avant `readFile`, sur chemin direct et lien symbolique | `media-secret-read.test.ts` rouge avant, vert après ; appel Gemini absent sur refus, vidéo ordinaire admise |
| R2 `video_analyze` suivait `clip.mp4` vers un jeton puis le préparait pour POST | Garde avant `stat` et au lecteur base64 | Test rouge avant, vert après ; aucun POST sur refus, vidéo ordinaire analysée |
| R3 ComfyUI uploadait un chemin secret ; `image_edit` lisait un nom secret dans son workspace | Gardes aux deux lecteurs locaux | Deux tests rouges avant, verts après ; aucun upload ni appel image sur refus, image locale ordinaire uploadée |
| R4 deux compositions Bash sous `~/.codebuddy` passaient | Refus d'un suffixe dynamique sous une racine d'identifiants pour les commandes lectrices | Deux tests rouges avant, verts après ; `validateCommand` refuse les deux chaînes |
| R5 séparateur Windows perdu par la normalisation POSIX | Normalisation selon plateforme | Test simulant `win32` rouge avant, vert après ; `settings.json` reste autorisé |

Les nouvelles assertions ont échoué **7/7** avant les modifications (`rouge-media.log` dans Partage). Après correction : **8/8** nouvelles assertions, **77/77** tests ciblés voisins, **1184/1184** tests sécurité, **40/40** données personnelles ; `npx tsc --noEmit` et ESLint ciblé réussis (12 avertissements existants, aucune erreur). `git diff --check` réussi. Les traces sont dans `reprise-sol/reprise-1/sol/` sur Partage.

## Ce que je n'ai pas pu vérifier

- Aucun envoi réel à Gemini, OpenAI ou ComfyUI ; les transports sont remplacés par des fonctions de test.
- Windows et macOS non exécutés : R5 est vérifié par simulation de la plateforme dans le validateur.
- Le shell peut encore construire un chemin entièrement à l'exécution hors du texte visible par le validateur. La protection complète exige un bac à sable natif activé et vérifié ; son fonctionnement n'a pas été mesuré ici.
- Les autres lecteurs bruts cités comme non audités par la relecture, la suite générale (~27 000 tests), l'interface et Cowork n'ont pas été exécutés. La documentation limite désormais sa promesse aux lecteurs effectivement gardés.
