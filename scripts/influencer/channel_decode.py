#!/usr/bin/env python3
"""channel_decode.py — décode le FORMAT d'une chaîne YouTube (méthode « copier une chaîne à succès »).

Principe (Amaury Wit / YouTube Automation, cf. ~/.codebuddy/personas/lisa/ANALYSE-methode-amaury-wit.md) :
on réplique le PACKAGING d'une chaîne qui explose — durée, cadence, structure hook→corps→CTA, style de
titres, miniatures, rythme de coupe — jamais son identité ni ses scripts. Cet outil MESURE ce packaging
avec yt-dlp + ffmpeg, sans inventer : tout chiffre non mesurable est annoté « non mesuré ».

Usage :
    channel_decode.py <url_chaîne|@handle> [--videos N=30] [--deep K=0] [--out DIR] [--lang fr]
                      [--yt-dlp PATH] [--no-thumbs] [--scene 0.3]

Étapes :
  1. Listing `--flat-playlist -J` sur /videos et /shorts → abonnés, nb de vidéos, vues, titres ; puis
     métadonnées complètes (`-j`) des N premières vidéos de chaque onglet → dates, durées, vues, likes,
     commentaires, chapitres, résolution → cadence (vidéos/semaine sur 90 j), distribution des durées
     (médiane, P25/P75, shorts vs longs), vues médianes à 60 j, like/vue si disponible.
  2. Titres : longueur (mots/caractères), motifs (« vient de », question, parenthèse, chiffre,
     MAJUSCULES, « je/j'ai », deux-points), top mots (hors mots vides FR/EN).
  3. Miniatures : téléchargement des N miniatures (URL maxres → hq), mesures par ffmpeg : luminosité
     moyenne, part de pixels « peau » (heuristique visage, pas une détection), part de pixels très clairs /
     très saturés (indice de texte/accent), planche contact PNG. OCR = non mesuré (aucune dépendance).
  4. `--deep K` : pour les K vidéos les plus vues (1 longue + 1 short si les deux onglets existent) :
     transcript auto (VTT → texte horodaté), hook = mots des 5 premières secondes, débit mots/min, CTA
     (abonne/like/commentaire/newsletter/formation… + horodatage relatif), rythme de coupe (téléchargement
     360p `player_client=android -f 18`, puis (a) `select='gt(scene,S)'` ffmpeg et (b) différence
     inter-images 4 fps seuil 12/255 sur 64×36 gris — la méthode de cuts.py, comparable à la barre du
     22/08) → coupes/min, médiane, plan max, coupes du cold open 0–25 s ; planche 8 frames.
  5. Sortie : DIR/<handle>/FICHE-FORMAT.md (fiche lisible + « format spec » en 15 lignes prêt à
     répliquer) + data.json (toutes les mesures brutes + erreurs).

Robuste : une vidéo qui échoue ne casse pas la fiche ; les champs manquants sont annotés « non mesuré »
et les erreurs listées dans data.json["errors"]. Dépendances : python3 stdlib, yt-dlp, ffmpeg/ffprobe.
Relances : les fichiers déjà présents (miniatures, VTT, vidéos 360p) sont réutilisés, pas retéléchargés.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures as cf
import datetime as dt
import glob
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import urllib.request

DEFAULT_YTDLP = '/home/patrice/miniforge3/bin/yt-dlp'
DEFAULT_OUT = os.path.expanduser('~/.codebuddy/channel-decode')
NM = 'non mesuré'

STOP_FR = set("""le la les l un une des du de d et ou à a au aux en dans sur pour par avec sans ce cet cette ces
ça ca c qui que quoi dont où ne pas plus n s il elle ils elles on nous vous je j tu me te se y est sont
été être fait faire va vont votre vos notre nos mon ma mes ton ta tes son sa ses leur leurs tout tous toute
toutes comme mais donc or ni car si très bien déjà encore aussi ici là même après avant entre vers chez
sous the of and to in for is are was be on at by with from this that it as an or your you we i my our its
how what why when new vs ai ia""".split())

CTA_PATTERNS = [
    ('abonnement', r"abonn(?!ement)|subscri"),
    ('suivre', r"^suiv|^suis-moi|^follow"),
    ('like', r"^like|pouce|thumbs"),
    ('commentaire', r"commentaire|^comments?$"),
    ('newsletter', r"^newsletter|^inscri"),
    ('formation/offre', r"^formations?$|^masterclass|^bootcamp|^course$|^programme$"),
    ('lien description', r"^description|^link$|^links$"),
    ('cloche', r"^cloche|^notif|^bell$"),
]


# ---------------------------------------------------------------------------
# utilitaires
# ---------------------------------------------------------------------------

def run(cmd, timeout=600, text=True):
    try:
        p = subprocess.run(cmd, capture_output=True, text=text, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return -1, '' if text else b'', f'timeout {timeout}s'
    except FileNotFoundError as e:
        return -2, '' if text else b'', str(e)


def median(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def pct(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return xs[int(k)]
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def fmt_num(x, nd=0):
    if x is None:
        return NM
    if isinstance(x, float) and nd:
        return f'{x:.{nd}f}'
    return f'{int(round(x)):,}'.replace(',', ' ')


def fmt_dur(s):
    if s is None:
        return NM
    s = int(round(s))
    if s >= 3600:
        return f'{s//3600}h{(s%3600)//60:02d}m{s%60:02d}s'
    if s >= 60:
        return f'{s//60} min {s%60:02d} s'
    return f'{s} s'


def fmt_pct(x, nd=1):
    return NM if x is None else f'{100*x:.{nd}f} %'


def normalize_target(t):
    t = t.strip()
    if t.startswith('@'):
        return f'https://www.youtube.com/{t}'
    if not t.startswith('http'):
        if '/' not in t:
            return f'https://www.youtube.com/@{t}'
        return 'https://' + t
    t = re.sub(r'/(videos|shorts|streams|featured|about|playlists)/?(\?.*)?$', '', t)
    return t.rstrip('/')


# ---------------------------------------------------------------------------
# 1. listing + métadonnées
# ---------------------------------------------------------------------------

def flat_listing(yt, url, lang, errors):
    code, out, err = run([yt, '--flat-playlist', '-J', '--extractor-args', f'youtube:lang={lang}', url], timeout=300)
    if code != 0 or not out.strip():
        errors.append({'step': 'flat', 'url': url, 'error': (err or '')[-400:]})
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        errors.append({'step': 'flat', 'url': url, 'error': f'json: {e}'})
        return None


def detailed_meta(yt, url, n, lang, errors):
    """Métadonnées complètes des n premières vidéos d'un onglet (1 requête par vidéo, ~1 s chacune)."""
    code, out, err = run([yt, '--skip-download', '-j', '--ignore-errors', '--playlist-end', str(n),
                          '--extractor-args', f'youtube:lang={lang}', url], timeout=60 * max(5, n))
    items = []
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        items.append(slim(d))
    if not items and code != 0:
        errors.append({'step': 'meta', 'url': url, 'error': (err or '')[-400:]})
    for m in re.findall(r'ERROR: \[youtube\] ([\w-]{11}): (.*)', err or ''):
        errors.append({'step': 'meta', 'video': m[0], 'error': m[1][:200]})
    return items


