#!/usr/bin/env python3
"""Assemble une vidéo longue « actu IA » 16:9 (format 1 « L'IA vient de… ») à partir
de clips avatar HeyGen VERTICAUX déjà parlants — $0, ffmpeg + PIL uniquement.

Différence avec longform-assemble.py : ici la voix est DANS les clips avatar (pas de
voice/<id>.mp3), l'avatar est vertical (720×1280) et incrusté plein hauteur au centre
sur un B-roll flouté (look « face caméra » Vision IA), et le rythme est imposé par le
montage : cut-away B-roll plein cadre toutes les ≤ 4 s, cartes chiffrées déclenchées
sur un mot du transcript (whisper word-timestamps, noms propres corrigés), cartons de
chapitre, hook = carte thèse + citation la plus forte, CTA carte à ~10 %, punchline et
carte de fin sans voix nouvelle.

Entrée : un JSON d'ordre (voir `ordre.json` du pilote longform-actu-2026-08-22) :

{
  "slug": "…", "titre": "…", "description": "…", "tags": [...],
  "music": null,                             // DÉFAUT : SANS musique (Vision IA n'en met pas) ; "…mp3" pour un lit
  "music_db": -38,                           // (si music) niveau LUFS du lit musical seul dans le master (verrouillé)
  "room_tone_lufs": -55,                     // sans musique : ambiance de salle constante très discrète (null = silence pur)
  "music_card_db": -4, "music_card_max_s": 3.0,   // atténuation fixe sous les cartes muettes courtes
  "avatar_punch_in": 1.15,                   // 1 ou 0 = cadrage unique
  "broll_roots": ["~/.codebuddy/media-video/flow-crame", "~/.codebuddy/media-video/broll"],
  "cutaway": {"first_at": 3.0, "every": 3.5, "duration": 2.5},
  "subtitles": "karaoke" | "none",
  "hook": {"these": "…", "accent": "…", "ligne": "…", "duree": 4.0,
           "citation": {"segment": "L4", "de": "compétence", "a": "aiguillage.", "texte": "…", "broll": [...]}},
  "cta": {"apres": "L1", "titre": "…", "ligne": "…", "duree": 3.0},
  "punchline": {"titre": "…", "accent": "…", "ligne": "…", "duree": 3.5},
  "fin": {"titre": "LISA IA", "ligne": "@lisaiafr", "duree": 4.0},
  "chapitres": [{"at": "hook"|"<segment id>"|"punchline", "titre": "…"}],
  "segments": [{"id": "L1", "src": "…mp4", "titre": "…", "acte": "ACTE 1 · PRIX",
                "fix": ["avant=après"], "broll": ["lisa-brain.mp4", "~/…/b096.mp4"],
                "face_crop": "top:0.18,bottom:0.88",
                "cartes": [{"t": "14", "type": "chiffre", "chiffre": "0,14 $", "ligne": "…", "duree": 3.0},
                           {"t": "12.5", "type": "liste", "titre": "…", "lignes": ["…"], "duree": 4.0},
                           {"t": "mot+2", "type": "barres", "titre": "…", "barres": [{"label": "…", "valeur": 33, "texte": "33"}]}]}]
}

Gabarit v2 (STRUCTURE-VIDEOS-LONGUES-2026-08-22.md §3) : "hook.faits" = 3-4 extraits chiffrés
SANS visage (voix de l'extrait + carte + B-roll) avant le 1er insert Lisa ; "cta.apres": "hook" place
le CTA unique avant 12 % ; "carton" par segment = phrase-pont sobre ; "recap" = carte 3 lignes avant la
fin ; "fin.formule" + écran de fin 20 s ; cartes "source" (capture stylisée surlignée) ;
"broll_specific_dir" = B-roll Grok Imagine nommés <id>-*.mp4 prioritaires.

Retouches v2b (juge Gemini 15,5/20 + retours Patrice « musique trop forte » ×2, 22/08) : la carte-thèse du
hook est SUPERPOSÉE à la voix de la première section parlée (plus de carte muette au démarrage ;
"hook.sur_voix": false rétablit la carte devant, "hook.duree_sur_voix" = 3.0 s) ; aucune carte ne reste
vide > 0,3 s (liste : 1re puce immédiate) ; chaîne audio SANS traitement dynamique : voix normalisée
linéairement à −14 LUFS (+ limiteur crête −1,5 dBTP), lit musical VERROUILLÉ à "music_db" LUFS intégrés
(défaut −32, mesuré sur le morceau : même niveau sous les cartes muettes et l'écran de fin, jamais de
remontée), ducking doux en plus sous la voix ; QC final = mesure seule si conforme (re-master dynamique
seulement en repli) ; "avatar_punch_in" = 1.15 alterne plan moyen / punch-in recadré sur les plans avatar.
Audit audio agy (22/08, « la musique sursaute ») : CHAQUE section parlée est normalisée à −14 LUFS avant la
concaténation (gain par clip HeyGen, ±0,5 LU) ; "music_db" −38 par défaut ; sidechain doux (seuil 0,08,
ratio 2, 30/400 ms) ; sous les cartes/cartons muets < "music_card_max_s" (3 s) atténuation fixe
"music_card_db" (−4 dB) avec fondus de 1,5 s ; "denoise": true sur un segment/la citation = highpass 80 Hz
+ afftdn avant normalisation.
Décision Patrice 22/08 (« Vision IA ne met pas de musique de fond ») : le défaut est SANS musique — "music": null
(ou absent) ⇒ voix normalisée par section + une ambiance de salle constante (bruit rose à "room_tone_lufs",
défaut −55 LUFS, sous le plancher des clips HeyGen ≈ −44) pour que les cartes muettes ne « claquent » pas
en silence numérique ; "room_tone_lufs": null ⇒ silence pur. "music_db"/"music_card_db" ne servent que si
"music" est fourni.

Sections VOIX OFF (v3, 23/08 — format long « L'IA vient de… » 18 min = 5 sujets en voix off + 4 inserts
avatar) : un segment `"type": "voiceover"` a pour `src` un MP3/WAV (voix ElevenLabs `longform-voice.py`) au lieu
d'un clip avatar ; il est rendu SANS visage — B-roll plein cadre enchaînés au rythme de `cutaway` (mettre
`every == duration`, ex. 2.2 s cold open / 3.5 s sujet / 6 s zoom-out → c'est ce qui donne les pics de rythme),
cartes déclenchées sur un mot du transcript whisper du MP3, badge de chapitre sur les plans B-roll, sous-titres
idem. Les segments avatar (HeyGen) et voix off se mélangent librement dans `segments`. Un B-roll trop court
pour un plan est prolongé sur sa dernière image (jamais de section vidéo plus courte que sa voix).
Nouvelles cartes : `capture` (VRAIE capture d'écran PNG/JPG d'une page source, recadrée `box` [x0,y0,x1,y1]
en px source, annotée `annot` [{"forme": "rect"|"ellipse", "box": [...]}] en rouge, lent push-in, pied
« Source : … » + date) ; `timeline` (étapes datées révélées une à une : `etapes` [{"date", "texte", "accent"}]) ;
`courbe` (courbe en S tracée progressivement, `etapes` = 3 libellés de bas en haut).

Sorties (dans --out-dir) : <slug>.mp4 (1920×1080 30 fps, −14 LUFS), <slug>-preview.mp4
(960×540), <slug>-planche-12.jpg, PACK-<slug>.md, chapters.txt, MESURES-<slug>.json,
miniature-<slug>.jpg (via miniature-youtube.py). Workdir résumable : --out-dir/work/.

Usage :
  python3 assemble_news_long.py ordre.json --out-dir DIR [--only L1,L2] [--force] [--jobs 4]
  python3 assemble_news_long.py ordre.json --out-dir DIR --mesure   # re-mesure seulement
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
INFLUENCER = HERE.parent
sys.path.insert(0, str(INFLUENCER))
from video_delivery_qc import (  # noqa: E402
    LUFS_TOLERANCE,
    MAX_TRUE_PEAK_DBTP,
    DeliveryQCError,
    assert_no_production_markers,
    master_video_audio,
    measure_loudness,
    write_qc_sidecar,
)
from video_delivery_qc import TARGET_LUFS as QC_TARGET_LUFS  # noqa: E402


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# wrap-short.py (tiret dans le nom) : whisper, corrections de noms, cartes karaoké.
wrap_short = _load_module('wrap_short', INFLUENCER / 'wrap-short.py')

# Dossier des scripts narrés (`script_dir` du JSON d'ordre) : un `<id-de-segment>.txt` par
# segment. Posé une fois au démarrage plutôt que passé à travers toute la chaîne d'appels.
SCRIPT_DIR: Path | None = None

W, H, FPS = 1920, 1080, 30
FRAME = 1.0 / FPS
FONT_VAR = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf'
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BG = (11, 15, 26)
RED = (229, 37, 46)
WHITE = (255, 255, 255)
GREY = (189, 197, 216)
GRID = (22, 28, 44)
X264 = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-r', str(FPS), '-movflags', '+faststart']
# intermédiaires ré-encodés ensuite (B-roll normalisés, fond, composite) : plus rapide, un peu plus fin
X264_TMP = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p',
            '-r', str(FPS), '-movflags', '+faststart']


class NewsLongError(RuntimeError):
    pass


# --------------------------------------------------------------------------- utils
def run(cmd: list[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(cmd, check=True, capture_output=capture, text=True)
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or '')[-2500:]
        raise NewsLongError(f'échec {cmd[0]} (code {exc.returncode})\n{details}') from exc


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def path_lock(path: Path) -> threading.Lock:
    """Un verrou par destination : deux segments en parallèle peuvent vouloir le même B-roll normalisé."""
    key = str(path)
    with _locks_guard:
        if key not in _locks:
            _locks[key] = threading.Lock()
        return _locks[key]


def atomic(cmd: list[str], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f'.{dest.stem}.{os.getpid()}-{threading.get_ident()}.part{dest.suffix}')
    try:
        run([*cmd, str(tmp)])
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


def probe_duration(path: Path) -> float:
    out = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
               '-of', 'default=noprint_wrappers=1:nokey=1', str(path)], capture=True).stdout
    return float(out.strip())


def probe_frames(path: Path) -> int:
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
               '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1',
               str(path)], capture=True).stdout
    return int(out.strip())


def q(t: float) -> float:
    """Quantifie au cadre (évite toute dérive audio/vidéo sur les concat)."""
    return round(round(t * FPS) / FPS, 6)


def expand(p: str) -> Path:
    return Path(os.path.expanduser(p))


def tc(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f'{h:d}:{m:02d}:{s:02d}' if h else f'{m:02d}:{s:02d}'


def slugify(text: str) -> str:
    import unicodedata
    t = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    t = re.sub(r'[^a-zA-Z0-9]+', '-', t).strip('-').lower()
    return t[:70]


# --------------------------------------------------------------------------- fonts / cards
_font_cache: dict[tuple, ImageFont.FreeTypeFont] = {}


def font(size: int, weight: str = 'Condensed ExtraBold', path: str = FONT_VAR) -> ImageFont.FreeTypeFont:
    key = (path, size, weight)
    if key not in _font_cache:
        f = ImageFont.truetype(path, size)
        if weight and path == FONT_VAR:
            f.set_variation_by_name(weight)
        _font_cache[key] = f
    return _font_cache[key]


def wrap_lines(text: str, f: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines: list[str] = []
    for para in text.split('\n'):
        words = para.split()
        if not words:
            lines.append('')
            continue
        cur = words[0]
        for w in words[1:]:
            trial = f'{cur} {w}'
            if f.getlength(trial) <= max_w:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def fit_text(text: str, box_w: int, box_h: int, size_max: int, size_min: int = 20,
             weight: str = 'Condensed ExtraBold', path: str = FONT_VAR, max_lines: int | None = None,
             leading: float = 1.12, name: str = 'texte') -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    """Plus grand corps qui fait tenir `text` dans box_w×box_h. Échoue plutôt que de tronquer."""
    for size in range(size_max, size_min - 1, -2):
        f = font(size, weight, path)
        lines = wrap_lines(text, f, box_w)
        if max_lines and len(lines) > max_lines:
            continue
        if any(f.getlength(l) > box_w for l in lines):
            continue
        lh = int(size * leading)
        h = lh * len(lines)
        if h <= box_h:
            return f, lines, lh
    raise NewsLongError(f'{name}: « {text[:50]} » ne tient pas dans {box_w}×{box_h} (min {size_min} pt)')


def draw_block(d: ImageDraw.ImageDraw, lines: list[str], f: ImageFont.FreeTypeFont, lh: int,
               x: int, y: int, fill, align: str = 'left', box_w: int = 0) -> int:
    for i, line in enumerate(lines):
        lw = f.getlength(line)
        if align == 'center':
            lx = x + (box_w - lw) / 2
        elif align == 'right':
            lx = x + box_w - lw
        else:
            lx = x
        d.text((lx, y + i * lh), line, font=f, fill=fill)
    return y + lh * len(lines)


_card_bg: Image.Image | None = None


def _card_background() -> Image.Image:
    """Fond de carte (grille + vignette) calculé une fois — le flou gaussien est coûteux."""
    global _card_bg
    if _card_bg is None:
        img = Image.new('RGB', (W, H), BG)
        d = ImageDraw.Draw(img)
        for x in range(0, W, 96):
            d.line([(x, 0), (x, H)], fill=GRID, width=1)
        for y in range(0, H, 96):
            d.line([(0, y), (W, y)], fill=GRID, width=1)
        vig = Image.new('L', (W // 4, H // 4), 0)
        vd = ImageDraw.Draw(vig)
        vd.rectangle([0, 0, W // 4, H // 4], fill=110)
        vd.ellipse([-50, -75, W // 4 + 50, H // 4 + 75], fill=0)
        vig = vig.filter(ImageFilter.GaussianBlur(35)).resize((W, H), Image.BILINEAR)
        img.paste(Image.new('RGB', (W, H), (0, 0, 0)), (0, 0), vig)
        _card_bg = img
    return _card_bg.copy()


def card_base(kicker: str = 'LISA IA · ACTU') -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = _card_background()
    d = ImageDraw.Draw(img)
    d.rectangle([0, H - 10, W, H], fill=RED)
    if kicker:
        kf = font(30, 'Condensed Bold')
        d.rectangle([96, 64, 96 + 12, 64 + 40], fill=RED)
        d.text((124, 66), kicker, font=kf, fill=GREY)
    return img, d


def render_card_frames(spec: dict[str, Any], dur: float) -> list[tuple[Image.Image, float]]:
    """Rend une carte en une liste (image, durée) — révélation ligne à ligne pour `liste`,
    croissance pour `barres`, pop pour `chiffre`."""
    kind = spec.get('type', 'chiffre')
    kicker = spec.get('kicker', 'LISA IA · ACTU')
    frames: list[tuple[Image.Image, float]] = []
    margin = 160
    box_w = W - 2 * margin

    if kind == 'chiffre':
        chiffre = str(spec['chiffre'])
        ligne = str(spec.get('ligne', ''))
        source = spec.get('source')
        steps = 6
        for i in range(steps + 1):
            img, d = card_base(kicker)
            k = i / steps
            scale = 0.88 + 0.12 * k
            alpha = min(1.0, 0.3 + 0.7 * k)
            nf, nlines, nlh = fit_text(chiffre, box_w, 380, int(300 * scale), 80, max_lines=1, name='chiffre')
            col = tuple(int(RED[j] * alpha + BG[j] * (1 - alpha)) for j in range(3))
            ny = 300 - (nlh - 300 * scale) / 2
            draw_block(d, nlines, nf, nlh, margin, int(ny), col, 'center', box_w)
            if i == steps and ligne:
                lf, llines, llh = fit_text(ligne, box_w, 200, 64, 30, 'Condensed SemiBold', max_lines=2, name='ligne')
                d.rectangle([W // 2 - 60, 700, W // 2 + 60, 706], fill=RED)
                draw_block(d, llines, lf, llh, margin, 740, WHITE, 'center', box_w)
            if i == steps and source:
                sf = font(26, 'Condensed Regular')
                d.text((W - 96 - sf.getlength(source), H - 60), source, font=sf, fill=GREY)
            frames.append((img, 0.05 if i < steps else max(0.1, dur - 0.05 * steps)))
        return frames

    if kind == 'liste':
        titre = str(spec.get('titre', ''))
        lignes = [str(x) for x in spec.get('lignes', [])]
        n = len(lignes)
        # le titre seul ne reste jamais plus de 0,3 s (juge : « carte vide 2,1 s ») ; puis une puce par pas
        first = min(0.3, dur / 4)
        step = max(0.35, (dur - 0.6 - first) / max(1, n))
        shown_total = 0.0
        for k in range(n + 1):
            img, d = card_base(kicker)
            y = 150
            if titre:
                tf, tlines, tlh = fit_text(titre, box_w, 220, 96, 40, max_lines=2, name='titre liste')
                y = draw_block(d, tlines, tf, tlh, margin, y, WHITE) + 30
                d.rectangle([margin, y, margin + 140, y + 8], fill=RED)
                y += 40
            avail = H - y - 110
            row = int(avail / max(1, n))
            size_max = min(64, max(34, int(row / 1.35)))
            for j, l in enumerate(lignes[:k]):
                cy = y + j * row
                lf2, ll, lh2 = fit_text(l, box_w - 60, row - 12, size_max, 26, 'Condensed SemiBold', max_lines=2, name='ligne liste')
                d.rectangle([margin, cy + lh2 * 0.22, margin + 14, cy + lh2 * 0.78], fill=RED)
                draw_block(d, ll, lf2, lh2, margin + 40, cy, WHITE)
            d_k = first if k == 0 else (step if k < n else max(0.2, dur - shown_total))
            shown_total += d_k
            frames.append((img, d_k))
        return frames

    if kind == 'barres':
        titre = str(spec.get('titre', ''))
        barres = spec.get('barres', [])
        vmax = max(float(b.get('valeur', 0)) for b in barres) or 1.0
        steps = 12
        for i in range(steps + 1):
            k = i / steps
            k = 1 - (1 - k) ** 2
            img, d = card_base(kicker)
            y = 150
            if titre:
                tf, tlines, tlh = fit_text(titre, box_w, 200, 96, 40, max_lines=2, name='titre barres')
                y = draw_block(d, tlines, tf, tlh, margin, y, WHITE) + 30
                d.rectangle([margin, y, margin + 140, y + 8], fill=RED)
                y += 50
            n = len(barres)
            row = min(150, int((H - y - 80) / max(1, n)))
            bar_h = int(row * 0.46)
            label_w = 520
            lf = font(min(46, int(bar_h * 0.9)), 'Condensed SemiBold')
            vf = font(min(52, int(bar_h * 1.05)), 'Condensed ExtraBold')
            full_w = box_w - label_w - 220
            for j, b in enumerate(barres):
                cy = y + j * row
                d.text((margin, cy + (bar_h - lf.size) / 2 - 4), str(b.get('label', '')), font=lf, fill=WHITE)
                w = int(full_w * float(b.get('valeur', 0)) / vmax * k)
                col = RED if b.get('accent') else (70, 90, 140)
                d.rectangle([margin + label_w, cy, margin + label_w + max(4, w), cy + bar_h], fill=col)
                if i == steps:
                    d.text((margin + label_w + w + 24, cy + (bar_h - vf.size) / 2 - 6), str(b.get('texte', b.get('valeur'))), font=vf, fill=WHITE)
            frames.append((img, 0.05 if i < steps else max(0.1, dur - 0.05 * steps)))
        return frames

    if kind == 'source':
        # « capture » d'article stylisée : feuille claire, titre, phrase surlignée, pied « Source : … »
        img, d = card_base('SOURCE')
        px, py, pw, ph = 200, 150, W - 400, H - 300
        d.rounded_rectangle([px + 10, py + 14, px + pw + 10, py + ph + 14], radius=18, fill=(0, 0, 0))
        d.rounded_rectangle([px, py, px + pw, py + ph], radius=18, fill=(246, 246, 242))
        src_name = str(spec.get('source', ''))
        date = str(spec.get('date', ''))
        mf = font(30, 'Condensed Bold')
        d.text((px + 50, py + 34), src_name.upper(), font=mf, fill=RED)
        if date:
            d.text((px + pw - 50 - mf.getlength(date), py + 34), date, font=mf, fill=(110, 110, 110))
        d.line([(px + 50, py + 84), (px + pw - 50, py + 84)], fill=(200, 200, 195), width=2)
        y = py + 110
        titre = str(spec.get('titre', ''))
        if titre:
            tf, tlines, tlh = fit_text(titre, pw - 100, 240, 72, 36, 'Condensed ExtraBold', max_lines=3, name='titre source')
            y = draw_block(d, tlines, tf, tlh, px + 50, y, (20, 20, 26)) + 30
        surligne = str(spec.get('surligne', ''))
        if surligne:
            hf, hlines, hlh = fit_text(surligne, pw - 100, 260, 50, 28, 'Condensed SemiBold', max_lines=4, name='surligné')
            for i, l in enumerate(hlines):
                lw = hf.getlength(l)
                d.rectangle([px + 46, y + i * hlh + 4, px + 54 + lw, y + i * hlh + hlh - 2], fill=(255, 214, 102))
            draw_block(d, hlines, hf, hlh, px + 50, y, (20, 20, 26))
            y += hlh * len(hlines) + 20
        # lignes « corps » grisées pour la texture d'article
        gy = y + 20
        while gy < py + ph - 110:
            d.rectangle([px + 50, gy, px + pw - 50 - (gy * 7) % 300, gy + 10], fill=(215, 215, 210))
            gy += 26
        foot = str(spec.get('ligne', f'Source : {src_name}'))
        ff = font(34, 'Condensed Bold')
        d.rectangle([px, py + ph - 76, px + pw, py + ph], fill=RED)
        d.text((px + 50, py + ph - 58), foot, font=ff, fill=WHITE)
        frames.append((img, dur))
        return frames

    if kind in {'these', 'cta', 'punchline', 'fin', 'chapitre', 'formule'}:
        img, d = card_base(kicker if kind != 'fin' else '')
        titre = str(spec.get('titre', ''))
        accent = str(spec.get('accent', '') or '')
        ligne = str(spec.get('ligne', '') or '')
        if kind == 'chapitre':
            # carton de chapitre / phrase-pont : acte petit + titre géant + pont sobre
            acte = str(spec.get('acte', ''))
            y = 300 if ligne else 330
            if acte:
                af = font(44, 'Condensed Bold')
                d.rectangle([margin, y + 8, margin + 16, y + 52], fill=RED)
                d.text((margin + 40, y), acte, font=af, fill=GREY)
                y += 90
            tf, tlines, tlh = fit_text(titre, box_w, 360, 128, 48, max_lines=3, name='titre chapitre')
            y = draw_block(d, tlines, tf, tlh, margin, y, WHITE)
            if ligne:
                lf, llines, llh = fit_text(ligne, box_w, 160, 50, 28, 'Condensed SemiBold', max_lines=2, name='pont')
                draw_block(d, llines, lf, llh, margin, y + 40, GREY)
            frames.append((img, dur))
            return frames
        if kind == 'fin' and spec.get('ecran_fin'):
            # écran de fin YouTube : 2 zones réservées (vidéo précédente 16:9 + abonnement rond)
            d.rounded_rectangle([1040, 300, 1040 + 700, 300 + 394], radius=12, outline=(70, 80, 110), width=4)
            ef = font(30, 'Condensed Bold')
            d.text((1040 + 350 - ef.getlength('ÉPISODE PRÉCÉDENT') / 2, 300 + 180), 'ÉPISODE PRÉCÉDENT', font=ef, fill=(120, 130, 160))
            d.ellipse([280, 360, 280 + 280, 360 + 280], outline=(70, 80, 110), width=4)
            d.text((280 + 140 - ef.getlength("S'ABONNER") / 2, 360 + 125), "S'ABONNER", font=ef, fill=(120, 130, 160))
            tf, tlines, tlh = fit_text(titre, 900, 140, 110, 50, max_lines=1, name='fin')
            draw_block(d, tlines, tf, tlh, 0, 120, WHITE, 'center', W)
            if accent:
                af, alines, alh = fit_text(accent, 900, 90, 64, 30, 'Condensed Bold', max_lines=1, name='fin accent')
                draw_block(d, alines, af, alh, 0, 120 + tlh + 6, RED, 'center', W)
            if ligne:
                lf, llines, llh = fit_text(ligne, W - 400, 100, 44, 26, 'Condensed SemiBold', max_lines=2, name='fin ligne')
                draw_block(d, llines, lf, llh, 200, H - 190, GREY, 'center', W - 400)
            frames.append((img, dur))
            return frames
        y = 250
        tf, tlines, tlh = fit_text(titre, box_w, 300, 150 if kind != 'fin' else 200, 50,
                                   max_lines=1 if kind == 'formule' else 2, name=kind)
        block_h = tlh * len(tlines)
        acc_h = 0
        af = alines = alh = None
        if accent:
            af, alines, alh = fit_text(accent, box_w, 260, 120, 44, max_lines=2, name=f'{kind} accent')
            acc_h = alh * len(alines) + 10
        lin_h = 0
        lf = llines = llh = None
        if ligne:
            lf, llines, llh = fit_text(ligne, box_w, 160, 52, 28, 'Condensed SemiBold', max_lines=2, name=f'{kind} ligne')
            lin_h = llh * len(llines) + 50
        total = block_h + acc_h + lin_h
        y = (H - total) // 2 - 10
        y = draw_block(d, tlines, tf, tlh, margin, y, WHITE, 'center', box_w)
        if accent:
            y = draw_block(d, alines, af, alh, margin, y + 10, RED, 'center', box_w)
        if ligne:
            d.rectangle([W // 2 - 60, y + 18, W // 2 + 60, y + 24], fill=RED)
            draw_block(d, llines, lf, llh, margin, y + 50, GREY, 'center', box_w)
        if kind == 'cta':
            # faux bouton S'ABONNER
            bf = font(40, 'Condensed ExtraBold')
            label = "S'ABONNER"
            bw = int(bf.getlength(label)) + 80
            bx = (W - bw) // 2
            by = H - 250
            d.rounded_rectangle([bx, by, bx + bw, by + 76], radius=14, fill=RED)
            d.text((bx + 40, by + 14), label, font=bf, fill=WHITE)
        frames.append((img, dur))
        return frames

    if kind == 'capture':
        return render_capture_frames(spec, dur)

    if kind == 'timeline':
        titre = str(spec.get('titre', ''))
        etapes = list(spec.get('etapes', []))
        n = len(etapes)
        if n == 0:
            raise NewsLongError('timeline: aucune étape')
        first = min(0.3, dur / 4)
        step = max(0.4, (dur - 0.6 - first) / n)
        shown = 0.0
        for k in range(n + 1):
            img, d = card_base(kicker)
            y = 150
            if titre:
                tf, tlines, tlh = fit_text(titre, box_w, 200, 96, 40, max_lines=2, name='titre timeline')
                y = draw_block(d, tlines, tf, tlh, margin, y, WHITE) + 30
                d.rectangle([margin, y, margin + 140, y + 8], fill=RED)
            ly = max(y + 200, 560)
            d.line([(margin, ly), (W - margin, ly)], fill=(70, 90, 140), width=6)
            gap = (W - 2 * margin) / max(1, n - 1) if n > 1 else 0
            df = font(54, 'Condensed ExtraBold')
            ef = font(38, 'Condensed SemiBold')
            for j, e in enumerate(etapes[:k]):
                cx = int(margin + (j * gap if n > 1 else (W - 2 * margin) / 2))
                col = RED if e.get('accent') else WHITE
                d.ellipse([cx - 22, ly - 22, cx + 22, ly + 22], fill=col)
                date = str(e.get('date', ''))
                texte = str(e.get('texte', ''))
                dw = df.getlength(date)
                dx = min(max(margin, cx - dw / 2), W - margin - dw)
                d.text((dx, ly - 110), date, font=df, fill=col)
                if texte:
                    tl = wrap_lines(texte, ef, 420)
                    tw = max(ef.getlength(l) for l in tl)
                    tx = min(max(margin, cx - tw / 2), W - margin - tw)
                    for i2, l in enumerate(tl[:3]):
                        d.text((tx, ly + 50 + i2 * 46), l, font=ef, fill=GREY)
            if k == n and spec.get('ligne'):
                lf, llines, llh = fit_text(str(spec['ligne']), box_w, 120, 44, 26, 'Condensed SemiBold', max_lines=2, name='ligne timeline')
                draw_block(d, llines, lf, llh, margin, H - 200, GREY, 'center', box_w)
            d_k = first if k == 0 else (step if k < n else max(0.2, dur - shown))
            shown += d_k
            frames.append((img, d_k))
        return frames

    if kind == 'courbe':
        titre = str(spec.get('titre', ''))
        etapes = [str(x) for x in spec.get('etapes', [])]
        steps = 18
        x0, x1 = margin + 40, W - margin - 40
        y_top, y_bot = 330, H - 200
        pts_all = []
        for i in range(101):
            u = i / 100
            # sigmoïde : lente, puis raide, puis plateau
            v = 1 / (1 + math.exp(-10 * (u - 0.5)))
            pts_all.append((x0 + (x1 - x0) * u, y_bot - (y_bot - y_top) * v))
        for i in range(steps + 1):
            k = i / steps
            img, d = card_base(kicker)
            y = 150
            if titre:
                tf, tlines, tlh = fit_text(titre, box_w, 160, 88, 40, max_lines=2, name='titre courbe')
                y = draw_block(d, tlines, tf, tlh, margin, y, WHITE) + 24
                d.rectangle([margin, y, margin + 140, y + 8], fill=RED)
            d.line([(x0, y_bot), (x1, y_bot)], fill=(70, 90, 140), width=4)
            d.line([(x0, y_bot), (x0, y_top - 20)], fill=(70, 90, 140), width=4)
            n_pts = max(2, int(len(pts_all) * k))
            d.line(pts_all[:n_pts], fill=RED, width=10, joint='curve')
            lf = font(46, 'Condensed ExtraBold')
            for j, lab in enumerate(etapes):
                u = (j + 0.5) / max(1, len(etapes))
                if u <= k + 0.02:
                    px, py = pts_all[min(100, int(u * 100))]
                    d.ellipse([px - 16, py - 16, px + 16, py + 16], fill=WHITE)
                    lw = lf.getlength(lab)
                    lx = min(max(x0, px - lw / 2), x1 - lw)
                    ly = py - 70 if j < len(etapes) - 1 else py + 30
                    d.text((lx, ly), lab, font=lf, fill=WHITE)
            if i == steps and spec.get('ligne'):
                lf2, llines, llh = fit_text(str(spec['ligne']), box_w, 100, 44, 26, 'Condensed SemiBold', max_lines=2, name='ligne courbe')
                draw_block(d, llines, lf2, llh, margin, H - 150, GREY, 'center', box_w)
            frames.append((img, 0.07 if i < steps else max(0.1, dur - 0.07 * steps)))
        return frames

    raise NewsLongError(f'type de carte inconnu: {kind}')


def render_capture_frames(spec: dict[str, Any], dur: float) -> list[tuple[Image.Image, float]]:
    """Carte « capture réelle » : l'image source (capture d'écran d'une page citée) recadrée, posée sur un
    écran arrondi ombré, annotée en rouge (cadre / cercle), lent push-in, en-tête source + date, pied
    « Source : … ». C'est la preuve journalistique demandée par le juge (cartes 100 % typographiques → réel)."""
    img_path = expand(str(spec.get('image', '')))
    if not img_path.exists():
        raise NewsLongError(f'capture introuvable: {img_path}')
    src = Image.open(img_path).convert('RGB')
    box = spec.get('box')
    if box:
        x0, y0, x1, y1 = [int(v) for v in box]
        src = src.crop((max(0, x0), max(0, y0), min(src.width, x1), min(src.height, y1)))
        ox, oy = max(0, x0), max(0, y0)
    else:
        ox = oy = 0
    src_name = str(spec.get('source', ''))
    date = str(spec.get('date', ''))
    foot = str(spec.get('ligne', f'Source : {src_name}' if src_name else ''))
    kicker = spec.get('kicker', 'CAPTURE · SOURCE')
    px, py, pw, ph = 150, 130, W - 300, H - 260
    top_h = 60 if (src_name or date) else 0
    foot_h = 70 if foot else 0
    area = (px + 14, py + top_h + 14, pw - 28, ph - top_h - foot_h - 28)
    # échelle « contain »
    scale0 = min(area[2] / src.width, area[3] / src.height)
    frames: list[tuple[Image.Image, float]] = []
    steps = 10 if dur >= 2.0 else 1
    zoom_max = float(spec.get('zoom', 1.05))
    for i in range(steps):
        k = i / max(1, steps - 1)
        z = 1.0 + (zoom_max - 1.0) * k
        img, d = card_base(kicker)
        d.rounded_rectangle([px + 12, py + 16, px + pw + 12, py + ph + 16], radius=18, fill=(0, 0, 0))
        d.rounded_rectangle([px, py, px + pw, py + ph], radius=18, fill=(246, 246, 242))
        if top_h:
            mf = font(30, 'Condensed Bold')
            d.text((px + 40, py + 16), src_name.upper(), font=mf, fill=RED)
            if date:
                d.text((px + pw - 40 - mf.getlength(date), py + 16), date, font=mf, fill=(110, 110, 110))
            d.line([(px + 40, py + top_h - 2), (px + pw - 40, py + top_h - 2)], fill=(200, 200, 195), width=2)
        sc = scale0 * z
        sw, sh = int(src.width * sc), int(src.height * sc)
        shot = src.resize((sw, sh), Image.LANCZOS)
        # recadrage centré si le zoom dépasse la zone
        cw, ch = min(sw, area[2]), min(sh, area[3])
        cx0, cy0 = (sw - cw) // 2, (sh - ch) // 2
        shot = shot.crop((cx0, cy0, cx0 + cw, cy0 + ch))
        dx = area[0] + (area[2] - cw) // 2
        dy = area[1] + (area[3] - ch) // 2
        img.paste(shot, (dx, dy))
        d = ImageDraw.Draw(img)
        d.rectangle([dx, dy, dx + cw, dy + ch], outline=(180, 180, 175), width=2)
        for a in spec.get('annot', []) or []:
            ax0, ay0, ax1, ay1 = [float(v) for v in a.get('box', [0, 0, 0, 0])]
            # px source (avant recadrage) → px écran
            X0 = dx + (ax0 - ox) * sc - cx0
            Y0 = dy + (ay0 - oy) * sc - cy0
            X1 = dx + (ax1 - ox) * sc - cx0
            Y1 = dy + (ay1 - oy) * sc - cy0
            if a.get('forme', 'rect') == 'ellipse':
                d.ellipse([X0, Y0, X1, Y1], outline=RED, width=7)
            else:
                d.rectangle([X0, Y0, X1, Y1], outline=RED, width=7)
            label = a.get('label')
            if label:
                lf = font(34, 'Condensed ExtraBold')
                lw = lf.getlength(label) + 28
                ly = Y0 - 50 if Y0 - 50 > dy else Y1 + 8
                d.rectangle([X0, ly, X0 + lw, ly + 44], fill=RED)
                d.text((X0 + 14, ly + 4), label, font=lf, fill=WHITE)
        if foot_h:
            ff = font(34, 'Condensed Bold')
            d.rectangle([px, py + ph - foot_h, px + pw, py + ph], fill=RED)
            fl = wrap_lines(foot, ff, pw - 80)[0]
            d.text((px + 40, py + ph - foot_h + 16), fl, font=ff, fill=WHITE)
        frames.append((img, dur / steps))
    return frames


