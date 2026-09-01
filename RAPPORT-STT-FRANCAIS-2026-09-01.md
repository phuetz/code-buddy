# Rapport — STT français de Lisa — 1er septembre 2026

## Verdict

Le moteur qui transcrivait réellement le microphone avant correction était **le binaire Rust
`buddy-sense`, via `sherpa-rs`/sherpa-onnx et le modèle NVIDIA Parakeet TDT 0.6B v3 int8**.
Ce n'était ni le worker Python `parakeet` de `speech-reaction.ts`, ni
`faster-whisper`.

`CODEBUDDY_SPEECH_LANG=fr`, `CODEBUDDY_SPEECH_MODEL=small` et les hotwords étaient bien
présents dans l'environnement du processus, mais l'ancien chemin `live-audio` ne les lisait pas.
Il chargeait directement le modèle Parakeet installé, le laissait auto-détecter la langue, puis
envoyait un événement `audio/transcript_final` déjà décodé. Le cerveau recopiait ce texte sans
effectuer de STT : c'est l'explication exacte de `0ms STT`.

Après correction, la configuration vivante `parakeet + langue fr + fallback=true` est résolue
explicitement ainsi :

```text
requested=parakeet
effective=faster-whisper
language=fr
model=small
hotwords=applied
reason=parakeet-language-pin-unsupported
```

Le micro reste segmenté par `buddy-sense`, mais celui-ci délègue désormais chaque segment sous
forme de WAV transitoire au chemin TypeScript/faster-whisper qui sait réellement transmettre
`language=fr` et `hotwords=...`. Le changement de moteur est journalisé bruyamment. Si le repli
est interdit, le chemin échoue fermé et le dit au lieu de produire un faux succès dans une autre
langue.

Je n'ai **pas modifié** `/home/patrice/.codebuddy/vision.env`.

## Preuve du moteur réellement exécuté avant correction

### Trace du processus résident

Le service user `buddy-sense.service` exécutait bien :

```text
/home/patrice/code-buddy/buddy-sense/target/release/buddy-sense
```

Sa trace de démarrage, antérieure à la correction :

```text
2026-08-28T13:52:53+02:00 buddy-sense[284562]:
[buddy-sense] live-audio: recognizer ready
(/home/patrice/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8)
```

La chaîne effective était donc :

```text
micro Pulse/echo-cancel-source
  → buddy-sense live_audio.rs
  → Stt::transcribe_pcm (sherpa-rs / sherpa-onnx / Parakeet TDT)
  → audio/transcript_final { text, decodeMs }
  → speech-reaction.ts, presetText
  → aucun décodage dans Node
```

Ce résultat est une trace d'exécution, pas une déduction tirée du seul code.

### Pourquoi le journal disait `0ms STT`

Le percept persistant contient à la fois l'ancien compteur trompeur et le vrai temps envoyé par
Rust. Exemples capturés juste avant le redémarrage :

```json
{"summary":"Heard: It's","latency":{"sttMs":0,"decodeMs":72}}
{"summary":"Heard: But","latency":{"sttMs":0,"decodeMs":50}}
{"summary":"Heard: Yeah.","latency":{"sttMs":0,"decodeMs":52}}
{"summary":"Heard: I'm not","latency":{"sttMs":0,"decodeMs":107}}
{"summary":"Heard: Stop.","latency":{"sttMs":0,"decodeMs":127}}
```

`sttMs` ne chronométrait que la copie du `presetText` par Node. `decodeMs` était le vrai
chronométrage du décodeur Rust. Le correctif reprend maintenant `decodeMs` comme temps STT pour
un `transcript_final` et conserve séparément le coût d'ingestion.

## Où `fr`, `small` et les hotwords se perdaient

- `fr` arrivait jusqu'à l'environnement de `buddy-sense`, mais l'ancien `live_audio.rs` ne
  consultait pas `CODEBUDDY_SPEECH_LANG`. L'API transducer utilisée par sherpa-rs n'expose pas de
  langue à fixer pour cet appel. Le modèle faisait donc sa détection automatique.
- `small` désigne le modèle faster-whisper. L'ancien chemin live chargeait à la place le
  répertoire Parakeet fixe ; cette valeur n'avait aucun consommateur sur ce chemin.
- `CODEBUDDY_SPEECH_HOTWORDS_FILE` et `CODEBUDDY_ROBOT_NAME` arrivaient eux aussi dans
  l'environnement, mais aucun hotword n'était passé au décodeur Rust. Le fichier contenant
  `Lisa` ne pouvait donc avoir aucun effet.
- Le repli faster-whisper de `speech-reaction.ts` n'était jamais atteint : du point de vue de
  Node, Rust avait déjà renvoyé un transcript final avec succès, même lorsqu'il ressemblait à de
  l'anglais.

