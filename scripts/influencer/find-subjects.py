#!/usr/bin/env python3
"""Moisson quotidienne de sujets pour Lisa (influenceuse décryptage IA).
Google News RSS (FR, 7 jours) -> dédup -> classement par le LLM ($0 via buddy)
au format Short 45-60s : HOOK ≤15 mots + PLAN 3 temps + POURQUOI.

Usage: python3 find-subjects.py [nb_sujets]   (défaut 8)
Sortie: ~/.codebuddy/influencer-work/sujets-du-jour.md (+ stdout)

C'est l'équivalent opérationnel de PostCommander getTrendingTopics
(services/llm/trending.ts) — même philosophie source-backed : aucun sujet
inventé hors des titres collectés. À terme, brancher directement les configs
autoblog de PostCommander (articleType news-comment) sur cette sortie.
"""
import os, sys, json, subprocess, urllib.request, xml.etree.ElementTree as ET

N = sys.argv[1] if len(sys.argv) > 1 else '8'
WORK = os.environ.get('INFLUENCER_WORKDIR', os.path.expanduser('~/.codebuddy/influencer-work'))
os.makedirs(WORK, exist_ok=True)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

QUERIES = {
    'ia-actu': 'intelligence+artificielle',
    'deepfake': 'deepfake+arnaque',
    'outils-ia': 'ChatGPT+OR+Gemini+OR+Claude+nouveaut%C3%A9',
    'ia-societe': 'IA+emploi+OR+ecole+OR+sant%C3%A9',
}

items = []
for tag, q in QUERIES.items():
    url = f'https://news.google.com/rss/search?q={q}+when:7d&hl=fr&gl=FR&ceid=FR:fr'
    try:
        xml = urllib.request.urlopen(
            urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20).read()
        for it in ET.fromstring(xml).iter('item'):
            t = it.findtext('title') or ''
            if t:
                items.append({'theme': tag, 'title': t[:140]})
    except Exception as e:
        print(f'{tag}: RSS KO ({str(e)[:50]})', file=sys.stderr)

seen, uniq = set(), []
for i in items:
    k = i['title'][:60]
    if k not in seen:
        seen.add(k)
        uniq.append(i)
print(f'{len(uniq)} titres frais', file=sys.stderr)

titles = '\n'.join(f"[{i['theme']}] {i['title']}" for i in uniq[:55])
prompt = f"""Tu es le rédacteur en chef de Lisa, influenceuse IA francophone qui décrypte l'IA \
pour le grand public (format Shorts 45-60s, ton complice). Voici les titres d'actus de la semaine:

{titles}

Choisis les {N} MEILLEURS sujets pour des Shorts (intérêt grand public, potentiel de débat/partage, \
angle concret, fraîcheur). Pour chacun donne EXACTEMENT:

SUJET N: <titre court>
HOOK: <accroche ≤15 mots>
PLAN: <3 temps séparés par ' / '>
POURQUOI: <1 ligne>

Rien d'autre. Aucun sujet hors de la liste."""

r = subprocess.run(['node', os.path.join(REPO, 'dist/index.js'),
                    '--permission-mode', 'dontAsk', '-p', prompt],
                   capture_output=True, text=True, timeout=240)
out = r.stdout
try:
    out = json.loads(out).get('result', out)
except Exception:
    pass
dst = os.path.join(WORK, 'sujets-du-jour.md')
open(dst, 'w').write(out)
print(out)
print(f'\n-> {dst}', file=sys.stderr)