def slim(d):
    likes = d.get('like_count')
    views = d.get('view_count')
    # YouTube masque parfois les likes : yt-dlp renvoie alors une valeur absurde (1, 2, 3…).
    likes_hidden = likes is not None and views and views > 5000 and likes < 20
    return {
        'id': d.get('id'), 'title': d.get('title'), 'upload_date': d.get('upload_date'),
        'timestamp': d.get('timestamp'), 'duration': d.get('duration'), 'view_count': views,
        'like_count': None if likes_hidden else likes, 'likes_hidden': bool(likes_hidden),
        'comment_count': d.get('comment_count'), 'width': d.get('width'), 'height': d.get('height'),
        'fps': d.get('fps'), 'language': d.get('language'), 'categories': d.get('categories'),
        'chapters': len(d.get('chapters') or []), 'tags': len(d.get('tags') or []),
        'description_len': len(d.get('description') or ''), 'thumbnail': d.get('thumbnail'),
        'webpage_url': d.get('webpage_url') or f"https://www.youtube.com/watch?v={d.get('id')}",
        'auto_caption_langs': [k for k in (d.get('automatic_captions') or {}) if k.endswith('-orig') or k in ('fr', 'en')][:6],
        'channel_follower_count': d.get('channel_follower_count'), 'channel': d.get('channel'),
        'uploader_id': d.get('uploader_id'), 'channel_id': d.get('channel_id'),
        'live_status': d.get('live_status'), 'availability': d.get('availability'),
    }


def date_of(v):
    if v.get('timestamp'):
        return dt.datetime.fromtimestamp(v['timestamp'], dt.timezone.utc)
    if v.get('upload_date'):
        return dt.datetime.strptime(v['upload_date'], '%Y%m%d').replace(tzinfo=dt.timezone.utc)
    return None


def cadence_stats(videos, now, window_days=90):
    dated = [(date_of(v), v) for v in videos]
    dated = [(d, v) for d, v in dated if d]
    if not dated:
        return {'per_week': None, 'window_days': None, 'count': 0, 'note': NM}
    dated.sort(key=lambda x: x[0])
    oldest = dated[0][0]
    span = (now - oldest).total_seconds() / 86400
    covered = span < window_days - 1  # l'échantillon ne couvre pas 90 j → on mesure sur la fenêtre réelle
    if covered:
        window = max(span, 1.0)
        inwin = dated
        note = f"{len(inwin)} vidéos sur {window:.0f} j (l'échantillon de {len(videos)} ne remonte pas à 90 j → cadence sur la fenêtre réelle)"
    else:
        window = window_days
        inwin = [(d, v) for d, v in dated if (now - d).total_seconds() / 86400 <= window_days]
        note = f'{len(inwin)} vidéos sur {window_days} j'
    gaps = [(dated[i + 1][0] - dated[i][0]).total_seconds() / 86400 for i in range(len(dated) - 1)]
    return {'per_week': len(inwin) / (window / 7.0), 'window_days': round(window, 1), 'count': len(inwin),
            'per_week_sample': len(dated) / (max(span, 1.0) / 7.0), 'sample_span_days': round(span, 1), 'sample_count': len(dated),
            'median_gap_days': median(gaps), 'max_gap_days': max(gaps) if gaps else None,
            'first_date': dated[0][0].date().isoformat(), 'last_date': dated[-1][0].date().isoformat(), 'note': note}


def views_stats(videos, now, days=60):
    recent = [v for v in videos if date_of(v) and (now - date_of(v)).total_seconds() / 86400 <= days]
    pool = recent if len(recent) >= 3 else videos
    note = f'{len(recent)} vidéos ≤ {days} j' if len(recent) >= 3 else f'moins de 3 vidéos ≤ {days} j → médiane sur les {len(videos)} récupérées'
    vs = [v.get('view_count') for v in pool]
    lr = [v['like_count'] / v['view_count'] for v in pool if v.get('like_count') and v.get('view_count')]
    cr = [v['comment_count'] / v['view_count'] for v in pool if v.get('comment_count') is not None and v.get('view_count')]
    hidden = sum(1 for v in pool if v.get('likes_hidden'))
    return {'median_views': median(vs), 'p25_views': pct(vs, .25), 'p75_views': pct(vs, .75), 'n': len(pool), 'note': note,
            'like_per_view_median': median(lr) if lr else None, 'likes_hidden_count': hidden,
            'comment_per_view_median': median(cr) if cr else None}


def duration_stats(videos):
    ds = [v.get('duration') for v in videos if v.get('duration')]
    return {'n': len(ds), 'median': median(ds), 'p25': pct(ds, .25), 'p75': pct(ds, .75),
            'min': min(ds) if ds else None, 'max': max(ds) if ds else None}


# ---------------------------------------------------------------------------
# 2. titres
# ---------------------------------------------------------------------------

def title_stats(titles):
    titles = [t for t in titles if t]
    if not titles:
        return {'n': 0}
    words = [len(re.findall(r"[\w'’-]+", t)) for t in titles]
    chars = [len(t) for t in titles]
    pats = {
        'vient_de': r"\bvien(t|nent) de\b|\bjust\b",
        'question': r"\?",
        'parenthese': r"\(|\)",
        'chiffre': r"\d",
        'majuscules': r"\b[A-ZÀ-Ý]{3,}\b",
        'je_jai': r"\b[Jj]['’]ai\b|\b[Jj]e\b|\bI\b|\bI['’]",
        'deux_points': r":",
        'exclamation': r"!",
        'guillemets': r"[«\"“]",
        'et_personne': r"personne n|nobody|no one",
        'tu_vous': r"\b[Tt]u\b|\b[Vv]ous\b|\byou\b",
    }
    ci = {'vient_de', 'et_personne', 'tu_vous'}  # insensibles à la casse (« Just », « Nobody »)
    res = {k: sum(1 for t in titles if re.search(rx, t, re.I if k in ci else 0)) / len(titles) for k, rx in pats.items()}
    wc = collections.Counter()
    for t in titles:
        for w in re.findall(r"[\w'’-]+", t.lower()):
            w = re.sub(r"^[ldjcmnst]['’]", '', w)
            if len(w) > 2 and w not in STOP_FR and not w.isdigit():
                wc[w] += 1
    return {'n': len(titles), 'words_median': median(words), 'chars_median': median(chars),
            'words_p25': pct(words, .25), 'words_p75': pct(words, .75), 'patterns': res,
            'top_words': wc.most_common(20), 'examples': titles[:8]}


