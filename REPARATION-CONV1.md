# Réparation CONV1 — conversation vocale

## Périmètre et contraintes

- Branche attendue : `feat/conversation-sol-2026-09-03`
- Base annoncée : `facea9864`
- Exécution déterministe uniquement : aucune lecture audio réelle, aucun rappel parlé, aucune API payante, aucun service système.
- Toutes les nouvelles fonctions restent opt-in par variable d’environnement ; le comportement sans opt-in doit rester inchangé.

## Journal des lectures

- `docs/FABLE5-CODEX-COORDINATION.md:1-274` — protocole et tableau de réservation ; aucune réservation concurrente CONV1 trouvée.
- `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/CONTEXTE-LISA.md:1-13` — chaîne et latences de référence.
- `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/RECH1-LITTERATURE-GEMINI.md:412-493` — section 8 et cinq mécanismes : projection de fin de tour, barge-in/AEC-VAD, backchannels, réparation communicative, TTS basse latence.
- `src/sensory/speech-reaction.ts:1-2181`, `src/sensory/respond-decider.ts:1-695`, `src/sensory/voice-loop.ts:1-3797` — chemin complet `speech_end/transcript_final → STT → gate → reply → speak`, garde demi-duplex, temporisation de tour et télémétrie du premier audio.
- `buddy-sense/src/senses/audio.rs:1-295`, `buddy-sense/src/senses/stt.rs:1-191`, `buddy-sense/src/senses/live_audio.rs:1-1780`, `buddy-sense/src/main.rs:1-284` — VAD énergie, endpoint mesuré, sherpa-rs en processus, partiel spéculatif et émission du final.
- `src/sensory/sensory-bridge.ts:1-176`, `src/sensory/voice-turn-taking.ts:1-42` — transport des percepts et heuristique textuelle antérieure.
- Tests lus en détail : `tests/sensory/speech-reaction.test.ts:1-1521`, `speech-reaction-workers.test.ts:1-207`, `sherpa-rs-stt.test.ts:1-77`, `speech-engine-config.test.ts:1-81`, `voice-turn-taking.test.ts:1-33`, `agent-reply.test.ts:1-610`, plus les sections backchannel/lecture de `voice-loop.test.ts`. Inventaire complet de `tests/sensory/` effectué, puis ses 50 fichiers exécutés ensemble.

État initial vérifié : branche `feat/conversation-sol-2026-09-03`, HEAD `facea9864`. Seuls `REPARATION-CONV1.md` et le `node_modules` non suivi préexistant apparaissaient avant la réservation ; ce dernier reste hors périmètre.

## Brique 1 — Fin de tour plus courte

