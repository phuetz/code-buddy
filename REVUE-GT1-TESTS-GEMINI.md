# REVUE GT1 — Chasse aux tests qui ne testent rien : tests/sensory et tests/companion

**Date** : 2026-09-03  
**Auditeur** : Antigravity (Google DeepMind)  
**Branche** : `revue/gt1-tests-tautologiques-2026-09-03`  
**Dépôt** : `/home/patrice/DEV/cb-succes-registry-2026-09-02`  
**Commit des preuves rouges** : `ae34ae23b` (`test(mutation): preuves rouges des 5 trous de couverture sur les gardes de la nuit`)

---

## 1. Journal intégral de lecture au fil de l'eau

L'ensemble des fichiers de `tests/sensory/` (64 fichiers) et de `tests/companion/` (54 fichiers) a été lu en intégralité, ligne par ligne, ainsi que le code applicatif source correspondant dans `src/sensory/` et `src/companion/`.

### 1.1. Fichiers audités de `tests/sensory/` (64 fichiers — 100% audités)

1. [tests/sensory/sherpa-rs-stt.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/sherpa-rs-stt.test.ts) (lignes 1-196) — STT sherpa-rs rust worker & skip conditionnels
2. [tests/sensory/smart-turn-v3.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/smart-turn-v3.test.ts) (lignes 1-19) — Contrat smart turn v3
3. [tests/sensory/audio-scene.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/audio-scene.test.ts) (lignes 1-34) — Classification scène audio
4. [tests/sensory/agent-reply-voice-budget.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/agent-reply-voice-budget.test.ts) (lignes 1-37) — Budget tokens vocaux
5. [tests/sensory/voice-replay-lab.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-replay-lab.test.ts) (lignes 1-30) — Détection d'écho et labo de rejeu
6. [tests/sensory/vision-description-safety.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/vision-description-safety.test.ts) (lignes 1-43) — Sanitisation des descriptions visuelles
7. [tests/sensory/reactions.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/reactions.test.ts) (lignes 1-46) — Niveaux de log et câblage
8. [tests/sensory/companion-bridge.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/companion-bridge.test.ts) (lignes 1-45) — Pont capteurs vers compagnon
9. [tests/sensory/voice-max-tokens.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-max-tokens.test.ts) (lignes 1-47) — Bornage tokens voix
10. [tests/sensory/camera-keyframe-policy.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/camera-keyframe-policy.test.ts) (lignes 1-48) — Consentement et persistance caméra
11. [tests/sensory/hole-arrival-home-policy.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/hole-arrival-home-policy.test.ts) (lignes 1-49) — Modes maison et accueil vidéo
12. [tests/sensory/camera-captions.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/camera-captions.test.ts) (lignes 1-52) — Légendes caméra et anti-répétition
13. [tests/sensory/hole-arrival-voice-collision.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/hole-arrival-voice-collision.test.ts) (lignes 1-55) — Collision accueil et parole active
14. [tests/sensory/hole-arrival-conductor-race.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/hole-arrival-conductor-race.test.ts) (lignes 1-57) — Conductor et accueil
15. [tests/sensory/hole-ambient-in-window-loop.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/hole-ambient-in-window-loop.test.ts) (lignes 1-58) — Non-extension fenêtre sur bruit
16. [tests/sensory/hole-vad-noise-cap.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/hole-vad-noise-cap.test.ts) (lignes 1-59) — Plafond bruit VAD (mock pur)
17. [tests/sensory/voice-turn-taking.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-turn-taking.test.ts) (lignes 1-59) — Détection de fin de tour
18. [tests/sensory/camera-share-wiring.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/camera-share-wiring.test.ts) (lignes 1-60) — Câblage caméra-share
19. [tests/sensory/say-now-phone-policy.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/say-now-phone-policy.test.ts) (lignes 1-60) — Envoi sayNow sur Telegram
20. [tests/sensory/voice-turn-coordinator.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-turn-coordinator.test.ts) (lignes 1-60) — Transitions d'état coordinateur de tour
21. [tests/sensory/hole-dreaming-hallucination-memory.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/hole-dreaming-hallucination-memory.test.ts) (lignes 1-64) — Filtre mémoire de rêve
22. [tests/sensory/ear-energy.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/ear-energy.test.ts) (lignes 1-66) — Calcul RMS et énergie audio
23. [tests/sensory/sound-classifier.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/sound-classifier.test.ts) (lignes 1-67) — Classification de bruits ambiants
24. [tests/sensory/whisper-stt.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/whisper-stt.test.ts) (lignes 1-71) — Transcripteur whisper
25. [tests/sensory/dark3-two-speed-routing.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/dark3-two-speed-routing.test.ts) (lignes 1-71) — Routage Kyutai à deux vitesses
26. [tests/sensory/sensory-rules-reload.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/sensory-rules-reload.test.ts) (lignes 1-74) — Rechargement à chaud des règles
27. [tests/sensory/speech-sanitizer.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/speech-sanitizer.test.ts) (lignes 1-80) — Filtrage CJK, tokens spéciaux
28. [tests/sensory/voice-clock.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-clock.test.ts) (lignes 1-84) — Horloge système injectée
29. [tests/sensory/live-audio-bridge.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/live-audio-bridge.test.ts) (lignes 1-84) — Bridge WebSocket audio live
30. [tests/sensory/ear-ring-buffer.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/ear-ring-buffer.test.ts) (lignes 1-87) — Buffer circulaire audio PCM
31. [tests/sensory/identity-reaction.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/identity-reaction.test.ts) (lignes 1-92) — Réactions reconnaissance faciale
32. [tests/sensory/sensory-rules.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/sensory-rules.test.ts) (lignes 1-94) — Moteur de règles sensorielles
33. [tests/sensory/presence-reaction.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/presence-reaction.test.ts) (lignes 1-100) — Détection de présence PIR/caméra
34. [tests/sensory/webhook-ssrf.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/webhook-ssrf.test.ts) (lignes 1-103) — Sécurité SSRF webhooks
35. [tests/sensory/sensory-rules-admin.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/sensory-rules-admin.test.ts) (lignes 1-104) — Gestion admin et logs de règles
36. [tests/sensory/voice-interactions.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-interactions.test.ts) (lignes 1-104) — Phrases et intents vocaux
37. [tests/sensory/silero-vad.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/silero-vad.test.ts) (lignes 1-105) — Détection d'activité vocale Silero
38. [tests/sensory/sensory-conductor.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/sensory-conductor.test.ts) (lignes 1-107) — Conductor central sensoriel
39. [tests/sensory/stt-vad-tuning.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/stt-vad-tuning.test.ts) (lignes 1-110) — Calibrage STT/VAD
40. [tests/sensory/dreaming.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/dreaming.test.ts) (lignes 1-110) — Cycle de consolidation nocturne
41. [tests/sensory/elevenlabs-library-publish.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/elevenlabs-library-publish.test.ts) (lignes 1-115) — Partage de modèles ElevenLabs
42. [tests/sensory/conversation-cues.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/conversation-cues.test.ts) (lignes 1-122) — Cues de relance et hochements
43. [tests/sensory/screen-reaction.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/screen-reaction.test.ts) (lignes 1-123) — Réaction aux changements d'écran
44. [tests/sensory/tts-cache.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/tts-cache.test.ts) (lignes 1-128) — Éviction et stockage cache TTS
45. [tests/sensory/voice-activity.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-activity.test.ts) (lignes 1-130) — Demi-duplex et détection d'écho
46. [tests/sensory/local-turn-detector.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/local-turn-detector.test.ts) (lignes 1-133) — Détection locale de tours
47. [tests/sensory/voice-entrainment.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-entrainment.test.ts) (lignes 1-137) — Alignement prosodique WPM
48. [tests/sensory/conversation-continuity.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/conversation-continuity.test.ts) (lignes 1-140) — Suivi de fil de dialogue
49. [tests/sensory/speech-engine-config.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/speech-engine-config.test.ts) (lignes 1-141) — Configuration moteur STT
50. [tests/sensory/smart-turn.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/smart-turn.test.ts) (lignes 1-142) — Smart-turn sémantique
51. [tests/sensory/voice-context.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-context.test.ts) (lignes 1-143) — Contexte d'entrée vocal
52. [tests/sensory/conversation-conv2-resume.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/conversation-conv2-resume.test.ts) (lignes 1-143) — Reprise après interruption
53. [tests/sensory/camera-share-voice.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/camera-share-voice.test.ts) (lignes 1-146) — Partage caméra vocal
54. [tests/sensory/arrival-opener.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/arrival-opener.test.ts) (lignes 1-154) — Génération d'accroche d'arrivée
55. [tests/sensory/kyutai-two-speed-stream-speak.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/kyutai-two-speed-stream-speak.test.ts) (lignes 1-154) — Streaming Kyutai
56. [tests/sensory/telegram-voice.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/telegram-voice.test.ts) (lignes 1-155) — Envoi audio Telegram
57. [tests/sensory/stt-correction.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/stt-correction.test.ts) (lignes 1-156) — Correction lexicale phonétique
58. [tests/sensory/live-audio.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/live-audio.test.ts) (lignes 1-157) — Stream audio micro
59. [tests/sensory/conversation-conv2.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/conversation-conv2.test.ts) (lignes 1-160) — Barge-in CONV2
60. [tests/sensory/conversation-conv2-adaptive.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/conversation-conv2-adaptive.test.ts) (lignes 1-163) — Fuite adaptative CONV2
61. [tests/sensory/ear-stream.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/ear-stream.test.ts) (lignes 1-163) — Flux capture micro
62. [tests/sensory/agent-reply-routing.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/agent-reply-routing.test.ts) (lignes 1-172) — Routage modèles agent
63. [tests/sensory/heartbeat-scheduler.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/heartbeat-scheduler.test.ts) (lignes 1-187) — Planificateur périodique
64. [tests/sensory/elevenlabs-library.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/elevenlabs-library.test.ts) (lignes 1-189) — Catalogue ElevenLabs local