Parakeet TDT 0.6B v3 n'est pas « anglais seulement » : sa fiche NVIDIA actuelle annonce le
français parmi 25 langues et une détection automatique. Le défaut n'est donc pas une incapacité
intrinsèque du modèle, mais l'impossibilité de faire respecter le pin `fr` et les hotwords sur le
binding exécuté. Un WAV Piper très propre était d'ailleurs déjà bien reconnu par Parakeet ; les
échecs réels concernaient la voix/micro du soir. Source primaire :
[NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3).

## Harnais de reproduction

Le harnais ajouté est `scripts/reproduce-stt-francais.ts`. Il prend un WAV et appelle
`transcribeWav`, la même fonction que le chemin batch du robot, en affichant le plan effectif,
la langue, le modèle, les hotwords et le temps réel.

Le WAV parlé a été généré dans le dépôt, sans utiliser le WAV chanté :

```bash
printf 'Lisa, tu m’entends ?' \
  | /usr/local/bin/piper \
      --model /home/patrice/DEV/lisa/voices/fr_FR-siwis-medium.onnx \
      --output_file tmp/stt-francais-2026-09-01/lisa-tu-mentends.wav
```

Exécution après correction, avec les mêmes fichiers d'environnement que le service :

```bash
node --env-file=.env \
  --env-file=/home/patrice/.codebuddy/vision.env \
  --import tsx scripts/reproduce-stt-francais.ts \
  tmp/stt-francais-2026-09-01/lisa-tu-mentends.wav
```

Sortie :

```text
{"phase":"stt-plan","requestedEngine":"parakeet","effectiveEngine":"faster-whisper","model":"small","language":"fr","languagePinned":true,"fallbackEnabled":true,"fallbackReason":"parakeet-language-pin-unsupported","blockingReason":null,"hotwords":["Lisa",...,"Parakeet"]}
[speech] STT fallback activated: requested=parakeet effective=faster-whisper language=fr reason=parakeet-language-pin-unsupported hotwords=12
{"phase":"stt-result","effectiveEngine":"faster-whisper","language":"fr","hotwordCount":12,"decodeMs":1839,"transcript":"Lisa, tu m'entends ?"}
```

Cette preuve montre la propagation des hotwords jusqu'aux options du worker ; elle ne prétend pas
que le seul mot `Lisa` a causé la réussite de ce WAV synthétique.

## Rouge → vert

### STT : rouge avant correction

Le test a d'abord exigé qu'un pin français configuré sur Parakeet soit routé vers le worker qui
sait le respecter, et que `fr` et `Lisa` apparaissent dans ses arguments. Sur le code initial :

```text
FAIL tests/sensory/speech-reaction-workers.test.ts
  × routes an explicit French pin away from auto-detect-only Parakeet and propagates hotwords

AssertionError: expected worker script to contain faster_whisper
Received: import sherpa_onnx ... OfflineRecognizer.from_transducer(...)

Test Files  1 failed (1)
Tests       1 failed | 4 passed (5)
```

Le libellé initial du test a été rectifié après vérification de la fiche NVIDIA : Parakeet est
multilingue ; c'est le pin explicite qui n'est pas supporté par ce binding. Le contenu technique
du test rouge n'a pas changé.

### STT : vert après correction

```text
Test Files  1 passed (1)
Tests       5 passed (5)
```

Des tests complémentaires couvrent le plan de routage, le refus fermé sans fallback et la
correction du `0ms` :

```text
Test Files  6 passed (6)
Tests       101 passed (101)
```

### Affirmation Telegram : rouge puis vert

Un second test reproduit exactement la question courte :

```text
request = "Il t'as transmis Lisa tu m'entends ?"
expected semantic review = true
received = false

Test Files  1 failed (1)
Tests       1 failed | 9 passed (10)
```

Après correction :

```text
Test Files  1 passed (1)
Tests       10 passed (10)
```

Le test d'intégration Telegram vérifie aussi que cette question atteint
`reviewSemanticResponse` avec le profil `factual_analytical`, et qu'une affirmation non étayée
est remplacée avant livraison.

## Vérification en conditions réelles

J'ai construit `dist/` et le binaire Rust release, puis redémarré les deux services nécessaires :

```text
buddy-vision-brain.service  active — PID 195635 — 21:43:03 CEST
buddy-sense.service         active — PID 180578 — 21:35:51 CEST
```

Trace de démarrage du vrai producteur audio :

```text
[buddy-sense] live-audio: STT fallback activated requested=parakeet
effective=faster-whisper language=fr
reason=parakeet-language-pin-unsupported hotwords=true transport=speech_end-wav
[buddy-sense] live-audio: listening (pulse:echo-cancel-source, aec:active)
[buddy-sense] bridge connected → ws://127.0.0.1:8129
```

J'ai ensuite injecté le WAV Piper dans le bridge sensoriel réel sur le même événement
`audio/speech_end` que produit désormais `buddy-sense`. Cette méthode teste le service résident,
le worker, le gate d'adresse et la réponse sans dépendre d'une lecture acoustique que l'AEC
pourrait annuler.

Journal du cerveau :

