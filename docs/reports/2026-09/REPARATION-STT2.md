# Réparation STT2 — transcript `sherpa-rs` vide

Rapport ouvert le 2026-09-04 avant toute inspection du dépôt, des journaux, de la configuration ou des artefacts du robot.

## Périmètre

- Reproduire le transcript vide de `sherpa-rs` sur un WAV réellement entendu par le démon.
- Identifier et corriger la cause dans le clone `~/DEV/cb-stt2-2026-09-04`.
- Rendre le repli vers faster-whisper précis et non répétitif.
- Vérifier le même WAV, les tests sensoriels, TypeScript et `git diff --check`.

## Contraintes

- Dépôt original `~/code-buddy`, configuration `~/.codebuddy/vision.env` et services systemd du robot en lecture seule.
- Aucun redémarrage de service, aucun push et aucune API payante.
- `HOME=~/DEV/cb-stt2-2026-09-04/_qa/stt2/home` pour les commandes qui nécessitent un HOME isolé.

## Diagnostic

### Configuration réellement observée, sans modification

`systemctl --user cat buddy-vision-brain.service` confirme que l'unité lit
`~/code-buddy/.env`, puis `~/.codebuddy/vision.env`. Le drop-in
`85-stt-engine.conf` contient encore une ligne historique
`CODEBUDDY_SPEECH_ENGINE=faster-whisper`, mais l'environnement des deux processus
actifs (`buddy-vision-brain` et `buddy-sense`) contient bien les valeurs suivantes.
Le processus et les journaux sont donc les autorités utilisées pour la reproduction :

```text
CODEBUDDY_SPEECH_ENGINE=sherpa-rs
CODEBUDDY_SPEECH_LANG=fr
CODEBUDDY_PARAKEET_MODEL_DIR=~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
CODEBUDDY_SPEECH_FALLBACK=true
CODEBUDDY_SPEECH_MODEL=small
CODEBUDDY_SPEECH_BEAM_SIZE=1
CODEBUDDY_SPEECH_PYTHON=~/miniforge3/bin/python3
CODEBUDDY_SPEECH_HOTWORDS_FILE=~/.codebuddy/speech-hotwords.txt
CODEBUDDY_SPEECH_WORKER_READY_TIMEOUT_MS=30000
CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS=20000
```

Le journal de démarrage de `buddy-sense` donnait déjà la cause structurelle :

```text
[buddy-sense] live-audio: STT fallback activated requested=sherpa-rs effective=faster-whisper language=fr reason=parakeet-language-pin-unsupported hotwords=true transport=speech_end-wav
```

### WAV réel du démon

Les WAV attachés aux avertissements de 05:38/05:40 avaient déjà été supprimés
par le nettoyage normal. Un `speech_end` encore conservé a fourni
`~/.codebuddy/companion/utt-1788498777318000248.wav`, copié uniquement dans
`~/DEV/cb-stt2-2026-09-04/_qa/stt2/audio/`. Son hash SHA-256 est
`0ff6bd579c5c6ba16256fa004b178de65c833404c552874d7b592a64bbb20696`.

```text
codec_name=pcm_s16le
sample_rate=16000
channels=1
bits_per_sample=16
duration=9.040000
mean_volume=-23.1 dB
max_volume=-3.5 dB
```

Ce n'est donc ni un silence, ni un format erroné. La phrase correspondante est
ensuite apparue dans le journal comme `engine=faster-whisper`.

### Reproduction brute sur le binaire de production

Le binaire en lecture seule `~/code-buddy/buddy-sense/target/release/buddy-sense`
a été lancé avec les variables ci-dessus, `LD_LIBRARY_PATH` dirigé vers son
répertoire et `HOME=~/DEV/cb-stt2-2026-09-04/_qa/stt2/home`. Voici la sortie
fusionnée stdout/stderr, avec seulement le préfixe du home normalisé en `~` :

