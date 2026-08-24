#!/usr/bin/env python3
"""Habillage d'un Short parlant Lisa (standard vague-2, étude Ninon) :
- sous-titres incrustés style Shorts (whisper word-timestamps, noms propres corrigés)
- cutaways B-roll plein cadre pendant les faits (l'audio de Lisa continue)
- titre hook en haut pendant les premières secondes
- layout split « Ninon AI » : B-roll continu en haut, Lisa en bas

Usage: python3 wrap-short.py <brut.mp4> <out.mp4> --hook "TITRE" \
         [--cut broll.mp4@mot:durée ...] [--fix "avant=après" ...] \
         [--layout standard|split] [--music musique.mp3] \
         [--music-volume 0.01]

Le déclencheur `mot` est cherché dans les word-timestamps whisper (1er match,
insensible casse/accents simples) ; `@12.5:3` = temps absolu accepté aussi.
En layout split, la durée de chaque `--cut` est ignorée : le premier B-roll
commence à 0, puis chaque clip tient jusqu'au déclencheur du suivant.

Sous-titres karaoké mot à mot par défaut (mot actif agrandi et coloré,
standard Ninon) ; `--subs cards` restaure les cartes statiques historiques.
Un `--cut` peut être une image (png/jpg/webp), notamment une capture de
collect-evidence.py : son `.meta.json` voisin est détecté et l'attribution
est incrustée automatiquement pendant la fenêtre d'affichage.
"""
import argparse, difflib, json, math, os, re, subprocess, sys, tempfile, unicodedata
from pathlib import Path

from video_delivery_qc import master_video_audio, write_qc_sidecar

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}

# Tapis musical : la voix est normalisée AVANT le mix pour qu'une source faible
# ne fasse plus remonter la musique avec elle. À 0.01 (≈ −40 dB), le tapis reste
# ainsi à peine perceptible et stable entre les clips. Le seuil de ducking est
# sur la SIDECHAIN voix, pas sur la musique.
DEFAULT_MUSIC_VOLUME = 0.01
DEFAULT_MUSIC_DUCK_THRESHOLD = 0.006
DEFAULT_VOICE_TARGET_LUFS = -14.5
DEFAULT_VOICE_TRUE_PEAK_DBTP = -2.0
MASTER_LIMIT_LINEAR = 0.841395  # −1,5 dBFS, sans gain automatique du limiteur


def valid_music_volume(value):
    """Refuse les gains non positifs et les valeurs NaN/inf acceptées par float()."""
    return math.isfinite(value) and value > 0


def music_audio_filters(
    music_index,
    total,
    volume=DEFAULT_MUSIC_VOLUME,
    duck_threshold=DEFAULT_MUSIC_DUCK_THRESHOLD,
):
    """Filtre voix prioritaire : normalise la voix, puis ajoute et limite le tapis."""
    fade_out = max(0.0, total - 1.0)
    return [
        f'[0:a]loudnorm=I={DEFAULT_VOICE_TARGET_LUFS:g}:'
        f'TP={DEFAULT_VOICE_TRUE_PEAK_DBTP:g}:LRA=7,aresample=48000,'
        'asplit=2[voice_main][voice_sc]',
        f'[{music_index}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,'
        f'aresample=48000,afade=t=in:st=0:d=0.5,'
        f'afade=t=out:st={fade_out:.3f}:d=1,'
        f'volume={volume:g}[music]',
        f'[music][voice_sc]sidechaincompress=threshold={duck_threshold:g}:ratio=8:'
        'attack=5:release=250[ducked]',
        f'[voice_main][ducked]amix=inputs=2:normalize=0,atrim=0:{total:.3f},'
        f'alimiter=limit={MASTER_LIMIT_LINEAR:g}:level=false:'
        'attack=5:release=50[aout]',
    ]

def is_image(path):
    return os.path.splitext(path)[1].lower() in IMAGE_EXTENSIONS

def norm(w):
    w = unicodedata.normalize('NFD', w.lower())
    return ''.join(ch for ch in w if unicodedata.category(ch) != 'Mn').strip('.,!?;:«»"\' ')

def transcribe(path):
    from faster_whisper import WhisperModel
    m = WhisperModel('small', compute_type='int8')
    segs, _ = m.transcribe(path, language='fr', word_timestamps=True)
    words = []
    for s in segs:
        for w in s.words or []:
            words.append({'t0': w.start, 't1': w.end, 'w': w.word.strip()})
    return words

# ---------------------------------------------------------------------------
# Texte à l'écran SANS erreur : le script fait foi, le STT ne donne que le tempo.
#
# Whisper « small » francise mal les noms propres du domaine (DeepSeek → « Deeppsych »,
# Grok → « GROC », Qwen → « Quen », Kimi K3 → « Kimi 4.3 », Fable 5 → « s'effable 5 »,
# Opus 5 → « Au plus 5 », et jusqu'à Lisa → « Liya »). Rustiner ces mots un par un avec
# --fix ne passe pas à l'échelle : chaque nouveau clip apporte ses propres inventions,
# et une erreur oubliée part gravée dans l'image.
#
# La narration est SYNTHÉTISÉE À PARTIR D'UN SCRIPT : le texte exact est donc connu
# avant l'enregistrement. `align_to_script` s'en sert comme unique source du texte
# affiché et ne garde de la transcription que les instants. Le mot montré à l'écran ne
# peut alors plus être un mot inventé : il sort du script, par construction.
# ---------------------------------------------------------------------------

