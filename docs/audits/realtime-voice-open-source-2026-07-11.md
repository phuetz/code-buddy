# Audit open source — voix temps réel (11 juillet 2026)

Objectif : réduire le temps entre la fin de parole de Patrice et le premier son
utile de Lisa, tout en conservant les outils Code Buddy, la mémoire, la voix
Estelle et l'interruption immédiate.

## Projets étudiés

- [Pipecat](https://github.com/pipecat-ai/pipecat) et
  [Smart Turn v3](https://github.com/pipecat-ai/smart-turn) : pipeline modulaire,
  VAD rapide puis modèle audio de fin de tour. Smart Turn prend le PCM 16 kHz,
  comprend le français, pèse environ 8 Mo en int8 et annonce généralement moins
  de 100 ms d'inférence. C'est la meilleure source pour notre endpointer local.
- [LiveKit Agents](https://github.com/livekit/agents) : combinaison recommandée
  VAD + détecteur de tour, endpoint adaptatif, génération préemptive, annulation
  du TTS et retrait de l'historique non entendu après interruption. Leur exemple
  basse latence emploie une fenêtre de silence de 400 ms.
- [Kyutai Moshi](https://github.com/kyutai-labs/moshi) : dialogue audio/audio
  réellement full-duplex, environ 200 ms dans les conditions annoncées. Très
  intéressant pour un futur mode de conversation sociale, mais il remplace le
  chemin LLM/outils et ne doit donc pas devenir le cerveau unique de Code Buddy.
- [FastRTC](https://github.com/gradio-app/fastrtc) : transport WebRTC/WebSocket
  et détection de pause intégrés. Pertinent pour parler au robot à distance ;
  moins utile sur le chemin local ALSA/PipeWire actuel.
- [TEN Framework](https://github.com/TEN-framework/ten-framework) et
  [TEN VAD](https://github.com/TEN-framework/ten-vad) : composants performants
  et portables à garder comme moteur VAD alternatif.

## Décision Code Buddy

Ne pas remplacer l'architecture existante. Adopter progressivement les motifs
qui ont fait leurs preuves :

1. endpoint VAD rapide autour de 400 ms ;
2. garde sémantique pour ne pas couper une pensée inachevée ;
3. retrait du silence confirmé avant STT ;
4. mesure séparée endpoint / décodage / premier texte / premier son ;
5. interruption qui annule le modèle et le son en cours ;
6. Smart Turn v3 local comme évolution principale de la garde heuristique ;
7. Moshi comme voie expérimentale full-duplex, sans remplacer les missions et outils.

## Première intégration

- endpoint par défaut : 700 → 420 ms, soit 280 ms retirés systématiquement ;
- seul un tail acoustique de 80 ms est conservé : 340 ms de silence confirmé ne
  sont plus envoyés au STT avec le nouveau seuil ;
- une phrase finissant par « que », « parce que », « et », une virgule ou des
  points de suspension est retenue jusqu'à 900 ms et fusionnée avec la suite ;
- `endpointMs`, `decodeMs`, `inputReadyMs` et le vrai `perceivedResponseMs` sont
  maintenant journalisés.

Le seuil reste réglable avec `BUDDY_SENSE_MIC_ENDPOINT_MS`. La garde sémantique
est réglable ou désactivable avec `CODEBUDDY_VOICE_INCOMPLETE_HOLD_MS`.

## Intégration Smart Turn v3.2

Le modèle CPU int8 officiel (8,3 Mo) est installé séparément et vérifié par
SHA-256 avec `node scripts/install-smart-turn.mjs`. Un worker Node persistant
garde ONNX Runtime et l'extracteur Whisper chargés. À chaque pause proposée par
le VAD, l'oreille lui passe au maximum les huit dernières secondes de PCM 16 kHz.

- pensée complète : transcription et réponse immédiates ;
- pensée incomplète : audio retenu et fusionné avec la continuation ;
- aucune continuation : réponse forcée après 1200 ms maximum ;
- panne, timeout ou modèle absent : repli immédiat sur le VAD actuel ;
- fichiers PCM temporaires privés (`0600`) et supprimés après chaque décision.

Mesure réelle sur le WAV français local : pensée complète `0,893` en 92 ms ;
coupure à quatre secondes `0,461` en 99 ms, correctement classée incomplète.

## Laboratoire Moshi Rust

Le backend de production officiel Kyutai a été compilé depuis le commit
`e6a55d2` dans `/home/patrice/DEV/moshi-rust/rust`. Le modèle féminin Moshika
q8 et Mimi sont installés avec des permissions privées sous
`~/.codebuddy/moshi/models/moshika/` (environ 8,55 Go au total). Le build final
emploie `-C target-cpu=native`, qui active AVX et F16C sur le Ryzen ; le build
CPU générique les laissait désactivés.

Mesures locales du chemin audio/audio complet, trames Mimi de 80 ms :

| Build | Threads | Temps moyen/trame | Facteur temps réel | RSS max |
|---|---:|---:|---:|---:|
| générique | 12 | 546 ms | 6,82× trop lent | 9,6 Go |
| natif AVX/F16C | 12 | 210 ms | 2,63× trop lent | 9,6 Go |
| natif AVX/F16C | 24 | 215 ms | 2,69× trop lent | 9,6 Go |

Conclusion : Moshi est validé comme laboratoire full-duplex, mais n'est pas
activé comme service et ne reçoit ni micro ni mémoire. Le backend Candle
officiel supporte actuellement CPU, CUDA et Metal, pas le GPU AMD/ROCm de cette
machine. L'intégration au routeur vocal est donc différée jusqu'à l'une des deux
conditions suivantes : backend ROCm/Vulkan maintenu et vérifié, ou mesure CPU
inférieure ou égale à 80 ms par trame. Le pipeline Code Buddy existant reste le
chemin temps réel par défaut.
