# Améliorations du mode vocal — 27 septembre 2026

Propositions issues de l'analyse des ratés intermittents du mode vocal (silences, latence, écho). Classées par effort croissant.

## 1. Healthcheck Pocket + redémarrage auto

**Effort : faible. Impact : élevé.**

Cause numéro un des silences : le serveur Pocket s'endort ou rate un démarrage à froid, et la chaîne de secours Voicebox → Pocket → Piper ne se déclenche que quand le moteur principal plante. Résultat : des réponses qui passent, d'autres qui tombent dans le silence sans changement de config.

- Ajouter un ping régulier du serveur Pocket (ex. toutes les 30 s).
- Si le ping échoue, redémarrer automatiquement le processus Pocket.
- Exposer l'état via `buddy companion percepts stats` pour repérer les échecs silencieux.

## 2. Préchargement du premier segment TTS

**Effort : moyen. Impact : élevé.**

Aujourd'hui la synthèse attend la phrase entière avant de démarrer. En lançant la synthèse du premier segment dès que le modèle commence à générer, en parallèle de la génération, on coupe la latence perçue de moitié.

- Détecter le premier segment (phrase ou pause naturelle) pendant le streaming du LLM.
- Lancer `speak()` sur ce segment immédiatement, sans attendre la fin de la réponse.
- Enchaîner les segments suivants au fur et à mesure.

## 3. Streaming audio chunk par chunk

**Effort : moyen. Impact : élevé.**

Envoyer les chunks audio au fur et à mesure au lieu d'un seul bloc. L'utilisateur entend la voix démarrer plus tôt, même si la phrase n'est pas finie — comme une vraie conversation.

- Remplacer l'envoi d'un bloc WAV unique par un flux de chunks (WebSocket ou pipe).
- Gérer la file d'attente côté lecteur pour éviter les coupures entre chunks.
- Mesurer le gain avec `buddy assistant latency --engine both` (temps jusqu'au premier son).

## 4. Fallback en cascade

**Effort : moyen. Impact : moyen.**

Garantir une voix même si le cloud lâche : ElevenLabs d'abord, puis Cartesia, puis Piper en local. La qualité baisse en cascade, mais le silence disparaît.

- Déclarer la chaîne dans `CODEBUDDY_TTS_FALLBACK_CHAIN` (ex. `elevenlabs>cartesia>piper`).
- Sur erreur ou timeout d'un moteur, passer au suivant sans perdre la phrase en cours.
- Corriger le comportement actuel où le repli WAV lève au lieu de basculer sur Pocket (phrase purement perdue).

## 5. Borner le verrou ElevenLabs

**Effort : faible. Impact : moyen.**

Le verrou ElevenLabs reste pris pendant toute la requête, donc toute synthèse qui se chevauche est refusée. En le bornant dans le temps et en préchargeant la phrase suivante, le trou est passé de 1,3 s à 0,44 s dans les tests — à généraliser.

- Remplacer le verrou global par un verrou par requête avec timeout.
- Précharger le segment suivant pendant que le courant joue.
- Ajouter un test de non-régression sur les synthèses chevauchées.

## 6. Pinner le modèle vocal sur un modèle capable

**Effort : faible. Impact : moyen.**

Par défaut, le petit modèle local gère le small-talk, mais s'il est trop petit il tronque le contexte et donne des réponses fausses. Forcer un modèle plus costaud via `CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL` (ex. devstral-small ou qwen 27B).

- Définir la variable dans `~/.codebuddy/user-settings.json`.
- Garder le petit modèle uniquement pour les commandes triviales, routées explicitement.
- Documenter le seuil de taille en dessous duquel le contexte est tronqué.

## 7. Filtre anti-écho renforcé

**Effort : moyen. Impact : moyen.**

Le robot s'entendait parler et se répondait à lui-même : le micro captait sa propre voix, l'annulation d'écho partielle trompait le cerveau, et le résidu était transcrit comme une entrée utilisateur. Une garde demi-duplex indépendante et un filtre qui ignore les phrases déjà envoyées au TTS ont été ajoutés — à étendre et à tester en conditions réelles.

- Étendre le filtre aux paraphrases (le robot ne répète pas exactement ce qu'il a dit).
- Ajouter un test d'intégration avec capture audio réelle du haut-parleur.
- Mesurer le taux de faux positifs (phrases utilisateur rejetées à tort).

## Ordre recommandé

1. Healthcheck Pocket (le plus rentable, le moins d'effort).
2. Borne du verrou ElevenLabs (correctif déjà partiellement en place).
3. Préchargement + streaming audio (gain de latence perçu).
4. Fallback en cascade (robustesse).
5. Pinnage du modèle vocal.
6. Filtre anti-écho renforcé.

Chaque point peut faire l'objet d'une issue séparée. Les points 1 à 3 couvrent la majorité des ratés observés.