# Coupé du script : titres markdown, séparateurs, didascalies et emphases.
_SCRIPT_DROP_LINE = re.compile(r'^\s*(#{1,6}\s|-{3,}\s*$|\*\*(?:Décor|Decor|Ton|Voix|Format|Durée|Source)s?\b)')
_SCRIPT_BRACKETS = re.compile(r'\[[^\]]*\]|\([A-ZÀ-Ý][^)]{0,40}\)\s*:')
_SCRIPT_MARKUP = re.compile(r'[*_`>]|~~')
# Ponctuation qui, isolée, ne fait pas un mot. Les scripts narrés emploient le tiret
# cadratin comme marque de respiration (« regardé — à très vite ») : affiché seul il
# occuperait une case de karaoké vide et volerait du temps au mot suivant.
_PONCTUATION_SEULE = '.,!?;:«»\'"“”‘’…—–-'


def script_words(text):
    """Le script → la liste de mots à AFFICHER, markdown et didascalies retirés.

    On conserve la ponctuation collée au mot (comme whisper) : elle porte la
    respiration du karaoké et les fins de phrase qui découpent les cartes.
    """
    kept = []
    for line in (text or '').splitlines():
        if _SCRIPT_DROP_LINE.match(line):
            continue
        line = _SCRIPT_BRACKETS.sub(' ', line)
        line = _SCRIPT_MARKUP.sub('', line)
        kept.append(line)
    return [w for w in ' '.join(kept).split() if w.strip(_PONCTUATION_SEULE)]


def _align_key(word):
    """Clé de comparaison : sans accent, sans ponctuation, sans casse."""
    return re.sub(r'[^a-z0-9]', '', norm(word))


def align_to_script(words, script_text, min_anchor_ratio=0.35):
    """Reporte les instants de `words` (STT) sur les mots de `script_text`.

    Renvoie `(mots_alignés, rapport)`. Chaque élément garde la forme
    `{'t0','t1','w'}` du reste du pipeline, mais `w` vient TOUJOURS du script.

    Les mots que le STT a reconnus servent d'ancres ; ceux qu'il a manqués ou
    inventés laissent un trou, comblé en répartissant le temps disponible au
    prorata de la longueur des mots — un mot long dure plus qu'un mot court.

    `min_anchor_ratio` est un garde-fou : sous ce taux d'ancrage, le script et
    l'audio ne parlent visiblement pas de la même chose (mauvais fichier, mauvaise
    prise). On le signale au lieu de produire un karaoké faux en silence.
    """
    target = script_words(script_text)
    if not target:
        raise ValueError('script vide : aucun mot à afficher')
    if not words:
        raise ValueError('transcription vide : aucun instant à reporter')

    src_keys = [_align_key(w['w']) for w in words]
    tgt_keys = [_align_key(w) for w in target]

    matcher = difflib.SequenceMatcher(None, src_keys, tgt_keys, autojunk=False)
    anchored = {}
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            anchored[block.b + k] = words[block.a + k]

    start = words[0]['t0']
    end = max(w['t1'] for w in words)
    out = [{'w': w, 't0': None, 't1': None} for w in target]
    for i, anchor in anchored.items():
        out[i]['t0'] = anchor['t0']
        out[i]['t1'] = anchor['t1']

    _fill_gaps(out, start, end)

    ratio = len(anchored) / len(target)
    report = {
        'mots_script': len(target),
        'mots_stt': len(words),
        'ancres': len(anchored),
        'taux_ancrage': round(ratio, 3),
        'suffisant': ratio >= min_anchor_ratio,
    }
    return out, report


# Durée plancher d'un mot comblé : sous ~3 images (25 fps) il passe inaperçu.
MIN_WORD_DURATION = 0.12


def _widen_gap(out, i, j, t_start, t_end, missing):
    """Reprend du temps aux ancres voisines quand le trou est trop étroit.

    Whisper ne laisse aucun silence entre deux mots qu'il a reconnus : un mot qu'il a
    manqué en plein débit tomberait donc dans un trou de durée nulle et ne s'afficherait
    jamais — précisément le mot que le script devait rétablir. Ses syllabes ont été
    absorbées par les mots voisins, on leur en reprend une part, sans jamais prendre plus
    de la moitié de leur durée pour que l'ancre reste lisible et l'ordre préservé.
    En bord de segment il n'y a qu'un voisin : la plage globale du STT n'est pas débordée.
    """
    lenders = []
    if i > 0:
        lenders.append([out[i - 1], -1, max(0.0, (out[i - 1]['t1'] - out[i - 1]['t0']) / 2)])
    if j < len(out):
        lenders.append([out[j], 1, max(0.0, (out[j]['t1'] - out[j]['t0']) / 2)])
    # Deux passes : la moitié demandée à chaque voisin, puis le reste à celui qui peut encore.
    for share in (0.5, 1.0):
        for lender in lenders:
            if missing <= 1e-9:
                break
            taken = min(lender[2], missing * share)
            if taken <= 1e-9:
                continue
            lender[2] -= taken
            missing -= taken
            if lender[1] < 0:
                lender[0]['t1'] -= taken
                t_start -= taken
            else:
                lender[0]['t0'] += taken
                t_end += taken
    return t_start, t_end


