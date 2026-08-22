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
  "music": "…mp3", "music_db": -32,
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
    DeliveryQCError,
    assert_no_production_markers,
    master_video_audio,
    write_qc_sidecar,
)


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# wrap-short.py (tiret dans le nom) : whisper, corrections de noms, cartes karaoké.
wrap_short = _load_module('wrap_short', INFLUENCER / 'wrap-short.py')

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
        step = max(0.35, (dur - 0.6) / max(1, n))
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
            d_k = step if k < n else max(0.2, dur - shown_total)
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

    raise NewsLongError(f'type de carte inconnu: {kind}')


def render_card_video(spec: dict[str, Any], dur: float, dest: Path, workdir: Path) -> None:
    """Rend une carte en MP4 depuis ses frames PIL. Les frames + la liste concat vivent dans un dossier
    temporaire UNIQUE par appel (mkdtemp) : `dest.stem` (ex. card-03) est le même dans chaque segment,
    et quatre segments rendus en parallèle se volaient/supprimaient `frames/card-03/` (incident du 22/08,
    ffmpeg 254 « list.txt introuvable »). Le verrou par destination évite en plus deux rendus identiques."""
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
            continue
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


def build_segment_ass(cards_list, shots, badge: str, citation: str | None, subtitles: str) -> str:
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
            if s['type'] == 'avatar' and s['t1'] - s['t0'] > 0.6:
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


def assemble_segment(seg_id: str, src: Path, clip_range: tuple[float, float] | None, dur: float,
                     composite: Path, shots: list[dict[str, Any]], cut_sources: list[Path],
                     card_videos: dict[int, Path], ass_path: Path, dest_v: Path, dest_a: Path,
                     cut_offsets: list[float]) -> None:
    """Monte les plans (trim du composite / cut-aways / cartes) + sous-titres, et extrait l'audio."""
    if not dest_v.exists():
        cmd = ['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(composite)]
        inputs = 1
        fc: list[str] = []
        labels: list[str] = []
        cut_i = 0
        for k, s in enumerate(shots):
            d = q(s['t1'] - s['t0'])
            if s['type'] == 'avatar':
                fc.append(f"[0:v]trim=start={s['t0']:.6f}:end={s['t1']:.6f},setpts=PTS-STARTPTS[v{k}]")
            elif s['type'] == 'cut':
                srcp = cut_sources[cut_i % len(cut_sources)]
                off = cut_offsets[cut_i % len(cut_offsets)]
                cut_i += 1
                cmd += ['-i', str(srcp)]
                fc.append(f"[{inputs}:v]trim=start={off:.6f}:end={off + d:.6f},setpts=PTS-STARTPTS[v{k}]")
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
class Section:
    def __init__(self, sid: str, kind: str, video: Path, audio: Path, dur: float, titre: str = ''):
        self.id, self.kind, self.video, self.audio, self.dur, self.titre = sid, kind, video, audio, dur, titre


def words_for(seg: dict[str, Any], src: Path, workdir: Path) -> list[dict[str, Any]]:
    cache = workdir / 'words' / f"{seg['id']}.json"
    if cache.exists():
        words = json.loads(cache.read_text(encoding='utf-8'))
    else:
        cache.parent.mkdir(parents=True, exist_ok=True)
        words = wrap_short.transcribe(str(src))
        cache.write_text(json.dumps(words, ensure_ascii=False), encoding='utf-8')
    return wrap_short.apply_fixes(words, seg.get('fix', []))


def find_word(words: list[dict[str, Any]], spec: str) -> float | None:
    """`mot` ou `mot+N` (N-ième occurrence) → t0 du mot (comparaison normalisée, « 2700 » est un MOT,
    pas un temps) ; sinon `@12.5` ou un nombre décimal avec point = temps absolu."""
    spec = str(spec).strip()
    if spec.startswith('@'):
        return float(spec[1:])
    m = re.match(r'^(.*?)(?:\+(\d+))?$', spec)
    target, occ = wrap_short.norm(m.group(1)), int(m.group(2) or 1)
    n = 0
    for w in words:
        if wrap_short.norm(w['w']) == target:
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
    for i in range(max(1, n_cut)):
        src_d = probe_duration(cuts[i % len(cuts)])
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
    ass_path.write_text(build_segment_ass(subs_cards, shots, badge, citation, cfg.get('subtitles', 'karaoke')),
                        encoding='utf-8')
    dest_v, dest_a = sdir / 'video.mp4', sdir / 'audio.wav'
    assemble_segment(sid, src, clip_range, dur, composite, shots, cut_sources, card_videos, ass_path,
                     dest_v, dest_a, offsets)
    (sdir / 'shots.json').write_text(json.dumps(
        [{k: (v if k != 'card' else (v or {}).get('type')) for k, v in s.items()} for s in shots],
        ensure_ascii=False, indent=1), encoding='utf-8')
    return Section(sid, kind, dest_v, dest_a, dur, seg.get('titre', ''))


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
    if not dest_v.exists():
        lst = workdir / 'concat-video.txt'
        lst.write_text('\n'.join(f"file '{s.video}'" for s in sections) + '\n', encoding='utf-8')
        atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst),
                '-c', 'copy'], dest_v)
    if not dest_a.exists():
        lst = workdir / 'concat-audio.txt'
        lst.write_text('\n'.join(f"file '{s.audio}'" for s in sections) + '\n', encoding='utf-8')
        atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst),
                '-c:a', 'pcm_s16le'], dest_a)


