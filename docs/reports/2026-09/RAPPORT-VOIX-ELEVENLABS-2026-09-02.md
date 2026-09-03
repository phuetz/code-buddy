# Rapport — Flux natif ElevenLabs pour la voix de Lisa (2026-09-02)

Branche `elevenlabs-stream`, commits `64d87a96e` (primitives de flux) et `c36c76fb9` (branchement voice-loop).

## 1. Ce qui a été mesuré

### Avant (journaux production, `buddy-vision-brain`, 3 derniers jours)

```
[voice] streamed 14 phrase(s) in 63140ms
[voice] stream latency: text=10122ms segment=10434ms firstAudio=11000ms contentAudio=11001ms fallbackSegments=0
[voice] phase latency: prompt=29ms providerDelta=10122ms generation=19557ms
```

Autres tours du même profil : 15 phrases / 65,4 s (text=4,6 s), 10 phrases / 48,5 s (text=10,0 s),
8 phrases / 43,5 s (text=9,9 s, fallbackSegments=5), 15 phrases / 70,8 s (fallbackSegments=14 —
flux natif Pocket perdu, tout le tour en repli WAV bloquant).

### Le chemin ElevenLabs, mesuré en réel (un essai, 54 caractères × 2, comptés au plafond)

| Chemin | Premier octet jouable | Clip complet |
| --- | --- | --- |
| Bloquant (`arrayBuffer`, chemin actuel) | **1 875 ms** | 1 875 ms (2,97 s d'audio) |
| Flux natif `/stream` (ce travail) | **152 ms** | 222 ms (2,88 s d'audio) |

**Gain : ~1,7 s de silence évité par phrase fraîche** (× le nombre de phrases d'un tour quand la
file de synthèse est le goulot). Le corps complet arrive en 222 ms : le lecteur n'attend plus
jamais la synthèse en cours de phrase.

Le compteur réel a été correctement débité par le flux : `~/.codebuddy/elevenlabs-voice-usage.json`
est passé à `{"month":"2026-09","characters":108}` (54 × 2) — même comptabilité que le bloquant.

### Validation structurelle

- L'en-tête WAV de flux (tailles RIFF/data à `0xFFFFFFFF`, longueur inconnue) est décodé par un
  vrai ffmpeg en pipe : `pcm_s16le, 24000 Hz, mono`. C'est la forme exacte que
  `Pcm16WavStreamEdges` impose déjà aux flux Pocket en production (il réécrit `data` à
  `0xFFFFFFFF`) — donc ce que `aplay -q -` reçoit chaque jour sur le robot.
- Rouge → vert : les 16 nouveaux tests (10 `tests/voice/elevenlabs-stream.test.ts` +
  6 `tests/sensory/elevenlabs-stream-speak.test.ts`) donnent **15 échecs / 1 passe** sur l'ancien
  code (stash des 4 fichiers src), **16 passes** après. Suites complètes `tests/voice/` +
  `tests/sensory/` : 622 tests verts (les 16 nouveaux inclus), 1 skip. `tsc --noEmit` et ESLint propres.

## 2. Le diagnostic, corrigé franchement

La localisation du défaut dans le code est **exacte** : `makeDefaultStreamSpeak` refusait tout
moteur autre que `pocket`/`voicebox`, donc le moteur `elevenlabs` retombait sur le couple
bloquant — 1,9 s de synthèse muette par phrase fraîche, mesurés ci-dessus.

Mais deux faits des journaux doivent être dits :

1. **La machine qui « hache » en direct ne parle pas en ElevenLabs aujourd'hui.** L'environnement
   du service (`/proc/<pid>/environ`) porte `CODEBUDDY_TTS_ENGINE=pocket`, un
   `CODEBUDDY_TTS_VOICE` pointant un modèle Piper, et **aucune clé ElevenLabs**. Le « magnifique
   sur Telegram » vient des notes vocales (hors temps réel) et des 6 400 phrases payées de la
   bibliothèque ; le direct haché est du Pocket/estelle. Pour entendre l'effet de ce travail en
   direct, il faudra donner au service `CODEBUDDY_TTS_VOICE=elevenlabs:<voice_id>` + la clé
   (je n'ai pas touché la production).
2. **La latence LLM domine le début de tour et une partie des trous.** Sur le tour de référence :
   10,1 s avant le premier token, 19,6 s de génération totale, pour 63,1 s de tour. Aucun moteur
   TTS ne comble un LLM qui produit ses phrases plus lentement que la lecture — le tour à
   `fallbackSegments=0` (flux Pocket sain de bout en bout) a quand même duré 63 s. Le flux
   ElevenLabs supprime la part TTS des trous (~1,9 s → ~0,15 s par phrase fraîche) ; la part LLM
   (voie `gpt-5.5` des tours « grounded ») reste le premier chantier de fluidité suivant.

## 3. Comment le coût est traité (explicitement)

- **Avant le réseau** : pour chaque phrase, la bibliothèque payée puis le cache TTS sont
  consultés ; un hit joue le fichier local et **n'ouvre jamais le flux facturé** (prouvé par
  test : `openElevenLabsAudioStream` non appelé sur hit).
- **Le budget** : le flux passe par la même réservation/commit/release que le bloquant
  (`reserveBudget` → commit sur HTTP 200, release sur échec ; plafond/clé absente/compteur
  occupé ⇒ pas de requête, repli local). Commit à l'acceptation de la requête, car ElevenLabs
  facture au démarrage de la génération — un barge-in en cours de corps est donc compté, ce qui
  est la réalité de la facture amont.
- **Après le flux** : le PCM complet est réécrit dans le cache TTS sous la même identité vocale
  que le chemin bloquant (`resolveElevenLabsCacheVoice`), conteneur + normalisation fichier —
  **une phrase répétée est gratuite**, comme avant. Un flux tronqué (barge-in, erreur, corps
  surdimensionné) n'est **jamais** mis en cache (prouvé par test).

## 4. Ce qui reste fragile / à confirmer

- **Pas encore entendu en vrai.** La chaîne complète micro→oreilles n'a pas tourné avec le moteur
  elevenlabs actif (production intouchée). Le premier essai réel chez Patrice est la vraie
  validation ; l'opt-out `CODEBUDDY_ELEVENLABS_AUDIO_STREAM=false` ramène instantanément au
  comportement actuel.
- **Route LLM distante ⇒ flux ignoré** : règle anti-gigue existante (`audioPrebufferMs > 0`
  bascule sur le tampon WAV). Sur la voie loopback actuelle (proxy 127.0.0.1) le flux est bien
  utilisé ; si la voix passait un jour par une URL distante, le flux serait contourné — hérité de
  Pocket, non introduit ici.
- **Gain sonore** : le direct applique le gain progressif (tête ~400 ms) ; la copie cache est
  re-normalisée sur le fichier complet. Un écart de volume subtil entre première écoute et
  répétition est possible (même famille d'écart que Pocket flux vs cache aujourd'hui).
- **Corps qui cale après les en-têtes** : borné seulement par le tueur du lecteur (60 s,
  `CODEBUDDY_VOICE_PLAY_TIMEOUT_MS`) ; l'en-tête, lui, est borné à 6 s.
- **Compteur d'août à 221 603 > plafond 200 000** : soit un plafond relevé ponctuellement, soit
  un chemin de dépense qui ne passe pas par ce compteur. À éclaircir un jour de comptes.
- **ffmpeg strict** signale un dernier paquet « corrupt » sur l'en-tête de longueur inconnue
  (tout est décodé ; `aplay` lit jusqu'à EOF et la production fait déjà exactement cela). Un
  futur lecteur strict sur la taille `data` pourrait tronquer une fin de phrase.