```text
[buddy-sense stt] model loaded from ~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
{"ready":true}
{"id":"stt2-real-2","text":"Lisa normalement Claude elle va t'informer des nouveautés sur Code Buddy donc tu sauras peut-être ce qu'il a fait"}
STT2_TIME elapsed=2.39 user=2.98 sys=0.60 maxrss_kb=2128676 exit=0
```

Le même WAV, le Python configuré, le modèle local `small`, `language=fr`,
`beam_size=1`, VAD actif, contexte précédent désactivé et les mêmes hotwords :

```text
{'text': "Lisa, normalement, Claude va t'informer des nouveautés sur Code Buddy, donc tu sauras peut-être ce qu'il a fait.", 'language': 'fr', 'duration': 9.04, 'duration_after_vad': 9.04}
STT2_FW_TIME elapsed=2.57 user=11.96 sys=1.03 maxrss_kb=663344 exit=0
```

Trois WAV suivants capturés passivement depuis la même source ont aussi donné,
avec le binaire de production, `Yeah.`, `Ok Google, il est quelle heure ?` et
`Il est 7h.`. Les trois textes identiques figuraient pourtant dans le journal avec
`engine=faster-whisper`. Le « jamais actif » était donc surtout une attribution
mensongère du moteur ; certains segments courts/parasites pouvaient réellement ne
produire aucun token et déclencher le repli bruyant.

### Isolation de la cause

| Hypothèse | Verdict | Preuve |
|---|---|---|
| Binaire, modèle ou bibliothèques `.so` cassés | Non | Chargement réussi, JSON valide, transcript non vide, code 0. |
| Langue française non prise en charge | Non | Parakeet-TDT v3 couvre `fr`; le décodage réel ci-dessus le confirme. |
| WAV silencieux ou mauvais format | Non | PCM 16 bits, 16 kHz, mono, 9,04 s, niveau sonore et deux transcripts non vides. |
| Parsing ou timeout TypeScript systématiquement cassé | Non | Le protocole renvoie bien `ready` puis `{id,text}`; un timeout isolé de 20 s a existé, sans expliquer toutes les phrases. |
| Routage Rust et métadonnée moteur | **Oui** | `resolve_live_stt_decision_from` déléguait toute langue épinglée, donc aussi `fr`, et le payload `speech_end` annonçait d'avance `sttEngine=faster-whisper`. Le cerveau relisait toutefois son environnement global `sherpa-rs`, relançait Sherpa sur ce WAV, puis conservait la fausse étiquette du payload. |

Conclusion : le binaire Sherpa n'est pas devenu inactif. Le routage Rust avait
divergé de la source de vérité TypeScript, qui savait déjà que `fr` fait partie
des 25 langues Parakeet v3. Les vrais retours vides étaient des décodages sans token
sur quelques segments, rendus trompeurs par un avertissement à chaque phrase et
par la mauvaise attribution `faster-whisper`.

## Réparation

Commit fonctionnel : `164d93b59` (`fix(sensory): keep French sherpa STT active`).

- `buddy-sense/src/senses/live_audio.rs` partage désormais la même liste de 25
  langues que `speech-engine-config.ts`. `fr` et `fr-FR` restent sur le décodeur
  Parakeet en processus ; seule une langue hors liste est déléguée ou refusée si
  le fallback est désactivé.
- `src/sensory/speech-reaction.ts` renvoie le moteur ayant effectivement produit
  le texte. Le journal `heard` ne reprend plus aveuglément `sttEngine` du payload
  lorsqu'un WAV a été redécodé.
- Au premier texte Sherpa vide, le journal contient maintenant la cause
  (`reason=no_tokens`), l'état/code de sortie, la fin de stderr, le temps de la
  requête, la durée/forme du WAV et son RMS. Au troisième vide consécutif (seuil
  `CODEBUDDY_SHERPA_EMPTY_THRESHOLD`, défaut 3), une seule ligne
  `sherpa-rs inactif : ...` est émise ; les phrases suivantes ne la répètent pas.
  Un transcript Sherpa non vide remet le compteur à zéro et signale la reprise.
