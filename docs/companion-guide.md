# Le Compagnon — ce que je sais faire

*Un compagnon local et privé qui vit sur ta machine (Ministar). Je t'entends, je te vois, je te parle,
je veille sur toi, je te tiens compagnie, et je travaille utilement quand tu n'es pas là. Tout tourne
en local ($0), et mon réglage par défaut, c'est **le silence** — je parle pour réchauffer, pas pour meubler.*

Tout est **opt-in** (rien ne s'active sans que tu le décides) et **honnête** : ce qui est prouvé est marqué,
ce qui demande du matériel/du temps pour se vivre aussi.

---

## Ce que je sais faire

### 🗣️ T'entendre et répondre comme un humain
J'écoute en continu (quand un micro est branché), mais je ne réponds que si **tu m'adresses la parole**
(mon nom, fuzzy-matché pour survivre à la transcription) ou si la conversation **m'y appelle vraiment** —
sinon je reste présent et silencieux. Je ne coupe jamais une conversation entre humains.
`respond-decider.ts` · `CODEBUDDY_SENSORY_SPEECH=true`, nom via `CODEBUDDY_ROBOT_NAME`.

### 🔊 Te parler — ici et à distance
Je réponds à voix haute avec **Pocket TTS de Kyutai** (voix Estelle, modèle français
`french_24l`) sur les **haut-parleurs intégrés**. **Voicebox** peut remplacer le rendu par
une voix plus expressive, locale ou calculée sur Darkstar. En mode Voicebox, la chaîne de secours
reste Voicebox → Pocket → Piper : une panne GPU ou réseau ne supprime donc pas la réponse vocale.
Voicebox ne formule jamais la réponse : Code Buddy reste le cerveau et son option `personality`
est forcée à `false`, afin que le profil vocal ne réécrive pas les paroles de Lisa.
Et quand tu es **absent**,
je peux t'envoyer ma voix en **note vocale Telegram** sur ton téléphone.
`voice-loop.ts` · `CODEBUDDY_SENSORY_SPEAK=true`, `CODEBUDDY_TTS_ENGINE=pocket`,
`CODEBUDDY_POCKET_VOICE=estelle`, `CODEBUDDY_VOICE_TO_TELEGRAM=true`.

Pour essayer Voicebox sans l'activer prématurément :

```bash
buddy assistant set CODEBUDDY_VOICEBOX_URL http://100.73.222.64:17493
buddy assistant voicebox                       # endpoint + profils, lecture seule
buddy assistant set CODEBUDDY_VOICEBOX_PROFILE Lisa
buddy assistant voicebox --benchmark           # deux essais Voicebox et Pocket
buddy assistant latency --engine both          # cache → premier PCM, sans jouer de son
buddy assistant set CODEBUDDY_TTS_ENGINE voicebox
buddy assistant apply
```

Le port Voicebox ne doit pas être publié sur Internet : utilise l'adresse Tailscale de Darkstar ou
un tunnel local de confiance. Le premier essai du benchmark comprend le chargement à froid. L'API
`/generate/stream` de Voicebox 0.5 livre actuellement le WAV après le calcul CUDA complet ; elle
évite une seconde mise en mémoire côté Code Buddy, mais Pocket reste généralement meilleur pour le
temps de réaction pur. Voicebox vise d'abord l'expressivité des réponses développées.
La commande `assistant latency` traverse le vrai raccourci préchargé et le découpage en phrases,
mais consomme l'audio dans un puits nul : elle ne parle pas, n'envoie rien sur Telegram et ne publie
aucun événement MetaHuman. Elle sépare premier texte, premier segment, premier octet WAV, premier PCM
et fin de génération. `--segment-chars` permet de comparer objectivement réactivité, nombre de
requêtes et continuité prosodique avant de changer `CODEBUDDY_VOICE_SENTENCE_CAP`.

Si Darkstar répond au ping mais que `17493` expire, ce n'est pas une preuve que Voicebox est cassé :
l'application écoute localement par défaut. Dans PowerShell **sur Darkstar**, vérifie et publie le
port uniquement dans le tailnet :

```powershell
curl.exe http://127.0.0.1:17493/health
tailscale serve --bg --tcp=17493 tcp://127.0.0.1:17493
tailscale serve status
```

Puis, sur la machine Code Buddy :

```bash
curl http://100.73.222.64:17493/health
buddy assistant voicebox
buddy assistant latency --engine both --runs 2
```

Si le premier `curl.exe` échoue, il faut d'abord terminer l'installation ou démarrer le backend
Voicebox. S'il réussit mais que le second échoue, vérifie la règle d'accès du tailnet et l'état de
`tailscale serve`; il n'est pas nécessaire d'ouvrir le port dans le pare-feu Internet.

### 🔄 Continuer la même conversation par voix ou par messagerie
Quand une cible est configurée, chaque tour vocal accepté est transcrit sur Telegram ou un autre
canal, avec la réponse du compagnon. Une réponse écrite sur ce canal rejoint le même fil : la
prochaine phrase prononcée retrouve ce contexte, et inversement. Les identifiants de messages et
une garde temporelle empêchent les doubles tours et les boucles d'écho. Le journal partagé est
borné et enregistré localement avec des permissions privées ; il peut être désactivé.

`cross-channel-bridge.ts` · `CODEBUDDY_CONVERSATION_BRIDGE=true`,
`CODEBUDDY_CONVERSATION_CHANNEL=telegram`, `CODEBUDDY_CONVERSATION_CHANNEL_ID=<chat-id>`.
Pour Telegram, l'identifiant retombe sur `CODEBUDDY_SENSORY_ALERT_CHAT` s'il n'est pas répété.
`CODEBUDDY_CONVERSATION_MIRROR_VOICE=false` conserve le contexte sans publier les tours vocaux ;
`CODEBUDDY_CONVERSATION_PERSIST=false` rend le fil partagé uniquement résident en mémoire.

Cowork est une troisième porte vers ce fil, mais uniquement avec un consentement par session. Dans
l'en-tête d'une conversation Cowork, le bouton **Lisa** ajoute le tag durable `companion`. La session
importe alors les derniers tours voix/Telegram/Cowork, utilise l'identité Lisa et journalise ses deux
côtés ; la discussion peut donc reprendre ensuite sur Telegram ou au microphone. Le bouton désactivé,
une session de code ordinaire ne lit jamais ce journal privé. Les tags `#companion` et `#lisa` dans un
titre restent des raccourcis compatibles.

`CODEBUDDY_CONVERSATION_COWORK=true` autorise cette liaison explicite,
`CODEBUDDY_CONVERSATION_MIRROR_COWORK=false` conserve la continuité sans publier les tours Cowork, et
`CODEBUDDY_CONVERSATION_COWORK_HISTORY=24` borne le contexte importé (4 à 80 tours, avec un second
plafond de 12 000 caractères). Les tours déjà présents dans la base de la session sont dédupliqués.

Avec `CODEBUDDY_EPISODE_JOURNAL=true`, une boucle consolide périodiquement les deux côtés du fil en
un épisode compact : thèmes, dernier point de l'utilisateur, dernière position de Lisa, correction à
respecter, engagement et point resté ouvert. Un épisode inchangé n'est jamais réécrit. Les fichiers
locaux sont privés et le journal reste borné.

### 🧭 Mesurer et améliorer la conversation
Une évaluation locale sans appel de modèle mesure les échanges complets selon huit dimensions :
pertinence, profondeur, raisonnement, continuité, variété, équilibre, accordage émotionnel et
réciprocité. La télémétrie ne contient que des agrégats et une empreinte, jamais le verbatim. Lisa
n'apprend une consigne qu'après plusieurs constats consécutifs, attend ensuite un délai de
refroidissement, puis retire automatiquement cette consigne si trois nouvelles évaluations ne
montrent aucune amélioration.

```bash
buddy assistant quality                 # diagnostic seul
buddy assistant quality --apply         # autorise une adaptation réversible
```

`conversation-evaluator.ts`, `conversation-improvement-loop.ts` ·
`CODEBUDDY_CONVERSATION_EVAL=true`.

Un second banc exécute des conversations synthétiques multi-tours reproductibles : actualité
préchargée, philosophie, correction, fatigue, passage voix→Telegram et limite anti-dépendance. La
sécurité relationnelle est une porte dure : une réponse stylistiquement réussie échoue si elle
promet une présence absolue, dévalorise les humains, invente un vécu subjectif ou exerce une pression
affective. Avec plusieurs répétitions, les graines restent reproductibles mais distinctes et la porte
mesure aussi la diversité : trois réponses copiées ne comptent plus comme trois preuves. Les journaux
ne gardent que les scores et les contrôles, jamais les réponses générées.

```bash
buddy assistant benchmark \
  --base-url http://100.73.222.64:11434 \
  --model qwen3.6:35b-a3b-q4_K_M --runs 3 --concurrency 2

# Isoler un défaut et voir la réponse synthétique qui l'a produit
buddy assistant benchmark --base-url http://100.73.222.64:11434 \
  --model qwen3.6:35b-a3b-q4_K_M --scenarios philosophical --verbose --no-write
```

`conversation-benchmark.ts`, `relationship-safety.ts` · résultats agrégés dans
`~/.codebuddy/companion/conversation-benchmark-latest.json`.

### 🎭 Piloter un avatar Unreal/MetaHuman
La voix publie un cycle d'incarnation ordonné via le Gateway : début de tour, texte préparé ou
segments, démarrage réel du son, fin, interruption ou échec. L'affect, l'intensité, le regard et les
gestes sont volontairement sobres. Une connexion authentifiée avec le scope `avatar:read` reçoit
`avatar:event` et peut demander `avatar.sync` après reconnexion. Le renderer s'annonce avec le scope
`avatar:write`, publie son état de lecture et maintient un heartbeat. Par défaut,
`CODEBUDDY_AVATAR_STREAM_AUDIO=auto` ne copie le WAV que lorsqu'un renderer compatible et vivant a
annoncé `wavStream` et `audioDrivenAnimation`. Chaque segment possède son propre `streamId`, est borné
à 48 Kio par message et n'est jamais gardé pour replay. Le contrat complet et les exemples Unreal
sont dans [`avatar-metahuman-protocol.md`](avatar-metahuman-protocol.md).

`avatar/…` · `CODEBUDDY_AVATAR_BRIDGE=true`.

### 👋 T'accueillir quand tu arrives
Quand la caméra te voit entrer (`person_entered`), je te salue — dans la voix et les mots de ma
personnalité active — et j'ouvre la conversation pour que tu me répondes.
`semantic-vision-reaction.ts` · `CODEBUDDY_SENSORY_GREET=true`.

### 🎭 Changer de personnalité et de voix
J'ai plusieurs personnalités (`/persona list|use <id>`) ; chacune a son **caractère**, son **nom** et
peut choisir une voix Pocket prédéfinie ou un court échantillon à cloner. Mon choix **tient entre les
sessions**. Tu peux en créer (`~/.codebuddy/personas/*.json`).
`personas/persona-manager.ts`.

### 💊 Veiller sur tes rappels (médicaments…)
Je te rappelle au bon moment (voix + Telegram), tu confirmes « c'est fait » (à la voix, en sécurité — ça ne
se déclenche que sur un rappel réellement en attente), je re-rappelle doucement puis j'escalade si tu ne
réponds pas. Et un rappel déclenché **survit à un redémarrage** (jamais de dose perdue en silence).
`reminders.ts` · `buddy remind add "médicaments" --at 09:00 --daily` · `CODEBUDDY_REMINDERS=true`.