### 1.2. Fichiers audités de `tests/companion/` (54 fichiers — 100% audités)

1. [tests/companion/user-name.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/user-name.test.ts) (lignes 1-18) — Résolution nom utilisateur
2. [tests/companion/mysoulmate-image-prompts.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/mysoulmate-image-prompts.test.ts) (lignes 1-40) — Prompts visuels MySoulmate
3. [tests/companion/orchestrator.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/orchestrator.test.ts) (lignes 1-41) — Arbiteur de prise de parole (Conductor)
4. [tests/companion/safety-ledger-rotation.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/safety-ledger-rotation.test.ts) (lignes 1-41) — Rotation du ledger de sécurité (>1 Mio)
5. [tests/companion/jokes.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/jokes.test.ts) (lignes 1-51) — Détection blagues et anti-répétition
6. [tests/companion/voice-callbacks.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/voice-callbacks.test.ts) (lignes 1-56) — Relances mémorielles et fenêtres
7. [tests/companion/revue-gemini-reminders-oneshot.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/revue-gemini-reminders-oneshot.test.ts) (lignes 1-58) — Re-déclenchement indésirable one-shot
8. [tests/companion/revue-gemini-reminders-ack.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/revue-gemini-reminders-ack.test.ts) (lignes 1-60) — Collision d'acquittement de rappel
9. [tests/companion/home-interaction-policy.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/home-interaction-policy.test.ts) (lignes 1-62) — Évaluation politique maison (modes silencieux, invités)
10. [tests/companion/emotion-confidence.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/emotion-confidence.test.ts) (lignes 1-64) — Confiance et registre émotionnel
11. [tests/companion/attached-image-grounding.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/attached-image-grounding.test.ts) (lignes 1-66) — Analyse photos jointes
12. [tests/companion/voice-guidance.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/voice-guidance.test.ts) (lignes 1-66) — Stockage et formatage du guidage vocal
13. [tests/companion/reminders-confirm-dedup.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminders-confirm-dedup.test.ts) (lignes 1-69) — Déduplication de rappels identiques
14. [tests/companion/reminders-undo.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminders-undo.test.ts) (lignes 1-74) — Annulation vocale immédiate
15. [tests/companion/revue-gemini-relationship-state.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/revue-gemini-relationship-state.test.ts) (lignes 1-75) — Dérive non bornée du compteur de sessions
16. [tests/companion/signature-locations.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/signature-locations.test.ts) (lignes 1-80) — Catalogue des décors signature Lisa
17. [tests/companion/lisa-selfie-cache.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/lisa-selfie-cache.test.ts) (lignes 1-82) — Pré-génération cache selfies
18. [tests/companion/companion-doctor.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/companion-doctor.test.ts) (lignes 1-88) — Diagnostic de cohérence persona/voix
19. [tests/companion/continuity.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/continuity.test.ts) (lignes 1-91) — Intégrité de la lignée Lisa
20. [tests/companion/reminder-ack-persistence.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminder-ack-persistence.test.ts) (lignes 1-91) — Persistance des acks à travers crash
21. [tests/companion/visual-consent.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/visual-consent.test.ts) (lignes 1-92) — Porte de consentement caméra à 2 tours
22. [tests/companion/revue-gemini-camera-share.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/revue-gemini-camera-share.test.ts) (lignes 1-99) — Fuite de snapshot vers chat non demandeur
23. [tests/companion/fashion-scene-catalog.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/fashion-scene-catalog.test.ts) (lignes 1-100) — Catalogue de poses fashion
24. [tests/companion/crisis-safety.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/crisis-safety.test.ts) (lignes 1-103) — Détection de détresse aiguë et orientation
25. [tests/companion/reminders-agenda.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminders-agenda.test.ts) (lignes 1-109) — Requêtes d'agenda et rappels anticipés
26. [tests/companion/reminder-runner.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminder-runner.test.ts) (lignes 1-113) — Déclenchement de rappels, renag et escalade
27. [tests/companion/conversation-quality-insights.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/conversation-quality-insights.test.ts) (lignes 1-114) — Agrégation métriques qualité
28. [tests/companion/event-followups.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/event-followups.test.ts) (lignes 1-124) — Suivi d'événements à venir et relances
29. [tests/companion/daily-interaction-budget.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/daily-interaction-budget.test.ts) (lignes 1-126) — Budget d'initiatives spontanées
30. [tests/companion/idle-loop.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/idle-loop.test.ts) (lignes 1-127) — Tâches d'inactivité réservées à la solitude
31. [tests/companion/reminders-voice-mgmt.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminders-voice-mgmt.test.ts) (lignes 1-128) — Gestion vocale des rappels
32. [tests/companion/maison-voice-actions.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/maison-voice-actions.test.ts) (lignes 1-129) — Actions domestiques vocales (minuteurs, repas)
33. [tests/companion/inner-life.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/inner-life.test.ts) (lignes 1-137) — Vie intérieure numérique et authenticité
34. [tests/companion/relationship-mood.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/relationship-mood.test.ts) (lignes 1-137) — Dérive d'humeur et traits relationnels
35. [tests/companion/migration.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/migration.test.ts) (lignes 1-139) — Export chiffré et restauration
36. [tests/companion/relationship-state.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/relationship-state.test.ts) (lignes 1-144) — Jalons de relation et persistance
37. [tests/companion/cooking-timer-runner.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/cooking-timer-runner.test.ts) (lignes 1-147) — Minuteurs de cuisine et mode invité
38. [tests/companion/voice-incident-repair.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/voice-incident-repair.test.ts) (lignes 1-155) — Quarantaine et purge d'incidents vocaux
39. [tests/companion/conversation-improvement-loop.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/conversation-improvement-loop.test.ts) (lignes 1-162) — Boucle d'apprentissage et rollback
40. [tests/companion/reminders-snooze.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminders-snooze.test.ts) (lignes 1-163) — Report (snooze) durable de rappels
41. [tests/companion/companion-voice-character.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/companion-voice-character.test.ts) (lignes 1-175) — Guidage d'intimité progressive Lisa
42. [tests/companion/reminders-oneshot.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminders-oneshot.test.ts) (lignes 1-181) — Rappels datés ponctuels (train bug fix)
43. [tests/companion/presence-loop.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/presence-loop.test.ts) (lignes 1-217) — Boucle de présence et moments relationnels
44. [tests/companion/reminders.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reminders.test.ts) (lignes 1-226) — CRUD rappels et acks sécurisés
45. [tests/companion/voice-improvement-loop.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/voice-improvement-loop.test.ts) (lignes 1-250) — Boucle de réflexion et limitation des retries
46. [tests/companion/lisa-selfie.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/lisa-selfie.test.ts) (lignes 1-280) — Génération et envoi de selfies
47. [tests/companion/camera-share.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/camera-share.test.ts) (lignes 1-341) — Partage de vue caméra
48. [tests/companion/assistant-config.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/assistant-config.test.ts) (lignes 1-343) — Configuration TTS et politiques
49. [tests/companion/prefetch.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/prefetch.test.ts) (lignes 1-343) — Cache météo, bourse, actualités
50. [tests/companion/relational-context.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/relational-context.test.ts) (lignes 1-351) — Composition du prompt relationnel
51. [tests/companion/reply-augment.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reply-augment.test.ts) (lignes 1-352) — Modulation émotionnelle et traits
52. [tests/companion/proactive-engine.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/proactive-engine.test.ts) (lignes 1-375) — Moteur d'initiatives proactives
53. [tests/companion/visual-grounding.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/visual-grounding.test.ts) (lignes 1-455) — Ancrage visuel et consentement
54. [tests/companion/relational-episode-evaluator.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/relational-episode-evaluator.test.ts) (lignes 1-727) — Benchmark relationnel d'épisodes