```text
2026-09-01T21:43:24.632+02:00 WARN
[speech] STT fallback activated: requested=parakeet effective=faster-whisper
language=fr reason=parakeet-language-pin-unsupported hotwords=12

2026-09-01T21:43:26.550+02:00 INFO
[speech] heard (1917ms STT, engine=faster-whisper, model=small,
language=fr, hotwords=applied) → Lisa, tu m'entends ?

2026-09-01T21:43:26.553+02:00 INFO
[speech] responding (addressed, decision 3ms)
```

Le percept relu et déchiffré par le code du dépôt confirme :

```json
{
  "summary": "Heard: Lisa, tu m'entends ?",
  "responded": true,
  "stt": {
    "requestedEngine": "parakeet",
    "engine": "faster-whisper",
    "model": "small",
    "language": "fr",
    "hotwords": "applied",
    "fallbackReason": "parakeet-language-pin-unsupported"
  },
  "latency": { "sttMs": 1917, "decisionMs": 3, "actionMs": 2331 }
}
```

## Deuxième défaut : pourquoi Lisa a confirmé une fiction

### Cause prouvée

Ce n'est pas une consigne explicite de complaisance dans les trois fichiers suspects :

- le prompt vivant `/home/patrice/.codebuddy/bot-cwd/.codebuddy/SOUL.md` dit déjà « Be honest,
  always » et « love does not lie » ;
- le prompt du dépôt préfère les preuves live et interdit de bluffer l'architecture ;
- `reply-augment.ts` module l'émotion, le ton et les ouvertures, pas les faits ;
- `relational-context.ts` injecte un épisode récent, mais n'a pas produit la première réponse
  fausse.

La faille se trouve dans **l'éligibilité du garde sémantique**. Les événements réels montrent :

```text
21:05:43 phase=review
21:06:04 outcome=revised issueCodes=[unsupported_claim,ungrounded_fresh_claim]

21:06:36 question courte → generation → delivery (aucune phase review)
21:07:12 question courte → generation → delivery (aucune phase review)
21:07:51 « Il t'as transmis... ? » → generation → delivery (aucune phase review)
```

Le planificateur classait la dernière question `act=question`, `depth=standard`, avec la seule
obligation `answer_question`; `shouldRunSemanticResponseGate` rendait `false`. Le modèle a donc
repris la prémisse de Patrice comme un fait et la réponse a été livrée sans le garde qui avait
correctement arrêté l'affirmation non étayée deux minutes plus tôt.

Après livraison, le journal épisodique a persisté cette phrase comme « Dernière position de
Lisa », puis `relational-context.ts` l'a rendue réinjectable via `<recent_episode>`. Ce mécanisme
n'est pas la cause initiale, mais il amplifie l'erreur en mémoire.

### Correctif

Les questions courtes qui demandent à Lisa de confirmer un événement observable du système
(`transmis`, `reçu`, `entendu`, `capturé`, et équivalents anglais) sont maintenant classées comme
vérifications d'évidence runtime. Elles :

- déclenchent le profil sémantique `factual_analytical`, même à profondeur `standard` ;
- exigent `source_fresh_facts` et `express_uncertainty` en plus de répondre à la question ;
- passent par le garde avant livraison et persistence Telegram.

Je n'ai pas durci au hasard la personnalité de Lisa : la correction porte sur la porte logique
qui avait sauté le contrôle.

`lisa-telegram.service` a été reconstruit puis redémarré ; il est actif (PID 195636) depuis
21:43:03 CEST.

## Vérifications finales

```text
npm test -- <8 fichiers STT/conversation/Telegram ciblés>  148/148 passed
npm run typecheck                                 passed
npm run build                                     passed
npx eslint <fichiers modifiés ciblés>             passed
cargo fmt --check                                 passed
cargo test --features live-audio                  56/56 passed
cargo build --release --features live-audio       passed
git diff --check                                  passed
```

Le test Rust a aussi réellement décodé son échantillon français embarqué :

```text
decoded: Ne vous demandez pas ce que votre pays peut faire pour vous.
Demandez-vous plutôt ce que vous pouvez faire pour lui.
```

## Limites et éléments non modifiés

- Le WAV de vérification est une voix Piper propre. Les traces réelles du soir prouvent les
  sorties anglaises et les vrais `decodeMs`, mais aucun WAV humain correspondant à « Is it… »
  n'était conservé pour faire un A/B bit-à-bit.
- Je n'ai pas envoyé un faux message de test à Patrice sur Telegram. La correction Telegram est
  prouvée par le rouge/vert, le test d'intégration du handler et le redémarrage du service, sans
  provoquer de message externe non sollicité.
- La vieille entrée externe `episode:recent` contenant la fausse affirmation existe encore dans
  la mémoire vivante. Je ne l'ai ni supprimée ni réécrite : cela aurait modifié des données hors
  dépôt. Le nouveau garde empêche que la même demande de confirmation soit livrée sans revue ;
  la purge éventuelle de cette entrée reste une action explicite à valider par Patrice.
- Aucun changement de configuration vivante n'est nécessaire et `vision.env` est resté intact.
