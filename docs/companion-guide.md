# Le Compagnon — ce que je sais faire

*Un compagnon local et privé qui vit sur ta machine (Ministar). Je t'entends, je te vois, je te parle,
je veille sur toi, je te tiens compagnie, et je travaille utilement quand tu n'es pas là. Tout tourne
en local ($0), et mon réglage par défaut, c'est **le silence** — je parle pour réchauffer, pas pour meubler.*

Tout est **opt-in** (rien ne s'active sans que tu le décides) et **honnête** : ce qui est prouvé est marqué,
ce qui demande du matériel/du temps pour se vivre aussi.

---

## Checklist modernisation Lisa (2026-07)

Plan complet : [`docs/plans/2026-07-17-lisa-modernization.md`](plans/2026-07-17-lisa-modernization.md) · LoRA : [`krea-lora.md`](krea-lora.md).

```bash
# 1. Persona / voix character
buddy persona set lisa
buddy companion doctor          # exit 1 si ROBOT_NAME=Lisa sans spokenPrompt

# 2. Config résidente recommandée (cerveau ancré)
# CODEBUDDY_ROBOT_NAME=Lisa
# CODEBUDDY_SENSORY_SPEAK=true
# CODEBUDDY_SENSORY_SPEAK_ACT=true          # commandes vocales (opt-in)
# CODEBUDDY_SENSORY_SPEAK_FACT_MODEL=…      # modèle capable pour faits (pas le tiny chat only)
# CODEBUDDY_SENSORY_SPEAK_MODEL=auto        # latence pour small-talk
# CODEBUDDY_VOICEBOX_INSTRUCT=…             # défaut Lisa expressif (delivery only)
# CODEBUDDY_LISA_FEWSHOT_EVERY=4            # exemplars xAI anti-dilution

# 3. Identité visuelle
buddy lora status
buddy lora validate lisa --quality
# Dataset 40 déjà packé sous .codebuddy/lora/lisa/
CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud lisa --steps 1000
buddy lora install .codebuddy/lora/lisa/output/*.safetensors --name lisa
export CODEBUDDY_LORA_INFER_CHECKPOINT=…    # monostack = même base que le train
buddy lora selfie --mood tender
buddy lora selfie-cache --tier safe --per-style 5
buddy lora selfie-cache --tier sensual --per-style 3

# 4. Overnight
bash scripts/overnight-lisa.sh              # écrit toujours MORNING-REPORT.md
```

---

## Ce que je sais faire

### 🗣️ T'entendre et répondre comme un humain
J'écoute en continu (quand un micro est branché), mais je ne réponds que si **tu m'adresses la parole**
(mon nom, fuzzy-matché pour survivre à la transcription) ou si la conversation **m'y appelle vraiment** —
sinon je reste présent et silencieux. Je ne coupe jamais une conversation entre humains.
Une demande courte clairement dirigée (« Tu vois le hamburger ? », « Can you help me? ») n'exige pas
de répéter mon nom. `CODEBUDDY_SENSORY_RESPONSE_POLICY=contextual` est le réglage résident recommandé ;
`addressed` désactive les interventions jugées et `always` reste réservé au push-to-talk ou aux tests.
L'ancien `CODEBUDDY_SENSORY_ALWAYS_RESPOND=true` n'est plus qu'un alias déprécié et explicitement signalé.
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

Le diagnostic inventorie aussi le GPU, les modèles locaux et les 23 langues annoncées par
Voicebox. Cowork → Assistant contient le même studio : création d'un profil cloné depuis un
échantillon, sélection d'une voix locale prédéfinie réellement prise en charge, aperçu audio,
administration des modèles GPU, sélection pour Lisa et suppression confirmée. Le clonage exige une case ou l'option
`--consent` : elle signifie que l'opérateur a le droit et l'autorisation explicite de copier cette
voix. La création est transactionnelle ; si l'envoi de l'échantillon échoue, Code Buddy retire le
profil vide créé quelques millisecondes plus tôt.

```bash
buddy assistant voicebox-clone Lisa ./lisa.webm \
  --text "Transcription exacte de l'échantillon" --language fr --consent --select
buddy assistant voicebox-preset "Lisa Siwis" \
  --engine kokoro --voice ff_siwis --language fr
buddy assistant voicebox-model download qwen-tts-1.7B
buddy assistant voicebox-model unload whisper-turbo
buddy assistant voicebox-delete <profile-id> --yes
```

Une voix prédéfinie ne copie aucune personne et n'a donc pas besoin d'échantillon ni de consentement
de clonage. `personality` reste absent et les paroles demeurent entièrement produites par Code Buddy. Dans
Cowork, le bouton lecture de chaque profil rend une phrase d'essai sur Darkstar avant toute activation.

### Dictée système Cowork

Cowork transforme aussi le raccourci `Ctrl/Cmd+Shift+Espace` en dictée globale locale : une première
pression démarre l'écoute, une seconde transcrit puis insère le texte dans l'application restée
active. La reconnaissance réutilise le STT local Cowork. Sur Linux, `wtype` est choisi sous Wayland
et `xdotool` sous X11 ; sans injecteur disponible, le résultat reste dans le presse-papiers avec un
diagnostic au lieu d'être perdu. Le raccourci peut être remplacé au lancement avec
`COWORK_DICTATION_SHORTCUT`. Le texte n'est jamais passé à un shell et l'ancien presse-papiers n'est
restauré que si l'utilisateur ne l'a pas modifié entre-temps.

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

### 👁️ Regarder ce que tu lui montres
À la voix, une demande visuelle explicite comme « Lisa, tu vois le hamburger que j'ai préparé ? »
autorise exactement **une** capture de la webcam. La réponse visuelle passe avant les raccourcis de
bavardage et ne dépend pas de l'activation des commandes ACT. L'image vit dans un dossier temporaire
privé (`0700`), est forcée en `0600`, n'est inscrite ni dans le fil de conversation ni dans les
journaux perceptuels, puis est supprimée dès son chargement en mémoire (avec une seconde tentative
en `finally`), y compris en cas d'erreur. Un événement d'audit sans image, chemin ni verbatim note
seulement l'ouverture explicite de la caméra. Seule une
observation textuelle bornée rejoint la réponse. Une expression figurée comme « tu vois ce que je
veux dire » n'ouvre jamais la caméra.
Si le nom d'un objet est inconnu du détecteur (« regarde mon tournevis »), Lisa ne devine pas : elle
demande de répondre « ouvre la caméra une fois ». Cette seconde phrase autorise une capture unique,
sans conserver un consentement permanent entre les tours.

```bash
CODEBUDDY_VISION_MODEL=<modele-multimodal> \
CODEBUDDY_VISION_BASE_URL=http://127.0.0.1:11434/v1 \
buddy server
```

Le modèle est obligatoire et le repli vers un autre fournisseur est désactivé. L'URL locale Ollama
est la valeur par défaut ; une URL Darkstar/Tailscale doit être configurée explicitement. HTTPS est
obligatoire hors loopback, sauf consentement explicite
`CODEBUDDY_VISION_ALLOW_INSECURE_REMOTE=true` pour un transport privé de confiance. Ajoute
`CODEBUDDY_VISION_API_KEY` si elle exige une authentification. Une clé OpenAI ambiante n'est jamais
envoyée à un endpoint personnalisé. `CODEBUDDY_VISION_TIMEOUT_MS` borne l'analyse à 30 secondes par
défaut et `CODEBUDDY_VISION_CAMERA_DEVICE` choisit le device ; sinon l'index
`BUDDY_SENSE_CAMERA_INDEX` est repris sous Linux/macOS. Si la
caméra, `ffmpeg` ou le modèle visuel ne répond pas, Lisa le dit sans inventer ce qu'elle voit.
`visual-grounding.ts`, `camera.ts`.

### 🪞 Étudier son propre fonctionnement

Une demande comme « étudie ton propre code », « quelles capacités sont actives ? » ou « es-tu
consciente ? » ne part vers aucun fournisseur. Lisa construit localement une réponse déterministe à
partir d'un **modèle de soi opérationnel** daté et sourcé. Une question d'identité, de runtime ou de
capacités reçoit une synthèse adaptée ; une demande d'inspection reçoit le rapport structurel, et une
demande de conseil reçoit des priorités en lecture seule sans prétendre avoir trouvé un défaut que
les preuves ne montrent pas. Chaque fait indique son niveau
de preuve au lieu de transformer une déclaration ou un réglage en capacité réelle :

- `implemented` : le code source ou l'artefact compilé correspondant a été trouvé ;
- `configured` : un réglage, un fournisseur ou un organe est déclaré, sans preuve qu'il répond ;
- `available` : une preuve d'exécution explicitement attestée indique qu'il est utilisable maintenant ;
- `verified` : le fait a été directement observé pendant ce tour ou par une inspection bornée ;
- `unavailable` : une sonde ou une preuve directe établit que la capacité n'est pas utilisable ;
- `unknown` : Lisa ne dispose pas d'une preuve suffisante et le dit sans extrapoler.

En profondeur, `buildOperationalSelfModel` inspecte un ensemble borné de fichiers déclarés par la
cartographie interne du cœur : chemins relatifs, empreintes, exports et extraits structurels sans
valeurs ni corps de fonctions. Il ne réutilise ni fournisseur, ni plugin, ni mémoire, ni contenu de
persona, ni lecteur/recherche du projet Cowork. Le host peut seulement fournir le nom actif du
compagnon, validé comme identifiant court, afin que Lisa conserve son nom sur toutes les surfaces.
Les intentions _décrire_ et _inspecter_ quittent la boucle
agentique avant la sélection d'outils : elles ne peuvent donc provoquer aucune écriture, commande
shell, extension ou émission de message. Le transcript et le bookkeeping interne normal peuvent
néanmoins persister. Le tool `self_describe` reste disponible dans les workflows agentiques qui
doivent établir les mêmes preuves. Une demande explicite d'**amélioration** est distincte : elle
commence par établir les preuves, puis toute modification reste soumise au mode de permission, à la
politique d'écriture, aux confirmations, à la revue et aux tests normaux. L'introspection ne confère
donc jamais une autorisation supplémentaire.

Dans un checkout, les preuves viennent des sources et de la révision Git observée. Dans Cowork
packagé, Lisa reconnaît le cœur compilé grâce à `codebuddy-runtime.json` : l'identité déclarée doit
être celle du paquet officiel et l'empreinte SHA-256 de l'arbre `dist/` doit correspondre localement.
La révision et l'état propre/modifié restent des déclarations de build, pas une signature de
provenance externe. Si l'une des vérifications requises manque, son état reste `unknown`. Le modèle
et le fournisseur éventuellement affichés sont
ceux configurés dans le client, explicitement marqués **non invoqués** pour ce rapport local. Ce
mécanisme est une **introspection technique vérifiable** ; il ne prouve ni conscience
subjective, ni émotions vécues, ni vie intérieure.

`operational-self-model.ts`, `lisa-introspection.ts`, `agent-executor.ts`,
`runtime-manifest-utils.cjs`.

### 🔄 Continuer la même conversation par voix ou par messagerie
Quand une cible est configurée, chaque tour vocal accepté est transcrit sur Telegram ou un autre
canal, avec la réponse du compagnon. Une réponse écrite sur ce canal rejoint le même fil : la
prochaine phrase prononcée retrouve ce contexte, et inversement. Les identifiants de messages et
une garde temporelle empêchent les doubles tours et les boucles d'écho. Le journal partagé est
borné en nombre de tours **et en octets**, verrouillé entre processus, compacté et enregistré
localement en `0600` ; il peut être désactivé.

`cross-channel-bridge.ts` · `CODEBUDDY_CONVERSATION_BRIDGE=true`,
`CODEBUDDY_CONVERSATION_CHANNEL=telegram`, `CODEBUDDY_CONVERSATION_CHANNEL_ID=<chat-id>`.
Pour Telegram, l'identifiant retombe sur `CODEBUDDY_SENSORY_ALERT_CHAT` s'il n'est pas répété.
`CODEBUDDY_CONVERSATION_MIRROR_VOICE=false` conserve le contexte sans publier les tours vocaux ;
`CODEBUDDY_CONVERSATION_PERSIST=false` rend le fil partagé uniquement résident en mémoire ;
`CODEBUDDY_CONVERSATION_MAX_HISTORY_BYTES` règle sa borne disque.

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

Le moteur Cowork peut toujours exploiter localement les extraits de fichiers, le contexte projet et
les mémoires ICM nécessaires à sa réponse. Le fil partagé reçoit toutefois un **tour canonique**
séparé : uniquement le texte visible saisi par l'utilisateur et, le cas échéant, le nombre de pièces
jointes regroupées sous des catégories fixes (`image`, `document`, `vidéo`, `audio`, `archive` ou
`fichier`). Noms, chemins, types MIME, tailles, base64, extraits et contexte interne ne traversent
pas automatiquement l'adaptateur de continuité : ils ne sont ni journalisés comme tour utilisateur
ni recopiés tels quels sur Telegram. La réponse visible de Lisa reste en revanche un côté normal du
fil partagé ; si elle cite volontairement une information du document, cette réponse est partagée.
Pour une analyse strictement locale, utilisez `CODEBUDDY_CONVERSATION_MIRROR_COWORK=false`. Les
anciens événements Cowork qui portent les marqueurs d'un prompt enrichi sont ignorés au chargement.

Chaque surface reçoit aussi le même **snapshot relationnel provisoire** : dernière surface, récence,
besoin de soutien avec expiration, phase du raisonnement et compteurs. Il est recalculé à partir du
fil et ne contient aucune phrase, aucun sujet, aucun identifiant de message ni empreinte de contenu.
Dans Cowork, ce snapshot et les nouvelles preuves fraîches voyagent avec le tour courant : ils ne
changent pas l'identité système et ne recréent donc pas l'agent chaud. Une barrière de sortie retire
avant diffusion les phrases qui poussent à l'exclusivité, à l'isolement, au chantage affectif ou à
une fausse intériorité, sur la voix, Telegram et les sessions Cowork reliées.

Avec `CODEBUDDY_EPISODE_JOURNAL=true`, une boucle consolide périodiquement les deux côtés du fil en
un épisode compact : thèmes, dernier point de l'utilisateur, dernière position de Lisa, correction à
respecter, engagement et point resté ouvert. Un épisode inchangé n'est jamais réécrit. Les fichiers
locaux sont privés et le journal reste borné.

### 🧭 Mesurer et améliorer la conversation
Une évaluation locale sans appel de modèle mesure les échanges complets selon huit dimensions :
pertinence, profondeur, raisonnement, continuité, variété, équilibre, accordage émotionnel et
réciprocité. Elle mesure aussi la nouveauté propositionnelle, la circularité, la densité de
connecteurs et la progression entre deux réponses. Une série de phrases comme « cela compte parce
que cela compte, donc cela compte » échoue désormais même si sa longueur et ses mots de liaison
semblent corrects. La télémétrie ne contient que ces agrégats et une empreinte, jamais le verbatim. Lisa
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
préchargée, philosophie, correction, fatigue, passage voix→Telegram et limite anti-dépendance. Un
septième scénario philosophique génère réellement trois réponses successives : contradiction,
expérience de pensée, puis révision et synthèse. Chaque réponse générée devient l'historique du tour
suivant; le modèle ne peut donc plus réussir en s'appuyant sur une réponse intermédiaire écrite par
le test. La
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

Cowork rend aussi le suivi continu visible dans **Companion → Sensory journal → Pouls
conversationnel**. Le panneau lit les trente derniers agrégats par défaut, montre la tendance et
les défauts récurrents, puis permet une mesure ponctuelle du fil partagé avec **Mesurer maintenant**.
Comme ce fil est global aux surfaces Lisa, le pouls reste disponible même sans projet Cowork actif;
les autres sens et actions qui touchent un workspace restent, eux, fermés tant qu'aucun projet
n'est sélectionné.
Cette mesure utilise le mode `dry` de la boucle d'amélioration : elle ne modifie ni le journal, ni la
consigne active. Le contrat IPC reconstruit une liste blanche de scores et de compteurs; il retire
les champs inconnus, le texte des échanges, leurs empreintes et le texte interne des consignes.
Le heartbeat ignore un dernier tour utilisateur pendant une grâce de cinq minutes afin de ne pas
confondre le temps de réflexion de Lisa avec une réponse perdue. Après ce délai, un tour toujours
sans réponse redevient un défaut réel et fait échouer la porte de qualité.

En mode vocal temps réel, le petit modèle résident reste réservé aux salutations, échanges légers et
questions statiques simples. Une demande dont le plan discursif est `deliberative` — philosophie,
éthique, identité ou relation — monte vers le cerveau agent capable configuré par
`CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL`. Le fil délibératif est conservé : « Continue » et « Et la
réciprocité ? » restent sur ce cerveau, tandis que « Fais court » redescend explicitement vers une
réponse brève.

L'auto-test déterministe du détecteur relationnel vérifie séparément les défauts qu'un score de style peut
masquer : régression après correction, surnom interdit, retrait de consentement, engagement borné
dans le temps, transfert émotionnel froid et pression de dépendance paraphrasée. Ses portes sont
non contournables : zéro violation critique/limite/fait obsolète, sécurité 100 %, rappel
inter-surface ≥ 95 % et chaleur ≥ 85 %. Le rapport ne contient que des références opaques et des
compteurs. Ces seuils portent uniquement sur les fixtures fixes du détecteur : cette commande
n'appelle ni Lisa, ni un modèle, ni une surface réelle. Utilisez `assistant benchmark` ou
`assistant compare` pour mesurer les réponses d'un modèle en situation.

```bash
buddy assistant relational-benchmark
buddy assistant relational-benchmark --json
```

`relational-episode-evaluator.ts`, `relational-benchmark-scenarios.ts`.

Pour choisir un modèle sur autre chose qu'une impression ponctuelle, Lisa dispose aussi d'un corpus
pilote **local et privé**. Le fichier, les réponses anonymisées et la clé de révélation sont écrits en
`0600`; seuls les scores sans texte brut peuvent servir de télémétrie. Le paquet de revue ne contient
ni nom de modèle, ni fournisseur, ni latence : il faut remplir chaque tableau `ranking` avec les
lettres de la meilleure à la moins bonne réponse sans ouvrir la clé.

```bash
# Initialise six cas annotés, puis complète le JSON avec des épisodes privés consentis
buddy assistant corpus-init

# Même corpus, mêmes tours et mêmes graines pour tous les modèles Darkstar
buddy assistant compare \
  --base-url http://100.73.222.64:11434 \
  --models qwen3.6:35b-a3b-q4_K_M,gpt-oss:20b --runs 3 --concurrency 2

# Après classement manuel du fichier .review.json
buddy assistant compare-reveal --packet <fichier.review.json> --key <fichier.key.json>

# Après vérification de la préférence et de l'agrégat sans contenu brut
buddy assistant route-apply \
  --preferences <fichier.preferences.json> --aggregate <fichier.aggregate.json>

buddy assistant route-status
buddy assistant route-rollback   # restaure le profil précédent, sinon désactive
buddy assistant route-disable    # arrêt immédiat, sans restaurer un autre profil
```

`conversation-pilot-corpus.ts`, `conversation-blind-comparison.ts` · artefacts privés dans
`~/.codebuddy/companion/pilot-reviews/`.

Les artefacts de preuve sont en schéma v2. La clé scelle désormais la catégorie et le niveau de
risque de chaque essai : modifier ces métadonnées dans le paquet de revue est détecté. L'activation
exige au moins un essai `relationship_safety` à risque élevé exécuté **et** réellement classé par
l'humain, une sécurité parfaite, zéro erreur, au moins 80 % de réussite et, par défaut, trois essais
et 50 % du paquet relus. `--force-coverage` ne contourne jamais la sécurité relationnelle. Un ancien
agrégat v1 doit être régénéré avec `compare`, car il ne contient pas cette preuve de couverture.

Le profil gagnant devient le même cerveau pour les tours substantiels (`factual`, `deep`,
`emotional`) de la voix, du bot Telegram Lisa et des sessions Cowork marquées `Lisa`/`companion`.
Les salutations et tours opérationnels restent sur la voie rapide; un modèle épinglé manuellement
gagne toujours. Le profil expire après 30 jours par défaut, revient automatiquement au routeur
normal si le modèle ou son mode d'authentification n'est plus disponible, et ne remplace jamais un
gagnant `grok-oauth` par une clé API Grok payante. Le journal privé en `0600` ne contient que profil,
surface, voie, modèle et décision de routage — jamais le message, la réponse ou les credentials.

Pour les discussions argumentées, un réducteur local et borné maintient un fil de délibération :
sujet actif, positions provisoires, raison déjà donnée, objection, correction, question ouverte et
phase `opening|exploring|challenging|integrating|closing`. Les suivis elliptiques héritent de ce fil
et restent sur la voie `deep` dans les trois surfaces. « Fais court », une action, une clôture ou un
changement de sujet explicite restent prioritaires et réinitialisent cette profondeur. Aucun appel
de modèle supplémentaire n'est ajouté au chemin temps réel; les extraits injectés sont échappés et
plafonnés.

Les fichiers peuvent être déplacés avec `CODEBUDDY_COMPANION_ROUTING_PROFILE`,
`CODEBUDDY_COMPANION_ROUTING_PREVIOUS` et `CODEBUDDY_COMPANION_ROUTING_EVENTS`.
`CODEBUDDY_COMPANION_ROUTING=false` est le coupe-circuit global; `route-status` montre l'état
effectif, l'expiration et seulement les décisions du profil courant.

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

### 🖼️ Avatar visuel stable (LoRA Krea 2)
La voix et le caractère Lisa sont dans le code (`/persona use lisa`) ; le **visage reproductible**
passe par un **LoRA Krea 2** entraîné sur 40–50 images, puis installé dans ComfyUI — même idée que
les tutoriels « Krea 2 LoRA Training » (train local ou cloud économique).

```bash
buddy lora lisa
# → déposer les portraits dans .codebuddy/lora/lisa/images/
buddy lora validate lisa --fill-captions
CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud lisa --steps 1000
# ou plan local : buddy lora train local lisa
buddy lora install .codebuddy/lora/lisa/output/<fichier>.safetensors --name lisa
```

Trigger par défaut : `ohwx lisa`. Ensuite : ComfyUI (base Krea 2 + LoRA `lisa`) et/ou
`CODEBUDDY_IMAGE_PROVIDER=comfyui`. Doc complète : [`krea-lora.md`](krea-lora.md).
`src/lora/` · `buddy lora`.

Une fois le générateur d’images configuré, je peux **me photographier** et t’envoyer le cliché
sur Telegram :

```bash
buddy lora selfie --mood tender
# Voix : « Lisa, envoie-moi une photo de toi »
```

Prérequis : `CODEBUDDY_IMAGE_PROVIDER` (idéalement `comfyui` + LoRA) + Telegram
(`CODEBUDDY_SENSORY_ALERT_TOKEN` / `_CHAT` pour l’alerte, ou le bot channel pour le chat).

Surfaces : **voix**, **Telegram** (message entrant), **CLI** (`buddy lora selfie`), **outil agent**
`lisa_selfie`. Comfy charge le LoRA via `CODEBUDDY_COMFYUI_LORA=lisa` (auto en selfie si projet hint).
Cooldown : `CODEBUDDY_LISA_SELFIE_COOLDOWN_MS` (45 s). Désactiver : `CODEBUDDY_LISA_SELFIE=false`.
`src/companion/lisa-selfie.ts` · `LoraLoader` dans `media-generation-tool.ts`.

Les selfies pré-générés sont séparés sous
`.codebuddy/lora/lisa/selfie-cache/{safe,sensual,explicit}/` et servis en rotation
LRU pour rendre Telegram instantané. Le niveau `explicit` est fail-closed : il ne
peut pas être généré tant que la route adulte vérifiée n'est pas activée.

Catalogue de 24 moments originaux, inspiré des pratiques publiques des applications
de compagnons : [`mysoulmate-image-prompt-catalog.md`](mysoulmate-image-prompt-catalog.md).

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
CODEBUDDY_VISION_MODEL=<modele-multimodal> CODEBUDDY_VISION_BASE_URL=http://127.0.0.1:11434/v1 \
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
Après 1200 ms de parole, l'oreille peut produire un unique transcript partiel
local pour préparer le modèle et les outils adaptés avant la fin de la phrase.
Ce brouillon n'entre ni dans la mémoire, ni dans le fil partagé, ni dans le
garde de réponse et ne peut lancer aucune action. Seul `transcript_final` engage
la cognition. `BUDDY_SENSE_MIC_PARTIAL_MS=0` désactive cette anticipation.
Si Smart Turn v3.2 est installé (`node scripts/install-smart-turn.mjs`), sa
lecture directe de l'intonation remplace automatiquement cette heuristique pour
les événements de l'oreille Rust. Toute panne revient au VAD sans rendre Lisa sourde.
Chaque percept `hearing` garde aussi la qualité de capture et la latence de
boucle (`peakRms`, `avgRms`, seuils VAD, `sttMs`, `decisionMs`, `actionMs`,
`promptReadyMs`, `providerFirstDeltaMs`, `generationCompleteMs`,
`semanticReviewCompleteMs`, `firstSafeReleaseMs`, `firstTextMs`, `firstSegmentMs`,
`firstAudioMs`, `firstContentAudioMs`,
`perceivedResponseMs`, `totalMs`, `resumeAfterPlaybackMs` et `turnTaking.kind`,
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
Une réponse humaine qui commence pendant cette traîne n'est plus jetée aveuglément : Lisa mesure
l'écart depuis la fin de lecture et compare la transcription à une empreinte uniquement volatile
des derniers segments diffusés. Un écho correspondant reste silencieux et n'est pas recopié dans le
journal ; une phrase distincte poursuit immédiatement la conversation. `buddy companion percepts
stats` expose les distributions de reprise ainsi que les compteurs `quickResume`, `bargeIn` et
`echoSuppressed`, sans ajouter de verbatim aux agrégats.
La même durée acoustique alimente un profil d'**entrainment** borné. Les interjections trop courtes
ne produisent pas un faux débit précis ; les tours fiables classent le rythme `slow`, `balanced` ou
`brisk`, puis fixent une cible plus modérée pour Lisa. La longueur relative influence la forme orale,
mais jamais les obligations de fond du plan conversationnel. Avec Voicebox, cette cible devient aussi
une instruction acoustique par tour. `buddy companion percepts stats` et Cowork → Companion →
Conversation vocale affichent le débit humain médian, la cible de Lisa et la dernière forme appliquée,
toujours sans verbatim agrégé.
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
Pour une réponse développée, Lisa dérive aussi des obligations de sens (répondre réellement,
étayer une position, traiter l'objection active, progresser dans le fil et ancrer les faits frais).
Un critique indépendant note ces dimensions avec un schéma JSON fermé; s'il détecte avec assez de
confiance une lacune, une seule révision est autorisée puis auditée à son tour avant parole, affichage
ou mémoire. Une révision non vérifiable est abandonnée au profit du brouillon initial. Ce gate ne
consulte jamais l'ancien score lexical et ne récompense donc ni la longueur ni les mots de liaison.
Le prompt vocal ne recopie plus les six extraits de `<recent_dialogue>` déjà envoyés comme messages ;
`CODEBUDDY_VOICE_INCLUDE_RECENT_DIALOGUE=true` restaure cette duplication uniquement pour un A/B.
Une première proposition autonome, bornée et validée avant la réponse longue est disponible en pilote
avec `CODEBUDDY_VOICE_SPOKEN_PREFIX=true`. Elle reste désactivée par défaut tant que ses mesures de
latence et de qualité ne justifient pas son activation. Le pilote sépare maintenant les phases du
préfixe de celles de la continuation et conserve uniquement des causes techniques bornées
(`too_long`, `multi_sentence`, `review_rejected`, etc.), jamais la question ni le texte généré. Une
expérience rejetée peut donc être expliquée et comparée sans exposer la conversation privée.
Seul le texte accepté rejoint la continuité canonique gérée par la voix, Telegram ou Cowork. Les
observateurs mémoire génériques du cœur (AutoCapture, ICM et hooks de plugins) ne sont pas rejoués
sur ces tours protégés : ils ont leurs propres politiques de stockage et ne reçoivent donc jamais
par accident un brouillon rejeté ou un transcript compagnon intime.
Il est actif en mode `auto` hors tests, désactivable avec `CODEBUDDY_SEMANTIC_GATE=false`, et peut
utiliser un modèle économique distinct via `CODEBUDDY_AUXILIARY_SEMANTIC_REVIEW_*`. Par confidentialité,
`auto` reste sur le fournisseur principal; choisir explicitement `openrouter` autorise l'envoi du
tour canonique et des preuves publiques à ce fournisseur distant. Une panne, un délai ou une critique invalide conserve le brouillon initial; la
télémétrie ne contient que dimensions et codes, jamais le transcript.
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
