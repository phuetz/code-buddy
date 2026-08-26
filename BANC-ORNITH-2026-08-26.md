# BANC-ORNITH-2026-08-26

## Objet et protocole

Banc W5 sur dix symptômes issus de l'historique Git et des rapports `DEFAUTS-*.md` de ce dépôt. Les prompts injectent uniquement des extraits de travail réels ; chaque réponse est scorée par présence/absence d'identifiants, valeurs ou fichiers, avec un cas de format à exactement trois phrases. Le score `JUSTE` signifie que tous les critères codés du cas sont satisfaits ; il ne mesure pas la qualité stylistique.

Endpoint : `http://100.73.222.64:11434/api/generate`, `stream:false`, température `0.2`, `num_predict:512`. Chaque modèle a été exécuté seul ; le script décharge les deux autres modèles cibles par `keep_alive:0` avant chaque bascule, sans arrêter Ollama. Les trois répétitions de chaque cas ont été résumées par médiane. `eval_count / eval_duration` donne le débit ; `total_duration` Ollama donne la latence totale. Résultats bruts : [`BANC-ORNITH-RAW-2026-08-26-v2.json`](BANC-ORNITH-RAW-2026-08-26-v2.json).

## Les dix cas

| ID | Épreuve | Réponse/critère mécanique | Sources réelles | `num_ctx` |
|---|---|---|---|---:|
| W5-01 | Diagnostic sur long contexte : boucle agentique unifiée | Tous les critères codés dans le script | `src/agent/execution/agent-executor.ts`; `commit 19221988 (rapport CB16)` | 32768 |
| W5-02 | Lecture d'un message d'erreur : workers non entier | Tous les critères codés dans le script | `DEFAUTS-ERREURS-2026-08-25.md, E4`; `commit 80216860` | 8192 |
| W5-03 | Raisonnement concurrent : ledger JSONL Rust/TypeScript | `write_all`, JSON + `\n` en une écriture, disparition des lignes déchirées | `DEFAUTS-MEMOIRE-PERSISTANTE-2026-08-25.md, Q2`; `buddy-memory/src/store.rs`; `commit 6be941cc` | 8192 |
| W5-04 | Format imposé : trois phrases sur ENOENT | 3 phrases exactement + `ENOENT`, chemin, `src/index.ts`, sans stack | `DEFAUTS-ERREURS-2026-08-25.md, E6`; `src/index.ts` | 4096 |
| W5-05 | Registre : six outils enregistrés mais invisibles au LLM | Tous les critères codés dans le script | `DEFAUTS-REGISTRES-2026-08-25.md, détail du croisement`; `commit CB5` | 8192 |
| W5-06 | Priorité de configuration : modèle CLI réellement choisi | Tous les critères codés dans le script | `DEFAUTS-REGISTRES-2026-08-25.md, Deux sources de vérité`; `src/index.ts:609-635` | 8192 |
| W5-07 | Sécurité : variable d'environnement Python à bloquer | Tous les critères codés dans le script | `DEFAUTS de sécurité du 25/08 dans la coordination`; `src/tools/bash/security-patterns.ts`; `src/utils/subprocess-env.ts`; `commit 32af1725` | 8192 |
| W5-08 | Deltas streaming : marqueur coupé entre deux chunks | Tous les critères codés dans le script | `src/agent/streaming/streaming-handler.ts`; `tests/agent/streaming/output-sanitization.test.ts`; `commit 38a7e6c5` | 12288 |
| W5-09 | Sanitisation de prose distante : résultat exact | `Réponse distante`, sans bloc `<think>`, secret ni ZWSP | `src/fleet/peer-text-sanitizer.ts`; `src/council/peers.ts`; `commit 01b9dff8` | 4096 |
| W5-10 | Boucle séquentielle : limite de tours durable | Tous les critères codés dans le script | `src/agent/execution/agent-executor.ts`; `commit 4961c91c` | 12288 |

## Résultats médians