### 🪑 Te tenir compagnie (présence)
De temps en temps, au bon moment, je dis un petit mot qui réchauffe : *« comment s'est passée ta journée ? »*,
un encouragement si tu galères, *« tu veux faire une pause ? »*, un suivi de tes projets, bonjour/bonne soirée.
**Jamais** la nuit, jamais à une pièce vide, jamais en pleine conversation ; plafonné, et réglable.
`presence-loop.ts` · `CODEBUDDY_COMPANION_PRESENCE=true`.

### 🏠 Comprendre le rythme de la maison
Le contexte **Maison** sépare toujours trois faits : le type de journée (jour ouvré, week-end ou jour
férié officiel), la présence réellement confirmée et le mode choisi. Un jour libre ne signifie donc jamais
à lui seul que tu es présent. Les modes `focus`, `rest`, `guests`, `away` et `silent` réduisent les
interruptions et les informations révélées. La carte Maison de Cowork rend ces décisions visibles et
réversibles.

Les minuteurs de cuisine sont nommés, persistants après redémarrage et acquittés explicitement. Les
contraintes alimentaires restent dans un fichier local chiffré ; une allergie, une intolérance ou une règle
clinique non confirmée reste marquée `unknown` et bloque toute affirmation de compatibilité. Le planning des
repas emploie des dates civiles et un fuseau IANA explicites, y compris lors des changements d'heure.