# ---------------------------------------------------------------------------
# 3. miniatures
# ---------------------------------------------------------------------------

def download_thumb(v, outdir):
    vid = v['id']
    for ext in ('jpg', 'webp', 'png'):
        p = os.path.join(outdir, f'{vid}.{ext}')
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            return p
    urls = []
    if v.get('thumbnail'):
        urls.append(v['thumbnail'])
    urls += [f'https://i.ytimg.com/vi/{vid}/maxresdefault.jpg', f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg']
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read()
            if len(data) > 1000:
                ext = 'webp' if u.endswith('.webp') or data[:4] == b'RIFF' else 'jpg'
                p = os.path.join(outdir, f'{vid}.{ext}')
                with open(p, 'wb') as f:
                    f.write(data)
                return p
        except Exception:
            continue
    return None


def thumb_measures(path):
    """Luminosité moyenne + heuristiques couleur via ffmpeg (rawvideo 64×36). Pas de détection de visage réelle."""
    code, out, err = run(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'scale=64:36,format=rgb24', '-f', 'rawvideo', '-'], timeout=30, text=False)
    if code != 0 or len(out) < 64 * 36 * 3:
        return None
    n = 64 * 36
    lum = skin = bright = sat = 0.0
    for i in range(n):
        r, g, b = out[3 * i], out[3 * i + 1], out[3 * i + 2]
        lum += 0.299 * r + 0.587 * g + 0.114 * b
        mx, mn = max(r, g, b), min(r, g, b)
        if r > 95 and g > 40 and b > 20 and r > g and r > b and abs(r - g) > 15 and mx - mn > 15:
            skin += 1
        if mn > 225:
            bright += 1
        if mx > 120 and (mx - mn) / mx > 0.7:
            sat += 1
    return {'luminance_mean': lum / n, 'skin_ratio': skin / n, 'white_ratio': bright / n, 'saturated_ratio': sat / n}


def contact_sheet(paths, out_png, cols=5, w=320, h=180):
    if not paths:
        return None
    tmp = out_png + '.tiles'
    os.makedirs(tmp, exist_ok=True)
    ok = 0
    for i, p in enumerate(paths):
        code, _, _ = run(['ffmpeg', '-y', '-v', 'error', '-i', p, '-vf',
                          f'scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black',
                          os.path.join(tmp, f'{i:03d}.png')], timeout=30)
        ok += code == 0
    if not ok:
        shutil.rmtree(tmp, ignore_errors=True)
        return None
    rows = max(1, math.ceil(ok / cols))
    code, _, err = run(['ffmpeg', '-y', '-v', 'error', '-framerate', '1', '-pattern_type', 'glob', '-i', os.path.join(tmp, '*.png'),
                        '-vf', f'tile={cols}x{rows}', '-frames:v', '1', out_png], timeout=60)
    shutil.rmtree(tmp, ignore_errors=True)
    return out_png if code == 0 and os.path.exists(out_png) else None


# ---------------------------------------------------------------------------
# 4. deep : transcript, hook, débit, CTA, coupes
# ---------------------------------------------------------------------------

def parse_vtt(path):
    """→ liste (t_sec, mot) ; gère les VTT auto YouTube (mots horodatés <00:00:01.234><c>mot</c>)."""
    txt = open(path, encoding='utf-8', errors='replace').read()
    cues = []
    for b in re.split(r'\n\n+', txt):
        m = re.search(r'(\d+):(\d+):(\d+)\.(\d+) --> ', b)
        if not m:
            continue
        st = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000
        lines = b.split('\n')
        body_lines = [l for l in lines if '-->' not in l and not l.startswith(('WEBVTT', 'Kind', 'Language', 'NOTE'))]
        body = ' '.join(body_lines)
        words = re.findall(r'<(\d+):(\d+):(\d+)\.(\d+)><c>([^<]*)</c>', body)
        if words:
            for l in body_lines:
                if '<c>' in l:
                    lead = re.sub(r'<[^>]+>', '', l.split('<')[0]).strip()
                    if lead:
                        cues.append((st, lead))
                    break
            for h, mn, s, ms, w in words:
                cues.append((int(h) * 3600 + int(mn) * 60 + int(s) + int(ms) / 1000, w.strip()))
        else:
            plain = re.sub(r'<[^>]+>', '', body).strip()
            # les blocs « plein » doublonnent les blocs mot-à-mot ; on ne les garde que s'il n'y a aucun mot horodaté
            if plain:
                cues.append((st, plain))
    # si mélange : ne garder que les mots horodatés (évite les doublons)
    timed = [c for c in cues if ' ' not in c[1]]
    if len(timed) > 0.5 * len(cues):
        cues = timed
    out, last = [], None
    for t, w in cues:
        if not w or (t, w) == last:
            continue
        out.append((t, w))
        last = (t, w)
    return out


def seg(words, a, b):
    return ' '.join(w for t, w in words if a <= t < b)


def find_cta(words, dur, lang='fr'):
    text_words = words
    found = []
    n = len(text_words)
    for i in range(n):
        t, w = text_words[i]
        wl = re.sub(r"[^\w'’-]", '', w.lower())
        prev = re.sub(r"[^\w'’-]", '', text_words[i - 1][1].lower()) if i else ''
        nxt = ' '.join(x.lower() for _, x in text_words[i + 1:i + 5])
        for name, rx in CTA_PATTERNS:
            if re.search(rx, wl):
                # garde-fous contextuels contre les faux positifs fréquents
                if name == 'commentaire' and lang.startswith('fr') and wl.startswith('comment') and not wl.startswith('commentaire'):
                    continue  # « comment » = mot interrogatif en français
                if name == 'suivre' and not re.search(r"\b(moi|nous|me|la chaîne|chaîne|insta|tiktok|linkedin|twitter|sur)\b", nxt):
                    continue  # « suivre tout ce qui se passe » n'est pas un CTA
                if name == 'formation/offre' and wl == 'course' and prev == 'of':
                    continue  # « of course »
                if name == 'like' and lang.startswith('en') and wl == 'like' and not re.search(r"\b(button|the video|this video|and subscribe|subscribe)\b", nxt):
                    continue  # « like » = comparatif en anglais ; ne garder que « like button / like this video / like and subscribe »
                ctx = ' '.join(x for _, x in text_words[max(0, i - 8): i + 8])
                if found and found[-1]['type'] == name and t - found[-1]['t'] < 20:
                    continue  # même appel, mot suivant
                found.append({'type': name, 't': round(t, 1), 'rel': round(t / dur, 3) if dur else None, 'context': ctx})
                break
    return found