def render_demo_chassis(spec: dict[str, Any], zone: tuple[int, int, int, int]) -> Path:
    """Le châssis d'une carte « démo » : même écran arrondi que `capture`, mais évidé.

    On dessine tout SAUF l'intérieur de l'écran, qu'on laisse transparent : la vidéo
    de l'outil viendra se poser dessous par un overlay ffmpeg. Une carte `capture`
    fabrique une image par pas de zoom ; ici l'action est DANS la vidéo, donc un seul
    châssis suffit et il ne bouge pas."""
    src_name = str(spec.get('source', ''))
    date = str(spec.get('date', ''))
    foot = str(spec.get('ligne', f'Source : {src_name}' if src_name else ''))
    kicker = spec.get('kicker', 'DÉMO · EN DIRECT')
    px, py, pw, ph = 150, 130, W - 300, H - 260
    top_h = 60 if (src_name or date) else 0
    foot_h = 70 if foot else 0
    dx, dy, cw, ch = zone

    img, d = card_base(kicker)
    img = img.convert('RGBA')
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([px + 12, py + 16, px + pw + 12, py + ph + 16], radius=18, fill=(0, 0, 0, 255))
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=18, fill=(246, 246, 242, 255))
    if top_h:
        mf = font(30, 'Condensed Bold')
        d.text((px + 40, py + 16), src_name.upper(), font=mf, fill=RED)
        if date:
            d.text((px + pw - 40 - mf.getlength(date), py + 16), date, font=mf, fill=(110, 110, 110))
        d.line([(px + 40, py + top_h - 2), (px + pw - 40, py + top_h - 2)], fill=(200, 200, 195), width=2)
    if foot_h:
        ff = font(34, 'Condensed Bold')
        d.rectangle([px, py + ph - foot_h, px + pw, py + ph], fill=RED)
        fl = wrap_lines(foot, ff, pw - 80)[0]
        d.text((px + 40, py + ph - foot_h + 16), fl, font=ff, fill=WHITE)
    # Le cadre de l'écran est dessiné, puis son intérieur est évidé.
    d.rectangle([dx - 2, dy - 2, dx + cw + 2, dy + ch + 2], outline=(180, 180, 175), width=2)
    for a in spec.get('annot', []) or []:
        ax0, ay0, ax1, ay1 = [float(v) for v in a.get('box', [0, 0, 0, 0])]
        if a.get('forme', 'rect') == 'ellipse':
            d.ellipse([dx + ax0, dy + ay0, dx + ax1, dy + ay1], outline=RED, width=7)
        else:
            d.rectangle([dx + ax0, dy + ay0, dx + ax1, dy + ay1], outline=RED, width=7)
        label = a.get('label')
        if label:
            lf = font(34, 'Condensed ExtraBold')
            lw = lf.getlength(label) + 28
            ly = dy + ay0 - 50 if dy + ay0 - 50 > dy else dy + ay1 + 8
            d.rectangle([dx + ax0, ly, dx + ax0 + lw, ly + 44], fill=RED)
            d.text((dx + ax0 + 14, ly + 4), label, font=lf, fill=WHITE)
    ax, ay, aw, ah = spec['_area']
    trou = Image.new('RGBA', (aw, ah), (0, 0, 0, 0))
    img.paste(trou, (ax, ay))
    dest = Path(tempfile.mkdtemp(prefix='demo-chassis-')) / 'chassis.png'
    img.save(dest)
    return dest


