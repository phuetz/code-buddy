# RAPPORT-GK5 — Pocket TTS en Rust/ONNX dans buddy-sense

Mission : faisabilité d’une voix française locale de secours, inspirée de `buzz-voice`.

- Clone : `/home/patrice/DEV/cb-never-env-2026-09-02`
- Branche : `feat/gk5-pocket-tts-rust-2026-09-03`
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source (protocole mission).

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. LLM local Ollama `qwen3:4b-instruct` / `qwen3.8:27b` sur `127.0.0.1:11434` autorisé, ou aucun.
- Aucun service systemd. Ne pas toucher ComfyUI 8188/8189.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME temporaire dans le clone si besoin).
- Dépôt original `~/code-buddy` interdit. Référence `~/DEV/buzz/crates/buzz-voice/...` en **lecture seule**.
- Jamais `DISPLAY=:10`. Ports libres seulement.
- Un commit conventionnel par lot. Typecheck + lint + tests ciblés verts.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

Commandes :

```
git status -sb && git log -5 --oneline && git rev-parse HEAD && git diff --stat HEAD
```

Sortie collée :

```
## feat/gk5-pocket-tts-rust-2026-09-03
 M docs/FABLE5-CODEX-COORDINATION.md
?? RAPPORT-GK5.md
---
3fcf5a97d docs(voice): consigner les preuves DARK3
ec6cdb99a feat(voice): ajouter le routage Kyutai à deux vitesses
9719f57d0 chore(dark3): réserver le chantier voix locale
d50aee61e Merge EVO1 (notes de version lisibles par Lisa, outil self_evolution, source d'expérience Darwin-Gödel opt-in) into codex/audit-systeme-nerveux-2026-09-01
c053ccd22 docs(self-model): document self evolution
---
3fcf5a97d90718361696163a8a2474aed49e377c
---
 docs/FABLE5-CODEX-COORDINATION.md | 1 +
 1 file changed, 1 insertion(+)
```

Chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md`. Aucun fichier source lu encore. HOST=`Ministar`, date UTC `2026-09-03T09:09:30Z`.

## 1. Recherche ONNX Pocket TTS voix française

**Verdict : OUI, un export ONNX `french_24l` existe et a été téléchargé (377 Mo < 500 Mo).**

| Source | URL | Date consultée | Licence | Taille utile |
|---|---|---|---|---|
| KevinAHM/pocket-tts-onnx | https://huggingface.co/KevinAHM/pocket-tts-onnx | 2026-09-03 | poids **CC-BY-4.0** (Kyutai) ; scripts **Apache-2.0** | `onnx/french_24l/` |
| README v2 bundles | même dépôt, commit `58a6d00` (« Add v2 bundles », ~4 mois avant le 2026-09-03) | 2026-09-03 | langues : `english_2026-04`, **`french_24l`**, german, italian, portuguese, spanish (+ `_24l`) | — |
| kyutai/pocket-tts v2.0.0 | https://github.com/kyutai-labs/pocket-tts/releases/tag/v2.0.0 | 2026-09-03 | **CC-BY-4.0** | pas d’ONNX officiel ; PyTorch |
| FluidAudio CoreML | https://github.com/FluidInference/FluidAudio | 2026-09-03 | Apache-2.0, **CoreML pas ONNX** | `v2/french_24l/` trop gros / autre runtime |
| CML-TTS voix FR | https://huggingface.co/kyutai/tts-voices `cml-tts/fr/` | 2026-09-03 | **CC-BY-4.0** (OpenSLR 146) | WAV ~340 Ko |

Bundle INT8 réellement téléchargé dans le clone (`buddy-sense/models/pocket-tts/french_24l/`, révision `58a6d00cf13d239b6748cb0769f35c580a8f606c`) :

| Fichier | Octets | SHA-256 |
|---|---|---|
| `flow_lm_main_int8.onnx` | 305 144 125 | `6130a6b9…` |
| `mimi_encoder.onnx` (FP32, comme buzz-voice) | 39 768 446 | `790a82fb…` |
| `mimi_decoder_int8.onnx` | 22 684 077 | `b329ff3d…` |
| `text_conditioner.onnx` | 16 388 344 | `89d1b6ac…` |
| `flow_lm_flow_int8.onnx` | 9 962 530 | `d340c549…` |
| `tokenizer.model` + `bundle.json` + `bos_before_voice.npy` | ~107 Ko | voir `SHA256SUMS` |
| `reference_fr.wav` (CML-TTS) | 347 564 | `4bf06384…` |
| **Total disque** | **377 Mo** | `du -sh` = `377M` |

Le FP32 `flow_lm_main.onnx` français fait **1,21 Go** — non téléchargé (plafond 500 Mo). Il n’existe **pas** de Pocket TTS français 6 couches : seulement `french_24l`.

Voix de référence : le bundle ONNX n’embarque pas `estelle` (embeddings Python). Le runtime clone depuis un WAV via `mimi_encoder`. WAV français CML-TTS CC-BY-4.0 utilisé.

Recette d’export (non exécutée, déjà publié) : `https://github.com/KevinAHM/pocket-tts-onnx-export` — `python export.py --language french_24l` puis `--quantize`. Dépendances : torch, onnx, onnxruntime, huggingface_hub, safetensors, sentencepiece, scipy. Le dépôt source Kyutai `kyutai/pocket-tts` est **gated**.

