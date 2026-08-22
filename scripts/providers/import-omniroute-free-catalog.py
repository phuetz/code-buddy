#!/usr/bin/env python3
"""Importe le catalogue des fournisseurs LLM à PALIER GRATUIT d'OmniRoute (npm `omniroute`, MIT)
et le croise avec le catalogue Code Buddy (`src/providers/provider-catalog.ts`).

Sources lues (paquet npm global, aucun réseau) :
  <omniroute>/open-sse/config/providers/registry/<id>/index.ts  → baseUrl, format, authType, models
  <omniroute>/src/shared/constants/providers/**/*.ts            → hasFree, freeNote, website, apiKeyUrl, signupUrl

Usage :
  python3 scripts/providers/import-omniroute-free-catalog.py            # rapport markdown sur stdout
  python3 scripts/providers/import-omniroute-free-catalog.py --json out.json
  python3 scripts/providers/import-omniroute-free-catalog.py --ts        # snippets TS prêts à coller dans provider-catalog.ts

Filtres : format openai (chat OpenAI-compatible) · authType apikey · hasFree · pas de scraper web/g4f
(risque ToS) · pas déjà dans Code Buddy. Tout reste à VÉRIFIER LIVE avant de s'en servir (les paliers
gratuits bougent ; OmniRoute ré-audite les siens toutes les 2 semaines).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CB_CATALOG = HERE.parent.parent / "src" / "providers" / "provider-catalog.ts"

# Exclus : scrapers/comptes web (ToS), agrégateurs douteux, non-LLM.
EXCLUDE_PATTERNS = re.compile(r"(-web$|^g4f-|^free(ai|the|model)|^api-airforce$|^puter$|^aihorde$|^hackclub$|^theoldllm$|^uncloseai$|^navy$|^nara$|^dgrid$|^llm7$|search$|^jina-reader$|^firecrawl$|^morph$|^comfyui$|^sdwebui$|^freepik$|^segmind$|^voyage-ai$|^mixedbread$|^nomic$|^speechmatics$|^bytez$|^dify$|^coze$|^kiro$|^qoder$|^amazon-q$|^agy$|^lmarena$|^huggingchat$|^gemini-business$)")
# Liste CURÉE (22/08/2026) : infra réputée, palier gratuit clair, pas d'identité réelle chinoise ni de ToS
# interdisant le relais, pas d'agrégateur opaque. Le reste des candidats reste visible dans le rapport.
CURATED = {
    "cerebras", "sambanova", "scaleway", "cohere", "ai21", "reka", "hyperbolic", "deepinfra",
    "featherless-ai", "friendliai", "inference-net", "nscale", "pioneer", "inception",
    "internlm", "ant-ling", "liquid", "typhoon", "sarvam", "longcat", "modelscope", "zenmux", "tokenrouter",
    "openadapter",
}
# Écartés de la liste curée bien qu'éligibles : cloudflare-ai (baseURL à account_id), baseten (par déploiement), modal (URL douteuse).
# Modèle par défaut quand le registry OmniRoute découvre les modèles dynamiquement (à VÉRIFIER live) :
DEFAULT_MODELS = {
    "ai21": ["jamba-large", "jamba-mini"],
    "deepinfra": ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen3-235B-A22B", "deepseek-ai/DeepSeek-V3"],
    "featherless-ai": ["meta-llama/Meta-Llama-3.1-8B-Instruct", "Qwen/Qwen2.5-72B-Instruct"],
    "friendliai": ["meta-llama-3.3-70b-instruct", "deepseek-r1"],
    "inference-net": ["meta-llama/llama-3.2-3b-instruct", "deepseek/deepseek-v3"],
    "modelscope": ["Qwen/Qwen3-235B-A22B", "deepseek-ai/DeepSeek-V3"],
    "nscale": ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen3-235B-A22B"],
    "sambanova": ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-R1", "Llama-4-Maverick-17B-128E-Instruct"],
}
# Déjà couverts par Code Buddy (id Code Buddy ← id OmniRoute)
ALREADY = {
    "openai": "openai", "anthropic": "anthropic", "claude": "anthropic", "gemini": "gemini", "mistral": "mistral",
    "deepseek": "deepseek", "groq": "groq", "fireworks": "fireworks", "openrouter": "openrouter", "novita": "novita",
    "glm": "zai", "kimi": "kimi-coding", "moonshot": "kimi-coding", "arcee-ai": "arcee", "minimax": "minimax",
    "alibaba": "alibaba", "qwen": "alibaba", "bailian-coding-plan": "alibaba-coding-plan", "kilocode": "kilocode",
    "opencode": "opencode-zen", "huggingface": "huggingface", "nvidia": "nvidia", "ollama-cloud": "ollama-cloud",
    "stepfun": "stepfun", "grok-cli": "grok", "xai": "grok", "codex": "chatgpt", "chatgpt-web": "chatgpt",
    "copilot": "copilot", "bedrock": "bedrock", "azure-openai": "azure", "tencent": "tencent-tokenhub",
    "xiaomi": "xiaomi", "ollama": "ollama", "lmstudio": "lmstudio", "vllm": "vllm", "together": "together",
}


def omniroute_root() -> Path:
    env = os.environ.get("OMNIROUTE_ROOT")
    if env:
        return Path(env)
    try:
        root = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"npm root -g impossible : {exc}")
    return Path(root) / "omniroute"


def parse_registry(reg_dir: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for d in sorted(reg_dir.iterdir()):
        f = d / "index.ts"
        if not f.is_file():
            continue
        src = f.read_text(encoding="utf-8", errors="replace")
        # retirer les commentaires // (pas le // de https://) pour ne pas attraper des modèles commentés
        code = "\n".join(re.sub(r'(?<![:/])//(?!/).*$', "", l) for l in src.splitlines())
        g = lambda k: (re.search(rf'\b{k}:\s*"([^"]*)"', code) or [None, ""])[1]  # noqa: E731
        # modèles = les `{ id: "…" }` À L'INTÉRIEUR du tableau `models: [ … ]` (crochets équilibrés)
        models: list[str] = []
        mi = code.find("models:")
        if mi >= 0:
            bi = code.find("[", mi)
            depth, j = 0, bi
            while j < len(code):
                depth += {"[": 1, "]": -1}.get(code[j], 0)
                if depth == 0:
                    break
                j += 1
            models = re.findall(r'\{\s*id:\s*"([^"]+)"', code[bi:j + 1])
        out[d.name] = {
            "id": g("id") or d.name, "alias": g("alias"), "format": g("format"), "executor": g("executor"),
            "baseUrl": g("baseUrl"), "authType": g("authType"), "authHeader": g("authHeader"),
            "passthroughModels": "passthroughModels: true" in code, "models": models,
        }
    return out


def parse_constants(const_dir: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for f in sorted(const_dir.rglob("*.ts")):
        src = f.read_text(encoding="utf-8", errors="replace")
        # blocs `  <key>: {` … `  },` au 1er niveau d'indentation
        for m in re.finditer(r'\n  ([a-z0-9_-]+|"[^"]+"):\s*\{\n(.*?)\n  \},', src, flags=re.S):
            body = m.group(2)
            idm = re.search(r'\bid:\s*"([^"]+)"', body)
            if not idm:
                continue
            pid = idm.group(1)
            g = lambda k: (re.search(rf'\b{k}:\s*"((?:[^"\\]|\\.)*)"', body, flags=re.S) or [None, ""])[1]  # noqa: E731
            out[pid] = {
                "name": g("name"), "website": g("website"), "hasFree": "hasFree: true" in body,
                "freeNote": g("freeNote"), "apiKeyUrl": g("apiKeyUrl"), "signupUrl": g("signupUrl"),
                "subscriptionRisk": "subscriptionRisk: true" in body, "file": f.name,
            }
    return out


def codebuddy_ids() -> set[str]:
    if not CB_CATALOG.is_file():
        return set()
    return set(re.findall(r"^\s+id:\s*'([a-z0-9-]+)'", CB_CATALOG.read_text(encoding="utf-8"), flags=re.M))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", type=Path)
    ap.add_argument("--ts", action="store_true")
    ap.add_argument("--all", action="store_true", help="ne pas filtrer sur hasFree")
    ap.add_argument("--curated", action="store_true", help="ne garder que la liste CURATED")
    args = ap.parse_args()
    root = omniroute_root()
    reg = parse_registry(root / "open-sse" / "config" / "providers" / "registry")
    const = parse_constants(root / "src" / "shared" / "constants" / "providers")
    cb = codebuddy_ids()
    rows = []
    for pid, r in reg.items():
        c = const.get(pid, {})
        free = c.get("hasFree", False)
        reason = None
        if r["format"] != "openai": reason = f"format={r['format'] or '?'}"
        elif r["authType"] != "apikey": reason = f"auth={r['authType'] or '?'}"
        elif not r["baseUrl"]: reason = "baseUrl vide"
        elif not free and not args.all: reason = "pas de palier gratuit déclaré"
        elif EXCLUDE_PATTERNS.search(pid): reason = "exclu (web/g4f/non-LLM/ToS)"
        elif pid in ALREADY or ALREADY.get(pid) in cb or pid in cb: reason = f"déjà dans Code Buddy ({ALREADY.get(pid, pid)})"
        base = re.sub(r"/chat/completions/?$", "", r["baseUrl"])
        rows.append({
            "id": pid, "name": c.get("name") or pid, "baseURL": base, "models": r["models"][:8],
            "freeNote": c.get("freeNote", ""), "website": c.get("website", ""), "apiKeyUrl": c.get("apiKeyUrl", ""),
            "passthrough": r["passthroughModels"], "subscriptionRisk": c.get("subscriptionRisk", False),
            "keep": reason is None, "reason": reason,
        })
    if args.curated:
        for x in rows:
            if x["keep"] and x["id"] not in CURATED:
                x["keep"], x["reason"] = False, "hors liste curée"
    keep = [x for x in rows if x["keep"]]
    if args.json:
        args.json.write_text(json.dumps({"omniroute_root": str(root), "candidates": keep, "all": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{len(keep)} candidats / {len(rows)} entrées → {args.json}")
        return
    if args.ts:
        env = lambda s: re.sub(r"[^A-Z0-9]+", "_", s.upper()).strip("_")  # noqa: E731
        for x in keep:
            models = x["models"] or DEFAULT_MODELS.get(x["id"]) or ["default"]
            print(f"""  {{
    id: '{x['id']}',
    label: '{x['name'].replace("'", "’")}',
    // Import catalogue OmniRoute (22/08/2026) — palier gratuit : {x['freeNote'].replace("'", "’") or 'déclaré (hasFree)'}.
    // Clé : {x['apiKeyUrl'] or x['website'] or 'voir site'}. À vérifier live avant usage.
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['{env(x['id'])}_API_KEY'],
    baseUrlEnvKeys: ['{env(x['id'])}_BASE_URL'],
    modelEnvKeys: ['{env(x['id'])}_MODEL'],
    defaultBaseURL: '{x['baseURL']}',
    defaultModel: '{models[0]}',
    models: [{', '.join("'" + m + "'" for m in models[:6])}],
  }},""")
        return
    print(f"# Catalogue OmniRoute → candidats Code Buddy ({len(keep)} retenus / {len(rows)} entrées, source {root})\n")
    print("| id | nom | baseURL | palier gratuit | modèles (extrait) | clé |")
    print("|---|---|---|---|---|---|")
    for x in keep:
        print(f"| `{x['id']}` | {x['name']} | `{x['baseURL']}` | {x['freeNote'] or '—'} | {', '.join(x['models'][:3]) or '—'} | {x['apiKeyUrl'] or x['website']} |")
    print("\n## Écartés (raison)")
    from collections import Counter
    for reason, n in Counter(x["reason"] for x in rows if not x["keep"]).most_common():
        print(f"- {n} × {reason}")


if __name__ == "__main__":
    main()
