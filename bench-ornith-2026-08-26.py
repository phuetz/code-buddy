#!/usr/bin/env python3
"""Rejoue le banc W5 sur l'endpoint Ollama local de GPU node.

Le script est volontairement séquentiel : il termine toutes les requêtes d'un
modèle avant de demander le modèle suivant. Les cas et les critères sont
construits à partir des fichiers et commits présents dans ce dépôt ; aucune
écriture n'est faite dans les dépôts audités. Les résultats bruts sont écrits
dans le dépôt courant pour permettre un audit ou un rejeu partiel.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DEFAULT_ENDPOINT = "http://192.0.2.42:11434"
MODELS = ("ornith-1.5:35b", "qwen3.8:27b", "deepseek-r1:32b")
RAW_PATH = ROOT / "BANC-ORNITH-RAW-2026-08-26-v2.json"


def read_repo(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8", errors="replace")


def excerpt(path: str, start_line: int, end_line: int) -> str:
    lines = read_repo(path).splitlines()
    return "\n".join(
        f"{line_number}: {lines[line_number - 1]}"
        for line_number in range(start_line, min(end_line, len(lines)) + 1)
    )


def git_show(spec: str) -> str:
    try:
        return subprocess.check_output(
            ["git", "show", "--format=", *shlex.split(spec)],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return "(extrait Git indisponible dans ce checkout)"


def check_all(*items: str) -> dict[str, Any]:
    return {"kind": "all", "items": list(items)}


def check_any(*items: str) -> dict[str, Any]:
    return {"kind": "any", "items": list(items)}


def check_regex(pattern: str) -> dict[str, Any]:
    return {"kind": "regex", "pattern": pattern}


def check_absent(*items: str) -> dict[str, Any]:
    return {"kind": "absent", "items": list(items)}


def case_specs() -> list[dict[str, Any]]:
    long_agent_file = read_repo("src/agent/execution/agent-executor.ts")
    streaming_diff = git_show("38a7e6c5 -- src/agent/streaming/streaming-handler.ts")
    rounds_diff = git_show("4961c91c -- src/agent/execution/agent-executor.ts")
    research_source = excerpt("src/commands/research/index.ts", 181, 202)
    model_source = excerpt("src/index.ts", 609, 631)
    rust_source = excerpt("buddy-memory/src/store.rs", 220, 233)
    env_source = "\n".join(
        [
            excerpt("src/tools/bash/security-patterns.ts", 217, 225),
            excerpt("src/utils/subprocess-env.ts", 50, 57),
            excerpt("src/security/env-blocklist.ts", 30, 37),
        ]
    )

    return [
        {
            "id": "W5-01",
            "title": "Diagnostic sur long contexte : boucle agentique unifiée",
            "kind": "long_context",
            "num_ctx": 32768,
            "references": [
                "src/agent/execution/agent-executor.ts",
                "commit 19221988 (rapport CB16)",
            ],
            "prompt": (
                "Tu fais un diagnostic de maintenance sur le vrai fichier "
                "src/agent/execution/agent-executor.ts ci-dessous. Le défaut à "
                "vérifier est une divergence possible entre le chemin séquentiel "
                "et le chemin streaming de la boucle agentique. Sans proposer de "
                "code, cite le nom de la fonction qui porte la source de vérité, "
                "puis les deux méthodes adaptatrices qui la consomment. Donne "
                "aussi le fichier. Réponse courte, avec les identifiants exacts.\n\n"
                "--- FICHIER RÉEL (contexte long) ---\n"
                + long_agent_file
                + "\n--- FIN DU FICHIER ---"
            ),
            "checks": [
                check_all(
                    "runTurnLoop",
                    "processUserMessage",
                    "processUserMessageStream",
                    "agent-executor.ts",
                )
            ],
        },
        {
            "id": "W5-02",
            "title": "Lecture d'un message d'erreur : workers non entier",
            "kind": "error_reading",
            "num_ctx": 8192,
            "references": ["DEFAUTS-ERREURS-2026-08-25.md, E4", "commit 80216860"],
            "prompt": (
                "Voici une observation réelle du CLI Code Buddy, issue de "
                "DEFAUTS-ERREURS-2026-08-25.md :\n\n"
                "$ buddy research x --workers abc\n"
                "Wide Research démarre avec Items: 5, puis une Unhandled promise "
                "rejection et un fichier dans ~/.codebuddy/recovery/.\n\n"
                "Quelle correction de comportement faut-il appliquer ? Réponds en "
                "citant la valeur fautive, l'option, la plage valide et le code "
                "de sortie attendu. Ne parle pas d'une correction inventée. Voici "
                "l'extrait de production réel qui définit le contrat :\n\n"
                + research_source
            ),
            "checks": [
                check_all("--workers", "abc"),
                check_regex(r"1\s*(?:[–-]|à|to)\s*20"),
                check_any("exit 1", "code 1", "sortie 1", "refuser", "reject"),
            ],
        },
        {
            "id": "W5-03",
            "title": "Raisonnement concurrent : ledger JSONL Rust/TypeScript",
            "kind": "concurrency",
            "num_ctx": 8192,
            "references": [
                "DEFAUTS-MEMOIRE-PERSISTANTE-2026-08-25.md, Q2",
                "buddy-memory/src/store.rs",
                "commit 6be941cc",
            ],
            "prompt": (
                "Analyse ce défaut réel de concurrence dans le ledger JSONL partagé. "
                "Avant le correctif, Rust écrivait : writeln!(f, \"{}\", line). "
                "Une trace système montrait d'abord write(JSON), puis write(\\n). "
                "Un writer TypeScript appendFileSync pouvait donc s'intercaler. "
                "La reproduction mixte Node + Rust comptait 298 lignes JSON "
                "déchirées sur 2400. Quelle primitive et quelle unité d'écriture "
                "corrigent mécaniquement cette course ? Cite aussi le symptôme "
                "qui disparaît. Réponse courte, pas de patch. Voici le code réel "
                "après le correctif, dont tu dois extraire le contrat :\n\n"
                + rust_source
            ),
            "checks": [
                check_all("write_all", "JSON"),
                check_any("\\n", "newline", "nouvelle ligne", "line break", "saut de ligne"),
                check_any("une seule", "un seul", "unité unique", "unique", "single", "one"),
                check_any("torn", "déchir", "splice", "atom"),
            ],
        },
        {
            "id": "W5-04",
            "title": "Format imposé : trois phrases sur ENOENT",
            "kind": "format",
            "num_ctx": 4096,
            "references": ["DEFAUTS-ERREURS-2026-08-25.md, E6", "src/index.ts"],
            "prompt": (
                "À partir de ce cas réel : la commande `buddy -d <absent> -p hi` "
                "affichait une pile Node contenant ENOENT et "
                "wrappedChdir. Donne exactement TROIS phrases, une par ligne, "
                "et termine chaque phrase par un point. Phrase 1 : le diagnostic "
                "et le chemin manquant. Phrase 2 : le contrat d'affichage attendu "
                "(une ligne, sans stack). Phrase 3 : le fichier de Code Buddy à "
                "citer. N'ajoute ni titre, ni puce, ni quatrième phrase. Le rapport "
                "réel donne le chemin corrigé `src/index.ts:1650-1657` et "
                "`:2297-2304` ; utilise ce fichier, pas un nom inventé."
            ),
            "checks": [
                check_regex(r"(?:[^.!?]*[.!?]){3}\s*$"),
                check_all("ENOENT", "src/index.ts"),
                check_any("stack", "pile"),
                check_any("chemin", "path"),
            ],
        },
        {
            "id": "W5-05",
            "title": "Registre : six outils enregistrés mais invisibles au LLM",
            "kind": "registry_crossing",
            "num_ctx": 8192,
            "references": ["DEFAUTS-REGISTRES-2026-08-25.md, détail du croisement", "commit CB5"],
            "prompt": (
                "Le rapport réel CB5 donne ce croisement avant correction : des "
                "handlers et métadonnées existent, mais le modèle ne reçoit pas "
                "leur schéma. Il demande explicitement de retrouver les SIX noms "
                "d'outils finis rendus invisibles au LLM dans ce lot. Donne la liste "
                "exacte, séparée par des virgules, sans ajouter d'autres outils.\n\n"
                "Indices réels du rapport : apply_patch, community_search, "
                "memory_propose, screen_memory, csv_analyze et design_system sont "
                "cités comme finis et câblés d'un côté."
            ),
            "checks": [
                check_all(
                    "apply_patch",
                    "community_search",
                    "memory_propose",
                    "screen_memory",
                    "csv_analyze",
                    "design_system",
                )
            ],
        },
        {
            "id": "W5-06",
            "title": "Priorité de configuration : modèle CLI réellement choisi",
            "kind": "configuration_reasoning",
            "num_ctx": 8192,
            "references": ["DEFAUTS-REGISTRES-2026-08-25.md, Deux sources de vérité", "src/index.ts:609-635"],
            "prompt": (
                "Le rapport réel signale une divergence : le module "
                "src/config/resolve-model.ts est testé comme si le modèle sauvegardé "
                "gagnait sur l'environnement, mais le vrai boot CLI n'appelle pas ce "
                "module. Quand un modèle sauvegardé et une variable d'environnement "
                "sont tous deux présents, quel nom de variable gagne réellement, "
                "dans quel fichier se trouve le chemin de production, et quelle "
                "source est donc prioritaire ? Réponse en une ou deux phrases.\n\n"
                "Extrait réel du boot de production :\n"
                + model_source
            ),
            "checks": [
                check_all("GROK_MODEL", "src/index.ts"),
                check_any("environment", "environnement", "env"),
                check_any("saved", "sauvegard", "persist"),
            ],
        },
        {
            "id": "W5-07",
            "title": "Sécurité : variable d'environnement Python à bloquer",
            "kind": "security_reading",
            "num_ctx": 8192,
            "references": [
                "DEFAUTS de sécurité du 25/08 dans la coordination",
                "src/tools/bash/security-patterns.ts",
                "src/utils/subprocess-env.ts",
                "commit 32af1725",
            ],
            "prompt": (
                "Un audit réel a établi qu'un .env hostile pouvait faire charger un "
                "faux module Python avant la bibliothèque standard dans un sous-processus. "
                "Le correctif retire cette variable de deux allowlists et la place "
                "dans BLOCKED_ENV_VARS. Quel est le nom exact de la variable, et cite "
                "les deux fichiers de filtrage concernés ? Réponse courte. Extraits "
                "réels du correctif :\n\n"
                + env_source
            ),
            "checks": [
                check_all("PYTHONPATH", "security-patterns.ts", "subprocess-env.ts"),
                check_any("BLOCKED_ENV_VARS", "blocklist", "bloqu"),
            ],
        },
        {
            "id": "W5-08",
            "title": "Deltas streaming : marqueur coupé entre deux chunks",
            "kind": "streaming_reasoning",
            "num_ctx": 12288,
            "references": [
                "src/agent/streaming/streaming-handler.ts",
                "tests/agent/streaming/output-sanitization.test.ts",
                "commit 38a7e6c5",
            ],
            "prompt": (
                "Voici le diff réel du correctif 38a7e6c5 sur le streaming :\n\n"
                + streaming_diff
                + "\n\nExplique en termes opérationnels pourquoi sanitizeLLMOutput appliqué "
                "séparément à chaque delta ne suffit pas quand un marqueur est coupé "
                "entre deux chunks. Cite le nom de la méthode incrémentale, le buffer "
                "d'attente et le fichier où ils vivent."
            ),
            "checks": [
                check_all("sanitizeStreamingDelta", "streaming-handler.ts"),
                check_any("pendingDisplayContent", "pending", "buffer"),
                check_any("chunk", "delta", "morceau", "fragment"),
            ],
        },
        {
            "id": "W5-09",
            "title": "Sanitisation de prose distante : résultat exact",
            "kind": "transformation",
            "num_ctx": 4096,
            "references": [
                "src/fleet/peer-text-sanitizer.ts",
                "src/council/peers.ts",
                "commit 01b9dff8",
            ],
            "prompt": (
                "Le council reçoit cette prose d'un pair Fleet non contrôlé : "
                "<think>raisonnement secret</think> Réponse distante.\u200b "
                "Applique le contrat réel de sanitizePeerText : enlève le bloc de "
                "raisonnement et le caractère invisible, conserve le texte utile. "
                "Retourne UNIQUEMENT le texte final nettoyé, sans explication ni "
                "guillemets."
            ),
            "checks": [
                check_all("Réponse distante"),
                check_absent("raisonnement secret", "<think>", "</think>", "\u200b"),
            ],
        },
        {
            "id": "W5-10",
            "title": "Boucle séquentielle : limite de tours durable",
            "kind": "agent_loop",
            "num_ctx": 12288,
            "references": ["src/agent/execution/agent-executor.ts", "commit 4961c91c"],
            "prompt": (
                "Le diff réel du correctif 4961c91c est ci-dessous :\n\n"
                + rounds_diff
                + "\n\nDans le chemin séquentiel, quand maxToolRounds est atteint, quel texte "
                "exact doit devenir une entrée assistant durable, et dans quelles "
                "deux collections doit-il être ajouté pour que streaming et séquentiel "
                "aient le même transcript ? Cite aussi la boucle source de vérité. "
                "Réponds en quatre lignes maximum, sans préambule. Le fichier du diff "
                "contient la méthode `runTurnLoop`, qui est la boucle à citer."
            ),
            "checks": [
                check_all("Maximum tool execution rounds reached", "history", "messages", "runTurnLoop"),
                check_any("assistant", "assistant entry", "entrée assistant"),
            ],
        },
    ]


def score_text(text: str, checks: list[dict[str, Any]]) -> tuple[bool, list[dict[str, Any]]]:
    folded = text.casefold()
    details: list[dict[str, Any]] = []
    for check in checks:
        kind = check["kind"]
        if kind in ("all", "any", "absent"):
            items = check["items"]
            if kind == "all":
                matched = [item for item in items if item.casefold() in folded]
                ok = len(matched) == len(items)
            elif kind == "any":
                matched = [item for item in items if item.casefold() in folded]
                ok = bool(matched)
            else:
                matched = [item for item in items if item.casefold() not in folded]
                ok = len(matched) == len(items)
            details.append({"kind": kind, "ok": ok, "matched": matched, "items": items})
        elif kind == "regex":
            ok = re.search(check["pattern"], text, flags=re.IGNORECASE | re.DOTALL) is not None
            details.append({"kind": kind, "ok": ok, "pattern": check["pattern"]})
        else:
            details.append({"kind": kind, "ok": False, "error": "unknown check"})
    return all(item["ok"] for item in details), details


def ollama_generate(endpoint: str, model: str, prompt: str, num_ctx: int) -> dict[str, Any]:
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_ctx": num_ctx,
            "num_predict": 512,
        },
    }
    request = Request(
        endpoint.rstrip("/") + "/api/generate",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        # Une génération qui ne revient pas en trois minutes est une mesure
        # d'échec latence, pas une raison de bloquer toute la campagne.
        with urlopen(request, timeout=180) as response:
            body = json.load(response)
        wall_ms = (time.perf_counter() - started) * 1000
        eval_count = body.get("eval_count")
        eval_duration = body.get("eval_duration")
        total_duration = body.get("total_duration")
        eval_seconds = eval_duration / 1_000_000_000 if isinstance(eval_duration, (int, float)) else None
        tok_s = eval_count / eval_seconds if eval_count is not None and eval_seconds and eval_seconds > 0 else None
        total_ms = total_duration / 1_000_000 if isinstance(total_duration, (int, float)) else wall_ms
        response_text = body.get("response", "")
        thinking_text = body.get("thinking", "")
        correct, checks = score_text(response_text, [])
        del correct, checks
        return {
            "ok": True,
            "response": response_text,
            "thinking": thinking_text,
            "eval_count": eval_count,
            "eval_duration_ns": eval_duration,
            "eval_tok_s": tok_s,
            "total_duration_ns": total_duration,
            "total_ms": total_ms,
            "wall_ms": wall_ms,
        }
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        wall_ms = (time.perf_counter() - started) * 1000
        return {"ok": False, "error": f"{type(error).__name__}: {error}", "wall_ms": wall_ms}


def ollama_unload(endpoint: str, model: str) -> None:
    """Décharge un modèle cible sans arrêter le serveur Ollama."""
    payload = {"model": model, "prompt": "", "stream": False, "keep_alive": 0}
    request = Request(
        endpoint.rstrip("/") + "/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        response.read()


def load_existing() -> dict[str, Any]:
    if not RAW_PATH.exists():
        return {"metadata": {}, "runs": []}
    try:
        value = json.loads(RAW_PATH.read_text(encoding="utf-8"))
        if isinstance(value, dict) and isinstance(value.get("runs"), list):
            return value
    except (OSError, json.JSONDecodeError):
        pass
    return {"metadata": {}, "runs": []}


def run_bench(endpoint: str, repetitions: int, selected_models: list[str], selected_cases: list[str]) -> dict[str, Any]:
    specs = {case["id"]: case for case in case_specs()}
    case_ids = selected_cases or list(specs)
    unknown_cases = [case_id for case_id in case_ids if case_id not in specs]
    if unknown_cases:
        raise SystemExit(f"Cas inconnus : {', '.join(unknown_cases)}")
    unknown_models = [model for model in selected_models if model not in MODELS]
    if unknown_models:
        raise SystemExit(f"Modèles inconnus : {', '.join(unknown_models)}")

    raw = load_existing()
    raw["metadata"] = {
        "endpoint": endpoint,
        "models": selected_models,
        "repetitions": repetitions,
        "temperature": 0.2,
        "stream": False,
        "script": Path(__file__).name,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    runs = raw.setdefault("runs", [])
    for model in selected_models:
        # OLLAMA_KEEP_ALIVE est long sur GPU node. Décharger les autres modèles
        # cibles avant chaque changement garantit qu'un rejeu ne charge jamais
        # deux gros modèles simultanément.
        for other_model in selected_models:
            if other_model != model:
                print(f"déchargement ciblé de {other_model} avant {model}", flush=True)
                try:
                    ollama_unload(endpoint, other_model)
                except (HTTPError, URLError, TimeoutError, OSError) as error:
                    raise SystemExit(f"Impossible de décharger {other_model} : {error}") from error
        print(f"\n=== modèle {model} (séquentiel) ===", flush=True)
        for case_id in case_ids:
            case = specs[case_id]
            for repetition in range(1, repetitions + 1):
                if any(
                    run.get("model") == model
                    and run.get("case_id") == case_id
                    and run.get("repetition") == repetition
                    for run in runs
                ):
                    print(f"{model} {case_id} répétition {repetition}/{repetitions} — déjà sauvegardée", flush=True)
                    continue
                print(f"{model} {case_id} répétition {repetition}/{repetitions}", flush=True)
                measurement = ollama_generate(endpoint, model, case["prompt"], case["num_ctx"])
                response_text = measurement.get("response", "") if measurement.get("ok") else ""
                correct, check_details = score_text(response_text, case["checks"])
                run = {
                    "model": model,
                    "case_id": case_id,
                    "repetition": repetition,
                    "num_ctx": case["num_ctx"],
                    "temperature": 0.2,
                    "stream": False,
                    "correct": correct,
                    "check_details": check_details,
                    **measurement,
                }
                runs.append(run)
                RAW_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                if measurement.get("ok"):
                    speed = measurement.get("eval_tok_s")
                    speed_text = f"{speed:.1f} tok/s" if isinstance(speed, (int, float)) else "débit n/d"
                    print(
                        f"  {'JUSTE' if correct else 'FAUX'} — {speed_text}, "
                        f"latence {measurement.get('total_ms', 0):.0f} ms",
                        flush=True,
                    )
                else:
                    print(f"  ÉCHEC API — {measurement.get('error')}", flush=True)
    raw["metadata"]["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    RAW_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return raw


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def summarize(raw: dict[str, Any]) -> dict[str, Any]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for run in raw.get("runs", []):
        grouped.setdefault((run.get("model", ""), run.get("case_id", "")), []).append(run)
    summary: dict[str, Any] = {}
    for key, runs in grouped.items():
        model, case_id = key
        good_runs = [run for run in runs if run.get("ok")]
        speeds = [run["eval_tok_s"] for run in good_runs if isinstance(run.get("eval_tok_s"), (int, float))]
        latencies = [run["total_ms"] for run in good_runs if isinstance(run.get("total_ms"), (int, float))]
        summary[f"{model}\t{case_id}"] = {
            "model": model,
            "case_id": case_id,
            "n": len(runs),
            "ok_n": len(good_runs),
            "correct_n": sum(1 for run in runs if run.get("correct")),
            "median_tok_s": median(speeds),
            "median_total_ms": median(latencies),
            "runs": runs,
        }
    return summary


def format_number(value: Any, digits: int = 1) -> str:
    if not isinstance(value, (int, float)):
        return "n/d"
    return f"{value:.{digits}f}"


def write_report(raw: dict[str, Any], output_path: Path) -> None:
    specs = {case["id"]: case for case in case_specs()}
    summary = summarize(raw)
    lines = [
        "# BANC-ORNITH-2026-08-26",
        "",
        "## Objet et protocole",
        "",
        "Banc W5 sur dix symptômes issus de l'historique Git et des rapports `DEFAUTS-*.md` de ce dépôt. Les prompts injectent uniquement des extraits de travail réels ; chaque réponse est scorée par présence/absence d'identifiants, valeurs ou fichiers, avec un cas de format à exactement trois phrases. Le score `JUSTE` signifie que tous les critères codés du cas sont satisfaits ; il ne mesure pas la qualité stylistique.",
        "",
        f"Endpoint : `{raw.get('metadata', {}).get('endpoint', DEFAULT_ENDPOINT)}/api/generate`, `stream:false`, température `0.2`, `num_predict:512`. Chaque modèle a été exécuté seul ; le script décharge les deux autres modèles cibles par `keep_alive:0` avant chaque bascule, sans arrêter Ollama. Les trois répétitions de chaque cas ont été résumées par médiane. `eval_count / eval_duration` donne le débit ; `total_duration` Ollama donne la latence totale. Résultats bruts : [`{RAW_PATH.name}`]({RAW_PATH.name}).",
        "",
        "## Les dix cas",
        "",
        "| ID | Épreuve | Réponse/critère mécanique | Sources réelles | `num_ctx` |",
        "|---|---|---|---|---:|",
    ]
    for case in specs.values():
        criterion = "Tous les critères codés dans le script"
        if case["id"] == "W5-04":
            criterion = "3 phrases exactement + `ENOENT`, chemin, `src/index.ts`, sans stack"
        elif case["id"] == "W5-09":
            criterion = "`Réponse distante`, sans bloc `<think>`, secret ni ZWSP"
        elif case["id"] == "W5-03":
            criterion = "`write_all`, JSON + `\\n` en une écriture, disparition des lignes déchirées"
        lines.append(
            f"| {case['id']} | {case['title']} | {criterion} | "
            + "; ".join(f"`{ref}`" for ref in case["references"])
            + f" | {case['num_ctx']} |"
        )

    lines.extend([
        "",
        "## Résultats médians",
        "",
        "| Modèle | Cas | Justesse (3) | Médiane tok/s | Médiane latence totale (ms) | API OK |",
        "|---|---|---:|---:|---:|---:|",
    ])
    for model in raw.get("metadata", {}).get("models", []):
        for case_id in specs:
            item = summary.get(f"{model}\t{case_id}", {})
            lines.append(
                f"| `{model}` | {case_id} | {item.get('correct_n', 0)}/{item.get('n', 0)} | "
                f"{format_number(item.get('median_tok_s'))} | {format_number(item.get('median_total_ms'), 0)} | "
                f"{item.get('ok_n', 0)}/{item.get('n', 0)} |"
            )

    lines.extend([
        "",
        "## Synthèse mécanique",
        "",
        "| Modèle | Justesse totale | API OK |",
        "|---|---:|---:|",
    ])
    for model in raw.get("metadata", {}).get("models", []):
        model_runs = [run for run in raw.get("runs", []) if run.get("model") == model]
        lines.append(
            f"| `{model}` | {sum(1 for run in model_runs if run.get('correct'))}/{len(model_runs)} | "
            f"{sum(1 for run in model_runs if run.get('ok'))}/{len(model_runs)} |"
        )

    failures = [run for run in raw.get("runs", []) if not run.get("ok")]
    if failures:
        lines.extend([
            "",
            "## Incidents API constatés",
            "",
            "Ces appels font partie des trois répétitions demandées et ne sont pas transformés en réponse juste :",
        ])
        for run in failures:
            lines.append(
                f"- `{run.get('model')}` / {run.get('case_id')} / répétition {run.get('repetition')} : "
                f"`{run.get('error', 'erreur inconnue')}`."
            )

    lines.extend([
        "",
        "## Lecture prudente",
        "",
        "Le banc mesure ce jeu précis de dix tâches, ce prompt précis, cette quantification, ce serveur et cette configuration. Une différence de justesse ici est une différence sur les critères mécaniques retenus, pas une note générale d'intelligence ; le débit est `eval_count/eval_duration`, pas une promesse de débit applicatif. Les médianes réduisent l'effet d'une mesure isolée mais ne remplacent pas une étude de variance.",
        "",
        "Dix cas ne permettent PAS de conclure qu'un modèle est globalement meilleur, plus fiable sur tous les dépôts, supérieur sur toutes les langues ou tous les contextes, ni que le débit observé se généralisera à d'autres tailles de contexte, quantifications, charges GPU, prompts ou versions Ollama. Ils ne permettent pas non plus de conclure à une différence statistiquement significative au-delà de ce petit échantillon, ni d'évaluer la qualité humaine des explications puisque le score est volontairement mécanique.",
        "",
        "## Reproductibilité et vérifications",
        "",
        "Commande de rejeu :",
        "",
        "```bash",
        "python3 bench-ornith-2026-08-26.py",
        "```",
        "",
        "Le script refuse les modèles inconnus, ne lance aucune requête en parallèle et écrit après chaque mesure. Les fichiers audités restent en lecture seule ; aucun service local n'est arrêté et aucune API payante n'est utilisée.",
        "",
    ])
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--model", action="append", dest="models", choices=MODELS)
    parser.add_argument("--case", action="append", dest="cases")
    parser.add_argument("--rescore", action="store_true", help="Recalculer les critères sur le JSON v2 présent")
    parser.add_argument("--report", action="store_true", help="Écrire le rapport Markdown depuis les résultats présents")
    args = parser.parse_args()
    if args.repetitions < 1:
        parser.error("--repetitions doit être positif")
    if args.rescore:
        if not RAW_PATH.exists():
            parser.error(f"résultats absents : {RAW_PATH}")
        raw = load_existing()
        specs = {case["id"]: case for case in case_specs()}
        for run in raw.get("runs", []):
            case = specs.get(run.get("case_id"))
            if case is None or not run.get("ok"):
                continue
            run["correct"], run["check_details"] = score_text(run.get("response", ""), case["checks"])
        raw.setdefault("metadata", {})["criterion_revision"] = "v2.1"
        RAW_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_report(raw, ROOT / "BANC-ORNITH-2026-08-26.md")
        return 0
    if args.report:
        if not RAW_PATH.exists():
            parser.error(f"résultats absents : {RAW_PATH}")
        raw = load_existing()
        write_report(raw, ROOT / "BANC-ORNITH-2026-08-26.md")
        return 0
    selected_models = args.models or list(MODELS)
    raw = run_bench(args.endpoint, args.repetitions, selected_models, args.cases or [])
    write_report(raw, ROOT / "BANC-ORNITH-2026-08-26.md")
    print(f"\nRésultats bruts : {RAW_PATH}")
    print(f"Rapport : {ROOT / 'BANC-ORNITH-2026-08-26.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
