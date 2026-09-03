# RAPPORT IMG2 — Grok Imagine, lot 2

Date : 2026-09-03 (Europe/Paris)

## Résultat

- Livraison finale : **50 clips conformes sur 50** — Lisa 30/30 (deux plans pour chacune des 15 fiches validées) et Ambre 20/20 (un plan pour chacun des 20 textes tourisme v3).
- Modèle et paramètres effectifs : `grok-imagine-video-1.5`, `--resolution 1080p`, durée demandée 6 s ; ffprobe mesure 6,041667 s pour chaque clip.
- Lisa : 13 plans i2v depuis les deux images pertinentes de `broll-local/`, 17 plans t2v ; format API 1080p vertical, 1088×1920.
- Ambre : 20 plans i2v depuis des photos existantes (`*-stills`, dossiers de destinations ou banque illustrée) ; format API 1080p paysage, 1920×1088.
- Destinations : `~/.codebuddy/personas/lisa/broll-grok-2026-09-03/` et `~/.codebuddy/personas/ambre/broll-grok-2026-09-03/`, sans autre écriture externe au clone.
- Générations réussies : 51. Une première variante Lisa a été rejetée visuellement à cause de petits visages réalistes, conservée sans écrasement sous `_rejected/`, puis remplacée par un nouveau job au nom distinct. Ensemble livré : 50 clips.
- Quota : **0 réponse 403**, donc aucun arrêt anticipé. Décompte final : 50/50 livrés, 0 échec API, 1 variante rejetée hors manifeste.
- Aucun push, aucune publication, aucun service et aucune autre API payante.

## Durcissement du pilote

Commit fonctionnel : `3bddf52b2` (`feat(influencer): harden Grok Imagine batch recovery`).

- Chaque requête JSON xAI écrit maintenant dans le journal ses en-têtes de réponse utiles et non sensibles : date, identifiant de requête, limite et restant de débit, ou délai de reprise s'il est exposé. Cookies et en-têtes non autorisés sont exclus.
- Un `403` portant `personal-team-blocked:spending-limit` dans le corps, le motif HTTP ou un en-tête lève immédiatement `QuotaExhausted`, avant toute voie de rafraîchissement.
- Le résumé de lot journalise séparément `generated`, `skipped_existing`, `failed`, `completed` et `stopped_at`.
- `--model` et `--resolution {480p,720p,1080p}` surchargent explicitement le manifeste ; la commande de production a utilisé `--model grok-imagine-video-1.5 --resolution 1080p`.
- La règle de reprise reste stricte : tout fichier cible existant de plus de 50 000 octets est sauté avant un appel API.
- Tests dédiés : absence de rafraîchissement au 403 de plafond, filtrage des en-têtes, masquage du jeton et de l'identifiant dans le chemin, options CLI, résumé exact et reprise idempotente.

Constructeur reproductible des 50 jobs : `332aa1103`. Correction du plan à visages et verrou de non-régression : `4191e0e3d`.

## Sources retenues

Les 15 fiches Lisa sont l'ensemble validé par les deux revues précédentes : sept copies corrigées du premier lot et huit fiches publiables ou corrigées du second. Les deux fiches encore « à corriger » dans la revue ne sont pas entrées dans IMG2. Les 20 fichiers Ambre correspondent exactement à la table de réenregistrement de `tourisme-v3/`.

Le manifeste final est produit localement sous `_img2/jobs-lisa.json` et `_img2/jobs-ambre.json`. Tous les prompts Lisa imposent absence de visage réaliste et de texte incrusté ; tous les prompts Ambre interdisent vue aérienne, drone et survol de ville, avec caméra fixe et géométrie stable.

## Journal des requêtes

- `_img2/api-lisa.jsonl` et `_img2/api-ambre.jsonl` : **580 réponses journalisées, 580 avec en-têtes utiles** ; 102 HTTP 200 et 478 HTTP 202 pour les 51 générations, variante rejetée incluse.
- Ensemble final accepté : 563 requêtes (100 HTTP 200, 463 HTTP 202). La variante rejetée représente 17 requêtes supplémentaires.
- En-têtes observés : `date`, `x-request-id`, `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`. Les valeurs d'identifiant de requête ne sont pas reproduites ici.
- Le couple de débit exposé est `60/60` sur les requêtes qui portent ces deux champs. Il s'agit d'une limite de débit, pas d'un solde d'abonnement.

Dans le tableau, `RL 60/60` signifie limite/restant de requêtes ; `req.` donne le nombre exact d'appels création + polling pour le job.

## Jobs Lisa