def render_demo_card(spec: dict[str, Any], dur: float, dest: Path, workdir: Path) -> None:
    """Carte « démo » : une VRAIE capture vidéo d'un outil en marche, dans le châssis de `capture`.

    Une carte `capture` prouve qu'une source existe ; une carte `demo` prouve qu'un outil
    FONCTIONNE — le terminal qui répond, la commande qui tourne, le résultat qui s'affiche.
    C'est la différence entre citer un benchmark et le montrer.

    La vidéo est mise à l'échelle « contain » dans l'écran (jamais déformée, jamais rognée),
    posée sur un fond sombre, et le châssis évidé vient par-dessus. Si la démo est plus courte
    que la carte, sa dernière image est tenue ; plus longue, elle est coupée — la durée de la
    carte reste celle que le plan a prévue, sinon la voix se décale."""
    video = expand(str(spec.get('video', '')))
    if not video.exists():
        raise NewsLongError(f'démo introuvable: {video}')
    with path_lock(dest):
        if dest.exists():
            return
        dur = q(dur)
        px, py, pw, ph = 150, 130, W - 300, H - 260
        top_h = 60 if (spec.get('source') or spec.get('date')) else 0
        foot_h = 70 if spec.get('ligne', spec.get('source')) else 0
        aw, ah = pw - 28, ph - top_h - foot_h - 28
        vw, vh = [int(v) for v in run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                       '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
                                       str(video)], capture=True).stdout.strip().split(',')[:2]]
        sc = min(aw / vw, ah / vh)
        cw, ch = int(vw * sc) // 2 * 2, int(vh * sc) // 2 * 2
        dx = px + 14 + (aw - cw) // 2
        dy = py + top_h + 14 + (ah - ch) // 2
        spec = {**spec, '_area': (px + 14, py + top_h + 14, aw, ah)}
        chassis = render_demo_chassis(spec, (dx, dy, cw, ch))
        try:
            # `tpad` tient la dernière image si la démo est plus courte que la carte.
            filtre = (f'[1:v]scale={cw}:{ch},fps={FPS},tpad=stop_mode=clone:stop_duration={dur:.3f}[v];'
                      f'[0:v][v]overlay={dx}:{dy}:shortest=0[b];'
                      f'[b][2:v]overlay=0:0:format=auto,format=yuv420p[o]')
            atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error',
                    '-f', 'lavfi', '-i', f'color=c=0x141414:s={W}x{H}:r={FPS}',
                    '-i', str(video), '-i', str(chassis),
                    '-filter_complex', filtre, '-map', '[o]',
                    '-t', f'{dur:.6f}', '-an', *X264], dest)
        finally:
            shutil.rmtree(chassis.parent, ignore_errors=True)