def download_vtt(yt, v, deepdir, lang, errors):
    vid = v['id']
    existing = sorted(glob.glob(os.path.join(deepdir, f'{vid}*.vtt')))
    if not existing:
        langs = f'{lang}-orig,{lang},en-orig,en,fr-orig,fr'
        code, out, err = run([yt, '--skip-download', '--write-auto-sub', '--write-subs', '--sub-langs', langs,
                              '-o', os.path.join(deepdir, '%(id)s'), v['webpage_url']], timeout=300)
        existing = sorted(glob.glob(os.path.join(deepdir, f'{vid}*.vtt')))
        if not existing:
            errors.append({'step': 'vtt', 'video': vid, 'error': (err or '')[-300:]})
            return None
    # priorité : <lang>-orig, puis <lang>, puis *-orig, puis n'importe lequel
    def rank(p):
        name = os.path.basename(p)
        if f'.{lang}-orig.' in name:
            return 0
        if f'.{lang}.' in name:
            return 1
        if '-orig.' in name:
            return 2
        return 3
    return sorted(existing, key=rank)[0]


def download_360(yt, v, deepdir, errors):
    vid = v['id']
    for p in glob.glob(os.path.join(deepdir, f'vid_{vid}.*')):
        if os.path.getsize(p) > 100_000 and not p.endswith('.part'):
            return p
    code, out, err = run([yt, '--extractor-args', 'youtube:player_client=android', '-f', '18/b[height<=360]/b',
                          '--no-playlist', '-o', os.path.join(deepdir, 'vid_%(id)s.%(ext)s'), v['webpage_url']], timeout=900)
    for p in glob.glob(os.path.join(deepdir, f'vid_{vid}.*')):
        if os.path.getsize(p) > 100_000 and not p.endswith('.part'):
            return p
    errors.append({'step': 'video360', 'video': vid, 'error': (err or '')[-300:]})
    return None


def ffprobe_duration(path):
    code, out, _ = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], timeout=60)
    try:
        return float(out.strip())
    except ValueError:
        return None


def cuts_scene(path, thr):
    """Changements de plan via select='gt(scene,thr)' + showinfo (pts_time dans stderr)."""
    code, out, err = run(['ffmpeg', '-v', 'info', '-i', path, '-vf', f"select='gt(scene,{thr})',showinfo", '-vsync', 'vfr', '-f', 'null', '-'], timeout=900)
    ts = [float(m) for m in re.findall(r'pts_time:([0-9.]+)', err or '')]
    return sorted(set(round(t, 2) for t in ts))


def cuts_diff(path, thr=12, fps=4, w=64, h=36):
    """Méthode cuts.py (barre du 22/08) : différence moyenne inter-images à 4 fps, gris 64×36, seuil 12/255, fusion < 1 s."""
    code, out, err = run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'fps={fps},scale={w}:{h},format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], timeout=900, text=False)
    n = len(out) // (w * h)
    if n < 2:
        return [], 0
    sz = w * h
    prev = out[0:sz]
    ts = []
    for i in range(1, n):
        cur = out[i * sz:(i + 1) * sz]
        d = sum(abs(a - b) for a, b in zip(cur, prev)) / sz
        if d > thr:
            ts.append(i / fps)
        prev = cur
    merged = []
    for t in ts:
        if not merged or t - merged[-1] > 1.0:
            merged.append(t)
    return merged, n / fps


def cut_stats(ts, dur):
    if dur is None or dur <= 0:
        return {'count': len(ts), 'note': NM}
    gaps = [ts[i + 1] - ts[i] for i in range(len(ts) - 1)]
    if ts:
        gaps_full = [ts[0]] + gaps + [dur - ts[-1]]
    else:
        gaps_full = [dur]
    cold = [t for t in ts if t <= 25]
    return {'count': len(ts), 'per_min': 60 * len(ts) / dur, 'every_s': dur / max(len(ts), 1),
            'median_gap_s': median(gaps) if gaps else dur, 'p25_gap_s': pct(gaps, .25) if gaps else None,
            'p75_gap_s': pct(gaps, .75) if gaps else None, 'max_shot_s': max(gaps_full),
            'cold_open_cuts_0_25s': len(cold), 'cold_open_every_s': (25 / len(cold)) if cold else None,
            'first_cuts': [round(t, 1) for t in ts[:12]]}


def frames_sheet(path, dur, out_png, n=8):
    if not dur:
        return None
    step = max(dur / n, 0.5)
    code, _, err = run(['ffmpeg', '-y', '-v', 'error', '-ss', str(step / 2), '-i', path, '-vf', f'fps=1/{step},scale=-2:360,tile=4x2', '-frames:v', '1', out_png], timeout=300)
    return out_png if code == 0 and os.path.exists(out_png) else None