def _fill_gaps(out, start, end):
    """Interpole les mots sans ancre, au prorata de leur longueur."""
    n = len(out)
    i = 0
    while i < n:
        if out[i]['t0'] is not None:
            i += 1
            continue
        j = i
        while j < n and out[j]['t0'] is None:
            j += 1
        # Bornes du trou : fin de l'ancre précédente → début de la suivante.
        t_start = out[i - 1]['t1'] if i > 0 else start
        t_end = out[j]['t0'] if j < n else end
        if t_end is None or t_end < t_start:
            t_end = t_start
        needed = MIN_WORD_DURATION * (j - i)
        if t_end - t_start < needed:
            t_start, t_end = _widen_gap(out, i, j, t_start, t_end, needed - (t_end - t_start))
        weights = [max(1, len(_align_key(out[k]['w']))) for k in range(i, j)]
        total = sum(weights) or 1
        span = max(0.0, t_end - t_start)
        cursor = t_start
        for k, weight in zip(range(i, j), weights):
            share = span * weight / total
            out[k]['t0'] = cursor
            cursor += share
            out[k]['t1'] = cursor
        i = j


FIXES_DEFAULT = {
    'chat gpt': 'ChatGPT', 'chat gp': 'ChatGPT', 'chatgpt': 'ChatGPT',
    'open ai': 'OpenAI', 'openai': 'OpenAI', 'hugging face': 'Hugging Face',
    'gemini': 'Gemini', 'ia': 'IA', "l'ia": "l'IA",
}

def apply_fixes(words, extra):
    """Corrige les noms propres sur des n-grammes de 1 à 4 mots whisper.

    Whisper éclate « Kimi K3 » en « Kimi », « 4 », « .3, » : on compare donc la
    clé normalisée AVEC et SANS espaces (« kimi 4.3 » == « kimi 4 .3 »), et on
    recolle la ponctuation finale du dernier mot remplacé.
    """
    fixes = {}
    for k, v in FIXES_DEFAULT.items():
        fixes[k] = v
    for f in extra or []:
        a, b = f.split('=', 1)
        fixes[a.lower()] = b
    # variantes « alphanumérique pur » pour toutes les clés : « kimi 4.3 » == « kimi 4 .3, » == « kimi43 »
    alnum = lambda t: re.sub(r'[^a-z0-9]', '', norm(t))
    nospace = {alnum(k): v for k, v in fixes.items()}
    i = 0
    while i < len(words):
        hit = False
        for n in (4, 3, 2, 1):
            if i + n > len(words):
                continue
            toks = [norm(words[j]['w']) for j in range(i, i + n)]
            key = ' '.join(toks)
            rep = fixes.get(key)
            if rep is None:
                rep = nospace.get(alnum(key))
            if rep is not None:
                tail = re.search(r'[,.!?;:]+$', words[i + n - 1]['w'] or '')
                words[i]['w'] = rep + (tail.group(0) if tail and not rep.endswith(tail.group(0)) else '')
                for j in range(i + 1, i + n):
                    words[j]['w'] = ''
                i += n
                hit = True
                break
        if not hit:
            i += 1
    return [w for w in words if w['w']]

# Un trait d'union qui OUVRE un jeton est toujours une coupure de whisper (« au »+« -delà »,
# « qu'est »+« -ce », « travail »+« -là ») : le mot composé s'écrit d'un seul tenant. Un jeton
# réduit AU seul tiret, lui, est une respiration de la narration et doit rester tel quel — d'où
# l'exigence d'un caractère supplémentaire.
_TRAIT_UNION_SUITE = re.compile(r'^[-‑–—]\S')


def merge_apostrophes(words):
    """Recolle ce que whisper a éclaté : apostrophes (« qu 'elle ») et traits d'union.

    Sans cela, « au-delà » finit en deux jetons et le découpage en cartons peut isoler
    « -delà » tout seul à l'écran — mesuré sur L3, L4 et V1 le 24/08.
    """
    out = []
    for w in words:
        recolle = out and (
            w['w'].startswith("'")
            or out[-1]['w'].endswith("'")
            or _TRAIT_UNION_SUITE.match(w['w'])
        )
        if recolle:
            out[-1] = {
                't0': out[-1]['t0'],
                't1': w['t1'],
                'w': (out[-1]['w'] + w['w']).replace(" '", "'"),
            }
        else:
            out.append(dict(w))
    return out


