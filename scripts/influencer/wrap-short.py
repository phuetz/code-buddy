#!/usr/bin/env python3
"""Habillage d'un Short parlant Lisa (standard vague-2, étude Ninon) :
- sous-titres incrustés style Shorts (whisper word-timestamps, noms propres corrigés)
- cutaways B-roll plein cadre pendant les faits (l'audio de Lisa continue)
- titre hook en haut pendant les premières secondes
- layout split « Ninon AI » : B-roll continu en haut, Lisa en bas

Usage: python3 wrap-short.py <brut.mp4> <out.mp4> --hook "TITRE" \
         [--cut broll.mp4@mot:durée ...] [--fix "avant=après" ...] \
         [--layout standard|split] [--music musique.mp3]

Le déclencheur `mot` est cherché dans les word-timestamps whisper (1er match,
insensible casse/accents simples) ; `@12.5:3` = temps absolu accepté aussi.
En layout split, la durée de chaque `--cut` est ignorée : le premier B-roll
commence à 0, puis chaque clip tient jusqu'au déclencheur du suivant.
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

def build_ass(cards_list, hook, hook_end, w=1080, h=1920, layout='standard'):
    sub_margin_v = 430 if layout == 'standard' else 180
    hook_margin_v = 150 if layout == 'standard' else 90
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,DejaVu Sans,88,&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,7,0,2,60,60,{sub_margin_v},1
Style: Hook,DejaVu Sans,72,&H00FFFFFF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,3,10,0,8,40,40,{hook_margin_v},1

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

def build_split_video_filter(cuts, ass_path, total, face_crop):
    """Construit le B-roll continu en haut et le présentateur recadré en bas."""
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
        baked = detect_baked_letterbox(c['path'])
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
    ap.add_argument('--hook-end', type=float, default=4.5)
    ap.add_argument('--cut', action='append', default=[],
                    help='chemin.mp4@declencheur:durée (ex: b48.mp4@Un:3.5)')
    ap.add_argument('--fix', action='append', default=[])
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

    if a.layout == 'split' and not cuts:
        sys.exit('layout split: au moins un --cut avec déclencheur valide est requis')

    with tempfile.NamedTemporaryFile('w', suffix='.ass', delete=False) as f:
        f.write(build_ass(subs, a.hook, a.hook_end, layout=a.layout))
        ass_path = f.name

    inputs = ['-i', a.src]
    for i, c in enumerate(cuts):
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
        total = media_duration(a.src)
        fc = build_split_video_filter(cuts, ass_path, total, a.face_crop)

    audio_args = ['-map', '0:a', '-c:a', 'aac', '-b:a', '192k']
    if a.music:
        music_index = len(cuts) + 1
        inputs += ['-stream_loop', '-1', '-i', a.music]
        total = media_duration(a.src)
        fade_out = max(0.0, total - 1.0)
        fc.extend([
            f'[{music_index}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,'
            f'afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out:.3f}:d=1,'
            'volume=0.22[music]',
            '[music][0:a]sidechaincompress=threshold=0.03:ratio=8:'
            'attack=5:release=250[ducked]',
            f'[0:a][ducked]amix=inputs=2:normalize=0,atrim=0:{total:.3f},'
            'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]',
        ])
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
    print(f'OK {a.out} (cutaways: {[(c["path"].split("/")[-1], c["t0"]) for c in cuts]})')

if __name__ == '__main__':
    main()
