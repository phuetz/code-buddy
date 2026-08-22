# Protocole de pilotage de la chaîne média — proposition Fable 5 à Codex

Rédigé le 2026-08-01, après vérification sur Ministar. Statut : **adopté par
Fable 5 et Codex**, avec contresignature dans le journal de
`FABLE5-CODEX-COORDINATION.md`.
Règle supérieure, non négociable : **aucun crédit dépensé, aucune génération
soumise, aucune publication sans accord explicite et daté de Patrice.**

## 1. Inventaire vérifié des leviers (état du 2026-08-01)

| Levier | Voie de pilotage | Vérifié | Coût |
|---|---|---|---|
| ElevenLabs Pro | API directe (`ELEVENLABS_API_KEY` dans `~/.codebuddy/media.env`), voix nommées `ELEVEN_VOICE_*`, compteur `~/.codebuddy/elevenlabs-voice-usage.json` | clé présente | facturant (caractères) |
| HeyGen Pro | double voie : `HEYGEN_API_KEY` (media.env) et driver web CDP `heygen-batch.py` (Brave port 9222, session connectée). `lisa-presentatrice.py inventaire` est **non facturé** | clé présente ; MCP HeyGen dispo côté Fable (OAuth humain requis, optionnel) | facturant (crédits) |
| Flow / Veo (Google AI Ultra) | pas d'API — CDP uniquement : `flow-daily.py` (≤50 crédits/j), `flow-veo-mission.py` (plafond + réserve lus sur compteur live), `broll-batch.py`, `lisa-clip-batch.py`. État : `media-video/flow-daily-state.json` | timer systemd `codebuddy-flow-daily.timer` **non installé/inactif** → aucune dépense automatique en cours | facturant (15 crédits/plan Agent) |
| Epidemic Sound | pas d'API. Bibliothèque locale `~/.codebuddy/media-audio/music/<mood>/` déjà constituée ; preuves de licence à archiver | bibliothèque en place | abonnement ; téléchargement humain |
| Krea | aucune clé ni driver trouvé | à décider | facturant |
| Darkstar (2× 3090) | éteint ; `propositions/PLAN-DARKSTAR-INSTALL-2026-05-02.md` (ComfyUI CUDA, LTX) | plan prêt, machine froide | électricité uniquement |
| Local Ministar (gratuit) | ffmpeg/ffprobe, ImageMagick, Piper TTS, faster-whisper, ComfyUI CPU, `video_delivery_qc.py`, `visual-gate.py`, contrôle `controle-technique.json` (LUFS/true peak/format), planches-contact | tout vérifié présent | zéro |

Les capacités d'abonnement consignées dans les documents du projet ne valent
pas solde en temps réel : crédits et caractères disponibles sont relus juste
avant chaque mission, sans lancer de génération.

## 2. Portes de dépense (gates)

1. **Dry-run par défaut.** Tout run facturant exige, dans le fichier de mission,
   une ligne d'accord de la forme
   `accord Patrice JJ/MM : N crédits|caractères pour <mission>` — une case
   cochée dans `flow-queue.md` n'est PAS un accord de dépense.
2. **Plafonds durs existants conservés** (flow-daily 50 crédits/jour,
   lisa-presentatrice 100 crédits) ; jamais relevés sans accord écrit.
3. **Aucune (ré)activation du timer** `codebuddy-flow-daily.timer` sans accord.
4. **Solde d'abord** : toute mission commence par lire le compteur
   (state Flow, usage ElevenLabs, `inventaire` HeyGen) et le consigner ;
   elle s'arrête d'elle-même sous la réserve.
5. **Un seul batch facturant actif** sur la session Brave 9222 (déjà codé dans
   `flow-veo-mission.py`) ; l'agent qui lance inscrit la réservation dans le
   tableau de coordination AVANT le run.
6. **Publication interdite aux agents** : `publish-queue.py`/`publish-worker.py`
   ne s'exécutent que sur ordre explicite de Patrice, cible par cible
   (conforme à la ligne « Publication AMBRE/LISA — HUMAIN »).
7. La politique éditoriale `editorial_policy.py` (sujets liés à Patrice exclus)
   s'applique à toute nouvelle mission, sans exception agent.

## 3. Répartition proposée Fable / Codex

**Codex — direction artistique et qualité des assets** (prolonge sa réserve P1) :
masters AMBRE/LISA, assainissement des documents périmés, kits Shorts v4,
kit Japon après décision kimono, cohérence visuelle des personas,
rédaction/relecture des scripts `*.script.md`, revue des planches-contact.

**Fable 5 — orchestration, outillage et contrôle** :
maintenance des scripts `scripts/influencer/`, gates de crédits et journaux de
dépense, QC automatisée (loudness, transcription Whisper post-HeyGen,
`video_delivery_qc.py`), inventaires non facturés (HeyGen `inventaire`, quotas
ElevenLabs), registre des preuves Epidemic, préparation des files de mission
(`flow-queue.md`, plans `lisa-presentatrice.py plan`) **sans soumission**,
et — sur accord — exécution des runs facturants sous plafond.

**Commun** : passation par le journal de `FABLE5-CODEX-COORDINATION.md`,
mêmes règles que le code (un propriétaire par zone, pas de nettoyage,
états consignés avec preuves).

## 4. Prérequis humains (Patrice)

1. **Sessions web au moment des runs** : Brave lancé avec
   `--remote-debugging-port=9222`, connecté au compte Google Ultra avec un
   onglet Flow sur le bon projet, et/ou session HeyGen ouverte.
2. **Accords de dépense datés**, par mission et par fournisseur.
3. **Epidemic Sound** : téléchargements + archivage des preuves de licence
   (les agents tiennent le registre, ne téléchargent pas).
4. **Décisions éditoriales en attente** (inchangées) : kimono Japon,
   sort des Shorts 02/03, format inaugural LISA, chaînes/titres/miniatures/URL.
5. **Darkstar** : allumage et exécution du plan d'install.
6. **Krea** : choisir le mode — session CDP partagée comme Flow, ou usage
   humain seul.
7. Optionnel : OAuth du connecteur MCP HeyGen dans la session Fable si cette
   voie doit doubler l'API/CDP.

## 5. Première mission type (à blanc, zéro crédit)

Pour valider le protocole sans rien dépenser : Fable exécute
`lisa-presentatrice.py inventaire` + lecture des soldes + `plan` sur un script
existant ; Codex relit le plan et la conformité éditoriale ; le tout est
consigné au journal. Premier run facturant seulement après un accord daté.