# Whisper éclate « 4.5 » en « 4. »+« 5 », « 4 »+« . »+« 5 » ou « 4 »+« 5 ».
# Un jeton « 4. » matchait aussi la fin de phrase de cards() → deux cartons.
_MAX_FUSE_GAP = 0.40
_CORE_PUNCT = '.,!?;:«»"\' '
_VERSION_LEAD = re.compile(
    r'^(?:v|gpt|claude|grok|qwen|quen|glm|gemini|gémini|seedance|'
    r'kimi|opus|fable|deepseek|llama|mistral|nemotron|chatgpt)$',
    re.I)
_PERCENT = re.compile(r'^(?:%|％|pour-?cents?)$', re.I)
_MAGNITUDE = re.compile(
    r'^(?:milliards?|millions?|mille|millièmes?|%|％|pour-?cents?)$', re.I)
_BARE_SEP = re.compile(r'^[.,]$')
_FRAC = re.compile(r'^(\d{1,3})([.,!?;:]*)?$')
_LEAD_FRAC = re.compile(r'^([.,])(\d{1,3})([.,!?;:]*)?$')
_INT_HEAD = re.compile(r'^(?:[A-Za-z][A-Za-z0-9+-]*?)?\d{1,3}$')
_DEC_HEAD = re.compile(r'^(.*?)(\d+)([.,])$')
_THOUSANDS_GRP = re.compile(r'^\d{3}$')
_PURE_INT = re.compile(r'^\d{1,3}$')
_NUMISH = re.compile(
    r'^(?:[vV]?\d+(?:[.,]\d+)?%?|[A-Za-z]+-?\d+(?:[.,]\d+)?)$')


def _core(tok):
    return (tok or '').strip(_CORE_PUNCT)


def _close(a, b):
    return (b['t0'] - a['t1']) < _MAX_FUSE_GAP


def _fuse(parts, text):
    return {'t0': parts[0]['t0'], 't1': parts[-1]['t1'], 'w': text}


def _is_dec_head(text):
    """« 4. », « 3, », « v2. », « GPT-4. » — pas une année ni un nombre déjà entier.

    « 4.6, » / « Grok 4.6, » ont déjà leur partie fractionnaire : le [.,] final
    n'est que de la ponctuation, pas un séparateur décimal ouvert.
    """
    m = _DEC_HEAD.match(text or '')
    if not m or not (1 <= len(m.group(2)) <= 3):
        return False
    if re.search(r'\d[.,]\d*$', m.group(1) or ''):
        return False
    return True


def _is_numish_token(text):
    c = _core(text)
    if not c:
        return False
    if c in '%％' or _PERCENT.match(c) or _THOUSANDS_GRP.match(c):
        return True
    if _NUMISH.match(c) or _is_dec_head(text or ''):
        return True
    return bool(re.match(r'^[.,]\d', text or ''))


def _missing_sep(prev, nxt_after):
    """Point pour une version (Claude 4.5), virgule pour un nombre FR (3,7 milliards)."""
    if nxt_after and _MAGNITUDE.match(_core(nxt_after['w'])):
        return ','
    if prev and _VERSION_LEAD.match(_core(prev['w'])):
        return '.'
    return '.'


def sticky_with_next(a, b):
    """Vrai si a et b doivent rester sur le même carton (version, milliers, %)."""
    ca, cb = _core(a['w']), _core(b['w'])
    if _VERSION_LEAD.match(ca) and _is_numish_token(b['w']):
        return True
    if _is_numish_token(a['w']) and _PERCENT.match(cb):
        return True
    if _PURE_INT.match(ca) and _THOUSANDS_GRP.match(cb):
        return True
    if _is_dec_head(a['w']) and re.match(r'^\d', (b['w'] or '').lstrip()):
        return True
    if _INT_HEAD.match(ca) and _LEAD_FRAC.match((b['w'] or '').strip()):
        return True
    return False


def _is_sentence_end(text, nxt):
    if re.search(r'[!?…]$', text or ''):
        return True
    if not (text or '').endswith('.'):
        return False
    if nxt and _is_dec_head(text) and re.match(r'^\d', (nxt['w'] or '').lstrip()):
        return False
    return True