| Job | Fichier livré | Durée ffprobe | Capture QA | En-têtes utiles |
|---|---|---:|---|---|
| lisa-img2-gemini-video-agentique-a | `lisa-img2-gemini-video-agentique-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-video-agentique-a.jpg` | 16 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-gemini-video-agentique-b-safe | `lisa-img2-gemini-video-agentique-b-safe.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-video-agentique-b-safe.jpg` | 10 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-gemini-juridique-a | `lisa-img2-gemini-juridique-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-juridique-a.jpg` | 9 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-gemini-juridique-b | `lisa-img2-gemini-juridique-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-juridique-b.jpg` | 17 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-excel-copilot-python-a | `lisa-img2-excel-copilot-python-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-excel-copilot-python-a.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-excel-copilot-python-b | `lisa-img2-excel-copilot-python-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-excel-copilot-python-b.jpg` | 9 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-nvidia-vera-agents-a | `lisa-img2-nvidia-vera-agents-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-nvidia-vera-agents-a.jpg` | 12 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-nvidia-vera-agents-b | `lisa-img2-nvidia-vera-agents-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-nvidia-vera-agents-b.jpg` | 12 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-crowdstrike-safemind-a | `lisa-img2-crowdstrike-safemind-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-crowdstrike-safemind-a.jpg` | 12 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-crowdstrike-safemind-b | `lisa-img2-crowdstrike-safemind-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-crowdstrike-safemind-b.jpg` | 7 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-evaluation-ia-double-aveugle-a | `lisa-img2-evaluation-ia-double-aveugle-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-evaluation-ia-double-aveugle-a.jpg` | 17 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-evaluation-ia-double-aveugle-b | `lisa-img2-evaluation-ia-double-aveugle-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-evaluation-ia-double-aveugle-b.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-royaume-uni-100m-ia-a | `lisa-img2-royaume-uni-100m-ia-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-royaume-uni-100m-ia-a.jpg` | 9 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-royaume-uni-100m-ia-b | `lisa-img2-royaume-uni-100m-ia-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-royaume-uni-100m-ia-b.jpg` | 15 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-gemini-3-8-flash-a | `lisa-img2-gemini-3-8-flash-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-3-8-flash-a.jpg` | 11 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-gemini-3-8-flash-b | `lisa-img2-gemini-3-8-flash-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-3-8-flash-b.jpg` | 10 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-fairwind-cyber-a | `lisa-img2-fairwind-cyber-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-fairwind-cyber-a.jpg` | 12 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-fairwind-cyber-b | `lisa-img2-fairwind-cyber-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-fairwind-cyber-b.jpg` | 11 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-gemini-transcribe-a | `lisa-img2-gemini-transcribe-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-transcribe-a.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-gemini-transcribe-b | `lisa-img2-gemini-transcribe-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-gemini-transcribe-b.jpg` | 17 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-granite-4-2-a | `lisa-img2-granite-4-2-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-granite-4-2-a.jpg` | 9 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-granite-4-2-b | `lisa-img2-granite-4-2-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-granite-4-2-b.jpg` | 7 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-glm-5-3-flash-a | `lisa-img2-glm-5-3-flash-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-glm-5-3-flash-a.jpg` | 20 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-glm-5-3-flash-b | `lisa-img2-glm-5-3-flash-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-glm-5-3-flash-b.jpg` | 16 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-model-hardware-standard-a | `lisa-img2-model-hardware-standard-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-model-hardware-standard-a.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-model-hardware-standard-b | `lisa-img2-model-hardware-standard-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-model-hardware-standard-b.jpg` | 15 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-world-labs-atlas-a | `lisa-img2-world-labs-atlas-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-world-labs-atlas-a.jpg` | 9 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-world-labs-atlas-b | `lisa-img2-world-labs-atlas-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-world-labs-atlas-b.jpg` | 9 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-openai-hugging-face-rapport-a | `lisa-img2-openai-hugging-face-rapport-a.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-openai-hugging-face-rapport-a.jpg` | 17 req. ; HTTP 200/202 ; RL 60/60 |
| lisa-img2-openai-hugging-face-rapport-b | `lisa-img2-openai-hugging-face-rapport-b.mp4` | 6,041667 s | `_qa/img2/lisa/lisa-img2-openai-hugging-face-rapport-b.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |

## Jobs Ambre

| Job | Fichier livré | Durée ffprobe | Capture QA | En-têtes utiles |
|---|---|---:|---|---|
| ambre-img2-bali | `ambre-img2-bali.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-bali.jpg` | 7 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-cambodge | `ambre-img2-cambodge.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-cambodge.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-colombie | `ambre-img2-colombie.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-colombie.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-ecosse | `ambre-img2-ecosse.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-ecosse.jpg` | 12 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-egypte | `ambre-img2-egypte.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-egypte.jpg` | 7 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-grece | `ambre-img2-grece.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-grece.jpg` | 19 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-indonesie | `ambre-img2-indonesie.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-indonesie.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-islande | `ambre-img2-islande.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-islande.jpg` | 11 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-japon | `ambre-img2-japon.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-japon.jpg` | 17 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-jordanie | `ambre-img2-jordanie.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-jordanie.jpg` | 7 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-maroc | `ambre-img2-maroc.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-maroc.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-mexique | `ambre-img2-mexique.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-mexique.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-norvege | `ambre-img2-norvege.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-norvege.jpg` | 13 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-perou | `ambre-img2-perou.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-perou.jpg` | 13 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-philippines | `ambre-img2-philippines.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-philippines.jpg` | 21 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-portugal | `ambre-img2-portugal.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-portugal.jpg` | 10 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-sri-lanka | `ambre-img2-sri-lanka.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-sri-lanka.jpg` | 7 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-thailande | `ambre-img2-thailande.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-thailande.jpg` | 8 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-turquie | `ambre-img2-turquie.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-turquie.jpg` | 7 req. ; HTTP 200/202 ; RL 60/60 |
| ambre-img2-vietnam | `ambre-img2-vietnam.mp4` | 6,041667 s | `_qa/img2/ambre/ambre-img2-vietnam.jpg` | 16 req. ; HTTP 200/202 ; RL 60/60 |

