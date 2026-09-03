# Réparation CONV4 — transcription en flux sherpa-rs

## Journal de travail

| Étape | Preuve / résultat |
|---|---|
| 2026-09-03 — création du rapport | Rapport créé avant toute inspection du dépôt, conformément à la mission. |
| 2026-09-03 — coordination | `docs/FABLE5-CODEX-COORDINATION.md` lu intégralement par tranches jusqu’à la ligne 285 (`wc -l` = 285). Réservation CONV4 ajoutée : Codex GPT-5, clone courant, branche `fix/conv4-stt-flux-2026-09-03`, zone `speech-reaction`/worker/tests nécessaires. |
| 2026-09-03 — état initial | `git status --short --branch` → branche correcte ; seul `REPARATION-CONV4.md` est non suivi. `git log -1 --oneline` → `eea1b1515 Merge PILE-C...`. |
| 2026-09-03 — premier rouge tenté | `npx vitest run tests/sensory/speech-reaction-workers.test.ts --reporter=verbose` n’a pas chargé la suite : `ERR_MODULE_NOT_FOUND: Cannot find package 'vitest'` (`vitest.config.ts`). Dépendances du clone à installer ; aucun échec métier encore mesurable. |
| 2026-09-03 — rouge métier | Après `npm install`, le test modifié a rougi comme prévu : `1 failed / 6 passed`; le dossier Parakeet incomplet sélectionnait à tort `/tmp/fake-buddy-sense` au lieu de `fake-python`. |
| 2026-09-03 — format | `cargo fmt --all -- --check` a d’abord signalé uniquement deux zones de formatage dans `live_audio.rs`; correction par `cargo fmt --all`, puis contrôle final vert. |
| 2026-09-03 — dépendances du clone | `npm install` exécuté uniquement dans le clone : code 0, 1848 paquets ajoutés, 1992 audités. Les 48 vulnérabilités signalées (20 low, 12 moderate, 16 high) n’ont pas été modifiées par un audit fix. |
| 2026-09-03 — build Rust | `cargo build --release --features live-audio,stt` → code 0, profil release terminé en 11,33 s. |
| 2026-09-03 — linkage | `LD_LIBRARY_PATH=buddy-sense/target/release ldd buddy-sense/target/release/buddy-sense` → `libsherpa-onnx-c-api.so` et `libonnxruntime.so` résolus depuis `target/release`, aucun `not found`. Les `.so` nécessaires sont donc à côté du binaire. |
| 2026-09-03 — tests Rust | `cargo fmt --all -- --check && cargo test --features live-audio,stt -- --nocapture` → `61 passed; 0 failed`; le test réel Parakeet imprime le texte français attendu. |
| 2026-09-03 — tests TS ciblés | `npx vitest run tests/sensory/speech-reaction-workers.test.ts tests/sensory/speech-engine-config.test.ts --reporter=verbose` → `2 files, 14 passed`; puis `npx vitest run tests/sensory/sherpa-rs-stt.test.ts --reporter=verbose` → `1 file, 7 passed`, intégration réelle incluse. |
| 2026-09-03 — CLI sur cinq WAV | `buddy-sense stt` en worker JSONL, code 0, `ready={"ready":true}` : cinq réponses exactes et latences 166,1 / 150,7 / 150,4 / 148,0 / 145,7 ms. |
| 2026-09-03 — qualité finale | `npm run typecheck` → code 0 (`tsc --noEmit` + GPU identity). `npm run lint` → code 0, 0 erreur et 2474 warnings historiques. Lint ciblé des cinq fichiers TS touchés → code 0, aucune sortie. |

## Périmètre et garde-fous

- Clone de travail : `/home/patrice/DEV/cb-voix-e2e-2026-09-02`
- Branche demandée : `fix/conv4-stt-flux-2026-09-03`
- Aucun accès au dépôt original, aucun push, aucune API payante, aucun service système, aucune écriture hors clone ou dans `~/.codebuddy`.
- Fixtures WAV uniquement ; aucune écoute réelle ni donnée personnelle.

## Fichiers lus

