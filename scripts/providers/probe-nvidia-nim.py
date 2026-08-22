#!/usr/bin/env python3
"""Sonde LIVE du catalogue NVIDIA NIM (build.nvidia.com) : quels modèles répondent VRAIMENT à un chat ?
Lit NVIDIA_API_KEY (env ou ~/.codebuddy/lisa.env), liste GET /v1/models, puis envoie un mini-prompt
(max_tokens 8, timeout 25 s) à chaque modèle candidat — séquentiel (palier gratuit ≈ 40 RPM).
Usage : probe-nvidia-nim.py [--all] [--json out.json] [ids...]   (défaut : candidats connus ∪ liste live filtrée chat)
"""
import json, os, re, sys, time, urllib.request, urllib.error

BASE = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
def load_key():
    k = os.environ.get("NVIDIA_API_KEY")
    if k: return k
    envf = os.path.expanduser("~/.codebuddy/lisa.env")
    if not os.path.isfile(envf):
        sys.exit("NVIDIA_API_KEY introuvable (ni dans l'environnement, ni dans ~/.codebuddy/lisa.env) — clé gratuite sur build.nvidia.com")
    for line in open(envf, encoding="utf-8"):
        m = re.match(r'^(?:export\s+)?NVIDIA_API_KEY=(.*)$', line.strip())
        if m: return m.group(1).strip().strip('"').strip("'")
    sys.exit("NVIDIA_API_KEY introuvable")
KEY = load_key()
H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "Accept": "application/json"}

# Candidats : nos 4 vérifiés (22/08 matin) + la liste du registry OmniRoute (balayage 2026-06-19 + ports)
KNOWN = ["moonshotai/kimi-k3", "mistralai/mistral-nemotron", "nvidia/llama-3.3-nemotron-super-49b-v1",
         "nvidia/llama-3.1-nemotron-ultra-253b-v1", "z-ai/glm-5.2", "minimaxai/minimax-m2.7", "google/gemma-4-31b-it",
         "mistralai/mistral-small-4-119b-2603", "mistralai/mistral-large-3-675b-instruct-2512",
         "mistralai/devstral-2-123b-instruct-2512", "qwen/qwen3.5-397b-a17b", "qwen/qwen3.5-122b-a10b",
         "stepfun-ai/step-3.5-flash", "stepfun-ai/step-3.7-flash", "deepseek-ai/deepseek-v4-pro",
         "deepseek-ai/deepseek-v4-flash", "moonshotai/kimi-k2.6", "openai/gpt-oss-120b", "openai/gpt-oss-20b",
         "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b", "meta/llama-4-maverick-17b-128e-instruct",
         "qwen/qwen3-coder-480b-a35b-instruct", "qwen/qwen3-235b-a22b", "microsoft/phi-4-mini-instruct",
         "deepseek-ai/deepseek-r1-0528", "meta/llama-3.3-70b-instruct", "nvidia/nemotron-3-nano-30b-a3b"]

def get(path, timeout=30):
    req = urllib.request.Request(BASE + path, headers=H)
    return json.load(urllib.request.urlopen(req, timeout=timeout))

def probe(model, timeout=25):
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": "Réponds exactement: OK"}],
                       "max_tokens": 8, "temperature": 0}).encode()
    req = urllib.request.Request(BASE + "/chat/completions", data=body, headers=H)
    t0 = time.time()
    try:
        r = json.load(urllib.request.urlopen(req, timeout=timeout))
        txt = ((r.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        return {"status": "OK", "ms": int((time.time()-t0)*1000), "answer": txt.strip()[:40], "code": 200}
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:160]
        return {"status": f"HTTP {e.code}", "ms": int((time.time()-t0)*1000), "answer": msg, "code": e.code}
    except Exception as e:  # timeout etc.
        return {"status": type(e).__name__, "ms": int((time.time()-t0)*1000), "answer": str(e)[:100], "code": 0}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out_json = None
    if "--json" in sys.argv:
        i = sys.argv.index("--json")
        if i + 1 >= len(sys.argv) or sys.argv[i + 1].startswith("--"):
            sys.exit("--json attend un chemin de sortie (ex. --json probe.json)")
        out_json = sys.argv[i + 1]; args = [a for a in args if a != out_json]
    try:
        live = [m["id"] for m in get("/models").get("data", [])]
    except Exception as e:
        live = []; print(f"(liste /v1/models indisponible : {e})", file=sys.stderr)
    cands = args or KNOWN
    if "--all" in sys.argv and live:
        chat_like = [m for m in live if not re.search(r"embed|rerank|nemoretriever|vila|clip|ocr|tts|asr|riva|parakeet|canary|whisper|sd|stable|flux|imagen|genmol|molmim|esm|diffdock|proteinmpnn|rfdiffusion|alphafold|evo2|openfold|boltz|cosmos|audio|image|video|vision|nv-|detect|classif|guard|safety|jailbreak|topic|pii|dino|sam|grounding|depth|ocdr|paddle|cached|-embed", m, re.I)]
        cands = sorted(set(KNOWN) | set(chat_like))
    print(f"# Sonde NVIDIA NIM — {time.strftime('%Y-%m-%d %H:%M')} — {len(live)} modèles listés, {len(cands)} sondés\n")
    print("| modèle | listé | statut | latence | réponse |"); print("|---|---|---|---|---|")
    rows = []
    for m in cands:
        r = probe(m); r["model"] = m; r["listed"] = m in live; rows.append(r)
        print(f"| `{m}` | {'oui' if r['listed'] else 'NON'} | {r['status']} | {r['ms']/1000:.1f} s | {r['answer'].replace('|','/')} |", flush=True)
        time.sleep(1.6)  # ≈ 37 RPM
    ok = [r for r in rows if r["status"] == "OK"]
    print(f"\n**{len(ok)}/{len(rows)} répondent** : " + ", ".join(f"`{r['model']}` ({r['ms']/1000:.1f} s)" for r in sorted(ok, key=lambda x: x['ms'])))
    if out_json:
        json.dump({"date": time.strftime('%Y-%m-%dT%H:%M'), "listed": live, "rows": rows}, open(out_json, "w"), indent=1)

if __name__ == "__main__":
    main()