def deep_one(yt, v, deepdir, lang, scene_thr, errors):
    vid = v['id']
    res = {'id': vid, 'title': v.get('title'), 'url': v['webpage_url'], 'duration': v.get('duration'),
           'view_count': v.get('view_count'), 'kind': v.get('kind')}
    dur = v.get('duration')
    # transcript
    vtt = download_vtt(yt, v, deepdir, lang, errors)
    if vtt:
        try:
            words = parse_vtt(vtt)
            d = dur or (words[-1][0] if words else None)
            res['transcript_file'] = vtt
            res['transcript_lang'] = os.path.basename(vtt).split('.')[-2]
            res['words'] = len(words)
            res['wpm'] = (len(words) / d * 60) if d and words else None
            res['hook_0_5s'] = seg(words, 0, 5)
            res['s5_15'] = seg(words, 5, 15)
            res['s15_30'] = seg(words, 15, 30)
            res['last_20s'] = seg(words, (d or 0) - 20, (d or 0) + 5) if d else None
            res['first_bonjour_s'] = next((t for t, w in words if re.match(r"bonjour|salut|hello|hey|bienvenue|welcome", w.lower())), None)
            full = ' '.join(w for _, w in words)
            m = re.search(r"(je m['’]appelle \w+|moi c['’]est [A-ZÀ-Ý]\w+|my name is \w+|I['’]m [A-Z]\w+ (?:and|from)|ici [A-ZÀ-Ý]\w+,? (?:de|pour) )", full)
            res['self_intro'] = m.group(0) if m else None
            cta_all = find_cta(words, d, res.get('transcript_lang') or lang)
            res['cta_all'] = cta_all
            core = {'abonnement', 'suivre', 'like', 'commentaire', 'newsletter'}
            # les offres/liens/cloche ne sont retenus comme CTA que dans l'ouverture (< 20 %) ou la conclusion (> 75 %)
            res['cta'] = [c for c in cta_all if c['type'] in core or (c['rel'] is not None and (c['rel'] < 0.2 or c['rel'] > 0.75))]
            txt = os.path.join(deepdir, f'transcript-{vid}.txt')
            with open(txt, 'w', encoding='utf-8') as f:
                f.write(f'# {v.get("title")} — {v["webpage_url"]} — {len(words)} mots, {d} s\n')
                cur, line = -1, []
                for t, w in words:
                    if int(t // 10) != cur:
                        if line:
                            f.write(f'[{cur*10:>5d}s] ' + ' '.join(line) + '\n')
                        cur, line = int(t // 10), []
                    line.append(w)
                if line:
                    f.write(f'[{cur*10:>5d}s] ' + ' '.join(line) + '\n')
            res['transcript_txt'] = txt
        except Exception as e:  # jamais bloquant
            errors.append({'step': 'transcript', 'video': vid, 'error': str(e)[:200]})
    else:
        res['wpm'] = None
        res['hook_0_5s'] = NM
    # vidéo 360p → coupes + planche
    vp = download_360(yt, v, deepdir, errors)
    if vp:
        res['video_file'] = vp
        d2 = ffprobe_duration(vp) or dur
        try:
            ts = cuts_scene(vp, scene_thr)
            res['cuts_scene'] = cut_stats(ts, d2)
            res['cuts_scene']['threshold'] = scene_thr
        except Exception as e:
            errors.append({'step': 'cuts_scene', 'video': vid, 'error': str(e)[:200]})
        try:
            ts2, d3 = cuts_diff(vp)
            res['cuts_diff12'] = cut_stats(ts2, d3 or d2)
        except Exception as e:
            errors.append({'step': 'cuts_diff', 'video': vid, 'error': str(e)[:200]})
        res['frames_sheet'] = frames_sheet(vp, d2, os.path.join(deepdir, f'{vid}-8frames.png'))
        code, out, _ = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', vp], timeout=60)
        res['probe_360'] = out.strip()
    return res


# ---------------------------------------------------------------------------
# 5. fiche
# ---------------------------------------------------------------------------

def pick_deep(longs, shorts, k):
    chosen, seen = [], set()
    for pool, kind in ((longs, 'long'), (shorts, 'short')):
        pool = sorted([v for v in pool if v.get('view_count')], key=lambda v: -v['view_count'])
        if pool and len(chosen) < k:
            v = dict(pool[0]); v['kind'] = kind
            chosen.append(v); seen.add(v['id'])
    rest = sorted([dict(v, kind='long') for v in longs] + [dict(v, kind='short') for v in shorts],
                  key=lambda v: -(v.get('view_count') or 0))
    for v in rest:
        if len(chosen) >= k:
            break
        if v['id'] not in seen:
            chosen.append(v); seen.add(v['id'])
    return chosen


def md_table(rows, header):
    out = ['| ' + ' | '.join(header) + ' |', '|' + '---|' * len(header)]
    for r in rows:
        out.append('| ' + ' | '.join(str(x).replace('|', '\\|').replace('\n', ' ') for x in r) + ' |')
    return '\n'.join(out)


def build_fiche(data):
    ch = data['channel']
    L, S = data['longs'], data['shorts']
    now = data['run_date']
    lines = [f"# Fiche format — {ch.get('name') or '?'} ({ch.get('handle') or ch.get('url')})", '',
             f"Mesuré le {now} avec `channel_decode.py` (yt-dlp {data.get('ytdlp_version', '?')}, ffmpeg). Chaîne : {ch.get('url')}  ",
             f"Toute valeur est mesurée sur l'échantillon indiqué ; « {NM} » = non disponible sans dépendance/visionnage. "
             f"Erreurs non bloquantes : {len(data['errors'])} (voir `data.json`).", '', '## 1. Chaîne, volume, cadence', '']
    rows = [
        ('Abonnés', fmt_num(ch.get('followers')), 'yt-dlp `channel_follower_count`'),
        ('Vidéos longues listées (/videos)', fmt_num(ch.get('n_videos_listed')) if ch.get('videos_tab') else "onglet absent", 'listing flat'),
        ('Shorts listés (/shorts)', fmt_num(ch.get('n_shorts_listed')) if ch.get('shorts_tab') else 'onglet absent', 'listing flat'),
        ('Vues cumulées (listing, longs / shorts)', f"{fmt_num(ch.get('views_total_videos'))} / {fmt_num(ch.get('views_total_shorts'))}", 'somme `view_count` du listing (les shorts sans vues visibles comptent 0)'),
        ('Échantillon détaillé', f"{len(L['videos'])} longs + {len(S['videos'])} shorts", '`-j` sur les N premiers de chaque onglet'),
    ]
    for kind, D in (('Longs', L), ('Shorts', S)):
        if not D['videos']:
            continue
        c, vst, ds = D['cadence'], D['views'], D['durations']
        rows += [
            (f'{kind} — cadence', f"{fmt_num(c['per_week'], 2) if c['per_week'] is not None else NM} /semaine", c['note'] + (f" ; écart médian {fmt_num(c.get('median_gap_days'),1)} j, max {fmt_num(c.get('max_gap_days'),1)} j ; sur tout l'échantillon : {fmt_num(c.get('per_week_sample'),2)}/sem. ({c.get('sample_count')} vidéos, {fmt_num(c.get('sample_span_days'))} j, {c.get('first_date')} → {c.get('last_date')})" if c.get('median_gap_days') is not None else '')),
            (f'{kind} — durée', f"médiane {fmt_dur(ds['median'])} (P25 {fmt_dur(ds['p25'])} · P75 {fmt_dur(ds['p75'])} · min {fmt_dur(ds['min'])} · max {fmt_dur(ds['max'])})", f"{ds['n']} vidéos"),
            (f'{kind} — vues', f"médiane {fmt_num(vst['median_views'])} (P25 {fmt_num(vst['p25_views'])} · P75 {fmt_num(vst['p75_views'])})", vst['note']),
            (f'{kind} — likes/vue', fmt_pct(vst['like_per_view_median'], 2) if vst['like_per_view_median'] is not None else (f"masqués sur {vst['likes_hidden_count']}/{vst['n']}" if vst['likes_hidden_count'] else NM), 'médiane'),
            (f'{kind} — commentaires/vue', fmt_pct(vst['comment_per_view_median'], 2), 'médiane'),
            (f'{kind} — technique', D.get('tech') or NM, 'mode résolution/fps, catégorie, langue, % avec ≥ 3 chapitres'),
        ]
    lines.append(md_table(rows, ['Item', 'Valeur', 'Source / échantillon']))
    # top vidéos
    top = sorted(L['videos'] + S['videos'], key=lambda v: -(v.get('view_count') or 0))[:8]
    lines += ['', '### Top vues (échantillon)', '', md_table(
        [(fmt_num(v.get('view_count')), fmt_dur(v.get('duration')), v.get('upload_date') or '?', (v.get('title') or '')[:90], v['webpage_url']) for v in top],
        ['Vues', 'Durée', 'Date', 'Titre', 'URL'])]
    # titres
    lines += ['', '## 2. Titres', '']
    for kind, D in (('Longs', L), ('Shorts', S)):
        T = D.get('titles') or {}
        if not T.get('n'):
            continue
        p = T['patterns']
        lines += [f"**{kind}** ({T['n']} titres) : {fmt_num(T['words_median'])} mots / {fmt_num(T['chars_median'])} car. médians (P25–P75 mots {fmt_num(T['words_p25'])}–{fmt_num(T['words_p75'])}). "
                  f"Motifs : « vient de/just » {fmt_pct(p['vient_de'],0)} · question {fmt_pct(p['question'],0)} · parenthèse {fmt_pct(p['parenthese'],0)} · chiffre {fmt_pct(p['chiffre'],0)} · "
                  f"MAJUSCULES {fmt_pct(p['majuscules'],0)} · je/j'ai {fmt_pct(p['je_jai'],0)} · deux-points {fmt_pct(p['deux_points'],0)} · « personne n'en parle » {fmt_pct(p['et_personne'],0)} · tu/vous/you {fmt_pct(p['tu_vous'],0)}.  ",
                  f"Top mots : {', '.join(f'{w} ({c})' for w, c in T['top_words'][:15])}.  ",
                  'Exemples : ' + ' · '.join(f'« {t} »' for t in T['examples'][:5]), '']
    # miniatures
    TH = data.get('thumbs') or {}
    lines += ['## 3. Miniatures', '']
    if TH.get('n'):
        lines += [f"{TH['n']} miniatures téléchargées ({TH.get('source','longs')}) ; planche : `{TH.get('sheet') or NM}`.  ",
                  f"Luminosité moyenne {fmt_num(TH['luminance_mean_median'])}/255 (médiane ; < 90 = sombre) · part « peau » médiane {fmt_pct(TH['skin_ratio_median'])} "
                  f"(heuristique couleur : ≥ 8 % ⇒ visage/peau probable sur {TH['face_probable']}/{TH['n']} ; ce n'est PAS une détection de visage) · "
                  f"pixels très clairs {fmt_pct(TH['white_ratio_median'])} · très saturés {fmt_pct(TH['saturated_ratio_median'])} (indice texte/accents couleur).  ",
                  f"Nombre de mots de texte : {NM} (OCR non disponible) — lire la planche.", '']
    else:
        lines += [f'{NM} (aucune miniature téléchargée).', '']
    # deep
    DP = data.get('deep') or []
    lines += ['## 4. Analyse profonde (hook, débit, CTA, rythme de coupe)', '']
    if not DP:
        lines += [f'{NM} (`--deep 0`).', '']
    for d in DP:
        lines += [f"### {d.get('kind','?')} — « {(d.get('title') or '')[:100]} » — {fmt_num(d.get('view_count'))} vues, {fmt_dur(d.get('duration'))}", f"{d['url']}", '']
        rows = [('Hook 0–5 s', f"« {d.get('hook_0_5s') or NM} »"),
                ('5–15 s', f"« {(d.get('s5_15') or NM)[:300]} »"),
                ('15–30 s', f"« {(d.get('s15_30') or NM)[:300]} »"),
                ('Premier « bonjour/salut/hello »', fmt_dur(d.get('first_bonjour_s')) if d.get('first_bonjour_s') is not None else ('jamais' if d.get('words') else NM)),
                ('Débit', f"{fmt_num(d.get('wpm'))} mots/min ({fmt_num(d.get('words'))} mots, sous-titres `{d.get('transcript_lang', '?')}`)" if d.get('wpm') else NM),
                ('20 dernières s', f"« {(d.get('last_20s') or NM)[:300]} »"),
                ('Présentation de soi (transcript)', f"« {d['self_intro']} »" if d.get('self_intro') else ('aucune détectée' if d.get('words') else NM))]
        ctas = d.get('cta') or []
        if d.get('words'):
            rows.append(('CTA (type @ temps, % de la vidéo)', ' ; '.join(f"{c['type']} @ {fmt_dur(c['t'])} ({fmt_pct(c['rel'],0)}) « …{c['context'][:80]}… »" for c in ctas[:8]) or 'aucun mot-clé CTA détecté'))
        for key, label in (('cuts_scene', f"Coupes ffmpeg scene>{(d.get('cuts_scene') or {}).get('threshold', '?')}"), ('cuts_diff12', 'Coupes diff-images seuil 12 (méthode barre 22/08)')):
            c = d.get(key)
            if c and c.get('per_min') is not None:
                rows.append((label, f"{c['count']} changements → {fmt_num(c['per_min'],1)}/min, 1 toutes les {fmt_num(c['every_s'],1)} s ; écart médian {fmt_num(c['median_gap_s'],1)} s (P25 {fmt_num(c.get('p25_gap_s'),1)} · P75 {fmt_num(c.get('p75_gap_s'),1)}) ; plan max {fmt_num(c['max_shot_s'],1)} s ; cold open 0–25 s : {c['cold_open_cuts_0_25s']} coupes" + (f" (1 / {fmt_num(c['cold_open_every_s'],1)} s)" if c.get('cold_open_every_s') else '')))
            else:
                rows.append((label, NM))
        rows.append(('Planche 8 frames', f"`{d.get('frames_sheet') or NM}`"))
        rows.append(('Transcript', f"`{d.get('transcript_txt') or NM}`"))
        lines += [md_table(rows, ['Mesure', 'Valeur']), '']
    # spec
    lines += ['## 5. FORMAT SPEC — 15 lignes prêtes à répliquer (packaging, pas identité)', '']
    lines += [f'{i+1}. {s}' for i, s in enumerate(data['format_spec'])]
    lines += ['', f"Sources : listings et métadonnées yt-dlp du {now} ({ch.get('url')}/videos, /shorts) ; vidéos profondes : " +
              ', '.join(d['url'] for d in DP) + ' ; fichiers bruts dans `data.json`.']
    return '\n'.join(lines) + '\n'


def build_spec(data):
    ch = data['channel']
    L, S = data['longs'], data['shorts']
    dom = L if len(L['videos']) >= len(S['videos']) else S
    dom_kind = 'long' if dom is L else 'short'
    spec = []
    ds = dom['durations']
    spec.append(f"Format dominant : {'vidéos longues' if dom_kind=='long' else 'Shorts'} ({len(L['videos'])} longs / {len(S['videos'])} shorts dans l'échantillon ; {fmt_num(ch.get('n_videos_listed'))} longs et {fmt_num(ch.get('n_shorts_listed'))} shorts listés).")
    spec.append(f"Durée cible : {fmt_dur(ds['median'])} (fourchette P25–P75 {fmt_dur(ds['p25'])}–{fmt_dur(ds['p75'])}).")
    c = dom['cadence']
    spec.append(f"Cadence : {fmt_num(c['per_week'],1) if c['per_week'] is not None else NM} publication(s)/semaine ({c['note']}" + (f" ; {fmt_num(c.get('per_week_sample'),1)}/sem. sur tout l'échantillon de {c.get('sample_count')} vidéos / {fmt_num(c.get('sample_span_days'))} j" if c.get('per_week_sample') else '') + ').')
    if S['videos'] and L['videos']:
        spec.append(f"Mix : shorts à {fmt_num(S['cadence']['per_week'],1) if S['cadence']['per_week'] is not None else NM}/sem. (médiane {fmt_dur(S['durations']['median'])}, {fmt_num(S['views']['median_views'])} vues) en complément des longs ({fmt_num(L['views']['median_views'])} vues médianes).")
    else:
        spec.append(f"Mix : un seul format ({'longs uniquement' if L['videos'] else 'shorts uniquement'}) — l'autre onglet est absent ou vide.")
    v = dom['views']
    spec.append(f"Demande mesurée : {fmt_num(v['median_views'])} vues médianes ({v['note']}) pour {fmt_num(ch.get('followers'))} abonnés → ratio vues/abonnés médian {fmt_pct((v['median_views'] or 0)/ch['followers'],0) if ch.get('followers') and v['median_views'] else NM}.")
    DP = data.get('deep') or []
    dl = [d for d in DP if d.get('kind') == dom_kind] or DP
    if dl and dl[0].get('words'):
        d = dl[0]
        spec.append(f"Hook (0–5 s) : « {(d.get('hook_0_5s') or '')[:140]} » — premier « bonjour » : {fmt_dur(d.get('first_bonjour_s')) if d.get('first_bonjour_s') is not None else 'jamais'}.")
        spec.append(f"Débit de parole : {fmt_num(d.get('wpm'))} mots/min" + (f" (autres vidéos profondes : {', '.join(fmt_num(x.get('wpm')) for x in DP if x is not d and x.get('wpm'))})" if len(DP) > 1 else '') + '.')
        ctas = d.get('cta') or []
        if ctas:
            spec.append('Structure CTA : ' + ' ; '.join(f"{x['type']} à {fmt_pct(x['rel'],0)} ({fmt_dur(x['t'])})" for x in ctas[:5]) + '.')
        else:
            spec.append('Structure CTA : aucun mot-clé CTA détecté dans le transcript (abonne/like/commentaire/newsletter/formation/lien).')
        cs = d.get('cuts_diff12') or d.get('cuts_scene') or {}
        if cs.get('per_min') is not None:
            spec.append(f"Rythme visuel : {fmt_num(cs['per_min'],1)} changements/min (écart médian {fmt_num(cs['median_gap_s'],1)} s, plan max {fmt_num(cs['max_shot_s'],1)} s ; cold open 0–25 s : {cs['cold_open_cuts_0_25s']} coupes).")
        else:
            spec.append(f'Rythme visuel : {NM}.')
    else:
        spec += [f'Hook : {NM} (pas de transcript).', f'Débit : {NM}.', f'CTA : {NM}.', f'Rythme visuel : {NM}.']
    T = dom.get('titles') or {}
    if T.get('n'):
        p = T['patterns']
        dom_pats = sorted(((k, x) for k, x in p.items() if x >= 0.25), key=lambda kv: -kv[1])
        spec.append(f"Titres : {fmt_num(T['words_median'])} mots / {fmt_num(T['chars_median'])} car. ; motifs dominants : " + (', '.join(f'{k} {fmt_pct(x,0)}' for k, x in dom_pats) or 'aucun motif ≥ 25 %') + f" ; mots récurrents : {', '.join(w for w,_ in T['top_words'][:6])}.")
    else:
        spec.append(f'Titres : {NM}.')
    TH = data.get('thumbs') or {}
    if TH.get('n'):
        spec.append(f"Miniature : luminosité {fmt_num(TH['luminance_mean_median'])}/255 ({'sombre' if (TH['luminance_mean_median'] or 0) < 90 else 'moyenne' if (TH['luminance_mean_median'] or 0) < 150 else 'claire'}), visage/peau probable sur {TH['face_probable']}/{TH['n']} (heuristique), accents saturés {fmt_pct(TH['saturated_ratio_median'])} ; nb de mots : {NM} (voir planche).")
    else:
        spec.append(f'Miniature : {NM}.')
    spec.append(f"Technique : {dom.get('tech') or NM}")
    eng = []
    if v.get('like_per_view_median') is not None:
        eng.append(f"likes/vue {fmt_pct(v['like_per_view_median'],1)}")
    elif v.get('likes_hidden_count'):
        eng.append('likes masqués')
    if v.get('comment_per_view_median') is not None:
        eng.append(f"commentaires/vue {fmt_pct(v['comment_per_view_median'],2)}")
    spec.append('Engagement : ' + (', '.join(eng) or NM) + '.')
    topw = (L.get('titles') or {}).get('top_words') or (S.get('titles') or {}).get('top_words') or []
    spec.append(f"Sujets (mots de titres) : {', '.join(w for w,_ in topw[:10]) or NM}.")
    intro = next((d.get('self_intro') for d in DP if d.get('self_intro')), None)
    spec.append(f"Identité (avatar/visage/voix off) : {NM} automatiquement — lire la planche 8 frames et les miniatures ; présentation dans le transcript : " + (f'« {intro} »' if intro else 'aucune (« je m\'appelle / my name is » absent)') + '.')
    return spec[:15]


def tech_summary(videos):
    if not videos:
        return None
    res = collections.Counter(f"{v.get('width')}×{v.get('height')}@{v.get('fps')}" for v in videos if v.get('width'))
    cat = collections.Counter((v.get('categories') or ['?'])[0] for v in videos)
    lang = collections.Counter(v.get('language') or '?' for v in videos)
    chap = sum(1 for v in videos if (v.get('chapters') or 0) >= 3)
    desc = median([v.get('description_len') for v in videos])
    return (f"{res.most_common(1)[0][0] if res else '?'} ({res.most_common(1)[0][1]}/{len(videos)}) · {cat.most_common(1)[0][0]} · langue {lang.most_common(1)[0][0]} · "
            f"chapitres ≥3 : {chap}/{len(videos)} · description médiane {fmt_num(desc)} car.")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('target', help='URL de chaîne ou @handle')
    ap.add_argument('--videos', type=int, default=30, help='N vidéos détaillées par onglet (défaut 30)')
    ap.add_argument('--deep', type=int, default=0, help='K vidéos en analyse profonde (défaut 0)')
    ap.add_argument('--out', default=DEFAULT_OUT, help=f'répertoire de sortie (défaut {DEFAULT_OUT})')
    ap.add_argument('--lang', default='fr', help='langue préférée des titres/sous-titres (défaut fr ; mettre en pour une chaîne anglophone)')
    ap.add_argument('--yt-dlp', default=DEFAULT_YTDLP)
    ap.add_argument('--no-thumbs', action='store_true')
    ap.add_argument('--scene', type=float, default=0.3, help="seuil ffmpeg select='gt(scene,S)' (défaut 0.3)")
    a = ap.parse_args()

    yt = a.yt_dlp if os.path.exists(a.yt_dlp) else (shutil.which('yt-dlp') or a.yt_dlp)
    errors = []
    now = dt.datetime.now(dt.timezone.utc)
    base = normalize_target(a.target)
    print(f'[decode] chaîne {base}', file=sys.stderr)

    # 1a. listings flat (parallèles)
    with cf.ThreadPoolExecutor(2) as ex:
        fv = ex.submit(flat_listing, yt, base + '/videos', a.lang, errors)
        fs = ex.submit(flat_listing, yt, base + '/shorts', a.lang, errors)
        flat_v, flat_s = fv.result(), fs.result()
    meta_src = flat_v or flat_s
    if not meta_src:
        print('[decode] ÉCHEC : aucun onglet /videos ni /shorts lisible', file=sys.stderr)
        json.dump({'errors': errors}, open(os.path.join(a.out, 'ECHEC.json'), 'w'), indent=1)
        sys.exit(2)
    handle = (meta_src.get('uploader_id') or meta_src.get('channel_id') or 'chaine').lstrip('@')
    outdir = os.path.join(a.out, re.sub(r'[^\w.-]', '_', handle))
    os.makedirs(outdir, exist_ok=True)
    ch = {'name': meta_src.get('channel') or meta_src.get('uploader'), 'handle': meta_src.get('uploader_id'),
          'channel_id': meta_src.get('channel_id'), 'url': meta_src.get('uploader_url') or base,
          'followers': meta_src.get('channel_follower_count'), 'description': (meta_src.get('description') or '')[:500],
          'videos_tab': bool(flat_v), 'shorts_tab': bool(flat_s),
          'n_videos_listed': len(flat_v.get('entries') or []) if flat_v else 0,
          'n_shorts_listed': len(flat_s.get('entries') or []) if flat_s else 0,
          'views_total_videos': sum((e.get('view_count') or 0) for e in (flat_v.get('entries') or [])) if flat_v else None,
          'views_total_shorts': sum((e.get('view_count') or 0) for e in (flat_s.get('entries') or [])) if flat_s else None}
    print(f"[decode] {ch['name']} — {ch['followers']} abonnés, {ch['n_videos_listed']} longs, {ch['n_shorts_listed']} shorts listés", file=sys.stderr)

    # 1b. métadonnées détaillées (parallèles)
    with cf.ThreadPoolExecutor(2) as ex:
        jv = ex.submit(detailed_meta, yt, base + '/videos', a.videos, a.lang, errors) if flat_v and ch['n_videos_listed'] else None
        js = ex.submit(detailed_meta, yt, base + '/shorts', a.videos, a.lang, errors) if flat_s and ch['n_shorts_listed'] else None
        longs = jv.result() if jv else []
        shorts = js.result() if js else []
    # un « long » de moins de 3 min classé par YouTube dans /videos reste un long (c'est l'onglet qui décide)
    print(f'[decode] métadonnées : {len(longs)} longs, {len(shorts)} shorts', file=sys.stderr)
    if ch.get('followers') is None:
        for v in longs + shorts:
            if v.get('channel_follower_count'):
                ch['followers'] = v['channel_follower_count']
                break

    def block(videos):
        return {'videos': videos, 'cadence': cadence_stats(videos, now), 'views': views_stats(videos, now),
                'durations': duration_stats(videos), 'titles': title_stats([v.get('title') for v in videos]),
                'tech': tech_summary(videos)}
    L, S = block(longs), block(shorts)

    # 3. miniatures (onglet dominant ; les shorts n'ont en général pas de miniature custom)
    thumbs = {}
    if not a.no_thumbs:
        src_videos, src_name = (longs, 'longs') if longs else (shorts, 'shorts')
        tdir = os.path.join(outdir, 'thumbs')
        os.makedirs(tdir, exist_ok=True)
        with cf.ThreadPoolExecutor(8) as ex:
            paths = list(ex.map(lambda v: download_thumb(v, tdir), src_videos[:a.videos]))
        paths = [p for p in paths if p]
        meas = []
        for p in paths:
            m = thumb_measures(p)
            if m:
                m['file'] = os.path.basename(p)
                meas.append(m)
        sheet = contact_sheet(paths, os.path.join(outdir, 'miniatures-planche.png')) if paths else None
        thumbs = {'n': len(paths), 'source': src_name, 'sheet': sheet, 'measures': meas,
                  'luminance_mean_median': median([m['luminance_mean'] for m in meas]),
                  'skin_ratio_median': median([m['skin_ratio'] for m in meas]),
                  'white_ratio_median': median([m['white_ratio'] for m in meas]),
                  'saturated_ratio_median': median([m['saturated_ratio'] for m in meas]),
                  'face_probable': sum(1 for m in meas if m['skin_ratio'] >= 0.08)}
        print(f"[decode] miniatures : {thumbs['n']} ({src_name}), planche {sheet}", file=sys.stderr)

    # 4. deep
    deep = []
    if a.deep > 0:
        deepdir = os.path.join(outdir, 'deep')
        os.makedirs(deepdir, exist_ok=True)
        for v in pick_deep(longs, shorts, a.deep):
            print(f"[decode] deep {v['kind']} {v['id']} « {(v.get('title') or '')[:60]} » ({v.get('view_count')} vues)", file=sys.stderr)
            try:
                deep.append(deep_one(yt, v, deepdir, a.lang, a.scene, errors))
            except Exception as e:
                errors.append({'step': 'deep', 'video': v['id'], 'error': str(e)[:300]})

    data = {'run_date': now.date().isoformat(), 'target': base, 'channel': ch, 'longs': L, 'shorts': S,
            'thumbs': thumbs, 'deep': deep, 'errors': errors, 'args': vars(a)}
    code, out, _ = run([yt, '--version'], timeout=30)
    data['ytdlp_version'] = out.strip()
    data['format_spec'] = build_spec(data)
    with open(os.path.join(outdir, 'data.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1, default=str)
    fiche = build_fiche(data)
    with open(os.path.join(outdir, 'FICHE-FORMAT.md'), 'w', encoding='utf-8') as f:
        f.write(fiche)
    print(f"[decode] OK → {os.path.join(outdir, 'FICHE-FORMAT.md')} ({len(errors)} erreurs non bloquantes)", file=sys.stderr)
    print(os.path.join(outdir, 'FICHE-FORMAT.md'))


if __name__ == '__main__':
    main()