Déjà lus : `docs/FABLE5-CODEX-COORDINATION.md` (lecture complète en tranches), `REPARATION-CONV4.md` (création initiale), `docs/getting-started.md`, `docs/fleet-guide.md`, `CHANGELOG.md`, `src/sensory/speech-reaction.ts`, `src/sensory/speech-engine-config.ts`, `src/companion/percepts.ts`, `buddy-sense/Cargo.toml`, `buddy-sense/src/main.rs`, `buddy-sense/src/senses/stt.rs`, `buddy-sense/src/senses/live_audio.rs`, `buddy-sense/src/senses/audio.rs`, les quatre tests sensoriels concernés, `buddy-sense/models/README.md`, `buddy-sense/README.md`, et `scripts/reproduce-stt-francais.ts`.

Consultation externe de référence : fiche officielle NVIDIA du modèle [parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), qui indique 25 langues dont le français et la licence `CC-BY-4.0`. Aucun téléchargement n’a été effectué.

## Commandes et résultats

À compléter au fil de l’eau ; les sorties rouge/vert pertinentes seront collées ici.

### Premières preuves

```text
cargo build --release --features live-audio,stt
Finished `release` profile [optimized] target(s) in 11.33s

buddy-sense stt (worker résident, modèle Parakeet installé, WAV français connu)
pass 1: 187.9 ms — texte français attendu
pass 2: 150.3 ms — texte français attendu
pass 3: 141.6 ms — texte français attendu
exit=0 ; ready={"ready":true}
```

Preuve complémentaire : modèle local `/home/patrice/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`, lu sans modification, `du -sh` → `641M`; fichiers requis présents : `encoder.int8.onnx` (652184281 octets), `decoder.int8.onnx` (11845275), `joiner.int8.onnx` (6355277), `tokens.txt` (93939). Le modèle est donc complet. Le dossier contient aussi `test_wavs/fr.wav`, témoin local utilisé par la règle de sélection `auto`.

Les cinq fixtures sont dans `tests/fixtures/stt-conv4/`, PCM mono 16 kHz, dérivées localement du témoin français public du modèle (référence, calme, fort, marge de début, bande limitée). Aucun microphone n’est ouvert.

Le protocole `buddy-sense stt` n’expose pas de champ de langue : sherpa-rs/Parakeet auto-détecte. La langue `fr` est prouvée ici par la transcription française exacte sur les cinq fichiers, et non par un faux champ injecté dans la réponse.

Sortie condensée du passage CLI réel :

```text
ready={"ready":true}; exit=0
fr-bandlimited.wav 166.1 ms  Ne vous demandez pas ce que votre pays peut faire pour vous. Demandez-vous plutôt ce que vous pouvez faire pour lui.
fr-loud.wav        150.7 ms  Ne vous demandez pas ce que votre pays peut faire pour vous. Demandez-vous plutôt ce que vous pouvez faire pour lui.
fr-padded.wav      150.4 ms  Ne vous demandez pas ce que votre pays peut faire pour vous. Demandez-vous plutôt ce que vous pouvez faire pour lui.
fr-quiet.wav       148.0 ms  Ne vous demandez pas ce que votre pays peut faire pour vous. Demandez-vous plutôt ce que vous pouvez faire pour lui.
fr-reference.wav   145.7 ms  Ne vous demandez pas ce que votre pays peut faire pour vous. Demandez-vous plutôt ce que vous pouvez faire pour lui.
```

Conclusion modèle : le Parakeet installé fait bien du français, preuve 5/5. Il n’est donc pas nécessaire de documenter ni de télécharger un autre modèle sherpa-onnx FR de plus de 500 Mo. Référence d’installation conservée : dossier ci-dessus, taille locale 641 Mo, modèle NVIDIA `CC-BY-4.0`.

## Mesures

Mesure bout en bout sur le même `tests/fixtures/stt-conv4/fr-reference.wav`, même processus TS, mêmes trois passages après warm-up du worker, horloge monotone autour de l’émission `sensory:perception(kind=speech_end)` jusqu’au callback `heard` :