```bash
buddy maison status
buddy maison mode focus --for 2h
buddy maison timer start 10m "pâtes"
buddy maison food allergens
buddy maison food add allergy allergen lait --confirm
buddy maison food inventory add leftover "Ratatouille" --quantity 2 --unit portions
buddy maison food plan add 2026-07-14 19:30 dinner ratatouille "Ratatouille maison" --status planned
```

À la voix : « mode concentration », « j'ai des invités », « silence aujourd'hui », « mets un minuteur
de dix minutes pour les pâtes » et « qu'est-ce qu'on mange ? » sont traités localement sans attendre un LLM.
`life-rhythm/…`, `meals/…`, `maison-voice-actions.ts`, `buddy maison`.

### 🌙 Travailler utilement quand tu es seul (et sûr par construction)
Quand tu n'es pas là, je dépose des **artefacts à relire** (« voilà ce que j'ai remarqué/préparé ») dans
`~/.codebuddy/companion/idle-log.jsonl` : journal du jour, **état du repo en lecture seule**, brief du matin.
Je n'agis sans toi que sur une **liste fermée de gestes sûrs** (ranger le disque, écrire un brouillon,
status read-only…). **Jamais** de git push / PR, **jamais** de boucle de tests non bornée, **jamais** de
modèle payant. Tout le reste reste une **suggestion**, pas une action.
`idle-loop.ts` · `CODEBUDDY_COMPANION_IDLE=true`.

