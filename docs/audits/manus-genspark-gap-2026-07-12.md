# Audit Manus / Genspark → Code Buddy

Date : 12 juillet 2026
Méthode : documentation officielle publique, puis vérification dans le code et les tests locaux.

## Sources officielles consultées

- Manus : [index des fonctionnalités](https://manus.im/docs/llms.txt), [Projects](https://manus.im/docs/features/projects), [Projects auto-évolutifs](https://manus.im/blog/manus-projects-self-updating), [Wide Research](https://manus.im/docs/features/wide-research), [Browser Operator](https://manus.im/docs/features/browser-operator), [Meeting Minutes](https://manus.im/docs/features/meeting-minutes), [Mail Manus](https://manus.im/docs/features/mail-manus), [Data Analysis & Visualization](https://manus.im/docs/features/data-visualization), [Slides](https://manus.im/docs/features/slides).
- Genspark : [Super Agent](https://www.genspark.ai/helpcenter?doc=general_What_is_Super_Agent), [Hub](https://www.genspark.ai/helpcenter/hub), [AI Meeting Notes](https://www.genspark.ai/helpcenter/ai-meeting-notes), [Workflows](https://www.genspark.ai/helpcenter/workflows), [Custom Agent](https://www.genspark.ai/helpcenter/custom-super-agent), [Skills](https://www.genspark.ai/helpcenter/skills).

## Matrice honnête

| Capacité concurrente | État Code Buddy avant cet audit | Preuve locale | Décision |
|---|---|---|---|
| Super-agent qui route modèles et outils | Déjà plus large sur le local : 15 providers, registre dynamique, MoA, Council, Fleet | `src/providers/`, `src/models/model-hub.ts`, `src/tools/mixture-of-agents-tool.ts`, `src/fleet/` | Conserver ; ne pas ajouter un second registre en dur |
| Wide Research à agents indépendants | Déjà réel : workers à contexte neuf, Deep Research cité, itérations, STORM, CKG | `src/agent/wide-research.ts`, `src/agent/deep-research*.ts`, `buddy research --wide|--deep` | Ajouter la reprise durable pour ne pas refaire les workers terminés |
| Browser Operator visible et interruptible | Partiel avant la deuxième passe : brouillon et overlay présents, mais aucun chemin de production ne reliait réellement la validation à l’exécuteur | `src/browser-automation/browser-operator-executor.ts`, `cowork/src/renderer/components/BrowserOperatorOverlay.tsx` | Relier un runtime possédé, approuvé par empreinte et réellement interruptible |
| Projects Manus / Hub Genspark | Partiel : projets, sessions, mémoire et recherche existaient, mais sans instruction maître ni base de fichiers explicitement héritée | `cowork/src/main/project/`, `cowork/src/main/session/session-manager.ts` | Compléter le Projet comme Hub local-first |
| Meeting Minutes / AI Meeting Notes | Transcription et composants de journal existaient, mais aucun pipeline dédié décisions/actions/questions/export | `src/tools/video/long-transcribe.ts`, `cowork/src/renderer/components/CallLogView.tsx` | Ajouter un pipeline Meeting Notes local-first et une CLI |
| Slides, Sheets, Docs, image, vidéo, podcast | Déjà câblé aux sessions et fichiers réels ; certains anciens panneaux Labs restent seulement des aperçus | `cowork/src/renderer/components/deliverables/`, `cowork/src/main/media/` | Continuer à promouvoir les studios réels, pas les maquettes dormantes |
| AI Drive / fichiers de sortie | Déjà réel sur les artefacts locaux | `cowork/src/renderer/components/deliverables/DrivePanel.tsx`, `drive-real-model.ts` | Conserver local et adressable |
| Workflows planifiés et répétitifs | Déjà réel : cron, daemon, DAG Cowork, boucles et batch | `src/scheduler/`, `src/commands/cron-cli/`, `cowork/src/main/workflows/` | Conserver ; améliorer la supervision plutôt que dupliquer |
| Custom Agents / Skills partageables | Déjà réel : profils, agents spécialisés, packages `SKILL.md`, hub signé | `src/agent/custom/`, `src/skills/`, `buddy skills`, `buddy hub` | Conserver les permissions inspectables |
| Appels téléphoniques | Adaptateur Twilio réel présent, mais l’expérience complète dépend d’un compte et de webhooks externes | `src/channels/twilio-voice/` | Ne pas simuler une disponibilité sans configuration opérateur |
| Agent déclenché par une adresse e-mail dédiée | Connecteurs, canaux et triggers existent ; pas d’adresse bot hébergée équivalente à Mail Manus | `src/channels/`, `src/triggers/` | Écart assumé : nécessite une infrastructure mail et une politique d’expéditeurs approuvés |
| Meeting Bot qui rejoint Zoom/Meet/Teams | Absent | — | Non implémenté à l’aveugle : consentement des participants, calendrier et bots fournisseurs requis |
| Collaboration cloud à 50 personnes | Fleet, sessions peer et Cowork couvrent la collaboration locale/multi-machine, sans service SaaS public multi-tenant | `src/fleet/`, `src/server/websocket/` | Ne pas transformer implicitement le robot privé en SaaS public |

## Changements retenus dans cette boucle

### 1. Projet/Hub local-first

Un Projet Cowork représente le Hub ; ses sessions représentent les tâches. Le projet possède maintenant :

- une instruction maître persistante ;
- une liste explicite de fichiers texte de référence, relative au workspace ;
- un budget de contexte borné ;
- l’héritage automatique dans chaque tour, avec la mémoire du projet ;
- une protection contre `..`, les liens hors workspace, les gros fichiers, les formats binaires et les fichiers sensibles (`.env`, clés, credentials, `.codebuddy`, `.git`) ;
- une configuration exportable/importable et une surface Settings visible.

### 2. Meeting Notes local-first

Le pipeline accepte un transcript ou un média local, conserve les repères temporels, puis produit JSON et Markdown : résumé, participants, points clés, décisions, actions assignées avec preuve, échéances et questions ouvertes. La CLI propose un enrichissement distant explicite et documenté avec repli local ; l’outil agentique `meeting_notes` reste strictement déterministe et confiné au workspace. Aucun e-mail, partage ou action externe ne part automatiquement, et les rapports existants ne peuvent pas être écrasés par l’agent.

### 3. Wide Research reprenable

Les recherches parallèles peuvent être longues. Un checkpoint versionné et atomique conserve la décomposition et les résultats de workers. Une reprise valide le sujet et les options, saute les workers déjà réussis, relance seulement les échecs/incomplets, puis régénère la synthèse.

### 4. Garde de déploiement

L'audit d'intégration a aussi fermé une exposition préexistante : un serveur lancé avec `--no-auth`
ne peut plus offrir les routes générales, l'exécution d'outils, le chat agentique WebSocket ou
Cowork `/desktop` à un client réseau anonyme. Le loopback direct reste compatible ; les pairs distants
doivent s'authentifier, tandis que l'endpoint A2A volontairement distant conserve son exécuteur
`fleetSafe` en lecture seule. Les requêtes proxifiées anonymes sont refusées sans faire confiance à
`X-Forwarded-For`.

## Deuxième passe — correction et écarts restant ouverts

La première passe a surestimé le **Browser Operator**. À ce moment-là, l’outil agentique produisait surtout un brouillon de session ; l’exécuteur n’était pas relié à un chemin de production, l’overlay Cowork observait des événements génériques et son bouton STOP arrêtait la session agent entière. La ligne « déjà réel » de la matrice devait donc être classée **partielle**.

Cette deuxième passe ferme trois écarts concrets :

- **Project Evolution** : Cowork extrait localement des règles ou décisions réutilisables d’une session ou d’une synthèse, puis crée une proposition SQLite sans effet automatique. L’utilisateur examine les preuves filtrées et le diff exact avant/après, puis approuve, rejette ou restaure. Les empreintes du contenu et du workspace bloquent les propositions obsolètes, les changements de dossier et les rollbacks dangereux ; aucune clé détectée n’est transformée en mémoire.
- **Missions vocales en arrière-plan** : le mode vocal laisse un choix explicite entre conversation et mission durable. Une recommandation locale détecte les travaux longs, mais ne décide jamais à la place de l’utilisateur. La mission est persistée avant son lancement dans l’orchestrateur existant ; l’assistant confirme oralement, rouvre le micro, affiche progression et résultat, et permet une annulation dédiée. Une interruption vocale ne tue pas la mission, et la délégation ne vaut jamais autorisation d’envoyer, publier, acheter, appeler ou modifier un service distant.
- **Runtime Browser Operator** : un vrai cycle `prepare → review → start → status/stop` relie maintenant Cowork à l’exécuteur. Le runtime, le workspace et le propriétaire sont choisis côté processus principal ; l’approbation est liée au SHA-256 du plan immuable. Une seule exécution peut être active par session, chaque interaction redemande une confirmation humaine même lorsque Cowork auto-approuve le travail local ordinaire, les effets à fort impact restent bloqués, et les preuves sont confinées au workspace. Le mode local ouvre un navigateur Code Buddy dédié et visible : il ne se greffe pas encore aux onglets déjà authentifiés de l’utilisateur.

Deux écarts supplémentaires sont maintenant fermés :

- **Branches persistées** : la branche active est adossée aux lignes `messages` SQLite. La bifurcation depuis l’action d’un message utilise son identifiant persistant et l’inclut dans le nouvel historique. Le checkout sauvegarde la branche sortante puis remplace atomiquement les messages actifs, invalide le cache et les sessions provider cachées, et renvoie l’historique exact au renderer. Le journal de récupération sortant est archivé dans la transaction : si sa rotation échoue, le checkout est annulé, et s’il réussit aucun tour de l’ancienne branche ne peut être réinjecté au redémarrage.
- **Wide Research par vagues** : `--items` pilote désormais le volume total (jusqu’à 250) tandis que `--concurrency` borne les exécutions simultanées (jusqu’à 20). Chaque résultat et chaque fin de vague sont checkpointés ; une reprise saute les items réussis, y compris dans une vague interrompue. Le timeout par défaut grandit avec le nombre de vagues, et la synthèse utilise une réduction hiérarchique bornée au lieu d’un prompt contenant tous les rapports. Un manifeste de couverture expose les items échoués ou tronqués ; les résultats bruts restent complets dans le checkpoint. `--workers` reste un alias compatible plafonné à 20.

## Troisième passe — écarts produit fermés

La troisième passe transforme les quatre derniers écarts fonctionnels en chemins de production testés :

- **Meeting Live** : l'espace Réunion de Cowork impose un consentement explicite et horodaté, capture réellement le micro par blocs locaux de dix secondes, écrit des checkpoints atomiques avec SHA-256, reprend une session interrompue et finalise vers le pipeline Meeting Notes local. Le dernier bloc est drainé avant pause ou finalisation et une écriture rejetée bloque la finalisation (`docs/meeting-live.md`).
- **Design View** : les studios Document et Présentation éditent, réordonnent, dupliquent et suppriment directement les blocs ou slides avant d'emprunter le même export réel. Le studio Image permet de dessiner plusieurs zones et d'associer une consigne par zone. OpenAI reçoit le masque alpha exact ; xAI reçoit l'image et une consigne régionale normalisée, conformément aux capacités différentes des deux API. L'original n'est jamais écrasé. La chaîne parent→version est persistée dans un index privé, atomique et borné, puis chaque chemin est revalidé côté processus principal avant affichage ou restauration (`docs/design-view.md`).
- **Supervision des workflows** : le dry-run passe par le compilateur de production, l'historique est persistant et expurgé, les exécutions sont comparables, les échecs reçoivent un diagnostic déterministe et le replay rejoue le snapshot stocké. Toute action mutatrice, shell, externe ou inconnue redemande une confirmation fraîche ; un secret expurgé interdit le replay (`docs/workflow-supervision-agentbase.md`).
- **AgentBase local** : Settings → Connecteurs agrège les serveurs MCP configurés, leur état vivant, leurs outils et le catalogue disponible sans confondre « disponible » et « connecté ». Les permissions lecture/écriture/externe sont inspectables et relues à chaque décision. Les outils MCP natifs fournis à l'agent passent eux aussi par cette porte ; les actions non-lisibles échouent fermées, exigent une confirmation fraîche et un pré-audit `fsync` avant invocation. Le journal est lu et tourné avec des bornes de taille.

Deux améliorations de parité ont également été fermées pendant la revue :

- **Browser Operator authentifié durablement** : le navigateur local visible utilise désormais un profil Code Buddy privé et persistant. Les connexions effectuées volontairement dans cette fenêtre survivent aux missions suivantes, sans attacher ni inspecter les onglets personnels déjà ouverts. Un marqueur de propriété `0600` empêche d'adopter par erreur un profil Chrome existant ; un verrou inter-processus à heartbeat couvre toute la vie du navigateur et récupère seulement les propriétaires morts. L'interception du contexte valide aussi chaque navigation de document, redirection, popup et destination après interaction afin de ne pas contourner la garde réseau par une chaîne de redirections.
- **Large échelle vérifiable** : les branches et Wide Research ne sont plus de simples états d'interface. Les branches remplacent transactionnellement les messages **et** les traces SQLite, rebasent l'ordre des ajouts et committent une clôture SHA-256 du journal de récupération dans la même transaction ; un crash avant sa rotation ne peut donc pas réinjecter l'ancienne branche. Wide Research traite jusqu'à 250 items par vagues, checkpoint par item et réduit les rapports par une synthèse hiérarchique bornée. Un worker expiré garde son slot jusqu'à son arrêt effectif : la vague suivante ne crée pas de concurrence « fantôme » au-delà de la limite demandée.

## Quatrième passe — capacités locales durcies

Cette passe ne rajoute pas des promesses d'interface : elle relie les capacités aux entrées locales réelles et ferme leurs chemins de contournement les plus importants.

- **Meeting Live, deux sources audio et diarisation locale** : le microphone reste la source de base. Lorsque l'utilisateur choisit aussi l'audio système, Windows utilise `getDisplayMedia` après armement d'une permission Electron éphémère liée à la frame principale et au geste utilisateur ; la piste vidéo de transport est arrêtée immédiatement. Sous Linux, le main process crée un bail `pw-loopback` éphémère depuis la sortie PipeWire par défaut, Chromium confirme la source dans `enumerateDevices()`, puis le renderer la sélectionne par `deviceId` exact. Le processus est détruit à chaque sortie ou échec. Seules les pistes audio réellement obtenues sont mélangées localement. Un refus ou l'absence de piste audio produit un état indisponible ou un repli micro seul seulement si ce repli a été accepté. La diarisation Sherpa-ONNX s'exécute localement sur la capture puis aligne ses tours avec les segments Whisper. Ses libellés (`Locuteur 1`, `Prise 2 · Locuteur 1`, etc.) désignent des clusters anonymes propres à une prise, jamais des identités ni un suivi biométrique entre captures. Si Sherpa ou ses modèles manquent, échouent ou renvoient zéro cluster malgré une parole Whisper, le rapport indique explicitement qu'il n'est pas diarizé et n'invente aucun locuteur. Code Buddy ne rejoint toujours pas la réunion comme bot et ne contourne aucun indicateur d'enregistrement.
- **Inpainting ComfyUI réel et configurable** : Design View sait maintenant envoyer séparément la source et le masque alpha, injecter leurs références et la consigne dans un workflow API validé, soumettre `/prompt`, suivre `/history` et récupérer la sortie déclarée via `/view`. Il ne présente jamais une régénération texte→image comme une retouche masquée. Cette installation possède un profil qualité SD 1.5 utilisant `VAEEncodeForInpaint` et un profil rapide SD Turbo à quatre étapes ; ce dernier a produit une retouche masquée réelle en 13 à 18 secondes sur le repli CPU, avant et après alignement de PyTorch sur la version AMD supportée. Ces graphes ne sont ni prétendus universels ni embarqués pour toutes les machines. La fidélité des raccords, visages, textures et styles dépend fortement du checkpoint, du VAE, du sampler et des modèles réellement installés dans ComfyUI. Sans workflow compatible, masque valide ou sortie non ambiguë, la capacité échoue fermée.
- **Browser Operator, garde sémantique locale avant mutation** : la garde ne se limite plus aux mots du plan. Avant une interaction mutatrice, le processus inspecte localement l'URL effective, le texte visible, les noms ARIA, les labels, un voisinage borné, le lien et l'action du formulaire de la cible exacte. Elle peut ainsi reconnaître un bouton neutre comme « Continuer » placé dans un paiement, un envoi ou une suppression. Une première inspection précède la confirmation générique, puis une seconde juste après celle-ci réduit la fenêtre TOCTOU ; l'action est liée au sélecteur local réinspecté au lieu de laisser un modèle choisir ensuite une autre cible. Une cible mutatrice non inspectable échoue fermée, et un effet sensible reconnu reste bloqué faute de reçu d'autorisation propre à cet effet. Le DOM n'est pas envoyé à un modèle distant par ce préflight. Cette combinaison reste une défense heuristique contre une page dynamique ou hostile, pas une preuve absolue de l'effet futur du site.
- **Import AgentBase des configurations Code Buddy** : AgentBase découvre les `.codebuddy/mcp.json` du Projet et du profil utilisateur sans lancer leurs commandes. Le renderer ne reçoit qu'un aperçu borné et expurgé : clés d'environnement et présence de secrets, jamais leurs valeurs ; les arguments ou commandes contenant un secret littéral rendent l'entrée non importable. L'import ne reçoit pas une configuration forgée par le renderer : il relit le fichier côté processus principal, refuse liens symboliques, sorties de racine et transports réseau nécessitant OAuth/en-têtes, puis revalide identité, taille, empreinte et métadonnées du fichier contre les changements TOCTOU. Le connecteur créé est toujours **désactivé** et doit être relu puis activé manuellement ; les références `${VAR}` restent des références d'environnement et ne sont pas copiées dans le stockage Cowork.

## Cinquième passe — ComfyUI devient un moteur de recettes

L'Atelier Flow possède maintenant un **Laboratoire ComfyUI** qui cartographie la machine réelle au
lieu d'afficher un catalogue théorique : installation, loopback, device, modèles non vides,
workflows et nœuds exposés. Six parcours expliquent les prérequis, coûts, licences et limites pour
les couvertures/storyboards, l'animatique Wan, la cohérence des personnages, ACE-Step, l'avatar
parlant et la 3D. Le panneau n'installe ni ne lance rien ; il ouvre seulement l'instance locale ou
copie un plan déterministe.

Le cœur possède en parallèle un contrat de recette versionné, un registre immuable, un préflight
des nœuds/modèles/ressources/licences, un runtime loopback avec timeout/annulation et une collecte
d'artefacts confinée. L'outil agentique `comfy_recipe` n'accepte qu'un identifiant de recette
enregistrée et des entrées texte ; aucun graphe arbitraire, téléchargement ou chemin d'asset ne
traverse sa surface. L'usage commercial est explicite et chaque exécution exige une confirmation
fraîche. Une recette SD Turbo a réellement produit une image en 11,3 secondes sur le repli CPU ; une
recette Wan a été refusée au préflight faute de VRAM au lieu de masquer cette limite.

Un superviseur séparé qualifie la santé de ComfyUI sans le redémarrer. Les roues PyTorch/ROCm du
venv ont été réalignées sur la distribution AMD supportée, mais le défaut GCVM déjà présent dans
l'état du GPU exige un redémarrage système avant de revalider l'accélération. Le service CPU reste
volontairement lié à `127.0.0.1:8188` jusque-là.

Les limites restantes sont des frontières explicites, pas des fonctionnalités simulées :

- aucun bot ne rejoint automatiquement Zoom, Meet ou Teams : cela exige les API fournisseurs, le calendrier et le consentement de tous les participants ;
- Meeting Live ne mélange l'audio système que si Electron loopback (Windows) ou la source virtuelle PipeWire (Linux) fournit réellement une piste. Linux exige `wpctl` et `pw-loopback`; macOS reste micro uniquement. Whisper local reste requis pour le texte horodaté, et les numéros Sherpa restent des clusters anonymes propres à la capture ;
- ComfyUI dispose ici de workflows locaux SD 1.5/SD Turbo opérationnels, mais la qualité n'est pas équivalente à celle de tous les services cloud et variera avec les modèles et nœuds installés. Le runtime GPU AMD/ROCm a aussi déclenché un défaut mémoire noyau pendant cet audit ; le repli CPU reste fonctionnel sans masquer cette panne d'accélération. OpenAI prend en charge le masque alpha, tandis que xAI applique les zones sous forme de consignes spatiales et ne doit pas être présenté comme un masquage pixel-exact ;
- AgentBase peut importer des MCP Code Buddy locaux sous forme désactivée et sans matérialiser leurs secrets, mais il n'est ni un service SaaS propriétaire ni une authentification inexistante ;
- la garde Web combine désormais contexte DOM local, URL, formulaire et réinspection TOCTOU. Elle bloque les effets sensibles reconnus et échoue fermée sans cible inspectable, mais elle ne constitue toujours pas une preuve sémantique absolue de ce qu'une page arbitraire exécutera après l'interaction ;
- la collaboration cloud publique multi-tenant et l'adresse e-mail bot hébergée restent volontairement hors du périmètre du compagnon privé local-first.

Sources de cette deuxième passe : [Manus Projects auto-évolutifs](https://manus.im/blog/manus-projects-self-updating), [Manus Browser Operator](https://manus.im/docs/features/browser-operator), [Manus Branch](https://manus.im/blog/manus-branch), [Manus Design View](https://manus.im/blog/manus-design-view), [Genspark Realtime Voice](https://www.genspark.ai/helpcenter/realtime-voice), [Genspark Workflows](https://www.genspark.ai/helpcenter/workflows) et [Genspark AgentBase](https://www.genspark.ai/helpcenter/agentbase).

## Principe produit

Code Buddy ne doit pas gagner en accumulant des écrans qui portent le nom d’un concurrent. Il gagne lorsque les boucles sont locales, inspectables, reprenables et reliées entre elles : une réunion nourrit un Projet, un Projet nourrit une recherche, la recherche produit des livrables, et chaque action reste vérifiable avant publication.