| Moteur | Passage 1 | Passage 2 | Passage 3 | Médiane | Texte |
|---|---:|---:|---:|---:|---|
| sherpa-rs Rust résident | 179,1 ms | 166,2 ms | 191,4 ms | **179,1 ms** | 3/3 exact français |
| faster-whisper `small` résident | 1 215,6 ms | 1 216,2 ms | 1 164,8 ms | **1 215,6 ms** | 3/3 exact français |

Gain mesuré : **1 036,5 ms**, soit **85,27 % de réduction**, ou **6,79× plus rapide** pour sherpa-rs sur cette machine. Cette mesure locale n’est pas une promesse de conserver exactement le même chiffre sur le robot ; elle établit le chemin et l’écart sur le WAV commun. Le worker sherpa est chargé une fois (warm-up mesuré séparément à 2 376,1 ms) puis réutilisé.

Chaîne prouvée : `speech_end` avec payload WAV → `wireSpeechReaction` → worker JSONL `buddy-sense stt` → transcription → callback `heard`; le test réel `carries speech_end through the Rust worker to heard` est vert.

Règles de routage ajoutées :

- `sherpa-rs` explicite reste disponible sans pin de langue ; un pin explicite comme `fr` conserve le repli language-aware faster-whisper, car l’API sherpa-rs utilisée ne porte pas de champ de langue.
- `auto` ne choisit sherpa-rs que si le binaire existe et si les quatre fichiers ONNX/tokenizer sont complets dans un modèle local dont le support français est prouvé (`parakeet-tdt-0.6b-v3` connu ou `test_wavs/fr.wav` présent). Sinon, faster-whisper est choisi.
- Le warning de repli `auto STT fallback activated` est dédoublonné par raison pendant la durée du processus ; le test dédié appelle deux transcriptions et observe un seul warning.

Bloc exact à placer dans `vision.env` pour activer le chemin local mesuré (sans modifier ce fichier depuis cette mission) :

```dotenv
CODEBUDDY_SPEECH_ENGINE=auto
CODEBUDDY_SPEECH_LANG=auto
CODEBUDDY_SPEECH_FALLBACK=true
CODEBUDDY_SPEECH_WORKER=true
CODEBUDDY_SPEECH_MODEL=small
CODEBUDDY_SPEECH_PYTHON=/home/patrice/miniforge3/bin/python3
CODEBUDDY_SPEECH_STT_BIN=/home/patrice/DEV/cb-voix-e2e-2026-09-02/buddy-sense/target/release/buddy-sense
BUDDY_SENSE_STT_MODEL_DIR=/home/patrice/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
BUDDY_SENSE_STT_THREADS=4
```

`CODEBUDDY_SPEECH_LANG=auto` est volontaire : une valeur `fr` est un pin explicite et active le repli faster-whisper, puisque l’API sherpa-rs employée ne sait pas recevoir ce pin. `CODEBUDDY_SPEECH_MODEL` et `CODEBUDDY_SPEECH_PYTHON` ne servent qu’au repli local ; ils rendent ce repli déterministe sur cette machine. Le worker TS ajoute automatiquement `LD_LIBRARY_PATH` du répertoire du binaire.

## Commits

`7bb705bab` — `fix(sensory): require French sherpa-rs assets for auto` : routage, garde modèle/langue, worker Rust et tests unitaires.

`2ca585c6a` — `test(sensory): verify sherpa-rs French fixture stream` : cinq WAV, test worker réel, test `speech_end → heard` et sélection `auto` réelle.

Le présent rapport et la ligne de coordination sont le lot documentaire final, commités séparément après mise à jour des preuves.

## Bilan final

- Fait : `buddy-sense` release avec `live-audio,stt`, bibliothèques `.so` résolues, cinq fixtures françaises exactes.
- Fait : la chaîne TS `speech_end → worker sherpa-rs → heard` est prouvée sans microphone.
- Fait : `auto` exige le binaire et un modèle Parakeet FR complet ; sinon faster-whisper, warning dédoublonné par processus/raison.
- Mesure : 179,1 ms médian sherpa-rs contre 1 215,6 ms faster-whisper `small`, gain 1 036,5 ms / 85,27 % / 6,79×.
- Ouvert : chiffre à revalider sur le robot réel ; aucun service ni `vision.env` n’a été modifié.