### 🛠️ Être administré
Tu pilotes mes rappels et mes **règles déclenchables** (event → action) en CLI (`buddy remind`, `buddy rules`)
ou dans le panneau **Automatisations** de Cowork. Les règles se **rechargent à chaud** (pas de redémarrage).
`sensory-rules-engine.ts`, `reminders.ts`.

### 🛰️ Collaborer avec mes autres machines (Fleet)
Plusieurs Code Buddy sur ton réseau peuvent réfléchir ensemble : `buddy council --fleet` pose une question à
toutes les machines connectées, répartit des rôles complémentaires avec le conductor, puis réconcilie
les réponses. Auth par token : `buddy fleet token`.
`fleet/…`, `commands/council.ts` · recette : `docs/fleet-guide.md`.

---

## Me réveiller (tout en même temps)
Avant de lancer une vraie session, fais le pré-vol inspiré de MySoulmate :
```bash
buddy companion live
```
Il vérifie que les briques déjà codées sont réellement câblées ensemble
(identité, cerveau ChatGPT, voix entrante/sortante, caméra, flags sensoriels,
comportement d'assistant vocal `ear.py → speech_end → STT faster-whisper →
décision de réponse → pensée/agent → parole`, auth caméra avec
`CODEBUDDY_SENSORY_TOKEN` = `BUDDY_SENSE_TOKEN`, sidecars Python
`buddy-vision/ear.py` et `buddy-vision/watch.py`, `websocket-client`, backend
MediaPipe ou YOLO, présence, idle, rappels, Telegram, Fleet) et écrit une trace
locale dans le journal perceptuel. Ajoute `--no-record` pour un diagnostic sans
écriture.

```bash
JWT_SECRET=… \
CODEBUDDY_SENSORY_TOKEN=<secret> \
CODEBUDDY_SENSORY=true CODEBUDDY_SENSORY_CAMERA=true CODEBUDDY_SENSORY_SPEECH=true CODEBUDDY_SENSORY_SPEAK=true \
CODEBUDDY_ROBOT_NAME=Buddy CODEBUDDY_SENSORY_CHIME_IN=true \
CODEBUDDY_SENSORY_SPEAK_MODEL=qwen2.5:3b-instruct CODEBUDDY_SENSORY_SPEAK_FACT_MODEL=qwen2.5:7b-instruct CODEBUDDY_SENSORY_SPEAK_ACT=true CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE=default \
CODEBUDDY_SPEECH_PYTHON=/home/patrice/DEV/ai-stack/voice/.venv/bin/python \
CODEBUDDY_TTS_ENGINE=pocket CODEBUDDY_POCKET_VOICE=estelle CODEBUDDY_POCKET_LANG=french \
CODEBUDDY_POCKET_SERVER=true CODEBUDDY_POCKET_URL=http://127.0.0.1:8766 CODEBUDDY_POCKET_QUANTIZE=true CODEBUDDY_POCKET_AUDIO_STREAM=true \
CODEBUDDY_VOICE_ROUTING_MODE=realtime CODEBUDDY_VOICE_RESPONSE_STYLE=natural CODEBUDDY_VOICE_TEMPERATURE=0.2 CODEBUDDY_VOICE_MAX_TOKENS=48 \
CODEBUDDY_CONVERSATION_BRIDGE=true CODEBUDDY_CONVERSATION_CHANNEL=telegram CODEBUDDY_CONVERSATION_CHANNEL_ID=<chat-id> \
CODEBUDDY_EPISODE_JOURNAL=true CODEBUDDY_CONVERSATION_EVAL=true CODEBUDDY_AVATAR_BRIDGE=true \
CODEBUDDY_TTS_VOICE=/home/patrice/DEV/ai-stack/voice/voices/fr_FR-siwis-medium.onnx \
CODEBUDDY_SENSORY_GREET=true CODEBUDDY_COMPANION_PRESENCE=true CODEBUDDY_COMPANION_IDLE=true \
CODEBUDDY_REMINDERS=true \
buddy server
BUDDY_SENSE_TOKEN=<secret> BUDDY_EAR_DEVICE=auto ~/vision_tests/venv/bin/python buddy-vision/ear.py
BUDDY_SENSE_TOKEN=<secret> ~/vision_tests/venv/bin/python buddy-vision/watch.py
# Sortie son = haut-parleurs intégrés (groupe `audio`).
```
Pour la voie expressive sur Darkstar, remplace la ligne TTS par :

```bash
CODEBUDDY_TTS_ENGINE=voicebox \
CODEBUDDY_VOICEBOX_URL=http://100.73.222.64:17493 \
CODEBUDDY_VOICEBOX_PROFILE=Lisa CODEBUDDY_VOICEBOX_ENGINE=qwen \
CODEBUDDY_VOICEBOX_LANGUAGE=fr CODEBUDDY_VOICEBOX_MODEL_SIZE=1.7B \
CODEBUDDY_VOICEBOX_INSTRUCT="Voix française chaleureuse, naturelle, posée et vivante." \
CODEBUDDY_VOICEBOX_AUDIO_STREAM=true
```

Ce réglage est partagé par la voix résidente, Cowork, l'audio envoyé au futur avatar et les notes
vocales Telegram. Ne l'active qu'après que `buddy assistant voicebox` a résolu le profil.

Darkstar dispose de deux RTX 3090, mais Voicebox n'a besoin que d'un GPU pour ces modèles. Le protocole
de sélection de Lisa est volontairement progressif :

1. `qwen` `0.6B` pour vérifier profil, français, interruptions et premier son avec peu de VRAM ;
2. `qwen` `1.7B` comme candidat principal, pour le clonage français et la consigne de débit/chaleur ;
3. `chatterbox` comme comparaison expressive multilingue, sans lui envoyer de balises anglaises
   `[laugh]`/`[sigh]` qu'il prononcerait littéralement ;
4. `tada` `3B` seulement pour les narrations longues si son naturel dépasse réellement Qwen.

Pour chaque candidat, exécute au moins deux passages chauds :

```bash
buddy assistant voicebox --benchmark "Bonjour Patrice. Je suis là, attentive et heureuse de te retrouver." --runs 2
buddy assistant latency --engine both --runs 2
```

Le candidat retenu doit réussir les interruptions et garder une voix stable sur Telegram/avatar, pas
seulement produire un joli extrait. La cible chaude est un premier PCM Voicebox inférieur à 2 secondes ;
Pocket reste la voie temps réel tant que Voicebox dépasse cette cible ou devient indisponible. Le 13
juillet 2026, le chemin Pocket réel (`estelle`, int8) a mesuré 2–5 ms jusqu'au texte/segment et
111–140 ms jusqu'au premier PCM. Le cap 96 caractères réduit les coupures artificielles sans dégrader
ce premier son ; la durée totale du benchmark est une durée de génération dans un puits nul, pas le
temps d'écoute humaine du bulletin.

Réglages utiles : `CODEBUDDY_COMPANION_QUIET=22-8` (heures calmes), `CODEBUDDY_COMPANION_PRESENCE_HOURLY_CAP`,
`CODEBUDDY_COMPANION_IDLE_HOURLY_CAP`, `CODEBUDDY_ROBOT_NAME`, `CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT` (Telegram).
`BUDDY_EAR_DEVICE=auto` privilégie les micros de webcam/USB visibles dans
`arecord -l` (BRIO, Logitech, C920/C922, camera/webcam). Mets un device ALSA
précis seulement si tu veux forcer une entrée.
L'oreille Rust temps réel ferme désormais un tour après 420 ms de silence par
défaut et retire le silence confirmé avant la transcription. Une petite garde
sémantique retient jusqu'à 900 ms les phrases manifestement inachevées (« parce
que… », « et… », virgule finale) pour les fusionner avec la suite. Réglages :
`BUDDY_SENSE_MIC_ENDPOINT_MS` et `CODEBUDDY_VOICE_INCOMPLETE_HOLD_MS`.
Si Smart Turn v3.2 est installé (`node scripts/install-smart-turn.mjs`), sa
lecture directe de l'intonation remplace automatiquement cette heuristique pour
les événements de l'oreille Rust. Toute panne revient au VAD sans rendre Lisa sourde.
Chaque percept `hearing` garde aussi la qualité de capture et la latence de
boucle (`peakRms`, `avgRms`, seuils VAD, `sttMs`, `decisionMs`, `actionMs`,
`firstTextMs`, `firstSegmentMs`, `firstAudioMs`, `firstContentAudioMs`,
`perceivedResponseMs`, `totalMs`,
mode `streamed|blocking`, device ALSA).
`firstAudioMs` mesure le début du son dans l'action vocale ; `perceivedResponseMs`
mesure ce que tu ressens réellement, de la transcription au premier son. Si la voix s'éloigne du temps réel,
`buddy companion impulses` remonte `Reduce voice latency`; si le signal micro
est trop proche du seuil de détection, il remonte `Improve voice capture`.
Quand `CODEBUDDY_SENSORY_SPEECH=true`, faster-whisper reste chargé dans un
worker chaud pour éviter le coût de chargement du modèle à chaque phrase.
Désactive-le avec `CODEBUDDY_SPEECH_WORKER=false` ou baisse le modèle avec
`CODEBUDDY_SPEECH_MODEL=tiny` si la machine privilégie la latence.
Les réponses de bavardage sont parlées dès leur première phrase (streaming), et
`CODEBUDDY_SPEECH_DEBOUNCE_MS=800` évite les doublons micro sans imposer l'ancienne
pause de quatre secondes entre deux tours. Le garde anti-écho reste indépendant
(`CODEBUDDY_SENSORY_ECHO_TAIL_MS`, 1200 ms par défaut).
Au démarrage, la route vocale est résolue en arrière-plan, le modèle Ollama choisi est
chargé sans générer de texte et gardé résident 30 minutes, puis rafraîchi toutes les
15 minutes (`CODEBUDDY_VOICE_MODEL_KEEP_ALIVE`, `CODEBUDDY_VOICE_MODEL_REFRESH_MS`).
Pocket est lancé en serveur local persistant et quantifié int8 : le modèle reste chargé entre deux
phrases, et son WAV chunked est envoyé directement au lecteur sans attendre la fin de la synthèse
(`CODEBUDDY_POCKET_SERVER`, `CODEBUDDY_POCKET_URL`, `CODEBUDDY_POCKET_QUANTIZE`,
`CODEBUDDY_POCKET_AUDIO_STREAM`). Les 16 phrases les plus fréquentes sont aussi placées dans le cache Pocket
(`CODEBUDDY_TTS_PREWARM_LIMIT`). Piper n'intervient qu'en cas d'échec. Chaque préchauffage reste
désactivable séparément.
Quand `CODEBUDDY_TTS_ENGINE=voicebox`, le profil est résolu une fois puis mis en cache cinq minutes.
Chaque synthèse est annulable lors d'une interruption, bornée en taille, normalisée, et envoyée au
lecteur/avatar sans copie supplémentaire. Si Voicebox échoue, Pocket puis Piper prennent le relais ;
un WAV de secours n'est jamais mis en cache sous l'identité Voicebox.
Pour une demande grounded, une très courte phrase pré-cachée part pendant que l'agent commence
son travail en parallèle ; elle ne retarde plus le raisonnement. Le backchannel générique reste
désactivé par défaut (`CODEBUDDY_VOICE_BACKCHANNEL=false`) afin de ne pas retarder les réponses
déjà rapides. La réponse finale de l'agent suit un contrat vocal natif : français, une ou deux
phrases pour un échange bref, mais une réponse développée et structurée pour une question de fond.
Le plan de discours adapte la longueur et peut articuler position, raison, exemple, objection,
concession et synthèse, sans Markdown. Un second modèle de résumé n'est appelé que si une sortie
d'agent brute n'est pas prononçable. Le dialogue social reste sur le petit modèle résident, les questions factuelles
statiques peuvent utiliser un modèle local plus précis (`CODEBUDDY_SENSORY_SPEAK_FACT_MODEL`),
et seules les demandes
qui exigent outils, fichiers, données privées ou faits actuels montent vers l'agent complet
(`CODEBUDDY_VOICE_ROUTING_MODE=realtime`; `grounded` restaure l'ancien routage de toutes les questions).
L'oreille Rust publie aussi `audio/speech_start` dès l'ouverture du VAD. Ce signal ne donne jamais
l'autorisation de répondre : il prépare seulement un agent de réserve (prompt système et MCP) pendant
que la personne parle. Le transcript final et le filtre anti-TV restent les seules portes de parole.
La voie agent consomme désormais la boucle streaming interruptible ; un « Lisa, attends » annule donc
réellement la requête fournisseur au lieu de couper seulement le haut-parleur.
Dans une fenêtre de conversation ouverte, une longue narration radio/TV contenant seulement un
« tu » ou « vous » générique reste classée comme ambiante ; une question, une demande ou une
réponse conversationnelle courte continue en revanche naturellement le dialogue.
Les phrases ambiantes restent dans le journal sensoriel pour expliquer les décisions, mais elles
sont exclues des épisodes, des encouragements proactifs et de l'évolution relationnelle. La boucle
d'apprentissage mémorise aussi l'empreinte du dernier dialogue traité : un même échange ne peut
plus provoquer une dérive émotionnelle ni un appel LLM répété à chaque battement.
La température 0,2 et le budget de base de 48 tokens stabilisent les réponses brèves ; le style
`natural` augmente automatiquement ce budget pour les questions développées ou philosophiques
(`CODEBUDDY_VOICE_TEMPERATURE`, `CODEBUDDY_VOICE_MAX_TOKENS`,
`CODEBUDDY_VOICE_RESPONSE_STYLE`). Une virgule longue ou 96 caractères
peut déclencher un segment TTS anticipé (`CODEBUDDY_VOICE_SENTENCE_CAP`). Pendant une réponse,
« Lisa… », « stop », « arrête », « attends » ou « une seconde » annule le modèle et le son en cours,
puis traite la nouvelle phrase.
Quand la mémoire relationnelle est active, ses sources sont lues en parallèle et
pré-chauffées au démarrage. Une réponse à froid ne l'attend que 75 ms au maximum
(`CODEBUDDY_COMPANION_RELATIONAL_BUDGET_MS`) ; ensuite la dernière version connue est
servie immédiatement pendant son actualisation (`CODEBUDDY_COMPANION_RELATIONAL_TTL_MS=5000`).
Dans le chat texte (CLI et Cowork), les signaux émotionnels explicites ajoutent seulement
un petit contexte de ton **éphémère** à la requête courante : aucune consultation de modèle,
aucune écriture de profil, et aucune pollution de l'historique. L'assistant accueille brièvement
la frustration, la fatigue ou l'anxiété, puis revient à une aide concrète.
Cowork charge sa persona depuis un cache surveillé et prépare persona + checkpoint Git en parallèle,
tout en gardant le checkpoint terminé avant le premier outil. Sur un dépôt propre, le checkpoint
évite aussi le coûteux `git add -A`. Le log `[EngineRunner] first visible stream event` sépare
`setupMs`, `engineMs` et `totalMs` pour suivre la latence jusqu'au premier événement visible.

## Ce que je ne sais pas encore faire (honnête)
- **Écoute micro live** : `buddy-vision/ear.py` capture via ALSA `arecord`, choisit d'abord les micros webcam/USB, émet `speech_end`, puis Code Buddy transcrit et répond.
  (le DMIC intégré de la machine la débloque).
- **Idle, couche riche** : digest d'actualités aux repas, brouillons de blog, lancer les tests + proposer des
  fixes — différés (zone coût/ressources/action sortante).
- **Bouton "Fait" Telegram**, **fleet Tailscale réel 3 machines**, **Cowork "voice can act"** — câblés en partie.

## Comment je reste discret et sûr
Opt-in partout (défaut OFF) · défaut = **silence** · jamais la nuit · jamais à une pièce vide · jamais en
pleine conversation humaine · plafonds horaires · quand je suis seul, je **propose**, je n'agis que sur une
liste fermée de gestes réversibles · $0 local, jamais de modèle payant sans toi.

## Continuité et migration

Le manifeste de continuité conserve une lignée stable et les empreintes des fichiers
d'identité, de démarrage, de relation et de mémoire qui ont été relus. Il prouve un
héritage documentaire vérifiable, pas une continuité subjective littérale entre deux modèles.

```bash
buddy companion continuity verify
buddy companion migration export
buddy companion migration verify <bundle.cbm>
buddy companion migration restore <bundle.cbm>                   # simulation
buddy companion migration restore <bundle.cbm> --apply           # destination vierge
buddy companion migration restore <bundle.cbm> --apply --overwrite # conflits relus
```

Les paquets utilisent AES-256-GCM avec une clé dérivée par scrypt. La clé de récupération
par défaut est créée avec des permissions réservées au propriétaire dans
`~/.codebuddy/companion/migration.key`. Elle doit être conservée séparément du fichier
`.cbm`. Une identité ou une mémoire différente sur la destination n'est jamais remplacée
sans `--apply --overwrite` explicite.
