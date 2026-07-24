#!/usr/bin/env python3
"""Habillage d'un Short parlant Lisa (standard vague-2, étude Ninon) :
- sous-titres incrustés style Shorts (whisper word-timestamps, noms propres corrigés)
- cutaways B-roll plein cadre pendant les faits (l'audio de Lisa continue)
- titre hook en haut pendant les premières secondes

Usage: python3 wrap-short.py <brut.mp4> <out.mp4> --hook "TITRE" \
         [--cut broll.mp4@mot:durée ...] [--fix "avant=après" ...]

Le déclencheur `mot` est cherché dans les word-timestamps whisper (1er match,
insensible casse/accents simples) ; `@12.5:3` = temps absolu accepté aussi.
"""
import argparse, os, re, subprocess, sys, tempfile, unicodedata

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

FIXES_DEFAULT = {
    'chat gpt': 'ChatGPT', 'chat gp': 'ChatGPT', 'chatgpt': 'ChatGPT',
    'open ai': 'OpenAI', 'openai': 'OpenAI', 'hugging face': 'Hugging Face',
    'gemini': 'Gemini', 'ia': 'IA', "l'ia": "l'IA",
}

def apply_fixes(words, extra):
    fixes = dict(FIXES_DEFAULT)
    for f in extra or []:
        a, b = f.split('=', 1)
        fixes[a.lower()] = b
    # bigrammes d'abord, puis unigrammes
    i = 0
    while i < len(words):
        if i + 1 < len(words):
            big = norm(words[i]['w']) + ' ' + norm(words[i+1]['w'])
            if big in fixes:
                words[i]['w'] = fixes[big]
                words[i+1]['w'] = ''
                i += 2
                continue
        uni = norm(words[i]['w'])
        if uni in fixes:
            words[i]['w'] = fixes[uni]
        i += 1
    return [w for w in words if w['w']]

def cards(words, max_words=4, max_dur=2.6):
    """Groupe les mots en cartes de sous-titres courtes."""
    out, cur = [], []
    for w in words:
        cur.append(w)
        dur = cur[-1]['t1'] - cur[0]['t0']
        text = ' '.join(x['w'] for x in cur)
        if (len(cur) >= max_words or dur >= max_dur
                or re.search(r'[.!?…]$', w['w'])):
            out.append({'t0': cur[0]['t0'], 't1': cur[-1]['t1'], 'text': text})
            cur = []
    if cur:
        out.append({'t0': cur[0]['t0'], 't1': cur[-1]['t1'], 'text': ' '.join(x['w'] for x in cur)})
    for c in out:  # recolle les apostrophes éclatées par whisper (« qu 'elle » → « qu'elle »)
        c['text'] = re.sub(r"\s+'\s*", "'", c['text']).replace(" ' ", "'")
    # jointures : pas de trous < 0.3s
    for a, b in zip(out, out[1:]):
        if 0 < b['t0'] - a['t1'] < 0.3:
            a['t1'] = b['t0']
    return out

def ass_time(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'

def build_ass(cards_list, hook, hook_end, w=1080, h=1920):
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,DejaVu Sans,88,&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,7,0,2,60,60,430,1
Style: Hook,DejaVu Sans,72,&H00FFFFFF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,3,10,0,8,40,40,150,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    if hook:
        lines.append(f"Dialogue: 1,{ass_time(0.2)},{ass_time(hook_end)},Hook,,0,0,0,,{hook}")
    for c in cards_list:
        txt = c['text'].replace('{', '').replace('}', '')
        lines.append(f"Dialogue: 0,{ass_time(c['t0'])},{ass_time(c['t1'])},Sub,,0,0,0,,{txt}")
    return head + '\n'.join(lines) + '\n'

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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--hook', default='')
    ap.add_argument('--hook-end', type=float, default=4.5)
    ap.add_argument('--cut', action='append', default=[],
                    help='chemin.mp4@declencheur:durée (ex: b48.mp4@Un:3.5)')
    ap.add_argument('--fix', action='append', default=[])
    ap.add_argument('--broll-dir', default=os.path.expanduser('~/.codebuddy/media-video/broll'))
    a = ap.parse_args()

    words = transcribe(a.src)
    if not words:
        sys.exit('transcription vide')
    words = apply_fixes(words, a.fix)
    subs = cards(words)

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

    with tempfile.NamedTemporaryFile('w', suffix='.ass', delete=False) as f:
        f.write(build_ass(subs, a.hook, a.hook_end))
        ass_path = f.name

    inputs = ['-i', a.src]
    fc, last = [], '0:v'
    for i, c in enumerate(cuts):
        inputs += ['-i', c['path']]
        t0, t1 = c['t0'], c['t0'] + c['dur']
        fc.append(f"[{i+1}:v]trim=0:{c['dur']},scale=1080:1920:force_original_aspect_ratio=increase,"
                  f"crop=1080:1920,setpts=PTS-STARTPTS+{t0}/TB[br{i}]")
        fc.append(f"[{last}][br{i}]overlay=enable='between(t,{t0},{t1})':eof_action=pass[v{i}]")
        last = f'v{i}'
    fc.append(f"[{last}]ass={ass_path}[vout]")

    cmd = (['ffmpeg', '-y', '-v', 'error'] + inputs +
           ['-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '0:a',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', a.out])
    subprocess.run(cmd, check=True)
    os.unlink(ass_path)
    print(f'OK {a.out} (cutaways: {[(c["path"].split("/")[-1], c["t0"]) for c in cuts]})')

if __name__ == '__main__':
    main()