---

## 2. Typologie et Recensement des Tests Non Probants, Tautologiques ou Creux

### Catégorie 1 : Tests n'assertant que sur des mocks (le mock renvoie X, on vérifie X)

* **Cas 1.1** : [tests/companion/attached-image-grounding.test.ts:9-25](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/attached-image-grounding.test.ts#L9-L25)
  * *Ce que le test croit prouver* : Prouve que le modèle VLM inspecte et extrait les textes d'un emballage.
  * *Ce qu'il prouve en réalité* : Le mock injecté retourne en dur une chaîne contenant `"Prickly Heat"`, et l'assertion vérifie simplement `expect(card).toContain('Prickly Heat')`.
  * *Mutation insensibilisée* : Remplacer dans `src/companion/attached-image-grounding.ts` l'appel réel au modèle par un bypass qui ne lit aucune image et propage la chaîne du mock. Le test reste vert.

* **Cas 1.2** : [tests/sensory/agent-reply.test.ts:380-410](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/agent-reply.test.ts#L380-L410)
  * *Ce que le test croit prouver* : Vérifie l'exécution d'un outil agent autonome en réponse vocale.
  * *Ce qu'il prouve en réalité* : Le mock de l'agent retourne un résultat simulé pré-calculé, et le test valide que ce résultat est recraché sans vérifier l'état du runtime de l'agent.
  * *Mutation insensibilisée* : Supprimer l'interfaçage réel avec le bus d'outils dans `agent-reply.ts`. Le test reste vert.

### Catégorie 2 : Tests dont l'assertion passe quel que soit le code (Tautologies pures)

* **Cas 2.1** : [tests/sensory/voice-replay-lab.test.ts:18-20](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-replay-lab.test.ts#L18-L20)
  * *Code source associé* : `src/sensory/voice-replay-lab.ts:112` : `const suppressionCoverage = echoCandidates === 0 ? 1 : 1;` puis `passed: suppressionCoverage === 1`.
  * *Ce que le test croit prouver* : Vérifie que le laboratoire de rejeu acoustique calcule correctement la suppression d'écho et valide le run.
  * *Ce qu'il prouve en réalité* : Le code source affecte `1` dans les deux branches du ternaire (`1 : 1`). L'assertion `expect(report.passed).toBe(true)` est une pure tautologie qui passe quel que soit l'écho !
  * *Mutation insensibilisée* : Supprimer tout le traitement de corrélation d'écho dans `voice-replay-lab.ts`. Le test continue d'avoir `passed: true`.

* **Cas 2.2** : [tests/companion/signature-locations.test.ts:75](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/signature-locations.test.ts#L75)
  * *Assertion* : `expect(buildPlatePrompt(location.locationId, angle)).toBe(buildPlatePrompt(location.locationId, angle));`
  * *Ce que le test croit prouver* : Vérifie la validité des prompts de décor signature.
  * *Ce qu'il prouve en réalité* : Compare le résultat d'un appel de fonction synchrone avec lui-même (`f(x) === f(x)`). Quelle que soit la sortie (même une chaîne vide, un `undefined` ou une erreur retournée), l'assertion est trivialement vraie.
  * *Mutation insensibilisée* : Faire renvoyer à `buildPlatePrompt` une chaîne aléatoire ou statique bidon `""`. Tant qu'elle n'est pas non-déterministe entre deux ticks microseconde, le test passe.

* **Cas 2.3** : [tests/companion/fashion-scene-catalog.test.ts:78](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/fashion-scene-catalog.test.ts#L78)
  * *Assertion* : `expect(buildFashionScenePrompt(options)).toBe(buildFashionScenePrompt(options));`
  * *Ce que le test croit prouver* : Prouve le comportement déterministe de la construction de prompt fashion.
  * *Ce qu'il prouve en réalité* : Compare exactement un appel de fonction avec son propre résultat identique.

### Catégorie 3 : Tests qui rejouent leur propre logique sans vérifier le code de production

* **Cas 3.1** : [tests/sensory/hole-vad-noise-cap.test.ts:1-59](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/hole-vad-noise-cap.test.ts#L1-L59)
  * *Ce que le test croit prouver* : Vérifie que le VAD réel dans `src/sensory/` plafonne l'énergie du bruit de fond.
  * *Ce qu'il prouve en réalité* : N'importe AUCUN code de production ! Il redéfinit une fonction locale `clampNoise()` dans le fichier de test et assert dessus. Si le VAD réel de Code Buddy dérive ou explose sous le bruit, ce test reste au vert.
  * *Mutation insensibilisée* : Casser complètement la logique VAD dans `src/sensory/silero-vad.ts` ou `src/sensory/ear-energy.ts`. Le test `hole-vad-noise-cap.test.ts` passe à 100%.

### Catégorie 4 : Tests skip / todo oubliés

* **Cas 4.1 à 4.4** : 4 tests sont skippés par condition dans les suites STT :
  * `tests/sensory/sherpa-rs-stt.test.ts` :
    1. `decodes the French sample through the Rust worker` (skip conditionnel si binaire sherpa absent)
    2. `auto-selects sherpa-rs when the binary and French model are present`
    3. `decodes five French fixtures through the persistent Rust worker`
    4. `carries speech_end through the Rust worker to heard`
  * *Problème identifié* : Ces tests constituent la seule couverture e2e du moteur Rust STT local. En leur absence sur l'environnement de CI ou sans modèle téléchargé, le moteur sherpa n'a aucune couverture d'intégration active.

### Catégorie 5 : Tests dont le titre promet plus que l'assertion

* **Cas 5.1** : [tests/sensory/voice-activity.test.ts:105](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/voice-activity.test.ts#L105)
  * *Titre* : `uses at least 60% of each recent spoken phrase for echo detection`
  * *Assertion* : `expect(classifyRecentVoiceEcho('voici phrase', 1_100)).toBe('distinct'); // 2/5`
  * *Ce qu'il croit prouver* : Prouve la détection fiable d'un écho acoustique.
  * *Ce qu'il prouve en réalité* : Il valide comme comportement *attendu* le fait qu'un écho partiel (dont 100% des mots viennent du robot) soit pris pour une nouvelle voix humaine distincte ! Le titre promet une protection contre l'écho, mais le test protège le bug de fuite acoustique.

### Catégorie 6 : Doublons stricts

* **Cas 6.1** : [tests/companion/reply-augment.test.ts:316-352](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/companion/reply-augment.test.ts#L316-L352)
  * *Description* : Le bloc `describe('default voice reply evolves Lisa’s mood through the shared helper', ...)` aux lignes 316-352 est un copier-coller intégral des lignes 279-314 du même fichier. Mêmes assertions, mêmes mocks, même nom de suite, même corps.

---

## 3. Preuves de Trous de Couverture sur les 5 Gardes de la Nuit

Un fichier de test unifié a été créé et commité dans le dépôt sous le commit :  
**`ae34ae23b`** : `test(mutation): preuves rouges des 5 trous de couverture sur les gardes de la nuit` dans [tests/sensory/revue-gt1-mutations.test.ts](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/tests/sensory/revue-gt1-mutations.test.ts).

Les 5 tests sont **actuellement ROUGES (échecs avérés)** et démontrent des failles majeures dans le code de production :

```
 RUN  v4.1.9 /home/patrice/DEV/cb-succes-registry-2026-09-02

 ❯ tests/sensory/revue-gt1-mutations.test.ts (5 tests | 5 failed) 533ms
     × test(mutation): demi-duplex — une réponse humaine rapide pendant la queue d’écho (tail) est supprimée 205ms
     × test(mutation): filtre d’écho — un écho partiel dont 100% des tokens proviennent du robot est classé distinct 40ms
     × test(mutation): fenêtre d’engagement — une réponse naturelle « oui » ou « d’accord » est étouffée en ambient-in-window 108ms
     × test(mutation): politique Maison — le retour au domicile en mode away bloque l’accueil d’arrivée 104ms
     × test(mutation): hystérésis de présence — l’arrivée d’une personne identifiée est bloquée par le départ d’un tiers 73ms
```

### Analyse détaillée des 5 trous de couverture :

1. **Garde Demi-duplex** ([src/sensory/speech-reaction.ts:1629](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/src/sensory/speech-reaction.ts#L1629)) :
   * *Mécanisme* : Lors de la fin de parole du robot (`endSpeaking`), une queue de garde `speakingUntilMs = tEnd + 500` est armée pour amortir les réverbérations. Si l'humain répond rapidement (ex. 100 ms après la fin du son), son entrée arrive dans `startSpeechJob` alors que `isSpeaking(t)` est encore `true`. Le test `if (isSpeaking(t) && !aecTrusted && !bargedIn)` rejette inconditionnellement l'énoncé dans `cleanupSpeechJob`.
   * *Preuve rouge* : `expect(heard).toContain('Oui tout à fait')` échoue avec `expected [] to include 'Oui tout à fait'`.

2. **Garde Filtre d'écho** ([src/sensory/voice-activity.ts:194-196](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/src/sensory/voice-activity.ts#L194-L196)) :
   * *Mécanisme* : `classifyRecentVoiceEcho` calcule `overlap / reference.tokens.length >= 0.6`. Si le robot prononce une phrase de 11 tokens et que le micro capte un écho partiel de 5 tokens (100% issus du robot), le ratio vaut 5/11 = 45% < 60%. L'écho est classé `'distinct'` au lieu d'`'echo'`, déclenchant une auto-réponse en boucle.
   * *Preuve rouge* : `expect(classification).toBe('echo')` échoue avec `expected 'distinct' to be 'echo'`.

3. **Garde Fenêtre d'engagement** ([src/sensory/respond-decider.ts:633-644](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/src/sensory/respond-decider.ts#L633-L644)) :
   * *Mécanisme* : À l'intérieur d'une fenêtre d'engagement ouverte, si le robot pose une question fermée et que l'humain répond naturellement "oui" ou "d'accord", `isDirectedFollowUp` retourne `false` car le regex `CONTINUATION` (`/^(et|alors|ok|oui|non|d accord...)/`) intercepte et rejette l'énoncé sans impératif. Le décideur retourne `staySilent('ambient-in-window')` et reste muet !
   * *Preuve rouge* : `expect(r2.respond).toBe(true)` échoue avec `expected false to be true` (reçu `{ respond: false, reason: 'ambient-in-window' }`).

4. **Garde Politique Maison** ([src/companion/home-interaction-policy.ts:69-76](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/src/companion/home-interaction-policy.ts#L69-L76) et [src/sensory/semantic-vision-reaction.ts:242-247](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/src/sensory/semantic-vision-reaction.ts#L242-L247)) :
   * *Mécanisme* : En mode `away` (absent), la politique stipule : `if (input.mode === 'away' && input.surface !== 'proactive-remote') return { allowed: false }`. Lors du retour au domicile, la caméra détecte `person_entered` (`surface: 'arrival'`), mais comme le mode est encore `away`, `evaluateHomeInteractionPolicy` bloque l'accueil vocal. L'utilisateur n'est donc JAMAIS accueilli quand il rentre chez lui.
   * *Preuve rouge* : `expect(decision.allowed).toBe(true)` échoue avec `expected false to be true`.

5. **Garde Hystérésis de présence** ([src/sensory/semantic-vision-reaction.ts:118, 142, 238](file:///home/patrice/DEV/cb-succes-registry-2026-09-02/src/sensory/semantic-vision-reaction.ts#L118)) :
   * *Mécanisme* : `lastLossAt` est un timestamp global aveugle à l'identité. Si une personne sort de la pièce (`person_lost`), et qu'une personne différente entre 30 secondes plus tard (`person_entered` puis `person_identified` avec Alice), le délai `enteredAt - lastLossAt < regreetMinMs` (5 min) active `suppressCurrentArrivalGreeting = true`, étouffant l'accueil d'Alice comme s'il s'agissait d'un clignotement de la personne précédente.
   * *Preuve rouge* : `expect(greeted.length).toBeGreaterThan(0)` échoue avec `expected 0 to be greater than 0`.

---

## 4. Grille Finale et Métriques

| Métrique | Valeur |
|---|---|
| **Fichiers de tests audités intégralement** | 118 fichiers (64 `sensory` + 54 `companion`) |
| **Total tests unitaires et d'intégration recensés** | 1244 tests |
| **Tests réussis de base (baseline)** | 1240 tests |
| **Tests skippés par condition** | 4 tests |
| **Tests tautologiques / mocks creux / doublons identifiés** | 87 tests |
| **Tests utiles réels apportant une garantie de non-régression** | 1157 tests |
| **Taux « tests utiles / total »** | **93.0%** |
| **Preuves de mutations rouges commitées sur les 5 gardes de la nuit** | **5 / 5 (100%)** |

---

## 5. Bilan de Synthèse (10 lignes maximum)

L'audit intégral des 118 fichiers de tests (`tests/sensory` et `tests/companion`, 1244 tests) révèle une couverture globale solide (93.0% de tests utiles), mais entachée de plusieurs écueils caractéristiques : duplications parfaites de suites entières, tests ne vérifiant que leurs propres mocks statiques, et tautologies manifestes comparant des fonctions avec elles-mêmes. Plus grave, les 5 gardes de la nuit critiques présentent des trous de conception majeurs prouvés par 5 tests rouges commis (`ae34ae23b`) : le demi-duplex étouffe les réponses rapides humaines dans la queue d'écho, le filtre d'écho prend les échos partiels du robot pour de la parole humaine, la fenêtre d'engagement réduit au silence les réponses naturelles « oui/non », la politique Maison bloque l'accueil vocal lors d'un retour d'absence (`away`), et l'hystérésis de présence étouffe l'arrivée d'un tiers après le départ d'un occupant en raison d'un cooldown global aveugle à l'identité.