## 2. Feature Cargo `pocket-tts`

Port **minimal et attribué** de `buzz-voice` (`pocket.rs` / `pocket_april.rs` / `pocket_models.rs`, Apache-2.0, Block), lu en lecture seule depuis `~/DEV/buzz/crates/buzz-voice/src/`.

Adaptations nécessaires (pas une copie byte-à-byte) :

- Langue : `french_24l` **et** `english_2026-04` (buzz durcissait `english_2026-04` seul).
- Politique de prompt : `remove_semicolons=true` et `model_recommended_frames_after_eos=8` honorés (buzz les rejetait).
- **ORT 2.0.0-rc.6** (pin déjà présent pour `neural-vad`). Cargo **refuse** deux pré-releases `ort` (`rc.6` + `rc.12`) dans le même graphe — le `ort` 2.0-rc.12 de buzz n’est pas utilisable ici. API rc.6 : modules `session`/`memory` privés, `try_extract_tensor` → `ndarray::ArrayViewD`, tenseurs vides via `ndarray` (dims à 0).
- WAV : `hound` déjà dans buddy-sense (pas `sherpa-onnx` 1.12, qui entrerait en conflit avec `sherpa-rs` 0.6.8).
- Resample : interpolation linéaire locale.
- `rand` 0.8 (déjà au lockfile ; 0.10 tirait `chacha20` yanked).

Surfaces :

- `buddy-sense tts --text "…" --out x.wav [--voice] [--model-dir] [--threads]`
- `buddy-sense tts --bench`
- PCM 24 kHz mono 16-bit
- Attribution : en-têtes + `buddy-sense/THIRD-PARTY.md`
- Rien câblé côté TypeScript

`.onnx` gitignorés (~370 Mo). Restaurer : `buddy-sense/scripts/fetch-pocket-tts.sh`.

## 3. Mesures Ministar

Hôte : **AMD Ryzen AI 9 HX 470 w/ Radeon 890M**, 24 threads, `ORT_DYLIB_PATH=~/.cache/onnxruntime/lib/libonnxruntime.so.1.20.1` (déjà là pour le VAD, pas d’écriture `~/.codebuddy`).

Binaire : `cargo build --release --features pocket-tts`.

CLI (une phrase, 4 threads) :

```
[buddy-sense tts] wrote models/pocket-tts/out/bonjour.wav (5.04s audio, first_pcm=1291ms, total=6342ms, rms=0.0483)
```

WAV : 241 964 octets, non vide.

Banc `buddy-sense tts --bench --threads 4` — 5 phrases × 3 passages, bundle `french_24l` INT8, voix `reference_fr.wav` :

| Phrase | Pass | first_pcm_ms | total_ms | duration_s | rms |
|---|---|---|---|---|---|
| Bonjour, je suis là. | 1 | 1265.2 | 2832.2 | 1.12 | 0.0215 |
| Bonjour, je suis là. | 2 | 504.4 | 3468.7 | 1.92 | 0.0605 |
| Bonjour, je suis là. | 3 | 537.7 | 3006.9 | 1.60 | 0.0417 |
| Il est l'heure de prendre tes médicaments. | 1 | 439.7 | 4856.0 | 3.12 | 0.0769 |
| Il est l'heure de prendre tes médicaments. | 2 | 463.0 | 3706.4 | 2.24 | 0.0256 |
| Il est l'heure de prendre tes médicaments. | 3 | 422.0 | 3584.4 | 2.24 | 0.0394 |
| Le café est prêt dans la cuisine. | 1 | 462.0 | 3666.2 | 2.48 | 0.0527 |
| Le café est prêt dans la cuisine. | 2 | 483.5 | 3065.9 | 1.92 | 0.0466 |
| Le café est prêt dans la cuisine. | 3 | 490.8 | 4920.2 | 3.04 | 0.0265 |
| Rappelle-moi d'appeler Paul demain matin. | 1 | 462.5 | 3346.5 | 2.24 | 0.0399 |
| Rappelle-moi d'appeler Paul demain matin. | 2 | 333.3 | 3578.3 | 2.48 | 0.0472 |
| Rappelle-moi d'appeler Paul demain matin. | 3 | 397.0 | 3353.0 | 2.40 | 0.0899 |
| Oui, j'ai bien compris ta question. | 1 | 323.4 | 2285.3 | 2.08 | 0.0102 |
| Oui, j'ai bien compris ta question. | 2 | 331.6 | 9429.7 | 6.00 | 0.0154 |
| Oui, j'ai bien compris ta question. | 3 | 473.2 | 5726.8 | 2.40 | 0.0241 |