def render_card_video(spec: dict[str, Any], dur: float, dest: Path, workdir: Path) -> None:
    """Rend une carte en MP4 depuis ses frames PIL. Les frames + la liste concat vivent dans un dossier
    temporaire UNIQUE par appel (mkdtemp) : `dest.stem` (ex. card-03) est le même dans chaque segment,
    et quatre segments rendus en parallèle se volaient/supprimaient `frames/card-03/` (incident du 22/08,
    ffmpeg 254 « list.txt introuvable »). Le verrou par destination évite en plus deux rendus identiques."""
    if spec.get('type') == 'demo':
        # L'action est dans la vidéo : ce chemin ne passe pas par des frames PIL.
        render_demo_card(spec, dur, dest, workdir)
        return
    with path_lock(dest):
        if dest.exists():
            return
        dur = q(dur)
        frames = render_card_frames(spec, dur)
        (workdir / 'frames').mkdir(parents=True, exist_ok=True)
        tmpdir = Path(tempfile.mkdtemp(prefix=f'{dest.parent.name}-{dest.stem}-', dir=workdir / 'frames'))
        try:
            lst = []
            for i, (img, d) in enumerate(frames):
                p = tmpdir / f'{i:03d}.png'
                img.save(p)
                lst.append(f"file '{p}'\nduration {max(FRAME, d):.4f}")
            lst.append(f"file '{tmpdir / f'{len(frames) - 1:03d}.png'}'")
            concat = tmpdir / 'list.txt'
            concat.write_text('\n'.join(lst) + '\n', encoding='utf-8')
            atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(concat),
                    '-vf', f'fps={FPS},format=yuv420p', '-t', f'{dur:.6f}', '-an', *X264], dest)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


def shadow_overlay(path: Path, fg_w: int) -> Path:
    """PNG : ombre portée douce de part et d'autre de l'avatar + voile bas pour le sous-titre."""
    if path.exists():
        return path
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0 = (W - fg_w) // 2
    d.rectangle([x0 - 40, 0, x0 + fg_w + 40, H], fill=(0, 0, 0, 170))
    img = img.filter(ImageFilter.GaussianBlur(36))
    d = ImageDraw.Draw(img)
    # dégradé bas (sous-titre lisible sur le B-roll)
    for i in range(180):
        a = int(150 * (i / 180) ** 1.5)
        d.line([(0, H - 180 + i), (W, H - 180 + i)], fill=(0, 0, 0, a))
    img.save(path)
    return path


# --------------------------------------------------------------------------- B-roll
def resolve_broll(name: str, roots: list[Path]) -> Path:
    p = expand(name)
    if p.is_absolute() and p.exists():
        return p
    for r in roots:
        c = r / name
        if c.exists():
            return c
    raise NewsLongError(f'B-roll introuvable: {name}')


def media_ok(path: Path) -> bool:
    """Un intermédiaire est valide s'il a une durée lisible (un .mp4 sans moov = N/A)."""
    if not path.exists():
        return False
    try:
        return probe_duration(path) > 0
    except (NewsLongError, ValueError):
        return False


def render_broll_variant(src: Path, dest: Path, blurred: bool) -> Path:
    with path_lock(dest):
        if not media_ok(dest):
            dest.unlink(missing_ok=True)
            _render_broll_variant(src, dest, blurred)
    return dest


def _render_broll_variant(src: Path, dest: Path, blurred: bool) -> Path:
    vf = f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}'
    if blurred:
        vf += ',boxblur=18:8,eq=brightness=-0.22:saturation=0.8'
    vf += ',format=yuv420p'
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(src), '-vf', vf, '-an', *X264_TMP], dest)
    return dest


def render_bg_reel(variants: list[Path], dur: float, dest: Path) -> None:
    """Fond derrière l'avatar : enchaîne les B-roll floutés jusqu'à couvrir `dur`."""
    if media_ok(dest):
        return
    dest.unlink(missing_ok=True)
    total, lines, i = 0.0, [], 0
    durs = [probe_duration(v) for v in variants]
    while total < dur + 1:
        v = variants[i % len(variants)]
        lines.append(f"file '{v}'")
        total += durs[i % len(variants)]
        i += 1
    lst = dest.with_suffix('.txt')
    lst.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst),
            '-t', f'{q(dur):.6f}', '-c', 'copy'], dest)


# --------------------------------------------------------------------------- avatar composite
def parse_face_crop(spec: str | None) -> tuple[float, float]:
    if not spec:
        return 0.18, 0.88
    m = re.fullmatch(r'\s*top:([0-9.]+),bottom:([0-9.]+)\s*', spec)
    if not m:
        raise NewsLongError(f'face_crop invalide: {spec}')
    return float(m.group(1)), float(m.group(2))


def avatar_geometry(src: Path, face_crop: str | None) -> tuple[int, int, int, int, int]:
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
               '-of', 'csv=p=0', str(src)], capture=True).stdout.strip().split(',')
    sw, sh = int(out[0]), int(out[1])
    top, bottom = parse_face_crop(face_crop)
    crop_h = int(sh * (bottom - top)) // 2 * 2
    crop_y = int(sh * top)
    fg_w = int(round(sw * H / crop_h)) // 2 * 2
    return sw, sh, crop_y, crop_h, fg_w


def render_composite(src: Path, bg: Path, shadow: Path, geometry: tuple[int, int, int, int, int],
                     clip_range: tuple[float, float] | None, dur: float, dest: Path) -> None:
    """Avatar (recadré buste, plein hauteur, centré) sur B-roll flouté. Silencieux."""
    if media_ok(dest):
        return
    dest.unlink(missing_ok=True)
    sw, sh, crop_y, crop_h, fg_w = geometry
    cmd = ['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(bg)]
    if clip_range:
        cmd += ['-ss', f'{clip_range[0]:.3f}', '-t', f'{dur + 0.5:.3f}']
    cmd += ['-i', str(src), '-i', str(shadow)]
    fc = (f'[1:v]crop={sw}:{crop_h}:0:{crop_y},scale={fg_w}:{H}:flags=lanczos,setsar=1[fg];'
          f'[0:v][2:v]overlay=0:0:format=auto[b];'
          f'[b][fg]overlay=(W-w)/2:0:shortest=0,fps={FPS},format=yuv420p[v]')
    atomic([*cmd, '-filter_complex', fc, '-map', '[v]', '-t', f'{q(dur):.6f}', '-an', *X264_TMP], dest)


# --------------------------------------------------------------------------- timeline d'un segment
def build_shots(dur: float, cut_cfg: dict[str, Any], cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Alterne avatar / cut-away, insère les cartes à leur déclencheur.
    Retourne [{'type': 'avatar'|'cut'|'card', 't0', 't1', 'card': spec?}], contigu, quantifié."""
    first_at = float(cut_cfg.get('first_at', 3.0))
    every = float(cut_cfg.get('every', 3.5))
    cut_d = float(cut_cfg.get('duration', 2.5))
    tail = float(cut_cfg.get('tail_avatar', 2.5))
    min_shot = 0.9
    cards = sorted(cards, key=lambda c: c['_t'])
    # fenêtres de cartes (clampées dans le segment, pas de chevauchement)
    windows: list[tuple[float, float, dict]] = []
    last_end = 0.0
    for c in cards:
        t0 = max(c['_t'], last_end + min_shot) if windows else max(c['_t'], 0.0)
        t1 = min(t0 + float(c.get('duree', 3.0)), dur - tail)
        if t1 - t0 < 1.0:
            label = c.get('chiffre') or c.get('titre') or c.get('type', 'sans titre')
            raise NewsLongError(
                f'carte « {label} » ne peut pas être affichée: déclencheur {c["_t"]:.3f}s, '
                f'segment {dur:.3f}s, fenêtre utile {max(0.0, t1 - t0):.3f}s'
            )
        windows.append((q(t0), q(t1), c))
        last_end = t1
    shots: list[dict[str, Any]] = []
    t = 0.0
    next_cut = first_at
    wi = 0
    end_free = dur - tail  # après : avatar jusqu'à la fin

    def push(kind: str, a: float, b: float, card=None):
        a, b = q(a), q(b)
        if b - a < FRAME / 2:
            return
        if shots and shots[-1]['type'] == kind and kind == 'avatar':
            shots[-1]['t1'] = b
            return
        shots.append({'type': kind, 't0': a, 't1': b, 'card': card})

    while t < end_free - FRAME:
        card_start = windows[wi][0] if wi < len(windows) else None
        if card_start is not None and card_start - t < min_shot:
            # carte imminente : avatar jusqu'à la carte, puis la carte
            push('avatar', t, card_start)
            push('card', windows[wi][0], windows[wi][1], windows[wi][2])
            t = windows[wi][1]
            wi += 1
            next_cut = t + every
            continue
        if next_cut <= t + FRAME:
            b = min(t + cut_d, end_free, card_start if card_start else 1e9)
            if b - t >= min_shot:
                push('cut', t, b)
                t = b
            next_cut = t + every
            continue
        b = min(next_cut, end_free, card_start if card_start else 1e9)
        push('avatar', t, b)
        t = b
    push('avatar', end_free, dur)
    # coalescence finale des très courts plans d'avatar
    out: list[dict[str, Any]] = []
    for s in shots:
        if out and s['type'] == 'avatar' and out[-1]['type'] == 'avatar':
            out[-1]['t1'] = s['t1']
        else:
            out.append(s)
    return out


def ass_time(t: float) -> str:
    return wrap_short.ass_time(max(0.0, t))


def build_segment_ass(cards_list, shots, badge: str, citation: str | None, subtitles: str,
                      badge_on_cuts: bool = False) -> str:
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,DejaVu Sans,46,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,2,200,200,44,1
Style: Badge,DejaVu Sans,30,&H00E8E8E8,&H00E8E8E8,&H00101010,&H8C000000,-1,0,0,0,100,100,0,0,3,10,0,7,70,70,56,1
Style: Quote,DejaVu Sans,54,&H00FFFFFF,&H00FFFFFF,&H00101010,&HA0000000,-1,-1,0,0,100,100,0,0,3,14,0,2,220,220,110,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    if badge:
        for s in shots:
            if (s['type'] == 'avatar' or (badge_on_cuts and s['type'] == 'cut')) and s['t1'] - s['t0'] > 0.6:
                lines.append(f"Dialogue: 2,{ass_time(s['t0'])},{ass_time(s['t1'])},Badge,,0,0,0,,{wrap_short.ass_escape(badge)}")
    if citation:
        end = shots[-1]['t1'] if shots else 5
        lines.append(f"Dialogue: 3,{ass_time(0.15)},{ass_time(end)},Quote,,0,0,0,,{wrap_short.ass_escape(citation)}")
    if citation:
        subtitles = 'none'
    if subtitles == 'karaoke':
        card_windows = [(s['t0'], s['t1']) for s in shots if s['type'] == 'card']
        for c in cards_list:
            for e in wrap_short.karaoke_events(c):
                # pas de sous-titre par-dessus une carte chiffrée (elle porte déjà le texte)
                if any(a - 0.05 <= e['t0'] < b for a, b in card_windows):
                    continue
                txt = e['text'].replace(wrap_short.ACTIVE_WORD_TAG, r'{\fscx108\fscy108\1c&H4D4DFF&}')
                lines.append(f"Dialogue: 0,{ass_time(e['t0'])},{ass_time(e['t1'])},Sub,,0,0,0,,{txt}")
    elif subtitles == 'cards':
        for c in cards_list:
            lines.append(f"Dialogue: 0,{ass_time(c['t0'])},{ass_time(c['t1'])},Sub,,0,0,0,,{wrap_short.ass_escape(c['text'])}")
    return head + '\n'.join(lines) + '\n'


def punch_in_filter(zoom: float) -> str:
    """Recadrage « punch-in » ×zoom du composite (centré, ancré vers le haut = visage), remis à W×H."""
    cw = int(W / zoom) // 2 * 2
    ch = int(H / zoom) // 2 * 2
    cx = (W - cw) // 2
    cy = int((H - ch) * 0.30) // 2 * 2
    return f'crop={cw}:{ch}:{cx}:{cy},scale={W}:{H}:flags=lanczos,setsar=1'


def assemble_segment(seg_id: str, src: Path, clip_range: tuple[float, float] | None, dur: float,
                     composite: Path, shots: list[dict[str, Any]], cut_sources: list[Path],
                     card_videos: dict[int, Path], ass_path: Path, dest_v: Path, dest_a: Path,
                     cut_offsets: list[float], punch_in: float = 1.0, punch_first: bool = False) -> None:
    """Monte les plans (trim du composite / cut-aways / cartes) + sous-titres, et extrait l'audio.
    `punch_in` > 1 : un plan avatar sur deux est recadré ×punch_in (deux valeurs de plan) ; `punch_first`
    commence par le plan serré (un insert court d'un seul plan peut ainsi varier d'un insert à l'autre)."""
    if not dest_v.exists():
        cmd = ['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(composite)]
        inputs = 1
        fc: list[str] = []
        labels: list[str] = []
        cut_i = 0
        avatar_i = 1 if punch_first else 0
        for k, s in enumerate(shots):
            d = q(s['t1'] - s['t0'])
            if s['type'] == 'avatar':
                zoom = punch_in_filter(punch_in) + ',' if punch_in > 1.0 and avatar_i % 2 == 1 else ''
                avatar_i += 1
                fc.append(f"[0:v]trim=start={s['t0']:.6f}:end={s['t1']:.6f},setpts=PTS-STARTPTS,{zoom}"
                          f"null[v{k}]")
            elif s['type'] == 'cut':
                srcp = cut_sources[cut_i % len(cut_sources)]
                off = cut_offsets[cut_i % len(cut_offsets)]
                cut_i += 1
                cmd += ['-i', str(srcp)]
                fc.append(f"[{inputs}:v]trim=start={off:.6f}:end={off + d:.6f},setpts=PTS-STARTPTS,"
                          f"tpad=stop_mode=clone:stop_duration={d:.6f},trim=duration={d:.6f},setpts=PTS-STARTPTS[v{k}]")
                inputs += 1
            else:
                cmd += ['-i', str(card_videos[k])]
                fc.append(f"[{inputs}:v]trim=0:{d:.6f},setpts=PTS-STARTPTS[v{k}]")
                inputs += 1
            labels.append(f'[v{k}]')
        fc.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0[vc]")
        fc.append(f"[vc]ass={ass_path}:fontsdir=/usr/share/fonts/truetype/dejavu,fps={FPS},format=yuv420p[v]")
        atomic([*cmd, '-filter_complex', ';'.join(fc), '-map', '[v]', '-t', f'{dur:.6f}', '-an', *X264], dest_v)
    if not dest_a.exists():
        cmd = ['ffmpeg', '-y', '-hide_banner', '-v', 'error']
        if clip_range:
            cmd += ['-ss', f'{clip_range[0]:.3f}']
        cmd += ['-i', str(src), '-af',
                f'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
                f'apad,atrim=0:{dur:.6f}',
                '-t', f'{dur:.6f}', '-c:a', 'pcm_s16le', '-ar', '48000']
        atomic(cmd, dest_a)


def silent_audio(dur: float, dest: Path) -> None:
    if dest.exists():
        return
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i',
            'anullsrc=r=48000:cl=stereo', '-t', f'{dur:.6f}', '-c:a', 'pcm_s16le'], dest)


# --------------------------------------------------------------------------- sections
VOICED_KINDS = {'segment', 'fait', 'citation'}
DENOISE = 'highpass=f=80,afftdn=nf=-50:nr=6'  # doux : le gros du « souffle » de la citation est < 80 Hz (hp seul : −1,1 LU), afftdn nf=-30 rognait la voix (−2,1 LU)


class Section:
    def __init__(self, sid: str, kind: str, video: Path, audio: Path, dur: float, titre: str = '',
                 denoise: bool = False):
        self.id, self.kind, self.video, self.audio, self.dur, self.titre = sid, kind, video, audio, dur, titre
        self.denoise = denoise
        self.gain_db = 0.0
        self.lufs = None


def normalize_section_audio(sec: Section) -> Section:
    """Section PARLÉE → audio-norm.wav à −14 LUFS (gain linéaire par clip + limiteur crête vraie ; débruitage
    optionnel avant). Un seul gain global laissait ±3 LU entre clips HeyGen (audit : L6 −2,8 LU)."""
    if sec.kind not in VOICED_KINDS:
        return sec
    dest = sec.audio.with_name('audio-norm.wav')
    meta = sec.audio.with_name('audio-norm.json')
    if stale(dest, sec.audio) or not meta.exists() or json.loads(meta.read_text()).get('denoise') != sec.denoise:
        pre = f'{DENOISE},' if sec.denoise else ''
        if sec.denoise:
            tmp = sec.audio.with_name(f'.{sec.id}.denoised.wav')
            atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(sec.audio), '-af', DENOISE,
                    '-c:a', 'pcm_s16le'], tmp)
            meas = ebur128(tmp)
            tmp.unlink(missing_ok=True)
        else:
            meas = ebur128(sec.audio)
        gain = TARGET_LUFS - meas['I']
        atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(sec.audio), '-af',
                f'{pre}volume={gain:.2f}dB,{LIMITER}', '-c:a', 'pcm_s16le', '-ar', '48000'], dest)  # même format que
        after = ebur128(dest)  # les wav de cartes (concat demuxer : formats mélangés = paquets PCM invalides)
        meta.write_text(json.dumps({'denoise': sec.denoise, 'gain_db': round(gain, 2), 'in_lufs': meas['I'],
                                    'out_lufs': after['I']}), encoding='utf-8')
    data = json.loads(meta.read_text())
    sec.gain_db, sec.lufs = data['gain_db'], data['out_lufs']
    sec.audio = dest
    return sec


