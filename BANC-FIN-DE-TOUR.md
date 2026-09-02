# Banc fin de tour — PILE-C / LiveKit v1-mini + Silero

État initial — 2026-09-02, Europe/Paris
Dépôt : `/home/patrice/DEV/cb-conv-pilec-2026-09-03`
Branche : `feat/fin-de-tour-livekit-2026-09-03`
Mission : banc local, français, sans appel payant et sans lecture audio réelle.

## Garde-fou préalable

Ce rapport a été créé **avant toute installation Python**. À cette étape, aucun
venv, paquet Python ou poids LiveKit/Silero/Pocket TTS n’a été installé par cette
mission. Le seul non-suivi observé avant le rapport est le `node_modules`
préexistant ; il est laissé intact.

Le chantier est réservé dans `docs/FABLE5-CODEX-COORDINATION.md`. Le venv, les
caches et les artefacts du banc resteront dans le clone et sont exclus par
`.git/info/exclude` :

```text
.venv-turn-2026-09-03/
.turn-bench-cache-2026-09-03/
.turn-bench-artifacts-2026-09-03/
```

## Relevé pré-installation — sorties collées

Commandes exécutées avant ce rapport :

```console
$ python3 --version
Python 3.13.12

$ python3 -m pip --version
pip 26.0.1 from /home/patrice/miniforge3/lib/python3.13/site-packages/pip (python 3.13)

$ uname -srmo && nproc && lscpu | rg 'Model name|Architecture|CPU\(s\)|Thread|Core|MHz' | head -20
Linux 6.17.0-1032-oem x86_64 GNU/Linux
24
Architecture:                            x86_64
CPU(s):                                  24
On-line CPU(s) list:                     0-23
Model name:                              AMD Ryzen AI 9 HX 470 w/ Radeon 890M
Thread(s) per core:                      2
Core(s) per socket:                      12
CPU(s) scaling MHz:                      91%
CPU max MHz:                             5297.2979
CPU min MHz:                             621.6220
NUMA node0 CPU(s):                       0-23

$ python3 -m pip index versions livekit-agents
livekit-agents (1.7.1)

$ python3 -m pip index versions livekit-plugins-turn-detector
livekit-plugins-turn-detector (1.7.1)

$ python3 -m pip index versions livekit-plugins-silero
livekit-plugins-silero (1.7.1)

$ python3 -m pip index versions pocket-tts
pocket-tts (3.0.2)
```

Version pins retenus pour le banc : `livekit-agents==1.7.1`,
`livekit-plugins-turn-detector==1.7.1`, `livekit-plugins-silero==1.7.1` et
`pocket-tts==3.0.2`. Le détecteur audio v1-mini est sélectionné explicitement
par `inference.TurnDetector(version="v1-mini")`. Dans la version actuelle de
l’SDK, le détecteur audio est intégré à `livekit-agents`; le paquet
`livekit-plugins-turn-detector` demandé est installé pour conserver la pile
plugin complète, mais il ne sera pas confondu avec l’ancien détecteur textuel.

## Sources et licences lues avant installation