Après le 1er passage (conditionnement voix), le premier bloc PCM tombe vers **320–540 ms**. Le total est **souvent plus lent que le temps réel** (24 couches INT8 sur CPU). RMS toujours > 0.01. La durée audio varie (échantillonnage stochastique du flow).

Test debug ciblé : `french_24l: samples=65280 duration=2.72s rms=0.0407 first_pcm=3116ms total=8425ms wav=130604`.

## 4. Côté TS — ce qu’il faudrait pour un repli DARK3

**Rien n’a été câblé** (pas de fournisseur, pas d’env, pas de test TS).

Chaîne actuelle (`src/voice/local-tts.ts` `synthesizeKyutaiWithFallbackWav`) :

`Kyutai PCM24k → ElevenLabs → Pocket Python (CLI/serveur 8766) → Piper`

Pour en faire un repli local DARK3 **sans** casser le chemin Python :

1. **Contrat audio déjà compatible** : le binaire émet du WAV PCM16 24 kHz mono, identique à `pcm16Mono24kToWav` / `normalizePcm16Wav`.
2. **Nouveau lanceur**, calqué sur `buddy-sense stt` : spawn `buddy-sense tts --text … --out …` (ou un worker JSONL stdin/stdout si on veut éviter un process par phrase). `LD_LIBRARY_PATH` / `ORT_DYLIB_PATH` comme le worker STT.
3. **Env opt-in** (proposition, non implémentée) : `CODEBUDDY_TTS_POCKET_ONNX=true` + `BUDDY_SENSE_POCKET_MODEL_DIR` + `BUDDY_SENSE_POCKET_VOICE`. Défaut off = byte-identical.
4. **Où l’insérer** : après l’échec Kyutai, **avant** ElevenLabs si on veut rester $0 ; ou après ElevenLabs, **avant** le Pocket Python. Pour DARK3 « deux vitesses », **ne pas** remplacer Kyutai : `french_24l` est trop lent (first PCM ~0,3–1,3 s vs cible Kyutai ~0,28 s). Rôle : secours quand darkstar/Kyutai est éteint **et** qu’on refuse le cloud.
5. **Clé de cache** : `local:pocket-onnx:french_24l:<sha-voix>` — distincte de `local:kyutai:<n_q>:…`.
6. **Banque DARK3** : `buddy companion tts-bank build --provider pocket-onnx` n’existe pas ; les phrases longues (>80 car.) resteraient ElevenLabs.
7. **Tests TS à écrire le jour du câblage** : fake binaire qui écrit un WAV 24 kHz ; vérifier que `synthesizeKyutaiWithFallbackWav` tombe ici quand Kyutai échoue et que l’env ONNX est on ; env off → chemin historique.

## 5. Vérifications

Cargo tests **sans** la feature (régression) :

```
cd buddy-sense && cargo test --offline
test result: ok. 34 passed; 0 failed; 0 ignored
```

Cargo tests **avec** `--features pocket-tts` :

```
ORT_DYLIB_PATH=…/libonnxruntime.so.1.20.1 cargo test --features pocket-tts --offline
test result: ok. 53 passed; 0 failed; 5 ignored
```

(les 5 ignorés sont les tests buzz qui exigent un bundle anglais `english_2026-04` + IDs SentencePiece anglais).

Release : `cargo build --release --features pocket-tts` — `Finished release` 38,99 s.

Pas de fichier TS touché → pas de `tsc` / ESLint. `~/code-buddy` non ouvert en écriture. Aucun push, aucun service, aucun `~/.codebuddy`.

## 6. Commits

```
03bb492c3 feat(buddy-sense): ajouter Pocket TTS ONNX (feature pocket-tts)
369ccde0a docs(gk5): consigner la faisabilité Pocket TTS Rust/ONNX
```

## Bilan (≤ 10 lignes)

Un export ONNX `french_24l` INT8 existe (KevinAHM, CC-BY-4.0, 377 Mo) et a été téléchargé dans le clone. La feature `pocket-tts` porte le moteur buzz-voice sur l’`ort` 2.0.0-rc.6 déjà piné, avec `buddy-sense tts --text/--out/--bench`. Preuve : test `french_24l_emits_non_silent_pcm_wav` vert (2,72 s, RMS 0,0407) ; CLI release 241 964 octets, RMS 0,0483 ; banc 5×3 sur Ryzen AI 9 HX 470, first PCM ~0,32–0,54 s après tiède, RMS > 0,01. Cargo tests 34/34 (défaut) et 53/53+5 ignorés (`pocket-tts`). Rien câblé en TypeScript : trop lent pour remplacer Kyutai DARK3, utile comme dernier repli local $0. Ouvert : voix `estelle` (embeddings Python, pas WAV) ; 24 couches plus lentes que le temps réel ; `ort` rc.12 injoignable à cause du pin rc.6.