def mix_music(voice: Path, music: Path, music_db: float, dur: float, dest: Path) -> None:
    if dest.exists():
        return
    fade_out = max(0.0, dur - 2.0)
    fc = (f'[0:a]asplit=2[sc][dry];'
          f'[1:a]atrim=0:{dur:.6f},asetpts=PTS-STARTPTS,aresample=48000,'
          f'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,'
          f'volume={music_db:.1f}dB,afade=t=in:st=0:d=1.0,afade=t=out:st={fade_out:.6f}:d=2.0[m];'
          f'[m][sc]sidechaincompress=threshold=0.02:ratio=10:attack=8:release=400:makeup=1[duck];'
          f'[dry][duck]amix=inputs=2:normalize=0:dropout_transition=0,atrim=0:{dur:.6f}[mix]')
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(voice), '-stream_loop', '-1', '-i', str(music),
            '-filter_complex', fc, '-map', '[mix]', '-t', f'{dur:.6f}', '-c:a', 'pcm_s24le'], dest)


def premaster_audio(source: Path, dest: Path) -> None:
    """Loudnorm EBU R128 deux passes (linéaire) vers −14 LUFS sur le mix AVANT le mux : un programme
    avec de longues cartes silencieuses peut sortir 12 dB sous la cible, au-delà de la correction bornée
    que video_delivery_qc.master_video_audio accepte."""
    if dest.exists():
        return
    target = 'I=-14:TP=-1.5:LRA=11'
    res = run(['ffmpeg', '-hide_banner', '-v', 'info', '-i', str(source), '-af', f'loudnorm={target}:print_format=json',
               '-f', 'null', '-'], capture=True)
    m = re.findall(r'\{\s*"input_i".*?\}', res.stderr, flags=re.DOTALL)
    if not m:
        raise NewsLongError('loudnorm passe 1 : mesures introuvables')
    meas = json.loads(m[-1])
    second = (f'loudnorm={target}:measured_I={meas["input_i"]}:measured_TP={meas["input_tp"]}:'
              f'measured_LRA={meas["input_lra"]}:measured_thresh={meas["input_thresh"]}:'
              f'offset={meas["target_offset"]}:linear=true:print_format=summary')
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(source), '-af', second,
            '-c:a', 'pcm_s24le', '-ar', '48000'], dest)


