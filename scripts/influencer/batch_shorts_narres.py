#!/usr/bin/env python3
"""Industrialise les Shorts narrés 9:16 (format validé 18/08) sur les destinations.
Pour chaque : narration qwen (qui fait rêver, hook 3s, info vraie) -> voix Ambre -> make_short_narre.
"""
import os, sys, json, re, subprocess, urllib.request, tempfile

EKEY = os.environ["ELEVENLABS_API_KEY"]; VOICE = "UaGvaD7NWzU5mJNoUqoY"
GK = os.path.expanduser("~/.codebuddy/personas/ambre/grok-imagine")
CL = os.path.expanduser("~/.codebuddy/personas/ambre/seedance-clean")
OUTD = os.path.expanduser("~/.codebuddy/personas/ambre/talk-videos/shorts")
NARRD = os.path.expanduser("~/.codebuddy/personas/ambre/narrations-shorts")
MK = os.path.expanduser("~/code-buddy/scripts/influencer/make_short_narre.py")
os.makedirs(OUTD, exist_ok=True); os.makedirs(NARRD, exist_ok=True)

# (nom fichier, hook affiché, lieu pour qwen, [plans])
DEST = [
 ("bali", "BALI, INDONÉSIE", "Bali (Indonésie), ses rizières en terrasses, ses temples et ses plages", [f"{GK}/bali-rizieres-grok.mp4", f"{CL}/bali-rizieres.mp4"]),
 ("islande", "ISLANDE", "l'Islande, ses cascades, ses glaciers et ses aurores boréales", [f"{GK}/islande-cascade-grok.mp4", f"{CL}/islande-cascade.mp4"]),
 ("norvege", "NORVÈGE", "la Norvège et ses fjords spectaculaires", [f"{GK}/norvege-fjord-grok.mp4", f"{CL}/norvege-fjord.mp4"]),
 ("vietnam", "VIETNAM", "le Vietnam et la baie d'Halong, ses pitons karstiques sur une mer émeraude", [f"{CL}/vietnam-halong.mp4"]),
 ("maroc", "MAROC", "le Maroc et le désert du Sahara, ses dunes dorées à l'infini", [f"{CL}/maroc-sahara.mp4"]),
 ("mexique", "MEXIQUE", "le Mexique et la pyramide maya de Chichén Itzá", [f"{CL}/mexique-chichenitza.mp4"]),
 ("perou", "PÉROU", "le Pérou et la citadelle inca du Machu Picchu perchée dans les Andes", [f"{CL}/perou-machupicchu.mp4"]),
 ("egypte", "ÉGYPTE", "l'Égypte et les pyramides de Gizeh, seule merveille antique encore debout", [f"{CL}/egypte-pyramides.mp4"]),
 ("turquie", "CAPPADOCE, TURQUIE", "la Cappadoce en Turquie, ses cheminées de fées et ses montgolfières à l'aube", [f"{CL}/turquie-cappadoce.mp4"]),
 ("jordanie", "PETRA, JORDANIE", "Petra en Jordanie, cité antique taillée dans la roche rose", [f"{CL}/jordanie-petra.mp4"]),
 ("philippines", "PALAWAN, PHILIPPINES", "Palawan aux Philippines, ses lagons turquoise et ses falaises calcaires", [f"{CL}/philippines-palawan.mp4"]),
 ("indonesie", "MONT BROMO", "le mont Bromo en Indonésie, volcan actif émergeant d'une mer de nuages", [f"{CL}/indonesie-bromo.mp4"]),
 ("ecosse", "ÉCOSSE", "l'Écosse et ses Highlands brumeux, terre de lochs et de légendes", [f"{CL}/ecosse-highlands.mp4"]),
 ("thailande", "THAÏLANDE", "la Thaïlande et les îles Phi Phi, entre falaises et eaux cristallines", [f"{CL}/thailande-phiphi.mp4"]),
 ("portugal", "PORTUGAL", "le Portugal et la grotte de Benagil, cathédrale de pierre ouverte sur l'océan", [f"{CL}/portugal-benagil.mp4"]),
 ("colombie", "COLOMBIE", "la Colombie et Carthagène, ses ruelles coloniales hautes en couleurs", [f"{CL}/colombie-carthagene.mp4"]),
]

def qwen(prompt):
    body = json.dumps({"model": "qwen3.8:27b", "prompt": prompt, "stream": False, "think": False,
                       "options": {"temperature": 0.75, "num_ctx": 4096}}).encode()
    for host in ("http://darkstar:11434", "http://127.0.0.1:11434"):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(host + "/api/generate", data=body,
                headers={"Content-Type": "application/json"}), timeout=180).read()).get("response", "")
            return re.sub(r"<think>.*?</think>", "", r, flags=re.DOTALL).strip()
        except Exception:
            continue
    return ""

def eleven(text, path):
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}",
        data=json.dumps({"text": text, "model_id": "eleven_multilingual_v2",
                         "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.25}}).encode(),
        headers={"xi-api-key": EKEY, "Content-Type": "application/json"})
    open(path, "wb").write(urllib.request.urlopen(req, timeout=120).read())

def main():
    done = 0
    for slug, hook, lieu, plans in DEST:
        out = f"{OUTD}/short-narre-{slug}.mp4"
        plans = [p for p in plans if os.path.exists(p)]
        if not plans:
            print(f"[{slug}] pas de plan"); continue
        if os.path.exists(out) and os.path.getsize(out) > 300000:
            print(f"[{slug}] déjà fait"); done += 1; continue
        prompt = (f"Tu es Ambre, narratrice voyage. Écris la narration PARLÉE (≈60 mots, ~24 s) d'un Short vertical sur "
                  f"{lieu}. Elle doit FAIRE RÊVER : commence par une accroche forte (les 3 premières secondes doivent capter), "
                  f"donne UNE info fascinante et VRAIE, finis par une invitation douce à y aller un jour. UNIQUEMENT le texte parlé, "
                  f"français impeccable, jamais « j'ai visité » ni « mon coup de cœur ». Aucun titre, liste, emoji, didascalie.")
        txt = re.sub(r'[#*"]', '', qwen(prompt)).strip()
        if len(txt) < 90:
            print(f"[{slug}] narration trop courte"); continue
        ntxt = f"{NARRD}/{slug}.txt"; open(ntxt, "w").write(txt)
        voix = f"{NARRD}/{slug}.mp3"
        try: eleven(txt, voix)
        except Exception as e: print(f"[{slug}] voix err {e}"); continue
        subprocess.run(["python3", MK, voix, ntxt, hook, out] + plans, check=False)
        if os.path.exists(out) and os.path.getsize(out) > 300000:
            print(f"[{slug}] ✅"); done += 1
        else:
            print(f"[{slug}] ❌ montage")
    print(f"\n=== SHORTS NARRÉS : {done}/{len(DEST)} ===")

if __name__ == "__main__":
    main()