def words_for(seg: dict[str, Any], src: Path, workdir: Path,
              script_dir: Path | None = None) -> list[dict[str, Any]]:
    """Mots datés du segment. Avec un script, le TEXTE en vient et whisper ne donne que le tempo.

    Sans script, on retombe sur le comportement historique : les mots devinés par whisper,
    rustinés par la table `fix` du segment. C'est ce qui a gravé « tout chinois »,
    « la question n'est plus qu'à l'abonnement » et une punchline coupée en deux dans le
    pilote du 22/08 — la table ne répare que ce qu'on a déjà vu passer.
    """
    cache = workdir / 'words' / f"{seg['id']}.json"
    if cache.exists():
        words = json.loads(cache.read_text(encoding='utf-8'))
    else:
        cache.parent.mkdir(parents=True, exist_ok=True)
        words = wrap_short.transcribe(str(src))
        cache.write_text(json.dumps(words, ensure_ascii=False), encoding='utf-8')
    words = wrap_short.apply_fixes(words, seg.get('fix', []))

    script = seg.get('script')
    dossier = script_dir or SCRIPT_DIR
    if not script and dossier:
        candidat = Path(dossier) / f"{seg['id']}.txt"
        if not candidat.exists():
            raise NewsLongError(
                f"{seg['id']}: script attendu mais introuvable ({candidat}) — "
                'repli sur la transcription refusé'
            )
        script = str(candidat)
    if not script:
        return words
    chemin = Path(os.path.expanduser(str(script)))
    if not chemin.exists():
        raise NewsLongError(
            f"{seg['id']}: script déclaré mais introuvable ({chemin}) — "
            'repli sur la transcription refusé'
        )
    alignes, rapport = wrap_short.align_to_script(words, chemin.read_text(encoding='utf-8'))
    print(f"[script] {seg['id']}: {rapport['mots_script']} mots affichés depuis le script, "
          f"{rapport['taux_ancrage'] * 100:.0f}% d'ancrage", file=sys.stderr)
    if not rapport['suffisant']:
        raise SystemExit(f"{seg['id']}: ancrage trop faible "
                         f"({rapport['taux_ancrage'] * 100:.0f}%) — le script ne correspond pas à ce clip.")
    return alignes


def find_word(words: list[dict[str, Any]], spec: str) -> float | None:
    """`mot` ou `mot+N` (N-ième occurrence) → t0 du mot (comparaison normalisée, « 2700 » est un MOT,
    pas un temps) ; sinon `@12.5` ou un nombre décimal avec point = temps absolu."""
    spec = str(spec).strip()
    if spec.startswith('@'):
        return float(spec[1:])
    m = re.match(r'^(.*?)(?:\+(\d+))?$', spec)
    target, occ = wrap_short.norm(m.group(1)), int(m.group(2) or 1)
    # Un déclencheur peut porter sur PLUSIEURS mots (« trie ce dossier »). Historiquement
    # cela marchait par accident : la table `fix` fusionnait ces mots en un seul jeton. Dès
    # que les jetons sont rendus mot à mot — ce que fait l'alignement sur script —, il faut
    # chercher la SUITE de mots, sinon la carte retombe sur son instant de repli.
    cibles = target.split()
    n = 0
    for i, w in enumerate(words):
        if len(cibles) > 1:
            suite = [wrap_short.norm(x['w']) for x in words[i:i + len(cibles)]]
            trouve = suite == cibles
        else:
            trouve = wrap_short.norm(w['w']) == target
        if trouve:
            n += 1
            if n == occ:
                return float(w['t0'])
    if re.fullmatch(r'\d+\.\d+', spec):
        return float(spec)
    return None


def resolve_trigger(words: list[dict[str, Any]], spec: str, fallback: float) -> float:
    t = find_word(words, spec)
    if t is None:
        print(f"  AVERTISSEMENT déclencheur « {spec} » introuvable → {fallback:.1f}s", file=sys.stderr)
        return fallback
    return float(t)


def render_avatar_section(seg: dict[str, Any], cfg: dict[str, Any], workdir: Path, roots: list[Path],
                          shadow_cache: dict[int, Path], citation: str | None = None,
                          clip_range: tuple[float, float] | None = None, kind: str = 'segment',
                          faceless: bool = False, cache_dir: Path | None = None) -> Section:
    """Rend une section avatar (ou, si `faceless`, voix + B-roll plein cadre + cartes, sans visage)."""
    cache_dir = cache_dir or workdir
    sid = seg['id']
    src = expand(seg['src'])
    if not src.exists():
        raise NewsLongError(f'{sid}: clip introuvable {src}')
    sdir = workdir / 'segments' / sid
    sdir.mkdir(parents=True, exist_ok=True)
    if clip_range:
        dur = q(clip_range[1] - clip_range[0])
    else:
        dur = q(probe_duration(src))
    words_all = words_for(seg, src, cache_dir)
    if clip_range:
        words = [dict(w, t0=w['t0'] - clip_range[0], t1=w['t1'] - clip_range[0]) for w in words_all
                 if w['t1'] > clip_range[0] and w['t0'] < clip_range[1]]
    else:
        words = words_all
    subs_cards = wrap_short.cards(words, max_words=5, max_dur=2.8)

    # cartes chiffrées → temps
    cards = []
    for c in seg.get('cartes', []):
        c2 = dict(c)
        c2['_t'] = resolve_trigger(words, c['t'], fallback=dur / 2)
        cards.append(c2)

    cut_cfg = dict(cfg.get('cutaway', {}))
    cut_cfg.update(seg.get('cutaway', {}))
    shots = build_shots(dur, cut_cfg, cards)
    if faceless:
        for s_ in shots:
            if s_['type'] == 'avatar':
                s_['type'] = 'cut'

    # B-roll : variantes normalisées (cache global) — fond flouté + plein cadre
    specific: list[Path] = []
    spec_dir = cfg.get('broll_specific_dir')
    if spec_dir:
        base_id = sid.split('-')[0]
        specific = sorted(expand(spec_dir).glob(f'{base_id}-*.mp4'))
        if specific:
            print(f"  {sid}: {len(specific)} B-roll spécifiques ({', '.join(p.name for p in specific)})", flush=True)
    brolls = specific + [resolve_broll(b, roots) for b in seg.get('broll', [])]
    if not brolls:
        raise NewsLongError(f'{sid}: aucun B-roll')
    bgs = [render_broll_variant(b, cache_dir / 'broll-bg' / f'{b.stem}.mp4', True) for b in brolls]
    cuts = [render_broll_variant(b, cache_dir / 'broll-cut' / f'{b.stem}.mp4', False) for b in brolls]
    # décalages de lecture variés pour que deux passages du même B-roll diffèrent
    n_cut = sum(1 for s in shots if s['type'] == 'cut')
    cut_d = float(cut_cfg.get('duration', 2.5))
    offsets = []
    cut_durs = [probe_duration(c) for c in cuts]
    for i in range(max(1, n_cut)):
        src_d = cut_durs[i % len(cuts)]
        if faceless:
            # voix off : pas de `every` distinct, les plans font `duration` ; décalage par pas de 1,5 s
            n_slots = max(1, int((src_d - cut_d) / 1.5) + 1)
            slot = (i // len(cuts)) % n_slots
            offsets.append(q(min(max(0.0, src_d - cut_d - FRAME), slot * 1.5)))
        else:
            slot = (i // len(cuts)) % max(1, int((src_d - cut_d) // cut_d) or 1)
            offsets.append(q(min(max(0.0, src_d - cut_d - FRAME), slot * cut_d)))
    # ordre des cut-aways : on commence au 2e B-roll (le 1er est déjà le fond au début)
    cut_sources = (cuts[1:] + cuts[:1] if len(cuts) > 1 else cuts) if not faceless else cuts

    composite = sdir / 'composite.mp4'
    if faceless:
        # pas d'avatar : le « composite » n'est jamais lu (tous les plans sont cut/carte) — on pointe sur le 1er cut
        composite = cuts[0]
    else:
        bg_reel = sdir / 'bg.mp4'
        render_bg_reel(bgs, dur, bg_reel)
        geometry = avatar_geometry(src, seg.get('face_crop') or cfg.get('face_crop'))
        fg_w = geometry[4]
        with path_lock(cache_dir / f'shadow-{fg_w}.png'):
            if fg_w not in shadow_cache:
                shadow_cache[fg_w] = shadow_overlay(cache_dir / f'shadow-{fg_w}.png', fg_w)
        render_composite(src, bg_reel, shadow_cache[fg_w], geometry, clip_range, dur, composite)

    card_videos: dict[int, Path] = {}
    for k, s in enumerate(shots):
        if s['type'] == 'card':
            p = sdir / f'card-{k:02d}.mp4'
            render_card_video(s['card'], s['t1'] - s['t0'], p, workdir)
            card_videos[k] = p

    badge = ''
    if kind == 'segment':
        acte = seg.get('acte', '')
        badge = f"{acte}  —  {seg.get('titre', '')}" if acte else seg.get('titre', '')
    ass_path = sdir / 'subs.ass'
    ass_path.write_text(build_segment_ass(subs_cards, shots, badge, citation, cfg.get('subtitles', 'karaoke'),
                                          badge_on_cuts=faceless and kind == 'segment'),
                        encoding='utf-8')
    dest_v, dest_a = sdir / 'video.mp4', sdir / 'audio.wav'
    assemble_segment(sid, src, clip_range, dur, composite, shots, cut_sources, card_videos, ass_path,
                     dest_v, dest_a, offsets,
                     punch_in=float(seg.get('avatar_punch_in', cfg.get('avatar_punch_in', 1.15)) or 1.0),
                     punch_first=bool(seg.get('punch_in_first')))
    (sdir / 'shots.json').write_text(json.dumps(
        [{k: (v if k != 'card' else (v or {}).get('type')) for k, v in s.items()} for s in shots],
        ensure_ascii=False, indent=1), encoding='utf-8')
    return Section(sid, kind, dest_v, dest_a, dur, seg.get('titre', ''), denoise=bool(seg.get('denoise')))


def render_card_section(sid: str, spec: dict[str, Any], dur: float, workdir: Path) -> Section:
    sdir = workdir / 'cards'
    sdir.mkdir(parents=True, exist_ok=True)
    dur = q(dur)
    v = sdir / f'{sid}.mp4'
    a = sdir / f'{sid}.wav'
    render_card_video(spec, dur, v, workdir)
    silent_audio(dur, a)
    return Section(sid, spec.get('type', 'card'), v, a, dur, spec.get('titre', ''))


# --------------------------------------------------------------------------- final
def concat_sections(sections: list[Section], workdir: Path, dest_v: Path, dest_a: Path) -> None:
    if stale(dest_v, *(s.video for s in sections)):
        lst = workdir / 'concat-video.txt'
        lst.write_text('\n'.join(f"file '{s.video}'" for s in sections) + '\n', encoding='utf-8')
        atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst),
                '-c', 'copy'], dest_v)
    if stale(dest_a, *(s.audio for s in sections)):
        lst = workdir / 'concat-audio.txt'
        lst.write_text('\n'.join(f"file '{s.audio}'" for s in sections) + '\n', encoding='utf-8')
        atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst),
                '-c:a', 'pcm_s16le'], dest_a)