def merge_numeric_fragments(words):
    """Recolle décimaux, versions, milliers et pourcentages éclatés par whisper.

    Timing du jeton fusionné = début du premier, fin du dernier. Idempotent
    sur un nombre déjà entier (« 4.5 », « v2.5 »).
    """
    out = []
    i = 0
    n = len(words)
    while i < n:
        w = words[i]
        nxt = words[i + 1] if i + 1 < n else None
        nxt2 = words[i + 2] if i + 2 < n else None
        prev = out[-1] if out else None

        # « 4 » + « . » + « 5 »
        if (nxt and nxt2 and _close(w, nxt) and _close(nxt, nxt2)
                and _INT_HEAD.match(_core(w['w']))
                and _BARE_SEP.match((nxt['w'] or '').strip())
                and _FRAC.match((nxt2['w'] or '').strip())):
            out.append(_fuse([w, nxt, nxt2], w['w'] + nxt['w'] + nxt2['w']))
            i += 3
            continue

        if nxt and _close(w, nxt):
            # « 4. » + « 5 »  /  « v2. » + « 5 »  /  « GPT-4. » + « 5 »
            if _is_dec_head(w['w']) and _FRAC.match((nxt['w'] or '').strip()):
                out.append(_fuse([w, nxt], w['w'] + nxt['w']))
                i += 2
                continue
            # « 4 » + « .5 »
            if (_INT_HEAD.match(_core(w['w']))
                    and _LEAD_FRAC.match((nxt['w'] or '').strip())):
                out.append(_fuse([w, nxt], w['w'] + nxt['w']))
                i += 2
                continue
            # « 1 » + « 000 » (+ groupes de 3)
            if _PURE_INT.match(_core(w['w'])) and _THOUSANDS_GRP.match(_core(nxt['w'])):
                parts = [w, nxt]
                j = i + 2
                while (j < n and _close(parts[-1], words[j])
                       and _THOUSANDS_GRP.match(_core(words[j]['w']))):
                    parts.append(words[j])
                    j += 1
                out.append(_fuse(parts, ' '.join(p['w'] for p in parts)))
                i = j
                continue
            # « 12 » + « % »
            if (_is_numish_token(w['w']) and not (w['w'] or '').endswith('%')
                    and _PERCENT.match(_core(nxt['w']) or nxt['w'])):
                out.append(_fuse([w, nxt], w['w'] + ' ' + nxt['w']))
                i += 2
                continue
            # « 4 » + « 5 » (séparateur tombé) — 1+1, ou version, ou 1+N devant une magnitude
            ca, cb = _core(w['w']), _core(nxt['w'])
            if re.fullmatch(r'\d{1,2}', ca or '') and re.fullmatch(r'\d{1,2}', cb or ''):
                nxt_after = nxt2
                one_plus_one = len(ca) == 1 and len(cb) == 1
                versionish = prev and _VERSION_LEAD.match(_core(prev['w']))
                magnitude = nxt_after and _MAGNITUDE.match(_core(nxt_after['w']))
                if one_plus_one or versionish or (len(ca) == 1 and magnitude):
                    trail = re.search(r'[,.!?;:]+$', nxt['w'] or '')
                    text = ca + _missing_sep(prev, nxt_after) + cb
                    if trail:
                        text += trail.group(0)
                    out.append(_fuse([w, nxt], text))
                    i += 2
                    continue

        out.append(dict(w))
        i += 1
    return out


def cards(words, max_words=4, max_dur=2.6):
    """Groupe les mots en cartes de sous-titres courtes."""
    words = merge_numeric_fragments(merge_apostrophes(words))
    out, cur = [], []
    i = 0
    while i < len(words):
        w = words[i]
        nxt = words[i + 1] if i + 1 < len(words) else None
        cur.append(w)
        dur = cur[-1]['t1'] - cur[0]['t0']
        sentence_end = _is_sentence_end(w['w'], nxt)
        over = len(cur) >= max_words or dur >= max_dur or sentence_end
        if over:
            if nxt and sticky_with_next(w, nxt) and len(cur) < max_words + 3:
                i += 1
                continue
            out.append({'t0': cur[0]['t0'], 't1': cur[-1]['t1'],
                        'text': ' '.join(x['w'] for x in cur), 'words': list(cur)})
            cur = []
        i += 1
    if cur:
        out.append({'t0': cur[0]['t0'], 't1': cur[-1]['t1'],
                    'text': ' '.join(x['w'] for x in cur), 'words': list(cur)})
    # jointures : pas de trous < 0.3s
    for a, b in zip(out, out[1:]):
        if 0 < b['t0'] - a['t1'] < 0.3:
            a['t1'] = b['t0']
    return out

def ass_time(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'

ACTIVE_WORD_TAG = r'{\fscx116\fscy116\1c&H00FFFF&}'  # agrandi + jaune (BGR)

def ass_escape(text):
    return text.replace('{', '').replace('}', '').replace('\n', ' ')

def karaoke_events(card):
    """Un événement par mot : la carte entière, mot actif agrandi et coloré."""
    events = []
    words = card['words']
    for j, w in enumerate(words):
        start = card['t0'] if j == 0 else max(w['t0'], card['t0'])
        end = words[j + 1]['t0'] if j + 1 < len(words) else card['t1']
        if end - start < 0.01:
            continue
        parts = []
        for k, x in enumerate(words):
            token = ass_escape(x['w'])
            parts.append(f'{ACTIVE_WORD_TAG}{token}{{\\r}}' if k == j else token)
        events.append({'t0': start, 't1': end, 'text': ' '.join(parts)})
    return events

def concat_with_outro(src, outro):
    """Soude `outro` à la fin de `src` (même W×H/fps/SAR que src, audio 48 kHz stéréo) et renvoie le mp4 temporaire."""
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                            'stream=width,height,r_frame_rate', '-of', 'csv=p=0', src],
                           capture_output=True, text=True).stdout.strip().split(',')
    w, h, fr = int(probe[0]), int(probe[1]), probe[2]
    out = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False).name
    vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fr},format=yuv420p"
    fc = (f"[0:v]{vf}[v0];[1:v]{vf}[v1];"
          "[0:a]aresample=48000,aformat=channel_layouts=stereo[a0];[1:a]aresample=48000,aformat=channel_layouts=stereo[a1];"
          "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]")
    subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-i', outro, '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
                    '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-c:a', 'aac', '-b:a', '192k', out, '-y'], check=True)
    return out