- Documentation officielle du [détecteur de tours LiveKit](https://docs.livekit.io/agents/logic/turns/turn-detector/), consultée le 2026-09-02 : `v1-mini` tourne localement sur CPU ; le détecteur audio est disponible depuis `livekit-agents` 1.6.1 ; le français fait partie des langues annoncées ; Silero est recommandé en complément.
- [Carte du modèle `livekit/turn-detector`](https://huggingface.co/livekit/turn-detector), section License et limitations, consultée le 2026-09-02 : les poids sont sous LiveKit Model License ; la carte distingue le modèle textuel historique (transcrit) du détecteur audio v1-mini à utiliser ici.
- [Texte intégral LiveKit Model License](https://huggingface.co/livekit/turn-detector/blob/main/LICENSE), consulté avant téléchargement des poids : licence mondiale, gratuite, non exclusive et non transférable pour utiliser, copier, reproduire, distribuer et créer des dérivés des matériaux, sous conditions. Pour l’usage personnel/robot visé, cela autorise l’inférence locale du v1-mini dans un programme qui utilise le framework LiveKit Agents.
- Limites déterminantes de cette licence : les modèles ne doivent pas être employés seuls ni avec un framework autre que LiveKit Agents ; les matériaux, sorties ou résultats ne doivent pas servir à développer un autre modèle ; une redistribution doit conserver la licence et sa notice ; les dérivés restent soumis à l’accord. Il n’y a pas, dans le texte lu, d’interdiction spécifique à l’usage personnel ou à un robot, mais cette conclusion est conditionnée au respect de ces clauses et ne vaut pas avis juridique.
- Documentation officielle [Silero VAD](https://docs.livekit.io/agents/logic-structure/turns/vad/), consultée le 2026-09-02 : plugin local CPU et poids à télécharger avant premier usage. La licence du code/modèle Silero sera vérifiée dans l’environnement installé et reportée ici avec la preuve de commande.
- Le code SDK est Apache-2.0 d’après la documentation LiveKit ; cette licence de code ne remplace pas la LiveKit Model License des poids v1-mini.

## Recherche de cadrage relue

La section 7, « pile C », de
/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/RECH2-ETAT-DE-L-ART-GROK.md
propose précisément LiveKit Agents local + Turn Detector v1-mini + Silero,
avec exécution CPU, et signale comme risques la calibration, la latence et la
licence des modèles. Le thème 2 et le mécanisme 1 de
/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/RECH1-LITTERATURE-GEMINI.md
relient la prédiction de fin de tour aux pauses et à la prosodie (famille VAP)
pour éviter de couper une intention avant sa reprise ; ce mécanisme motive la
mesure pause intra-phrase, mais ne constitue pas une preuve de performance de
v1-mini.

## Commandes exactes prévues après création de ce rapport

Toutes les écritures de l’installation et des poids seront redirigées dans le
clone ; aucune lecture audio ni service systemd ne sera lancé.

```console
$ cd /home/patrice/DEV/cb-conv-pilec-2026-09-03
$ python3 -m venv .venv-turn-2026-09-03
$ PIP_NO_CACHE_DIR=1 .venv-turn-2026-09-03/bin/python -m pip install --upgrade pip
$ mkdir -p .turn-bench-cache-2026-09-03 .turn-bench-artifacts-2026-09-03
$ PIP_NO_CACHE_DIR=1 .venv-turn-2026-09-03/bin/python -m pip install \
    livekit-agents==1.7.1 \
    livekit-plugins-turn-detector==1.7.1 \
    livekit-plugins-silero==1.7.1 \
    pocket-tts==3.0.2
$ .venv-turn-2026-09-03/bin/python -m pip list --format=freeze
$ .venv-turn-2026-09-03/bin/python -c 'from livekit.agents import inference; print(inference.TurnDetector(version="v1-mini"))'
$ .venv-turn-2026-09-03/bin/python -c 'from livekit.plugins import silero; print(silero.__name__)'
$ .venv-turn-2026-09-03/bin/python -m pip show livekit-agents livekit-plugins-turn-detector livekit-plugins-silero pocket-tts
$ .venv-turn-2026-09-03/bin/python -c 'import importlib.metadata as m; print(m.metadata("livekit-agents").get("License")); print(m.metadata("livekit-plugins-silero").get("License"))'
```

Si Pocket TTS ne peut pas fournir une roue compatible avec Python 3.13, le
plan de repli est de chercher uniquement un cache ElevenLabs déjà présent dans
le clone, sans requête réseau nouvelle. Si aucun cache n’existe, le résultat
sera déclaré bloqué plutôt que simulé.

## Mesure prévue

Le banc produira 20 WAV de parole française synthétique, sans les jouer : 10
énoncés contenant une pause intra-phrase (« je voudrais une grande pizza… et
une salade ») et 10 énoncés complets. Chaque WAV sera annoté avec la durée de
la pause et la fin de parole connue par le générateur. Les trois temporisations
VAD seul (300, 500 et 800 ms) seront comparées au chemin v1-mini + Silero sur
les mêmes échantillons et les mêmes horloges simulées. Seront rapportés, par
condition, les fausses coupes, le délai de décision, la médiane et les coûts
CPU/latence d’inférence sur cette machine.

Le résultat devra distinguer les pauses intra-phrase (fausse coupe si la
décision tombe avant la reprise) des phrases complètes (délai fin de parole →
décision). Aucun micro, haut-parleur, PipeWire, LiveKit Server ou service
systemd ne sera touché.

## Intégration prévue, sans activation par défaut

Le câblage sera ajouté derrière `CODEBUDDY_SENSORY_TURN_DETECTOR=livekit`.
Sans cette variable, le chemin existant ne devra pas changer. Le test Vitest
sera d’abord rendu rouge par une décision de faux service non consommée, puis
passera vert après consommation de la décision fin de tour ; il vérifiera que
le chemin par défaut est byte-identique et ne chargera pas Python.

Les deux points d’insertion resteront ouverts dans le rapport final :

1. `buddy-sense` Rust → petit service Python local sur un port supérieur à
   3100, si le flux audio brut doit rester côté capteur ;
2. `speech-reaction.ts` → transcrits partiels, si l’intégration doit rester
   côté Code Buddy. La première option est la seule qui respecte pleinement
   le détecteur audio v1-mini, lequel consomme l’audio et non le texte.

## État au moment de la création

Installation : **NON COMMENCÉE**.
Poids : **NON TÉLÉCHARGÉS**.
Audio réel : **INTERDIT / NON LU**.
Services externes : **AUCUN TOUCHÉ**.
Commit : **À PRODUIRE APRÈS LE BANC ET LES TESTS**.

## Relevé post-installation — 2026-09-02

Le venv jetable a été créé dans le clone, puis la commande prévue a terminé
avec le code retour 0. La vérification de réinstallation (paquets déjà
satisfaits) a également terminé avec le code retour 0 :

~~~console
$ PIP_NO_CACHE_DIR=1 .venv-turn-2026-09-03/bin/python -m pip install livekit-agents==1.7.1 livekit-plugins-turn-detector==1.7.1 livekit-plugins-silero==1.7.1 pocket-tts==3.0.2
Requirement already satisfied: livekit-agents==1.7.1 in ./.venv-turn-2026-09-03/lib/python3.13/site-packages (1.7.1)
Requirement already satisfied: livekit-plugins-turn-detector==1.7.1 in ./.venv-turn-2026-09-03/lib/python3.13/site-packages (1.7.1)
Requirement already satisfied: livekit-plugins-silero==1.7.1 in ./.venv-turn-2026-09-03/lib/python3.13/site-packages (1.7.1)
Requirement already satisfied: pocket-tts==3.0.2 in ./.venv-turn-2026-09-03/lib/python3.13/site-packages (3.0.2)

$ .venv-turn-2026-09-03/bin/python -m pip list --format=freeze | rg '^(livekit-agents|livekit-plugins-turn-detector|livekit-plugins-silero|pocket-tts|torch|onnxruntime)=='
livekit-agents==1.7.1
livekit-plugins-silero==1.7.1
livekit-plugins-turn-detector==1.7.1
onnxruntime==1.29.0
pocket-tts==3.0.2
torch==2.14.0

$ .venv-turn-2026-09-03/bin/python -c 'import importlib.metadata as m; names=("livekit-agents","livekit-plugins-turn-detector","livekit-plugins-silero","pocket-tts","torch","onnxruntime"); [print(n, m.version(n), "license=" + str(m.metadata(n).get("License")), "license-expression=" + str(m.metadata(n).get("License-Expression"))) for n in names]; import torch; print("torch", torch.__version__, "cuda_available", torch.cuda.is_available(), "threads", torch.get_num_threads()); from livekit.agents import inference; print(inference.TurnDetector, "v1-mini constructor available"); from livekit.plugins import silero; print(silero.VAD, "force_cpu available")'
livekit-agents 1.7.1 license=None license-expression=Apache-2.0
livekit-plugins-turn-detector 1.7.1 license=None license-expression=Apache-2.0
livekit-plugins-silero 1.7.1 license=None license-expression=Apache-2.0
pocket-tts 3.0.2 license=None license-expression=None
torch 2.14.0 license=None license-expression=Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT
onnxruntime 1.29.0 license=MIT License license-expression=None
torch 2.14.0+cu130 cuda_available False threads 12
<class 'livekit.agents.inference.eot.detector.TurnDetector'> v1-mini constructor available
<class 'livekit.plugins.silero.vad.VAD'> force_cpu available
~~~

Le paquet PyTorch installé par Pocket TTS contient des bibliothèques CUDA
(2.14.0+cu130), mais CUDA est explicitement indisponible dans ce banc et
force_cpu=True est utilisé pour Silero. Aucun GPU ni périphérique audio n’a
été ouvert. Le modèle v1-mini est le détecteur **audio** intégré à
livekit-agents; livekit-plugins-turn-detector est bien installé comme
demandé, mais son ancienne classe de détection textuelle n’est pas substituée
au modèle audio v1-mini.

### Incident et validation Pocket TTS

La première commande de fumée, volontairement exécutée après l’installation,
avait un nom de langue incorrect :

~~~console
$ ... pocket_tts generate --language french --voice estelle --text 'Bonjour Lisa, ceci est un essai local.' ...
ValueError: For technical reasons, only a larger 24-layer model is available for French. Please use the 'french_24l' language instead.
~~~

La commande corrigée a réussi sans appel ElevenLabs :

~~~console
$ HF_HOME="$PWD/.turn-bench-cache-2026-09-03/hf" XDG_CACHE_HOME="$PWD/.turn-bench-cache-2026-09-03/xdg" TORCH_HOME="$PWD/.turn-bench-cache-2026-09-03/torch" POCKET_TTS_NO_BEARTYPE=1 CUDA_VISIBLE_DEVICES='' OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 .venv-turn-2026-09-03/bin/python -m pocket_tts generate --language french_24l --voice estelle --text 'Bonjour Lisa, ceci est un essai local.' --output-path .turn-bench-artifacts-2026-09-03/tts-smoke.wav --device cpu --quiet
$ file .turn-bench-artifacts-2026-09-03/tts-smoke.wav
RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, mono 24000 Hz
~~~

Le cache local fait 673M; les artefacts finaux font 3.2M. Les WAV n’ont
jamais été lus par un haut-parleur ou un périphérique : ils servent seulement
de tableaux PCM au banc.

### Licence des poids v1-mini

La licence lue est la [LiveKit Model License](https://huggingface.co/livekit/turn-detector/blob/main/LICENSE)
(texte consulté le 2026-09-02). La commande de contrôle et sa sortie
pertinente sont :

~~~console
$ curl -fsSL https://huggingface.co/livekit/turn-detector/raw/main/LICENSE | rg -n 'freely|standalone|nonexclusive|Limitation on Use|not to use any LiveKit Materials|distribute or otherwise|Last Updated'
7:   described below, you may use these LiveKit models freely but can only use them
9:   on a standalone basis or with any other frameworks.
42:   nonexclusive, nontransferable, worldwide, royalty-free license under LiveKit's
46:   Limitation on Use. As a condition to your use of the LiveKit Materials, you
47:   agree: (i) not to use any LiveKit Models on a standalone basis or with any
48:   frameworks other than LiveKit Agents; (ii) not to use any LiveKit Materials or
51:   LiveKit Models; or (iii) distribute or otherwise make available the LiveKit
113:Last Updated: November 25, 2024
~~~

Lecture opérationnelle pour Lisa : l’usage personnel et l’usage dans un robot
sont autorisés par le périmètre général de la licence, à condition d’exécuter
le modèle avec **LiveKit Agents**. La licence accorde des droits mondiaux,
gratuits, non exclusifs et non transférables d’utiliser, copier, reproduire,
distribuer et créer des dérivés des matériaux. Elle interdit l’exécution
standalone ou via un autre framework, l’emploi des matériaux/sorties pour
améliorer ou développer un autre modèle non-LiveKit, et la redistribution sans
les conditions de la licence et sa notice de copyright. Les dérivés créés
restent soumis à ces conditions. Le plugin et le SDK portent
Apache-2.0 dans leurs métadonnées ; ce n’est pas la licence des poids. Cette
lecture est une synthèse technique, pas un avis juridique.

La licence du code et des poids Silero utilisée par le plugin est répertoriée
comme [MIT dans le dépôt officiel Silero VAD](https://github.com/snakers4/silero-vad).
La licence du code Pocket TTS est [MIT](https://github.com/kyutai-labs/pocket-tts);
le banc ne redistribue toutefois aucun poids dans Git.

## Protocole effectivement exécuté

Le script reproductible est
[benchmarks/turn-detector/bench_fr.py](benchmarks/turn-detector/bench_fr.py).
Il synthétise avec Pocket TTS french_24l, voix estelle, puis resample chaque
cas en PCM mono 16 kHz. Les 10 cas pause-* ont une première proposition avec
prosodie non finale (…) et un silence numérique exact de 900, 950, 1000, 1050,
1100, 1150, 1200, 1250, 1300 ou 1350 ms, puis la reprise ; les 10 cas
complete-* n’ont pas de pause intra-phrase. Un silence terminal de 1200 ms
est ajouté pour permettre l’observation, et les fins de parole sont conservées
dans manifest.json.

Pour chaque WAV et chaque réglage, les mêmes frames de 32 ms sont poussées sans
horloge audio réelle :

* VAD seul : silero.VAD.load(..., min_silence_duration=300/500/800 ms,
  force_cpu=True), décision au premier END_OF_SPEECH ;
* pile : même candidat Silero, son préfixe est donné à
  inference.TurnDetector(version="v1-mini"), puis une décision de style
  LiveKit est appliquée avec seuil français 0.285, délai court 300 ms si la
  probabilité atteint le seuil, sinon maintien à 2500 ms ;
* fausse coupe : décision avant resume_ms d’un cas pause-* ; délai :
  décision moins la fin de parole de référence (première clause pour une
  pause, fin finale pour un complet).

Commande finale, après mise en cache TTS :

~~~console
$ python3 -m py_compile benchmarks/turn-detector/bench_fr.py
$ HF_HOME="$PWD/.turn-bench-cache-2026-09-03/hf" XDG_CACHE_HOME="$PWD/.turn-bench-cache-2026-09-03/xdg" TORCH_HOME="$PWD/.turn-bench-cache-2026-09-03/torch" POCKET_TTS_NO_BEARTYPE=1 CUDA_VISIBLE_DEVICES='' OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 .venv-turn-2026-09-03/bin/python benchmarks/turn-detector/bench_fr.py --synthesize --output-dir .turn-bench-artifacts-2026-09-03
{
  "run": {
    "utterances": 20,
    "wall_elapsed_ms": 3932.422,
    "process_cpu_ms": 5442.428,
    "one_core_cpu_pct": 138.399,
    "model": "turn-detector-v1-mini",
    "vad": "silero",
    "sample_rate": 16000,
    "cpu_only": true
  }
}
~~~

## Résultats finaux

Les nombres complets sont dans
.turn-bench-artifacts-2026-09-03/summary.json et
measurements.json (artefacts exclus du commit). Médiane VAD est le temps
CPU cumulé des inférences Silero pour un énoncé ; médiane EOT est le temps de
l’inférence v1-mini pour un candidat.

| Chaîne | Silence | Fausses coupes | Taux | Médiane délai complets | Médiane délai pauses | Médiane délai tous | Médiane VAD | Médiane EOT |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Silero seul | 300 ms | 10/10 | 100 % | 408.271 ms | 379.688 ms | 402.833 ms | 27.084 ms | — |
| Silero seul | 500 ms | 10/10 | 100 % | 600.271 ms | 572.646 ms | 594.833 ms | 25.406 ms | — |
| Silero seul | 800 ms | 10/10 | 100 % | 888.271 ms | 864.667 ms | 883.229 ms | 22.541 ms | — |
| v1-mini + Silero | 300 ms | 8/10 | 80 % | 425.419 ms | 399.834 ms | 422.928 ms | 27.084 ms | 16.624 ms |
| v1-mini + Silero | 500 ms | 10/10 | 100 % | 620.696 ms | 591.549 ms | 612.188 ms | 25.406 ms | 18.057 ms |
| v1-mini + Silero | 800 ms | 9/10 | 90 % | 905.041 ms | 885.204 ms | 899.829 ms | 22.541 ms | 16.233 ms |

Le banc a donc mesuré 60 parcours VAD et 60 sondes v1-mini. Le temps global
CPU est 5442.428 ms pour 3932.422 ms murales, soit 138.399 % d’un cœur
en équivalent parallèle ; la machine expose 24 CPU / 12 threads Torch. La
latence EOT observée est de 16.233 à 18.057 ms en médiane, hors acquisition et
STT.

## Conclusion de banc

Sur cette voix Pocket TTS synthétique, le gain ressenti n’est **pas démontré
comme suffisant** pour Lisa : la pile réduit de 20 points les fausses coupes à
300 ms et de 10 points à 800 ms, mais ne réduit rien à 500 ms. Elle ajoute
environ 20 ms de délai médian aux phrases complètes dans les trois réglages.
Les pauses artificielles produisent aussi des probabilités v1-mini parfois
élevées ; ce résultat ne doit pas être extrapolé à la prosodie humaine réelle.
La pile doit donc rester opt-in et être recalibrée sur un futur corpus humain
consenti avant toute valeur par défaut. Le point positif prouvé est le faible
coût d’inférence CPU, pas une validation produit de l’EOT.

## Plan de câblage Lisa et changement livré

Le câblage recommandé est buddy-sense Rust → service Python local lié à
127.0.0.1:3137 (port supérieur à 3100), qui conserve
TurnDetector(v1-mini) + Silero et n’émet vers Code Buddy qu’une décision sans
audio : turnDetector, turnProbability, turnThreshold, turnEnded et
turnDetectionMs. Aucun service n’est démarré par ce commit. Une alternative
est de joindre cette décision au même événement transcript_final côté
speech-reaction.ts; c’est le point de consommation implémenté ici, sans
remplacer le STT, le VAD existant ni le flux audio.

Le code ajoute src/sensory/turn-detector.ts et rend speech-reaction.ts capable
de consommer une décision injectée par un faux service ou un payload LiveKit,
uniquement quand CODEBUDDY_SENSORY_TURN_DETECTOR=livekit. Une décision
explicite positive court-circuite le maintien heuristique d’une phrase
incomplète ; une décision négative la maintient. Sans la variable, le provider
n’est pas appelé et le chemin existant reste inchangé. Le test Vitest a été
exécuté rouge avant le consommateur puis vert après :

~~~console
$ npx vitest run tests/sensory/speech-reaction.test.ts -t 'consumes an enabled LiveKit end-of-turn decision'
1 failed (la décision du faux provider n’était pas consommée; Number of calls: 0)

$ npx vitest run tests/sensory/speech-reaction.test.ts -t 'LiveKit|existing path cold'
Test Files 1 passed; Tests 2 passed | 45 skipped
~~~

## État final

Installation : **OK**, pins vérifiés ; poids/caches dans le clone et exclus.
Banc : **OK**, 20 énoncés, 6 conditions, CPU-only, aucune lecture audio.
Licence : **lue et synthétisée**, LiveKit Model License respectée dans le plan.
Intégration : **opt-in uniquement**, aucun service lancé et aucune API payante.
Tests : **rouge puis vert** pour le faux service ; vérifications finales à
reporter avec le hash du commit de livraison.