TARGET_LUFS = -14.0
LIMIT_DBTP = -1.5
# limiteur crête VRAIE : alimiter ne voit que les échantillons → suréchantillonnage ×4 et marge de 0,5 dB
# (sans cela une voix limitée à −1,5 dBFS ressortait à −0,5 dBTP et le QC basculait en re-master dynamique)
LIMITER = (f'aresample=192000,alimiter=limit={10 ** ((LIMIT_DBTP - 0.5) / 20):.4f}:attack=5:release=100:level=false,'
           f'aresample=48000')


def stale(dest: Path, *sources: Path) -> bool:
    """Vrai si `dest` manque ou est plus ancien qu'une de ses sources — le rendu régénère ce qui est
    périmé (un master existant n'était jamais ré-muxé après un re-rendu des sections)."""
    if not dest.exists():
        return True
    m = dest.stat().st_mtime
    return any(src.exists() and src.stat().st_mtime > m for src in sources)


def ebur128(path: Path, start: float | None = None, length: float | None = None) -> dict[str, float]:
    """Mesure I (LUFS), LRA et crête (dBFS, true-peak) d'un fichier ou d'un extrait."""
    cmd = ['ffmpeg', '-hide_banner', '-nostats']
    if start is not None:
        cmd += ['-ss', f'{start:.3f}']
    if length is not None:
        cmd += ['-t', f'{length:.3f}']
    res = run([*cmd, '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture=True)
    out: dict[str, float] = {}
    for key, pat in (('I', r'^\s+I:\s+(-?[0-9.]+) LUFS'), ('LRA', r'^\s+LRA:\s+(-?[0-9.]+) LU'),
                     ('TP', r'^\s+Peak:\s+(-?[0-9.]+) dBFS')):
        m = re.findall(pat, res.stderr, flags=re.M)
        if m:
            out[key] = float(m[-1])
    if 'I' not in out:
        raise NewsLongError(f'ebur128 : mesure introuvable pour {path}')
    return out


def premaster_voice(voice: Path, dest: Path) -> float:
    """Voix → −14 LUFS par GAIN LINÉAIRE (+ limiteur crête −1,5 dBTP, qui ne touche que les rares crêtes
    au-dessus) : aucun traitement dynamique, donc le rapport voix/musique décidé au mix est celui du master.
    (L'ancien loudnorm deux passes sur le mix basculait en mode dynamique — +13 dB dépassait TP −1,5 — et
    remontait la musique seule sous les cartes de +15 à +21 dB : le « pompage » relevé par le juge.)"""
    meas = ebur128(voice)
    gain = TARGET_LUFS - meas['I']
    if stale(dest, voice):
        atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(voice), '-af',
                f'volume={gain:.2f}dB,{LIMITER}', '-c:a', 'pcm_s24le', '-ar', '48000'], dest)
    return gain


def music_gain(music: Path, music_lufs: float, cache: Path) -> float:
    """Gain (dB) qui amène le morceau à `music_lufs` LUFS intégrés (mesure mise en cache)."""
    key = f'{music.resolve()}|{music.stat().st_mtime_ns}'
    data = json.loads(cache.read_text(encoding='utf-8')) if cache.exists() else {}
    if data.get('key') != key:
        data = {'key': key, **ebur128(music)}
        cache.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    return music_lufs - float(data['I'])


def card_envelope(quiet: list[tuple[float, float]], att_db: float, fade: float = 1.5) -> str:
    """Expression `volume` (eval=frame) : atténuation fixe `att_db` sous chaque fenêtre muette, avec des
    rampes linéaires de `fade` s centrées sur les bords (pas de sursaut entre deux phrases)."""
    if not quiet or att_db >= 0:
        return ''
    half = fade / 2
    terms = [f'max(0,min(1,min((t-{a - half:.3f})/{fade:.3f},({b + half:.3f}-t)/{fade:.3f})))' for a, b in quiet]
    env = '+'.join(terms) if len(terms) > 1 else terms[0]
    return f"volume=volume='pow(10,({att_db:.2f}*min(1,{env}))/20)':eval=frame,"


def mix_music(voice: Path, music: Path, music_gain_db: float, dur: float, dest: Path,
              quiet: list[tuple[float, float]] | None = None, card_db: float = -4.0, stamp: Path | None = None) -> None:
    """Voix (déjà à −14 LUFS par section) + lit musical VERROUILLÉ à son niveau (gain fixe) ; sidechain doux
    sous la voix (seuil 0,08 ≈ −22 dBFS, ratio 2, 30/400 ms : −2 à −3 dB, pas de pompage) ; sous les cartes
    muettes courtes, atténuation fixe `card_db` avec fondus de 1,5 s ; limiteur crête. Résultat = master
    audio, sans loudnorm."""
    quiet = quiet or []
    sig = json.dumps({'gain': round(music_gain_db, 2), 'quiet': quiet, 'card_db': card_db, 'v': 3})
    if stamp and stamp.exists() and stamp.read_text() == sig and not stale(dest, voice, music):
        return
    fade_out = max(0.0, dur - 2.0)
    fc = (f'[0:a]asplit=2[sc][dry];'
          f'[1:a]atrim=0:{dur:.6f},asetpts=PTS-STARTPTS,aresample=48000,'
          f'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
          f'volume={music_gain_db:.2f}dB,{card_envelope(quiet, card_db)}'
          f'afade=t=in:st=0:d=1.0,afade=t=out:st={fade_out:.6f}:d=2.0[m];'
          f'[m][sc]sidechaincompress=threshold=0.08:ratio=2:attack=30:release=400:makeup=1[duck];'
          f'[dry][duck]amix=inputs=2:normalize=0:dropout_transition=0,atrim=0:{dur:.6f},{LIMITER}[mix]')
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(voice), '-stream_loop', '-1', '-i', str(music),
            '-filter_complex', fc, '-map', '[mix]', '-t', f'{dur:.6f}', '-c:a', 'pcm_s24le', '-ar', '48000'], dest)
    if stamp:
        stamp.write_text(sig, encoding='utf-8')


def room_tone_gain(lufs: float, workdir: Path) -> float:
    """Gain (dB) qui amène `anoisesrc=pink` (amplitude 0.05) à `lufs` LUFS — mesuré une fois, mis en cache."""
    cache = workdir / 'room-tone.json'
    data = json.loads(cache.read_text()) if cache.exists() else {}
    if 'I' not in data:
        res = run(['ffmpeg', '-hide_banner', '-nostats', '-f', 'lavfi', '-i',
                   'anoisesrc=colour=pink:amplitude=0.05:sample_rate=48000:seed=7', '-t', '10', '-af', 'ebur128',
                   '-f', 'null', '-'], capture=True)
        m = re.findall(r'^\s+I:\s+(-?[0-9.]+) LUFS', res.stderr, flags=re.M)
        if not m:
            raise NewsLongError('ambiance de salle : mesure introuvable')
        data = {'I': float(m[-1])}
        cache.write_text(json.dumps(data), encoding='utf-8')
    return lufs - data['I']


def mix_room_tone(voice: Path, dur: float, dest: Path, tone_gain_db: float | None, stamp: Path) -> None:
    """Sans musique : voix + ambiance de salle CONSTANTE (bruit rose très discret, même niveau sous la parole
    et sous les cartes → zéro contraste), limiteur crête. `tone_gain_db` None ⇒ copie de la voix (silence pur)."""
    sig = json.dumps({'tone': None if tone_gain_db is None else round(tone_gain_db, 2), 'v': 1})
    if stamp.exists() and stamp.read_text() == sig and not stale(dest, voice):
        return
    if tone_gain_db is None:
        tmp = dest.with_name(f'.{dest.stem}.{os.getpid()}.part{dest.suffix}')
        shutil.copyfile(voice, tmp)
        os.replace(tmp, dest)
    else:
        fc = (f'[1:a]volume={tone_gain_db:.2f}dB,afade=t=in:st=0:d=0.5,afade=t=out:st={max(0.0, dur - 1.0):.3f}:d=1.0[tone];'
              f'[0:a][tone]amix=inputs=2:normalize=0:dropout_transition=0,atrim=0:{dur:.6f},{LIMITER}[mix]')
        atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(voice), '-f', 'lavfi', '-t', f'{dur:.3f}', '-i',
                'anoisesrc=colour=pink:amplitude=0.05:sample_rate=48000:seed=7', '-filter_complex', fc, '-map', '[mix]',
                '-t', f'{dur:.6f}', '-c:a', 'pcm_s24le', '-ar', '48000'], dest)
    stamp.write_text(sig, encoding='utf-8')


def premaster_audio(source: Path, dest: Path) -> None:
    """Contrôle du mix : s'il est déjà à −14 ±0,5 LUFS et sous −1,5 dBTP, copie telle quelle ; sinon
    ajustement LINÉAIRE (gain + limiteur) — jamais de loudnorm dynamique."""
    if not stale(dest, source):
        return
    meas = ebur128(source)
    delta = TARGET_LUFS - meas['I']
    if abs(delta) <= 0.5 and meas.get('TP', -99) <= LIMIT_DBTP + 0.01:
        tmp = dest.with_name(f'.{dest.stem}.{os.getpid()}.part{dest.suffix}')
        shutil.copyfile(source, tmp)
        os.replace(tmp, dest)
        return
    print(f'  pré-master : ajustement linéaire {delta:+.2f} dB (mix {meas["I"]:.1f} LUFS, TP {meas.get("TP", 0):.1f})',
          flush=True)
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(source), '-af', f'volume={delta:.2f}dB,{LIMITER}',
            '-c:a', 'pcm_s24le', '-ar', '48000'], dest)


def mux(video: Path, audio: Path, dur: float, dest: Path, force: bool = False) -> None:
    """Le master final est écrit dans un .part puis renommé (atomic) : l'ancien reste en place jusqu'au
    dernier instant, même avec --force."""
    if not force and not stale(dest, video, audio):
        return
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(video), '-i', str(audio),
            '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
            # PNS/TNS de l'encodeur AAC natif : sur une ambiance de salle (bruit rose) très basse, la substitution
            # de bruit produisait UN échantillon à +4,7 dBTP (74,99 s) → QC en repli dynamique ; sans PNS/TNS : −1,8
            '-aac_pns', '0', '-aac_tns', '0',
            '-t', f'{dur:.6f}', '-movflags', '+faststart'], dest)


def render_preview(src: Path, dest: Path, force: bool = False) -> None:
    if not force and not stale(dest, src):
        return
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(src), '-vf', 'scale=960:540',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '27', '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart'], dest)