def build_ass(cards_list, hook, hook_end, w=1080, h=1920, layout='standard',
              subs='karaoke', attributions=None):
    # split : sous-titres juste sous la couture B-roll / au-dessus de la tête (judge 22/08 : 88 px posés sur le buste)
    sub_margin_v = 430 if layout == 'standard' else 930
    sub_font = 88 if layout == 'standard' else 100
    hook_margin_v = 150 if layout == 'standard' else 90
    attr_margin_v = 24 if layout == 'split' else 240
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,DejaVu Sans,{sub_font},&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,7,0,2,60,60,{sub_margin_v},1
Style: Hook,DejaVu Sans,72,&H00FFFFFF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,3,10,0,8,40,40,{hook_margin_v},1
Style: Attr,DejaVu Sans,30,&H00E8E8E8,&H00E8E8E8,&H00101010,&H50000000,0,0,0,0,100,100,0,0,3,8,0,7,24,24,{attr_margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    if hook:
        lines.append(f"Dialogue: 1,{ass_time(0.2)},{ass_time(hook_end)},Hook,,0,0,0,,{ass_escape(hook)}")
    for a in attributions or []:
        lines.append(
            f"Dialogue: 2,{ass_time(a['t0'])},{ass_time(a['t1'])},Attr,,0,0,0,,"
            f"{ass_escape(a['text'])}")
    for c in cards_list:
        if subs == 'karaoke':
            for e in karaoke_events(c):
                lines.append(
                    f"Dialogue: 0,{ass_time(e['t0'])},{ass_time(e['t1'])},Sub,,0,0,0,,{e['text']}")
        else:
            lines.append(
                f"Dialogue: 0,{ass_time(c['t0'])},{ass_time(c['t1'])},Sub,,0,0,0,,{ass_escape(c['text'])}")
    return head + '\n'.join(lines) + '\n'

def attribution_for_cut(path):
    """Attribution d'une preuve collect-evidence : lit le .meta.json voisin.

    Les fichiers de preuve s'appellent {stem}-full.png ou
    {stem}-split-WxH.png ; les métadonnées sont dans {stem}.meta.json.
    """
    base = os.path.splitext(path)[0]
    stems = [base, re.sub(r'-full$', '', base), re.sub(r'-split-\d+x\d+$', '', base)]
    for stem in dict.fromkeys(stems):
        meta_path = f'{stem}.meta.json'
        if os.path.exists(meta_path):
            try:
                attribution = json.load(open(meta_path)).get('attribution')
            except (OSError, json.JSONDecodeError) as e:
                print(f'AVERTISSEMENT: métadonnées preuve illisibles {meta_path}: {e}',
                      file=sys.stderr)
                return None
            if attribution:
                return str(attribution)
    return None

def find_trigger(words, spec):
    """`mot` ou `mot+N` (Nème occurrence) → temps du mot ; nombre pur = temps absolu."""
    try:
        return float(spec)
    except ValueError:
        pass
    m = re.match(r'^(.*?)(?:\+(\d+))?$', spec)
    target, occ = norm(m.group(1)), int(m.group(2) or 1)
    n = 0
    for w in words:
        if norm(w['w']) == target:
            n += 1
            if n == occ:
                return w['t0']
    return None

def media_duration(path):
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True, check=True)
    return float(r.stdout.strip())

def parse_face_crop(spec):
    m = re.fullmatch(
        r'\s*top\s*:\s*([0-9]*\.?[0-9]+)\s*,\s*bottom\s*:\s*([0-9]*\.?[0-9]+)\s*',
        spec)
    if not m:
        raise argparse.ArgumentTypeError(
            "format attendu : top:0.15,bottom:0.65")
    top, bottom = map(float, m.groups())
    if not 0 <= top < bottom <= 1:
        raise argparse.ArgumentTypeError(
            'face-crop exige 0 <= top < bottom <= 1')
    return top, bottom

def detect_baked_letterbox(path):
    """Détecte un letterbox incrusté dans un clip (bandes noires générées par Veo).

    Retourne 'W:H:X:Y' si un crop utile (>2% de la hauteur) est détecté, sinon None.
    """
    try:
        out = subprocess.run(
            ['ffmpeg', '-v', 'info', '-ss', '0.5', '-t', '2', '-i', path,
             '-vf', 'cropdetect=limit=24:round=2', '-f', 'null', '-'],
            capture_output=True, text=True, timeout=60).stderr
        crops = re.findall(r'crop=(\d+):(\d+):(\d+):(\d+)', out)
        if not crops:
            return None
        w, h, x, y = map(int, crops[-1])
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
            capture_output=True, text=True, timeout=30).stdout.strip()
        src_w, src_h = map(int, probe.split(','))
        if h < src_h * 0.98 and h > src_h * 0.5:
            return f'{w}:{h}:{x}:{y}'
    except Exception as e:
        print(f'AVERTISSEMENT: cropdetect {os.path.basename(path)}: {e}',
              file=sys.stderr)
    return None