## Contrôles et incidents

- Contrôle indépendant final : **50/50 ffprobe**, **50/50 captures JPEG**, **50/50 décodages vidéo complets**. Volume de l'ensemble livré : 291 744 637 octets.
- Planche fixe : `_qa/img2/contact-lisa.jpg` et `_qa/img2/contact-ambre.jpg`. Planche temporelle début/milieu/fin : `_qa/img2/motion-lisa-contact.jpg` et `_qa/img2/motion-ambre-contact.jpg`.
- Revue fixe : aucun visage réaliste ni texte incrusté dans les 30 clips Lisa acceptés ; les écrans Excel contiennent une interface diégétique, pas une incrustation éditoriale. Les 20 clips Ambre correspondent à leur destination et ne montrent pas de survol urbain.
- Revue temporelle : cadrage et géométrie stables sur 50/50 ; mouvement limité aux signaux/lumières ou aux éléments naturels décrits.
- Incident éditorial : la première variante `gemini-video-agentique-b` contenait de petits visages réalistes dans des écrans. Elle n'a été ni écrasée ni régénérée ; elle est conservée dans `_rejected/`. Le remplacement `-b-safe` est abstrait et validé.
- Incident de harnais : le premier passage d'extraction s'est arrêté après 1 capture parce que ffmpeg lisait l'entrée standard de la boucle. Le passage complet corrigé avec `-nostdin` a produit et vérifié 50/50 captures.
- Rejeu final : Lisa 30 skips, Ambre 20 skips, **0 appel API** dans les deux journaux de rejeu.
- Le test TypeScript `tests/security/donnees-personnelles.test.ts` n'a pas pu démarrer : `vitest` est absent des dépendances locales (`ERR_MODULE_NOT_FOUND`). Aucun paquet n'a été installé. Le scan ciblé du rapport ci-dessous est propre.

## Vérifications exécutées

```text
python3 -m pytest -q tests/scripts/influencer/
184 passed, 1 skipped

python3 -m py_compile scripts/influencer/grok_imagine.py scripts/influencer/build_jobs_img2.py
code 0

ffprobe par fichier + ffmpeg -nostdin -v error -i <clip> -map 0:v:0 -f null -
50/50 probes conformes ; decoded=50

find _qa/img2/lisa _qa/img2/ambre ... -size +10000c
captures=50

rejeu des deux manifestes avec les mêmes --model/--resolution
Lisa : 30 skips, 0 API ; Ambre : 20 skips, 0 API

npx vitest run tests/security/donnees-personnelles.test.ts
ÉCHEC DE DÉMARRAGE : dépendance locale vitest absente (ERR_MODULE_NOT_FOUND)

scan ciblé RAPPORT-IMG2.md : chemins nominatifs, jetons, e-mails
privacy_scan=clean
```

## Bilan

- 50 clips finaux livrés aux deux seules destinations autorisées ; 30 Lisa et 20 Ambre.
- 50/50 ffprobe, captures, décodages et contrôles temporels réussis.
- 0 réponse 403, 0 échec API ; 51 générations réussies dont 1 variante rejetée et préservée.
- Script durci et testé ; reprise finale prouvée à 0 appel API.
- Garde Vitest de données personnelles non exécuté faute de dépendance locale ; scan ciblé propre.
- Aucun secret, identifiant de requête ou donnée personnelle reproduit dans ce rapport.
- Aucun push, service, dépôt original ou autre API touché.