- Variables : `BUDDY_SENSE_END_SILENCE_MS` (prioritaire), ancien `BUDDY_SENSE_MIC_ENDPOINT_MS` conservé en repli ; sans les deux, valeur mesurée inchangée de **420 ms**. `CODEBUDDY_SENSORY_TURN_HEURISTIC=true` active la cible sémantique : **350 ms** pour un tour fermé, **900 ms au total** pour un tour suspendu. Pour obtenir 350 ms physiquement, régler aussi l'endpoint Rust à 350 ; Node n'ajoute alors que les 550 ms restantes aux tours suspendus.
- ROUGE : `npx vitest run tests/sensory/voice-turn-taking.test.ts` → **2 échecs / 4 réussites**, fonction absente ; `cargo test --manifest-path buddy-sense/Cargo.toml --features live-audio end_silence_env_preserves` → **E0425**, résolveur absent.
- VERT : mêmes contrats → **52/52** tests TypeScript (avec l'intégration `speech-reaction`) et **1/1** Rust ; `cargo fmt --check` et ESLint ciblé exit 0.
- Commit : `da258bc17 feat(sensory): shorten conversational turn endpoint`.
- Mesure déployée restante : distribution réelle fin de voix→final→premier audio (p50/p95), taux d'interruptions sur hésitations françaises et comparaison 350/420 ms. Aucun micro ni haut-parleur n'a été utilisé ici.

## Brique 2 — Transcription en flux

- Variables : chemin explicitement opt-in par `CODEBUDDY_SPEECH_ENGINE=sherpa-rs` et binaire `buddy-sense` construit avec `live-audio`/`stt`; cadence existante `BUDDY_SENSE_MIC_PARTIAL_MS` (1 200 ms par défaut, `0` désactive). Les moteurs délégués gardent leur comportement historique ; `parakeet` garde un seul partiel.
- ROUGE : test de cadence Rust → **E0433**, `PartialTranscriptCadence` absent. Une première commande verte avec deux filtres Cargo a aussi échoué par syntaxe CLI (`unexpected argument`) ; elle a été remplacée par le filtre valide `partial`.
- VERT : sherpa-rs explicite redécode à chaque créneau, élimine les textes identiques et publie chaque partiel avec `stable=false`/`prewarmOnly=true`. Le test TypeScript envoie deux partiels divergents puis un final : deux préchauffages, zéro cognition avant le final, et `onHeard` reçoit uniquement le final. Rust `live-audio` **58/58** à ce stade ; TS ciblé **53 réussites, 1 skip**.
- Commit : `045996fab feat(sensory): stream sherpa transcript previews`.
- Mesure déployée restante : coût CPU et retard de pipe sur parole longue, gain réel de préchauffage route/contexte, déduplication linguistique et p95 final. Le banc prouve l'autorité exclusive du final, pas le gain matériel.

## Brique 3 — Backchannel

- Variable : `CODEBUDDY_SENSORY_BACKCHANNEL=true`. Sans elle, aucun ordonnanceur ni callback de premier audio n'est ajouté au contexte du tour.
- ROUGE : `conversation-cues.test.ts` ne trouvait pas le module ; `voice-loop.test.ts` obtenait `['play']` au lieu de `['response-ready','play']`.
- VERT : horloge/lecteur factices → départ déterministe à **120 ms** (< 200), requête de gain **−12 dB**, annulation à 50 ms si la réponse arrive d'abord, suppression du tour adressé suivant puis alternance `mhm`/`oui`. Le raccordement `speech-reaction → makeVoiceReply` et l'annulation au premier audio sont couverts. **143/143** tests ciblés au commit.
- Commits : `7fc218792 feat(sensory): add cancellable local backchannels`, puis médias partagés `14642a3b9 feat(sensory): cache local conversation cues`.
- Actifs : `assets/voice/conversation/{mhm,oui}.wav`, Pocket/Estelle local, PCM16 mono 24 kHz, 0,92 s chacun. Le test vérifie leur en-tête et la transformation d'amplitude −12 dB ; aucune lecture réelle.
- Mesure déployée restante : onset acoustique réel après `speech_end` (< 200 ms), niveau LUFS perçu à −12 dB, absence de chevauchement/AEC et préférence humaine entre les deux cues.

## Brique 4 — Réflexe de réparation

- Variable : `CODEBUDDY_SENSORY_REPAIR=true`. Seuil initial de confiance **0,55** ; un final vide, un final de deux mots ou moins, ou un final sous le seuil est réparable seulement après preuve d'adressage.
- ROUGE : **4 échecs** TypeScript (méthodes `playRepair`/`isAddressed` absentes et deux timeouts d'intégration), plus Rust **E0425** sur le garde d'émission des finals vides.
- VERT : cue immédiat, au plus une fois par `turnId`; final vide relié au dernier partiel adressé ou à une fenêtre d'attention issue d'un adressage ; son texte n'entre ni dans l'ingress sémantique ni dans `onHeard`. Le décideur expose une sonde d'adressage sans ouvrir la conversation et sans LLM. Tests de régression **187/187** ; Rust `live-audio` **59/59**.
- Commit : `5c4852f34 feat(sensory): repair uncertain addressed turns` ; actif partagé `14642a3b9`.
- Actif : `assets/voice/conversation/repair.wav`, Pocket/Estelle local, PCM16 mono 24 kHz, 2,20 s, phrase neutre **« Pardon, tu disais ? »** conformément au garde-fou d'absence de donnée personnelle.
- Mesure déployée restante : onset acoustique réel (< 300 ms), faux positifs sur commandes très courtes et calibration du seuil. Le wrapper sherpa-rs actuel ne fournit pas encore de score natif : le seuil s'applique aux producteurs qui propagent `confidence`; vide/court fonctionne déjà sans score.

## Vérifications finales

- `TMPDIR="$PWD/node_modules/.cache/conv1-tmp" npx vitest run tests/sensory/` → **50 fichiers, 592 réussites, 1 skip, 0 échec**.
- `cargo test --manifest-path buddy-sense/Cargo.toml --features live-audio` → **59/59** ; `cargo fmt --manifest-path buddy-sense/Cargo.toml -- --check` → exit 0.
- `npx tsc --noEmit -p .` → exit 0, aucune sortie.
- `npm run lint` → exit 0, **0 erreur**, 2 466 avertissements historiques ; ESLint ciblé des fichiers CONV1 → exit 0 sans sortie.
- `file`/`ffprobe` sur les trois actifs → `pcm_s16le`, mono, 24 kHz ; aucune écoute ou lecture par un backend audio.
- Aucun push, service, rappel, API payante ou écriture dans `/home/patrice/code-buddy`. Seul `node_modules` non suivi préexistant reste visible ; le cache Pocket reproductible de génération a été supprimé après création des trois WAV.
