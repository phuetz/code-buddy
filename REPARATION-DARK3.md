# Réparation DARK3

## Mission

Ajouter un fournisseur TTS local Kyutai, une politique vocale opt-in à deux vitesses et une banque de phrases précalculées, avec replis sûrs et tests sans réseau réel.

## État initial

- Rapport créé avant toute inspection du dépôt le 2026-09-03.
- Inspection, réservation du chantier, implémentation et vérifications à venir.

## Suivi

- Branche réservée : `feat/dark3-voix-deux-vitesses-2026-09-03`.
- Réservation coordination : commit `9719f57d0`.
- Fournisseur, routage, banque, CLI, documentation et tests : commit `ec6cdb99a`.
- Aucun appel API payant, aucun service démarré/arrêté, aucun push et aucune écriture exécutée
  dans `~/.codebuddy`.

## Réalisation

- `kyutai-local-voice.ts` implémente `GET /health` et `POST /tts` vers le serveur configuré par
  `CODEBUDDY_TTS_LOCAL_URL`. Le délai de 1 500 ms porte sur les en-têtes et le premier octet PCM;
  le corps reste interruptible sans tronquer arbitrairement une phrase longue.
- Les flux Kyutai PCM16 mono 24 kHz utilisent la même enveloppe WAV progressive et le même
  lecteur/tampon de gigue que le chemin ElevenLabs. Coupure ou délai : nouvelle tentative de la
  phrase inchangée sur ElevenLabs, puis Pocket.
- Les caches sont séparés par l'identité
  `local:kyutai:<n_q>:url=<endpoint>:format=pcm_s16le_mono_24000`; un repli cloud/local n'est
  jamais enregistré sous l'identité Kyutai.
- `CODEBUDDY_TTS_TWO_SPEED=true` active le routage par segment. Le défaut reste `false` et rend
  exactement le chemin historique. Seuil par défaut : 80 caractères; backchannels, accueil,
  rappel, « Pardon ? » et première phrase utile CONV3 sont forcés en local. Chaque décision émet
  `[voice] route=local|elevenlabs reason=…`.
- `buddy companion tts-bank build|list|verify [--provider local|elevenlabs]` lit
  `.codebuddy/tts-bank.txt`, les cues de préchauffage et les ouvertures d'arrivée. `verify` ne
  synthétise ni ne joue. Les dates, heures, nombres et placeholders dynamiques sont rejetés.

## Tests rouge → vert

- Rouge fournisseur/politique/banque : 3 suites absentes, puis vert : 3 fichiers, 23 tests.
- Rouge intégration CONV3 : première phrase sans hint (`undefined` au lieu de `conv3-first`), puis
  vert avec le routage propagé au flux natif et à son repli WAV.
- Serveurs HTTP factices uniquement : premier octet retardé, timeout après en-têtes, coupure
  mi-flux, HTTP en échec, repli ElevenLabs puis Pocket et égalité exacte du texte contrôlés.
- `vitest run tests/voice` : 17 fichiers, 179 tests passés.
- `vitest run tests/sensory` : 64 fichiers, 642 passés, 4 ignorés.
- Suites CLI/configuration/rappels voisines : 5 fichiers, 152 tests passés. Une première passe
  avait correctement échoué sur l'ancienne liste fermée des moteurs; son assertion a été mise à
  jour pour prouver que Pocket reste premier/défaut et que Kyutai est seulement proposé en opt-in.
- `npm run typecheck` : TypeScript principal et identité GPU passés.
- `npm run build` : compilation, 8 skills copiés et manifeste runtime généré, code 0.
- ESLint ciblé avec `--max-warnings=0`, `git diff --check` et les aides réelles
  `buddy companion tts-bank [verify] --help` : code 0.

## Configuration `vision.env`

```dotenv
CODEBUDDY_TTS_TWO_SPEED=true
CODEBUDDY_TTS_LOCAL_URL=http://100.73.222.64:8300
CODEBUDDY_TTS_LOCAL_TIMEOUT_MS=1500
CODEBUDDY_TTS_LOCAL_N_Q=12
CODEBUDDY_TTS_SHORT_MAX_CHARS=80
CODEBUDDY_TTS_VOICE=elevenlabs:3fxbs2pB9bs8S6Z1N38A
```

## Reste humain

- Patrice doit écouter la voix Kyutai et choisir `n_q=12` (premier PCM mesuré à 0,28 s) ou
  `n_q=24` (0,40 s, qualité potentiellement supérieure), puis reconstruire la banque si ce choix
  change puisque `n_q` fait partie de la clé.
- Darkstar et son serveur Kyutai doivent être allumés et joignables; sinon le repli fonctionne,
  mais le bénéfice de latence locale disparaît.