def split_active_cuts(cuts, total):
    """Ordonne les cuts du layout split et fixe leur fenêtre de départ."""
    ordered = sorted(cuts, key=lambda c: c['t0'])
    active = [ordered[0]]
    last_start = 0.0
    for c in ordered[1:]:
        start = min(total, max(0.0, c['t0']))
        if start <= last_start or start >= total:
            print(
                f"AVERTISSEMENT: B-roll {os.path.basename(c['path'])!r} "
                f"hors séquence à {c['t0']:.2f}s, sauté",
                file=sys.stderr)
            continue
        c['split_t0'] = start
        active.append(c)
        last_start = start
    active[0]['split_t0'] = 0.0
    return active

def build_split_video_filter(active, ass_path, total, face_crop):
    """Construit le B-roll continu en haut et le présentateur recadré en bas."""
    top, bottom = face_crop
    fc = [
        f'[0:v]trim=duration={total:.3f},setpts=PTS-STARTPTS,'
        f'crop=iw:floor(ih*({bottom:.6f}-{top:.6f})/2)*2:0:'
        f'floor(ih*{top:.6f}/2)*2,scale=1080:960,setsar=1,fps=25[face]'
    ]
    labels = []
    for i, c in enumerate(active):
        start = c['split_t0']
        end = active[i + 1]['split_t0'] if i + 1 < len(active) else total
        seg_dur = end - start
        label = f'br{i}'
        baked = None if is_image(c['path']) else detect_baked_letterbox(c['path'])
        pre_crop = f'crop={baked},' if baked else ''
        fc.append(
            f"[{c['input_index']}:v]{pre_crop}"
            'scale=1080:960:force_original_aspect_ratio=increase,'
            'crop=1080:960,setsar=1,fps=25,'
            f'tpad=stop_mode=clone:stop_duration={total:.3f},'
            f'trim=duration={seg_dur:.3f},setpts=PTS-STARTPTS[{label}]')
        labels.append(f'[{label}]')
    if len(labels) == 1:
        fc.append(f'{labels[0]}null[top]')
    else:
        fc.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0[top]")
    fc.extend([
        '[top][face]vstack=inputs=2:shortest=1[stack]',
        f'[stack]ass={ass_path}[vout]',
    ])
    return fc

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--hook', default='')
    ap.add_argument('--outro', default='', help='clip (mp4) soudé à la fin du clip source avant habillage : CTA/signature HeyGen')
    ap.add_argument('--hook-end', type=float, default=4.5)
    ap.add_argument('--cut', action='append', default=[],
                    help='chemin.mp4@declencheur:durée (ex: b48.mp4@Un:3.5)')
    ap.add_argument('--fix', action='append', default=[])
    ap.add_argument(
        '--script', default='',
        help='fichier texte du script narré : le texte AFFICHÉ en vient mot pour mot, '
             'la transcription ne sert plus qu\'à dater les mots. Supprime par construction '
             'les inventions de whisper sur les noms propres (DeepSeek, Grok, Qwen, Kimi K3…). '
             'Écris le script tel que tu veux le LIRE à l\'écran (« 27 » plutôt que « vingt-sept »).')
    ap.add_argument(
        '--script-min-ancrage', type=float, default=0.35,
        help='taux minimal de mots du script retrouvés dans la transcription (défaut 0.35). '
             'En dessous, le script ne correspond pas à la prise : on s\'arrête au lieu de '
             'graver un karaoké décalé.')
    ap.add_argument('--broll-dir', default=os.path.expanduser('~/.codebuddy/media-video/broll'))
    ap.add_argument(
        '--layout', choices=('standard', 'split'), default='standard',
        help='standard = cutaways plein écran ; split = B-roll continu en haut et visage en bas')
    ap.add_argument(
        '--face-crop', type=parse_face_crop, default=(0.15, 0.65),
        metavar='top:0.15,bottom:0.65',
        help='fraction verticale du clip Lisa recadrée dans la moitié basse (défaut: top:0.15,bottom:0.65)')
    ap.add_argument(
        '--music',
        help='musique optionnelle, bouclée et duckée sous la voix puis masterisée à -14 LUFS')
    ap.add_argument(
        '--music-volume',
        type=float,
        default=DEFAULT_MUSIC_VOLUME,
        metavar='GAIN',
        help='gain linéaire de la musique de fond après normalisation de la voix '
             '(défaut 0.01 ≈ −40 dB ; 0.03 = ancien niveau trop présent)')
    ap.add_argument(
        '--subs', choices=('karaoke', 'cards'), default='karaoke',
        help='karaoke = mot actif agrandi et coloré (défaut, standard Ninon) ; '
             'cards = cartes statiques historiques')
    a = ap.parse_args()
    if a.outro:
        # Outro CTA/signature (ex. clip HeyGen générique « Moi c'est Lisa, abonne-toi ») soudé APRÈS le
        # clip source, avant transcription (le karaoké couvre donc aussi l'outro). Ré-encodage au format
        # du clip source pour que le concat soit fiable quel que soit l'encodage de l'outro.
        a.src = concat_with_outro(a.src, a.outro)

    words = transcribe(a.src)
    if not words:
        sys.exit('transcription vide')
    words = apply_fixes(words, a.fix)
    if a.script:
        script_text = Path(os.path.expanduser(a.script)).read_text(encoding='utf-8')
        words, rapport = align_to_script(words, script_text, a.script_min_ancrage)
        print(f"[script] {rapport['mots_script']} mots affichés depuis le script, "
              f"{rapport['ancres']} datés directement par la transcription "
              f"({rapport['taux_ancrage'] * 100:.0f}% d'ancrage)", file=sys.stderr)
        if not rapport['suffisant']:
            sys.exit(
                f"ancrage trop faible ({rapport['taux_ancrage'] * 100:.0f}% < "
                f"{a.script_min_ancrage * 100:.0f}%) : le script ne correspond pas à cette prise. "
                'Vérifie le couple script/clip avant de rendre.')
    sub_cards = cards(words, max_words=3 if a.layout == 'split' else 4)

    cuts = []
    for spec in a.cut:
        path, rest = spec.split('@', 1)
        trig, dur = rest.rsplit(':', 1)
        t = find_trigger(words, trig)
        if t is None:
            print(f'AVERTISSEMENT: déclencheur {trig!r} introuvable, cutaway sauté', file=sys.stderr)
            continue
        if not os.path.isabs(path):
            path = os.path.join(a.broll_dir, path)
        cuts.append({'path': path, 't0': round(t, 2), 'dur': float(dur)})

    if a.layout == 'split' and not cuts:
        sys.exit('layout split: au moins un --cut avec déclencheur valide est requis')

    total = media_duration(a.src)
    active = split_active_cuts(cuts, total) if a.layout == 'split' else cuts
    attributions = []
    for i, c in enumerate(active):
        text = attribution_for_cut(c['path'])
        if not text:
            continue
        if a.layout == 'split':
            t0 = c['split_t0']
            t1 = active[i + 1]['split_t0'] if i + 1 < len(active) else total
        else:
            t0, t1 = c['t0'], min(total, c['t0'] + c['dur'])
        attributions.append({'t0': t0, 't1': t1, 'text': text})

    with tempfile.NamedTemporaryFile('w', suffix='.ass', delete=False) as f:
        f.write(build_ass(sub_cards, a.hook, a.hook_end, layout=a.layout,
                          subs=a.subs, attributions=attributions))
        ass_path = f.name

    inputs = ['-i', a.src]
    for i, c in enumerate(cuts):
        if is_image(c['path']):
            span = total if a.layout == 'split' else c['dur']
            inputs += ['-loop', '1', '-t', f'{span:.3f}', '-i', c['path']]
        else:
            inputs += ['-i', c['path']]
        c['input_index'] = i + 1

    if a.layout == 'standard':
        fc, last = [], '0:v'
        for i, c in enumerate(cuts):
            t0, t1 = c['t0'], c['t0'] + c['dur']
            fc.append(f"[{i+1}:v]trim=0:{c['dur']},scale=1080:1920:force_original_aspect_ratio=increase,"
                      f"crop=1080:1920,setpts=PTS-STARTPTS+{t0}/TB[br{i}]")
            fc.append(f"[{last}][br{i}]overlay=enable='between(t,{t0},{t1})':eof_action=pass[v{i}]")
            last = f'v{i}'
        fc.append(f"[{last}]ass={ass_path}[vout]")
    else:
        fc = build_split_video_filter(active, ass_path, total, a.face_crop)

    audio_args = ['-map', '0:a', '-c:a', 'aac', '-b:a', '192k']
    if a.music:
        if not valid_music_volume(a.music_volume):
            sys.exit('--music-volume doit être un nombre fini > 0')
        music_index = len(cuts) + 1
        inputs += ['-stream_loop', '-1', '-i', a.music]
        fc.extend(music_audio_filters(music_index, total, volume=a.music_volume))
        audio_args = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k']

    if a.layout == 'standard' and not a.music:
        # Garder exactement la commande historique du mode standard.
        cmd = (['ffmpeg', '-y', '-v', 'error'] + inputs +
               ['-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '0:a',
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
                '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', a.out])
    else:
        cmd = (['ffmpeg', '-y', '-v', 'error'] + inputs +
               ['-filter_complex', ';'.join(fc), '-map', '[vout]'] + audio_args +
               ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
                '-t', f'{total:.3f}', '-movflags', '+faststart', a.out])
    try:
        subprocess.run(cmd, check=True)
    finally:
        os.unlink(ass_path)
    measurement = master_video_audio(Path(a.out))
    write_qc_sidecar(Path(a.out), measurement)
    print(f'OK {a.out} (cutaways: {[(c["path"].split("/")[-1], c["t0"]) for c in cuts]})')

if __name__ == '__main__':
    main()