def render_planche(src: Path, dur: float, dest: Path, n: int = 12, cols: int = 4, force: bool = False) -> None:
    if not force and not stale(dest, src):
        return
    tw, th = 480, 270
    rows = math.ceil(n / cols)
    sheet = Image.new('RGB', (cols * tw, rows * (th + 28)), (20, 20, 24))
    d = ImageDraw.Draw(sheet)
    f = font(22, 'Condensed Bold')
    tmp = dest.with_suffix('.frame.jpg')
    for i in range(n):
        t = (i + 0.5) * dur / n
        run(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-ss', f'{t:.3f}', '-i', str(src), '-frames:v', '1',
             '-vf', f'scale={tw}:{th}', str(tmp)])
        im = Image.open(tmp).convert('RGB')
        x, y = (i % cols) * tw, (i // cols) * (th + 28)
        sheet.paste(im, (x, y))
        d.text((x + 8, y + th + 3), tc(t), font=f, fill=(230, 230, 230))
    tmp.unlink(missing_ok=True)
    sheet.save(dest, quality=88)


def measure(final: Path, sections: list[Section], out: Path, scene_thr: float = 0.3) -> dict[str, Any]:
    """Coupes/min sur tout le film (select=gt(scene,thr)), médiane des écarts, durée, LUFS, chapitres."""
    dur = probe_duration(final)
    res = run(['ffmpeg', '-hide_banner', '-i', str(final), '-vf', f"select='gt(scene,{scene_thr})',showinfo",
               '-an', '-f', 'null', '-'], capture=True)
    times = [float(m) for m in re.findall(r'pts_time:([0-9.]+)', res.stderr)]
    merged: list[float] = []
    for t in times:
        if not merged or t - merged[-1] > 0.4:
            merged.append(t)
    gaps = [b - a for a, b in zip(merged, merged[1:])]
    gaps_sorted = sorted(gaps)
    med = gaps_sorted[len(gaps_sorted) // 2] if gaps_sorted else dur
    p25 = gaps_sorted[len(gaps_sorted) // 4] if gaps_sorted else dur
    p75 = gaps_sorted[(3 * len(gaps_sorted)) // 4] if gaps_sorted else dur
    longest = max(gaps) if gaps else dur
    first25 = [t for t in merged if t <= 25]
    g25 = [b - a for a, b in zip(first25, first25[1:])]
    # avatar shots : plan le plus long depuis shots.json
    longest_avatar = 0.0
    avatar_total = 0.0
    for s in sections:
        sj = s.video.parent / 'shots.json'
        if sj.exists():
            for sh in json.loads(sj.read_text()):
                if sh['type'] == 'avatar':
                    longest_avatar = max(longest_avatar, sh['t1'] - sh['t0'])
                    avatar_total += sh['t1'] - sh['t0']
    qc = final.with_suffix(final.suffix + '.delivery-qc.json')
    lufs = json.loads(qc.read_text()).get('audio', {}) if qc.exists() else {}
    # histogramme coupes/min + pics (> 1,5× la médiane des minutes)
    n_min = int(math.ceil(dur / 60))
    hist = [0] * max(1, n_min)
    for t_ in merged:
        hist[min(n_min - 1, int(t_ // 60))] += 1
    hist_sorted = sorted(hist)
    med_min = hist_sorted[len(hist_sorted) // 2] if hist_sorted else 0
    pics = [i for i, v in enumerate(hist) if med_min and v > 1.5 * med_min]
    # plans hors avatar (cut/carte) les plus longs, et comptage des cartes par type
    longest_non_avatar = 0.0
    card_types: dict[str, int] = {}
    for s in sections:
        sj = s.video.parent / 'shots.json'
        if sj.exists():
            for sh in json.loads(sj.read_text()):
                if sh['type'] != 'avatar':
                    longest_non_avatar = max(longest_non_avatar, sh['t1'] - sh['t0'])
                if sh['type'] == 'card':
                    card_types[sh.get('card') or 'carte'] = card_types.get(sh.get('card') or 'carte', 0) + 1
        elif s.kind not in ('segment',):
            card_types[s.kind] = card_types.get(s.kind, 0) + 1
            longest_non_avatar = max(longest_non_avatar, s.dur)
    data = {
        'fichier': str(final), 'duree_s': round(dur, 2), 'duree': tc(dur),
        'coupes_par_minute_hist': hist, 'pics_minutes': pics, 'mediane_par_minute': med_min,
        'plan_hors_avatar_max_s': round(longest_non_avatar, 2), 'cartes_par_type': card_types,
        'changements_visuels': len(merged), 'changements_par_min': round(len(merged) / dur * 60, 1),
        'ecart_median_s': round(med, 2), 'ecart_p25_s': round(p25, 2), 'ecart_p75_s': round(p75, 2),
        'plan_max_s': round(longest, 2), 'seuil_scene': scene_thr,
        'cold_open_0_25s': {'changements': len(first25),
                            'ecart_median_s': round(sorted(g25)[len(g25) // 2], 2) if g25 else None},
        'plan_avatar_max_s': round(longest_avatar, 2), 'avatar_total_s': round(avatar_total, 1),
        'part_avatar_pct': round(avatar_total / dur * 100, 1),
        'sections_voix_off': sum(1 for s in sections if s.kind == 'segment' and not (s.video.parent / 'composite.mp4').exists()),
        'loudness': lufs,
    }
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return data


def write_pack(cfg: dict[str, Any], chapters: list[tuple[float, str]], out: Path, final: Path, dur: float,
               mesures: dict[str, Any] | None) -> None:
    chap_txt = '\n'.join(f'{tc(t)} {title}' for t, title in chapters)
    desc = cfg.get('description', '').strip()
    tags = cfg.get('tags', [])
    alts = cfg.get('titres_alternatifs', [])
    lines = [f"# PACK — {cfg['titre']}", '',
             f'- Fichier : `{final}`', f'- Durée : {tc(dur)} ({dur:.1f} s)', '',
             '## Titre', '', cfg['titre'], '']
    if alts:
        lines += ['Alternatives :', *(f'- {a}' for a in alts), '']
    sources = cfg.get('sources', [])
    src_txt = ('\n\nSOURCES\n' + '\n'.join(f'• {x}' for x in sources)) if sources else ''
    lines += ['## Description (coller telle quelle)', '', '```', desc, '', 'CHAPITRES', chap_txt + src_txt, '', '```', '',
              '## Tags', '', ', '.join(tags), '', '## Chapitres (chapters.txt)', '', '```', chap_txt, '```', '']
    if mesures:
        lines += ['## Mesures', '', '```', json.dumps(mesures, ensure_ascii=False, indent=2), '```', '']
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def build_thumbnail(cfg: dict[str, Any], out_dir: Path, workdir: Path, slug: str) -> Path | None:
    mini = cfg.get('miniature')
    if not mini:
        return None
    dest = out_dir / f'miniature-{slug}.jpg'
    face_src = expand(mini['visage_clip'])
    frame = workdir / 'miniature-visage.jpg'
    if not frame.exists():
        run(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-ss', f"{float(mini.get('visage_t', 3.0)):.3f}",
             '-i', str(face_src), '-frames:v', '1', '-q:v', '2', str(frame)])
    mots = mini['mots']  # ex. ["CHANGEMENT", "DE MAÎTRE"] ; le dernier en rouge
    textes = []
    y = 150
    for i, m in enumerate(mots):
        last = i == len(mots) - 1
        textes.append({
            'nom': f'mot{i}', 'texte': m, 'cadre': [40, y, 600, 170], 'taille_max': 120, 'taille_min': 44,
            'marge': 10, 'lignes_max': 1, 'vignette': True,
            'couleur': '#ffffff' if not last else '#ffffff',
            'plaque': {'couleur': '#c8161f' if last else '#0b0f1a', 'contour': '#c8161f' if last else '#ffffff',
                       'epaisseur': 5, 'rayon': 16, 'marge_x': 28, 'marge_y': 18},
        })
        y += 190
    spec = {
        'capitale_min_vignette': 9.0,
        'miniatures': [{
            'destination': str(dest), 'fond': '#0b0f1a',
            'police': '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf',
            'formes': [{'type': 'ellipse', 'boite': [-260, -120, 820, 960], 'couleur': '#141a2c'}],
            'photos': [{'fichier': str(frame), 'boite': [600, 0, 680, 720],
                        'cadrage_y': int(mini.get('cadrage_y', 150)), 'fondu_gauche': 220}],
            'textes': [{
                'nom': 'rubrique', 'texte': mini.get('rubrique', 'ACTU IA'), 'cadre': [48, 38, 300, 66],
                'taille_max': 34, 'taille_min': 22, 'marge': 6, 'lignes_max': 1, 'couleur': '#ffffff',
                'plaque': {'couleur': '#c8161f', 'rayon': 14, 'marge_x': 24, 'marge_y': 12}}, *textes],
            'obstacles': [],
        }],
    }
    spec_path = workdir / 'miniature-spec.json'
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding='utf-8')
    run([sys.executable, str(HERE / 'miniature-youtube.py'), str(spec_path),
         '--planche', str(out_dir / f'miniature-{slug}-vignette.jpg'),
         '--rapport', str(workdir / 'miniature-rapport.json')])
    return dest


# --------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('ordre', type=Path)
    ap.add_argument('--out-dir', type=Path, required=True)
    ap.add_argument('--work-dir', type=Path, default=None, help='intermédiaires (défaut: <out-dir>/work)')
    ap.add_argument('--cache-dir', type=Path, default=None,
                    help='cache partagé B-roll normalisés + transcripts (défaut: <out-dir>/work)')
    ap.add_argument('--only', default='', help='ids de segments à (re)rendre seuls, ex. L1,L2 (debug)')
    ap.add_argument('--force', action='store_true',
                    help='re-rend les intermédiaires de la passe (segments visés, cartes, concat, mix, master) — '
                         'jamais les B-roll normalisés/transcripts ; le master final est remplacé atomiquement, '
                         'jamais supprimé avant que le nouveau soit écrit')
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--mesure', action='store_true', help='ne fait que re-mesurer le MP4 final')
    ap.add_argument('--scene', type=float, default=0.3)
    args = ap.parse_args()

    t_start = time.time()
    cfg = json.loads(args.ordre.read_text(encoding='utf-8'))
    global SCRIPT_DIR
    if cfg.get('script_dir'):
        SCRIPT_DIR = Path(os.path.expanduser(cfg['script_dir'])).resolve()
        print(f'[script] textes narrés lus dans {SCRIPT_DIR}', file=sys.stderr)
    out_dir = args.out_dir.expanduser().resolve()
    workdir = (args.work_dir or (out_dir / 'work')).expanduser().resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    cache_dir = (args.cache_dir or (out_dir / 'work')).expanduser().resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    slug = cfg.get('slug') or slugify(cfg['titre'])
    final = out_dir / f'{slug}.mp4'
    roots = [expand(r) for r in cfg.get('broll_roots', ['~/.codebuddy/media-video/flow-crame', '~/.codebuddy/media-video/broll'])]

    try:
        visible = {
            'titre': cfg.get('titre'), 'description': cfg.get('description'),
            'chapitres': [c.get('titre') for c in cfg.get('chapitres', [])],
            'cartes': {k: {f: cfg.get(k, {}).get(f) for f in ('titre', 'these', 'accent', 'ligne')}
                       for k in ('hook', 'cta', 'punchline', 'fin')},
            'citation': (cfg.get('hook', {}).get('citation') or {}).get('texte'),
            'recap': cfg.get('recap'), 'formule': cfg.get('fin', {}).get('formule'),
            'faits': [f.get('carte') for f in cfg.get('hook', {}).get('faits', [])],
            'cartons': [s.get('carton') for s in cfg['segments'] if isinstance(s.get('carton'), dict)],
            'segments': [{'titre': s.get('titre'), 'acte': s.get('acte'),
                          'cartes': [{f: c.get(f) for f in ('chiffre', 'ligne', 'titre', 'lignes', 'source', 'surligne',
                                                            'etapes', 'accent')
                                      if c.get(f) is not None} for c in s.get('cartes', [])]}
                         for s in cfg['segments']],
        }
        assert_no_production_markers(visible, 'contenu visible (long actu)')

        only = {x for x in args.only.split(',') if x}
        if args.force and not args.mesure:
            # Ne supprimer QUE ce que cette passe régénère : les segments visés (tous, ou --only), et — hors
            # --only — les sections dérivées (hook-fait-*, hook-citation, cartes) + concat/mix/master
            # intermédiaires. Les sorties finales (master, preview, planche) ne sont PAS supprimées :
            # elles sont réécrites atomiquement (tmp + rename) en fin de passe.
            for s in cfg['segments']:
                if only and s['id'] not in only:
                    continue
                for name in ('video.mp4', 'audio.wav', 'audio-norm.wav', 'audio-norm.json', 'subs.ass',
                             'composite.mp4', 'bg.mp4', 'bg.txt'):
                    (workdir / 'segments' / s['id'] / name).unlink(missing_ok=True)
                for p in (workdir / 'segments' / s['id']).glob('card-*.mp4'):
                    p.unlink()
            if not only:
                for p in [workdir / 'video.mp4', workdir / 'voice.wav', workdir / 'voice-norm.wav', workdir / 'mix.wav',
                          workdir / 'mastered.wav',
                          workdir / 'concat-video.txt', workdir / 'concat-audio.txt']:
                    p.unlink(missing_ok=True)
                shutil.rmtree(workdir / 'cards', ignore_errors=True)
                for d in (workdir / 'segments').glob('hook-*'):
                    shutil.rmtree(d, ignore_errors=True)
            shutil.rmtree(workdir / 'frames', ignore_errors=True)

        if args.mesure:
            secs = [Section(s['id'], 'segment', workdir / 'segments' / s['id'] / 'video.mp4',
                            workdir / 'segments' / s['id'] / 'audio.wav', 0) for s in cfg['segments']]
            data = measure(final, secs, out_dir / f'MESURES-{slug}.json', args.scene)
            print(json.dumps(data, ensure_ascii=False, indent=2))
            return

        segs = {s['id']: s for s in cfg['segments']}
        shadow_cache: dict[int, Path] = {}

        # Hook : la carte-thèse est superposée à la 1re section PARLÉE (fait 1, sinon citation, sinon 1er
        # segment) — la voix démarre à 0:00. `hook.sur_voix: false` rétablit la carte muette devant.
        hook = cfg.get('hook', {})
        these_card: dict[str, Any] | None = None
        these_host = None
        if hook and hook.get('sur_voix', True):
            these_card = {'type': 'these', 'titre': hook.get('these', ''), 'accent': hook.get('accent', ''),
                          'ligne': hook.get('ligne', ''), 't': '@0.0',
                          'duree': float(hook.get('duree_sur_voix', min(3.0, float(hook.get('duree', 4.0)))))}
            if hook.get('faits'):
                these_host = 'fait'
            elif hook.get('citation'):
                these_host = 'citation'
            else:
                these_host = 'segment'
                cfg['segments'][0]['cartes'] = [these_card, *cfg['segments'][0].get('cartes', [])]

        # 1) segments avatar en parallèle
        def job(seg):
            vo = seg.get('type') == 'voiceover'
            print(f"→ segment {seg['id']} ({seg.get('titre', '')}){' [voix off]' if vo else ''}", flush=True)
            return render_avatar_section(seg, cfg, workdir, roots, shadow_cache, cache_dir=cache_dir,
                                         faceless=vo)

        todo = [s for s in cfg['segments'] if not only or s['id'] in only]
        with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
            rendered = {s.id: s for s in ex.map(job, todo)}
        if only:
            print('OK (segments seuls rendus)')
            return

        # 2) sections dans l'ordre
        sections: list[Section] = []
        chapter_marks: dict[str, float] = {}
        t = 0.0

        def add(sec: Section, mark: str | None = None):
            nonlocal t
            if mark:
                chapter_marks.setdefault(mark, t)
            sections.append(sec)
            t += sec.dur

        if hook:
            if these_card is None:
                add(render_card_section('hook-these', {'type': 'these', 'titre': hook.get('these', ''),
                                                       'accent': hook.get('accent', ''), 'ligne': hook.get('ligne', '')},
                                        float(hook.get('duree', 4.0)), workdir), 'hook')
            else:
                chapter_marks.setdefault('hook', 0.0)
            for i, fait in enumerate(hook.get('faits', [])):
                seg = segs[fait['segment']]
                src = expand(seg['src'])
                words = words_for(seg, src, cache_dir)
                t0 = resolve_trigger(words, fait['de'], 0.0) - float(fait.get('avant', 0.15))
                t_end = find_word(words, str(fait['a']))
                if t_end is None:
                    raise NewsLongError(f"fait {i}: mot de fin « {fait['a']} » introuvable")
                w_end = next(w for w in words if w['t0'] == t_end)
                t1 = w_end['t1'] + float(fait.get('apres', 0.3))
                cartes_f = [dict(fait['carte'], t=fait['carte'].get('t', '@0.0'))] if fait.get('carte') else []
                if i == 0 and these_host == 'fait':
                    cartes_f = [these_card, *cartes_f]
                pseudo = {'id': f'hook-fait-{i + 1}', 'src': seg['src'], 'fix': seg.get('fix', []),
                          'broll': fait.get('broll') or seg.get('broll', []),
                          'cartes': cartes_f,
                          'cutaway': fait.get('cutaway', {'first_at': 0.0, 'duration': 2.2, 'every': 2.2, 'tail_avatar': 0.0})}
                add(render_avatar_section(pseudo, cfg, workdir, roots, shadow_cache, clip_range=(max(0.0, t0), t1),
                                          kind='fait', faceless=True, cache_dir=cache_dir),
                    'faits' if i == 0 else None)
            cit = hook.get('citation')
            if cit:
                seg = segs[cit['segment']]
                src = expand(seg['src'])
                words = words_for(seg, src, cache_dir)
                t0 = resolve_trigger(words, cit['de'], 0.0) - float(cit.get('avant', 0.15))
                t_end = find_word(words, str(cit['a']))
                if t_end is None:
                    raise NewsLongError(f"citation: mot de fin « {cit['a']} » introuvable")
                w_end = next(w for w in words if w['t0'] == t_end)
                t1 = w_end['t1'] + float(cit.get('apres', 0.35))
                pseudo = {'id': 'hook-citation', 'src': seg['src'], 'fix': seg.get('fix', []),
                          'broll': cit.get('broll') or seg.get('broll', []),
                          'cartes': [these_card] if these_host == 'citation' else [],
                          'denoise': bool(cit.get('denoise', seg.get('denoise'))),
                          'face_crop': seg.get('face_crop'),
                          'cutaway': cit.get('cutaway', {'first_at': 1.8, 'duration': 1.5, 'every': 99, 'tail_avatar': 1.2})}
                add(render_avatar_section(pseudo, cfg, workdir, roots, shadow_cache,
                                          citation=cit.get('texte'), clip_range=(max(0.0, t0), t1), kind='citation',
                                          cache_dir=cache_dir), 'citation')

        cta = cfg.get('cta', {})

        def add_cta():
            add(render_card_section('cta', {'type': 'cta', 'titre': cta.get('titre', 'Abonne-toi'),
                                            'ligne': cta.get('ligne', ''), 'accent': cta.get('accent', '')},
                                    float(cta.get('duree', 3.0)), workdir), 'cta')

        if cta and cta.get('apres') == 'hook':
            add_cta()
        punch = cfg.get('punchline', {})
        fin = cfg.get('fin', {})
        carton_d = float(cfg.get('carton_duree', 0.0))
        for seg in cfg['segments']:
            sid = seg['id']
            carton = seg.get('carton')
            c_dur = float(carton.get('duree', carton_d or 2.0)) if isinstance(carton, dict) else carton_d
            if carton is not False and c_dur > 0 and (carton or carton_d > 0):
                add(render_card_section(f'carton-{sid}', {
                    'type': 'chapitre', 'titre': (carton or {}).get('titre') or seg.get('titre', sid),
                    'kicker': (carton or {}).get('kicker', 'LISA IA · ACTU'),
                    'acte': seg.get('acte', ''), 'ligne': (carton or {}).get('pont', '')}, c_dur, workdir), sid)
            add(rendered[sid], sid)
            if cta and cta.get('apres') == sid:
                add_cta()
        recap = cfg.get('recap')
        if recap:
            add(render_card_section('recap', {'type': 'liste', 'kicker': 'LISA IA · RÉCAP', 'titre': recap.get('titre', 'À retenir'),
                                              'lignes': recap.get('lignes', [])}, float(recap.get('duree', 6.0)), workdir), 'recap')
        if punch:
            add(render_card_section('punchline', {'type': 'punchline', 'titre': punch.get('titre', ''),
                                                  'accent': punch.get('accent', ''), 'ligne': punch.get('ligne', '')},
                                    float(punch.get('duree', 3.5)), workdir), 'punchline')
        if fin:
            formule = fin.get('formule')
            if formule:
                add(render_card_section('fin-formule', {'type': 'formule', 'titre': formule.get('titre', ''),
                                                        'accent': formule.get('accent', ''), 'ligne': formule.get('ligne', '')},
                                        float(formule.get('duree', 3.0)), workdir), 'formule')
            add(render_card_section('fin', {'type': 'fin', 'titre': fin.get('titre', 'LISA IA'),
                                            'ligne': fin.get('ligne', ''), 'accent': fin.get('accent', ''),
                                            'ecran_fin': bool(fin.get('ecran_fin'))},
                                    float(fin.get('duree', 4.0)), workdir), 'fin')
        total = q(t)

        # 3) chapitres
        chapters: list[tuple[float, str]] = []
        for ch in cfg.get('chapitres', []):
            at = ch['at']
            if at not in chapter_marks:
                print(f"AVERTISSEMENT chapitre « {ch['titre']} » : repère {at} inconnu", file=sys.stderr)
                continue
            if chapters and chapter_marks[at] <= chapters[-1][0]:
                print(f"  chapitre « {ch['titre']} » fusionné avec le précédent (même instant)", file=sys.stderr)
                continue
            chapters.append((chapter_marks[at], ch['titre']))
        if not chapters or chapters[0][0] > 0:
            chapters.insert(0, (0.0, cfg.get('hook', {}).get('chapitre', 'Intro')))
        (out_dir / 'chapters.txt').write_text('\n'.join(f'{tc(a)} {b}' for a, b in chapters) + '\n', encoding='utf-8')

        # 4) montage final
        video = workdir / 'video.mp4'
        voice = workdir / 'voice.wav'
        for sec in sections:
            normalize_section_audio(sec)
        voiced = [s for s in sections if s.kind in VOICED_KINDS]
        print('  voix par section : ' + ', '.join(f'{s.id} {s.gain_db:+.1f} dB→{s.lufs:.1f}' for s in voiced), flush=True)
        concat_sections(sections, workdir, video, voice)
        quiet: list[tuple[float, float]] = []
        t_acc = 0.0
        for sec in sections:
            if sec.kind not in VOICED_KINDS and sec.dur < float(cfg.get('music_card_max_s', 3.0)):
                quiet.append((round(t_acc, 3), round(t_acc + sec.dur, 3)))
            t_acc += sec.dur
        voice_norm = workdir / 'voice-norm.wav'
        v_gain = premaster_voice(voice, voice_norm)
        mix = workdir / 'mix.wav'
        music_info: dict[str, Any]
        if cfg.get('music'):
            music = expand(cfg['music'])
            if not music.exists():
                raise NewsLongError(f'musique introuvable: {music}')
            music_lufs = float(cfg.get('music_lufs', cfg.get('music_db', -38)))
            m_gain = music_gain(music, music_lufs, workdir / 'music-loudness.json')
            print(f'  audio : voix {v_gain:+.1f} dB → −14 LUFS ; musique {m_gain:+.1f} dB → {music_lufs:.0f} LUFS verrouillés',
                  flush=True)
            mix_music(voice_norm, music, m_gain, total, mix, quiet=quiet, card_db=float(cfg.get('music_card_db', -4.0)),
                      stamp=workdir / 'mix.sig')
            music_info = {'lufs_verrouille': music_lufs, 'gain_db': round(m_gain, 2),
                          'cartes_muettes_db': float(cfg.get('music_card_db', -4.0)), 'fenetres_muettes': quiet}
        else:
            tone = cfg.get('room_tone_lufs', -55)
            tone_gain = room_tone_gain(float(tone), workdir) if tone is not None else None
            print(f'  audio : voix {v_gain:+.1f} dB → −14 LUFS ; SANS musique ; ambiance de salle '
                  f'{"aucune (silence pur)" if tone is None else f"{float(tone):.0f} LUFS constante"}', flush=True)
            mix_room_tone(voice_norm, total, mix, tone_gain, workdir / 'mix.sig')
            music_info = {'sans_musique': True, 'ambiance_lufs': tone}
        mastered = workdir / 'mastered.wav'
        premaster_audio(mix, mastered)
        if args.force or stale(final, video, mastered):
            mux(video, mastered, total, final, force=args.force)
            measurement = measure_loudness(final)
            if (abs(measurement.integrated_lufs - QC_TARGET_LUFS) > LUFS_TOLERANCE
                    or measurement.true_peak_dbtp > MAX_TRUE_PEAK_DBTP):
                print(f'  QC : {measurement.integrated_lufs:.2f} LUFS / TP {measurement.true_peak_dbtp:.2f} hors '
                      f'tolérance → re-master dynamique (repli)', file=sys.stderr)
                measurement = master_video_audio(final)
            write_qc_sidecar(final, measurement)
        render_preview(final, out_dir / f'{slug}-preview.mp4', force=args.force)
        render_planche(final, total, out_dir / f'{slug}-planche-12.jpg', force=args.force)
        mes = measure(final, sections, out_dir / f'MESURES-{slug}.json', args.scene)
        mes['temps_rendu_s'] = round(time.time() - t_start, 1)
        mes['voix_par_section_lufs'] = {s.id: s.lufs for s in voiced}
        mes['musique'] = music_info
        (out_dir / f'MESURES-{slug}.json').write_text(json.dumps(mes, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        write_pack(cfg, chapters, out_dir / f'PACK-{slug}.md', final, total, mes)
        thumb = build_thumbnail(cfg, out_dir, workdir, slug)
    except (NewsLongError, DeliveryQCError) as exc:
        sys.exit(f'ERREUR: {exc}')

    print(f'OK {final} — {tc(total)} ({total:.1f}s) ; {len(sections)} sections ; '
          f"{mes['changements_par_min']} chg/min (médiane {mes['ecart_median_s']} s) ; "
          f'rendu {mes["temps_rendu_s"]} s')
    print(f'OK {out_dir / f"{slug}-preview.mp4"}')
    print(f'OK {out_dir / f"{slug}-planche-12.jpg"}')
    print(f'OK {out_dir / f"PACK-{slug}.md"}')
    if thumb:
        print(f'OK {thumb}')


if __name__ == '__main__':
    main()