| Modèle | Cas | Justesse (3) | Médiane tok/s | Médiane latence totale (ms) | API OK |
|---|---|---:|---:|---:|---:|
| `ornith-1.5:35b` | W5-01 | 3/3 | 140.6 | 3867 | 3/3 |
| `ornith-1.5:35b` | W5-02 | 0/3 | 154.3 | 3489 | 3/3 |
| `ornith-1.5:35b` | W5-03 | 3/3 | 155.3 | 3540 | 3/3 |
| `ornith-1.5:35b` | W5-04 | 0/3 | 155.0 | 3468 | 3/3 |
| `ornith-1.5:35b` | W5-05 | 3/3 | 152.3 | 2891 | 3/3 |
| `ornith-1.5:35b` | W5-06 | 0/3 | 155.0 | 3048 | 3/3 |
| `ornith-1.5:35b` | W5-07 | 0/3 | 153.7 | 3440 | 3/3 |
| `ornith-1.5:35b` | W5-08 | 0/3 | n/d | n/d | 0/3 |
| `ornith-1.5:35b` | W5-09 | 1/3 | 154.6 | 3472 | 3/3 |
| `ornith-1.5:35b` | W5-10 | 3/3 | 153.3 | 2483 | 3/3 |
| `qwen3.8:27b` | W5-01 | 2/3 | 72.8 | 7488 | 3/3 |
| `qwen3.8:27b` | W5-02 | 0/3 | 68.7 | 8205 | 3/3 |
| `qwen3.8:27b` | W5-03 | 0/3 | 52.3 | 10711 | 3/3 |
| `qwen3.8:27b` | W5-04 | 0/3 | 62.3 | 9104 | 3/3 |
| `qwen3.8:27b` | W5-05 | 3/3 | 58.3 | 2874 | 3/3 |
| `qwen3.8:27b` | W5-06 | 0/3 | 57.1 | 9592 | 3/3 |
| `qwen3.8:27b` | W5-07 | 0/3 | 57.7 | 9388 | 3/3 |
| `qwen3.8:27b` | W5-08 | 2/3 | 52.5 | 10348 | 3/3 |
| `qwen3.8:27b` | W5-09 | 1/3 | 55.8 | 3901 | 3/3 |
| `qwen3.8:27b` | W5-10 | 3/3 | 58.6 | 5139 | 3/3 |
| `deepseek-r1:32b` | W5-01 | 0/3 | n/d | n/d | 0/3 |
| `deepseek-r1:32b` | W5-02 | 1/3 | 38.1 | 13645 | 3/3 |
| `deepseek-r1:32b` | W5-03 | 1/3 | 37.9 | 13711 | 3/3 |
| `deepseek-r1:32b` | W5-04 | 2/3 | 37.9 | 12848 | 3/3 |
| `deepseek-r1:32b` | W5-05 | 3/3 | 37.8 | 9540 | 3/3 |
| `deepseek-r1:32b` | W5-06 | 0/3 | 37.3 | 9811 | 3/3 |
| `deepseek-r1:32b` | W5-07 | 0/3 | 37.1 | 11555 | 3/3 |
| `deepseek-r1:32b` | W5-08 | 0/3 | 36.6 | 14053 | 3/3 |
| `deepseek-r1:32b` | W5-09 | 0/3 | 37.2 | 13931 | 3/3 |
| `deepseek-r1:32b` | W5-10 | 1/3 | 37.2 | 7817 | 3/3 |

## Synthèse mécanique

| Modèle | Justesse totale | API OK |
|---|---:|---:|
| `ornith-1.5:35b` | 13/30 | 27/30 |
| `qwen3.8:27b` | 11/30 | 30/30 |
| `deepseek-r1:32b` | 8/30 | 27/30 |

## Incidents API constatés

Ces appels font partie des trois répétitions demandées et ne sont pas transformés en réponse juste :
- `ornith-1.5:35b` / W5-08 / répétition 1 : `HTTPError: HTTP Error 500: Internal Server Error`.
- `ornith-1.5:35b` / W5-08 / répétition 2 : `HTTPError: HTTP Error 500: Internal Server Error`.
- `ornith-1.5:35b` / W5-08 / répétition 3 : `HTTPError: HTTP Error 500: Internal Server Error`.
- `deepseek-r1:32b` / W5-01 / répétition 1 : `TimeoutError: timed out`.
- `deepseek-r1:32b` / W5-01 / répétition 2 : `TimeoutError: timed out`.
- `deepseek-r1:32b` / W5-01 / répétition 3 : `TimeoutError: timed out`.

## Lecture prudente

Le banc mesure ce jeu précis de dix tâches, ce prompt précis, cette quantification, ce serveur et cette configuration. Une différence de justesse ici est une différence sur les critères mécaniques retenus, pas une note générale d'intelligence ; le débit est `eval_count/eval_duration`, pas une promesse de débit applicatif. Les médianes réduisent l'effet d'une mesure isolée mais ne remplacent pas une étude de variance.

Dix cas ne permettent PAS de conclure qu'un modèle est globalement meilleur, plus fiable sur tous les dépôts, supérieur sur toutes les langues ou tous les contextes, ni que le débit observé se généralisera à d'autres tailles de contexte, quantifications, charges GPU, prompts ou versions Ollama. Ils ne permettent pas non plus de conclure à une différence statistiquement significative au-delà de ce petit échantillon, ni d'évaluer la qualité humaine des explications puisque le score est volontairement mécanique.

## Reproductibilité et vérifications

Commande de rejeu :

```bash
python3 bench-ornith-2026-08-26.py
```

Le script refuse les modèles inconnus, ne lance aucune requête en parallèle et écrit après chaque mesure. Les fichiers audités restent en lecture seule ; aucun service local n'est arrêté et aucune API payante n'est utilisée.