- `_qa/stt2/` est gitignoré ; aucun artefact audio ou cache de test n'entre dans
  le commit.

## Vérifications

### Preuve réelle après correction

Le build de livraison inclut les deux features afin que le même exécutable serve
le démon et la commande `stt` :

```text
cd ~/DEV/cb-stt2-2026-09-04/buddy-sense
cargo build --release --frozen --features live-audio,stt
Finished `release` profile [optimized] target(s) in 1.64s
```

Le binaire ainsi construit, le même WAV et exactement les variables STT actives
ci-dessus donnent :

```text
{"ready":true}
[buddy-sense stt] model loaded from ~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
{"id":"stt2-live-exact-env","text":"Lisa normalement Claude elle va t'informer des nouveautés sur Code Buddy donc tu sauras peut-être ce qu'il a fait"}
STT2_EXACT_ENV_TIME elapsed=2.04 user=2.61 sys=0.55 maxrss_kb=2126108 exit=0
```

La commande demandée littéralement, avec la seule feature `stt`, passe aussi :

```text
cargo build --release --frozen --features stt
Finished `release` profile [optimized] target(s) in 0.11s
```

### Tests et contrôles

```text
npx vitest run tests/sensory
Test Files  72 passed | 1 skipped (73)
Tests       677 passed | 4 skipped | 1 todo (682)

npx vitest run tests/sensory/speech-reaction-workers.test.ts
Test Files  1 passed (1)
Tests       10 passed (10)

npx tsc --noEmit -p .
exit 0

npx eslint src/sensory/speech-reaction.ts tests/sensory/speech-reaction-workers.test.ts
exit 0

cargo test --frozen --features live-audio,stt
61 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

rustfmt --edition 2021 --check src/senses/live_audio.rs
exit 0

git diff --check
exit 0
```

Les deux nouveaux tests de worker couvrent explicitement cinq retours vides
consécutifs (un seul diagnostic initial, une seule annonce d'inactivité, fallback
attribué à faster-whisper) et une fermeture code 7 avec stderr
`decoder crashed`, durée audio et fallback effectif.

Incidents de banc conservés par transparence : la première commande Cargo sous
le HOME isolé n'a exécuté aucun test, car `rustup` n'y trouvait pas de toolchain ;
la relance a utilisé la toolchain existante en lecture seule et les caches Cargo
dans `_qa/stt2/home`. `cargo fmt --check` global reste rouge sur
`src/tts/pocket.rs` et `src/tts/pocket_april.rs`, deux fichiers historiques non
touchés ; le fichier Rust modifié passe son `rustfmt --check` ciblé.

## Mise en service restant à faire

Aucun service n'a été redémarré et aucun fichier sous `~/code-buddy`,
`~/.codebuddy` ou systemd n'a été modifié.

Après revue/intégration du commit, l'opérateur devra construire le TypeScript,
installer le binaire Rust construit avec `--features live-audio,stt`, puis
redémarrer `buddy-vision-brain.service` et `buddy-sense.service` (cerveau avant
capteur). Il devra aussi garder à l'esprit que le drop-in historique annonce
`faster-whisper` alors que `~/.codebuddy/vision.env` fournit actuellement la valeur
effective `sherpa-rs`; la valeur des processus après redémarrage doit être contrôlée.

Preuve attendue au prochain démarrage :

```text
[buddy-sense] live-audio: STT ready requested=sherpa-rs effective=sherpa-rs language=fr model=~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
[speech] heard (... engine=sherpa-rs, ...)
```

La ligne `reason=parakeet-language-pin-unsupported` ne doit plus apparaître pour
`fr`. Si trois vrais segments sans token surviennent, une seule annonce
`sherpa-rs inactif : reason=no_tokens ... consecutive_empty=3` doit apparaître,
précédée d'un seul diagnostic complet au premier vide.