def mux(video: Path, audio: Path, dur: float, dest: Path, force: bool = False) -> None:
    """Le master final est écrit dans un .part puis renommé (atomic) : l'ancien reste en place jusqu'au
    dernier instant, même avec --force."""
    if dest.exists() and not force:
        return
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(video), '-i', str(audio),
            '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
            '-t', f'{dur:.6f}', '-movflags', '+faststart'], dest)


def render_preview(src: Path, dest: Path, force: bool = False) -> None:
    if dest.exists() and not force:
        return
    atomic(['ffmpeg', '-y', '-hide_banner', '-v', 'error', '-i', str(src), '-vf', 'scale=960:540',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '27', '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart'], dest)


def render_planche(src: Path, dur: float, dest: Path, n: int = 12, cols: int = 4, force: bool = False) -> None:
    if dest.exists() and not force:
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
    lines += ['## Description (coller telle quelle)', '', '```', desc, '', 'CHAPITRES', chap_txt, '', '```', '',
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
                          'cartes': [{f: c.get(f) for f in ('chiffre', 'ligne', 'titre', 'lignes', 'source', 'surligne')
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
                for name in ('video.mp4', 'audio.wav', 'subs.ass', 'composite.mp4', 'bg.mp4', 'bg.txt'):
                    (workdir / 'segments' / s['id'] / name).unlink(missing_ok=True)
                for p in (workdir / 'segments' / s['id']).glob('card-*.mp4'):
                    p.unlink()
            if not only:
                for p in [workdir / 'video.mp4', workdir / 'voice.wav', workdir / 'mix.wav', workdir / 'mastered.wav',
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

        # 1) segments avatar en parallèle
        def job(seg):
            print(f"→ segment {seg['id']} ({seg.get('titre', '')})", flush=True)
            return render_avatar_section(seg, cfg, workdir, roots, shadow_cache, cache_dir=cache_dir)

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

        hook = cfg.get('hook', {})
        if hook:
            add(render_card_section('hook-these', {'type': 'these', 'titre': hook.get('these', ''),
                                                   'accent': hook.get('accent', ''), 'ligne': hook.get('ligne', '')},
                                    float(hook.get('duree', 4.0)), workdir), 'hook')
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
                pseudo = {'id': f'hook-fait-{i + 1}', 'src': seg['src'], 'fix': seg.get('fix', []),
                          'broll': fait.get('broll') or seg.get('broll', []),
                          'cartes': [dict(fait['carte'], t=fait['carte'].get('t', '@0.0'))] if fait.get('carte') else [],
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
            chapters.append((chapter_marks[at], ch['titre']))
        if not chapters or chapters[0][0] > 0:
            chapters.insert(0, (0.0, cfg.get('hook', {}).get('chapitre', 'Intro')))
        (out_dir / 'chapters.txt').write_text('\n'.join(f'{tc(a)} {b}' for a, b in chapters) + '\n', encoding='utf-8')

        # 4) montage final
        video = workdir / 'video.mp4'
        voice = workdir / 'voice.wav'
        concat_sections(sections, workdir, video, voice)
        music = expand(cfg['music'])
        if not music.exists():
            raise NewsLongError(f'musique introuvable: {music}')
        mix = workdir / 'mix.wav'
        mix_music(voice, music, float(cfg.get('music_db', -32)), total, mix)
        mastered = workdir / 'mastered.wav'
        premaster_audio(mix, mastered)
        if args.force or not final.exists():
            mux(video, mastered, total, final, force=args.force)
            measurement = master_video_audio(final)
            write_qc_sidecar(final, measurement)
        render_preview(final, out_dir / f'{slug}-preview.mp4', force=args.force)
        render_planche(final, total, out_dir / f'{slug}-planche-12.jpg', force=args.force)
        mes = measure(final, sections, out_dir / f'MESURES-{slug}.json', args.scene)
        mes['temps_rendu_s'] = round(time.time() - t_start, 1)
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
