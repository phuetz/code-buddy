#!/usr/bin/env python3
"""Garde-fous communs des rendus vidéo destinés à la livraison.

Ce module ne publie rien. Il fournit des contrôles déterministes utilisables
par tous les renderers : marqueurs de production, géométrie des cartons et
mastering audio mesuré sur le fichier final (après encodage AAC).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any, Iterable


TARGET_LUFS = -14.0
LUFS_TOLERANCE = 1.0
MAX_TRUE_PEAK_DBTP = -1.0
LOUDNORM_TRUE_PEAK_TARGET = -1.5
LOUDNORM_LRA = 11.0
MIN_END_CARD_SECONDS = 4.0

# Les mots usuels restent autorisés dans une phrase. Seuls les libellés de
# gabarit, placeholders et troncatures manifestes sont bloqués.
FORBIDDEN_PRODUCTION_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        'libellé Accroche',
        re.compile(r'(?im)^\s*(?:#+\s*)?accroche\s*:?\s*$'),
    ),
    (
        'libellé Conclusion',
        re.compile(r'(?im)^\s*(?:#+\s*)?conclusion\s*:?\s*$'),
    ),
    (
        'libellé Hook',
        re.compile(
            r'(?im)^\s*(?:#+\s*)?(?:hook|hook\s+de\s+fin)\s*:?\s*$'
        ),
    ),
    (
        'TODO',
        re.compile(r'(?iu)(?:\bTODO\b|\bFIXME\b|\bTBD\b)'),
    ),
    (
        'placeholder à compléter',
        re.compile(
            r'(?iu)(?:\[\s*(?:à|a)\s+compl[ée]ter\s*\]|'
            r'<\s*(?:à|a)\s+compl[ée]ter\s*>|'
            r'\b(?:placeholder|texte\s+ici)\b)'
        ),
    ),
    (
        'libellé tronqué',
        re.compile(
            r'(?iu)\b(?:accroche|conclusion|hook)\b'
            r'[^\n]{0,80}(?:…|\.{3})\s*$'
        ),
    ),
)


class DeliveryQCError(RuntimeError):
    """Un livrable ne respecte pas un garde-fou bloquant."""


@dataclass(frozen=True)
class TextBox:
    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height


@dataclass(frozen=True)
class EndCardLayout:
    width: int
    height: int
    safe_margin_x: int
    safe_margin_y: int
    title: TextBox
    author: TextBox
    status: TextBox
    cta: TextBox
    url: TextBox
    duration_seconds: float = MIN_END_CARD_SECONDS
    foreground: str = '#FFFFFF'
    background: str = '#111827'
    accent: str = '#F5C451'


@dataclass(frozen=True)
class LoudnessMeasurement:
    integrated_lufs: float
    true_peak_dbtp: float
    loudness_range_lu: float
    threshold_lufs: float
    target_offset_lu: float


def _boxes_overlap(left: TextBox, right: TextBox) -> bool:
    return not (
        left.right <= right.x
        or right.right <= left.x
        or left.bottom <= right.y
        or right.bottom <= left.y
    )


def end_card_layout(width: int, height: int) -> EndCardLayout:
    """Retourne un layout mobile-safe dont aucune zone de texte ne se croise."""
    if width < 640 or height < 640:
        raise DeliveryQCError('carton final : résolution minimale 640×640')
    safe_x = round(width * 0.10)
    safe_y = round(height * 0.10)
    usable_width = width - 2 * safe_x
    line_height = max(48, round(height * 0.065))
    gap = max(18, round(height * 0.025))
    block_height = line_height * 5 + gap * 4
    start_y = max(safe_y, (height - block_height) // 2)
    boxes = [
        TextBox(safe_x, start_y, usable_width, line_height),
        TextBox(safe_x, start_y + line_height + gap, usable_width, line_height),
        TextBox(
            safe_x,
            start_y + (line_height + gap) * 2,
            usable_width,
            line_height,
        ),
        TextBox(
            safe_x,
            start_y + (line_height + gap) * 3,
            usable_width,
            line_height,
        ),
        TextBox(
            safe_x,
            start_y + (line_height + gap) * 4,
            usable_width,
            line_height,
        ),
    ]
    layout = EndCardLayout(
        width=width,
        height=height,
        safe_margin_x=safe_x,
        safe_margin_y=safe_y,
        title=boxes[0],
        author=boxes[1],
        status=boxes[2],
        cta=boxes[3],
        url=boxes[4],
    )
    all_boxes = [layout.title, layout.author, layout.status, layout.cta, layout.url]
    if any(
        _boxes_overlap(left, right)
        for index, left in enumerate(all_boxes)
        for right in all_boxes[index + 1 :]
    ):
        raise DeliveryQCError('carton final : zones de texte superposées')
    if any(
        box.x < safe_x
        or box.right > width - safe_x
        or box.y < safe_y
        or box.bottom > height - safe_y
        for box in all_boxes
    ):
        raise DeliveryQCError('carton final : safe area mobile violée')
    return layout


def short_title_layout(width: int = 1080, height: int = 1920) -> dict[str, TextBox]:
    """Zones distinctes du titre et de l'auteur pour les Shorts 9:16."""
    layout = end_card_layout(width, height)
    return {
        'title': TextBox(
            layout.safe_margin_x,
            round(height * 0.32),
            width - 2 * layout.safe_margin_x,
            round(height * 0.18),
        ),
        'author': TextBox(
            layout.safe_margin_x,
            round(height * 0.58),
            width - 2 * layout.safe_margin_x,
            round(height * 0.08),
        ),
    }


def contrast_ratio(foreground: str, background: str) -> float:
    def luminance(value: str) -> float:
        raw = value.lstrip('#')
        if len(raw) != 6 or not re.fullmatch(r'[0-9a-fA-F]{6}', raw):
            raise DeliveryQCError(f'couleur hexadécimale invalide : {value}')
        channels = [int(raw[index:index + 2], 16) / 255 for index in (0, 2, 4)]
        linear = [
            channel / 12.92
            if channel <= 0.04045
            else ((channel + 0.055) / 1.055) ** 2.4
            for channel in channels
        ]
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]

    high, low = sorted(
        (luminance(foreground), luminance(background)),
        reverse=True,
    )
    return (high + 0.05) / (low + 0.05)


def iter_text_values(value: Any, prefix: str = '$') -> Iterable[tuple[str, str]]:
    if isinstance(value, str):
        yield prefix, value
    elif isinstance(value, dict):
        for key, nested in value.items():
            yield from iter_text_values(nested, f'{prefix}.{key}')
    elif isinstance(value, (list, tuple)):
        for index, nested in enumerate(value):
            yield from iter_text_values(nested, f'{prefix}[{index}]')


def find_production_markers(value: Any) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for location, text in iter_text_values(value):
        for label, pattern in FORBIDDEN_PRODUCTION_MARKERS:
            match = pattern.search(text)
            if match is None:
                continue
            excerpt = match.group(0).strip().replace('\n', ' ')[:120]
            findings.append(
                {'location': location, 'marker': label, 'excerpt': excerpt}
            )
    return findings


def assert_no_production_markers(value: Any, source: str = 'contenu') -> None:
    findings = find_production_markers(value)
    if findings:
        details = '; '.join(
            f'{item["location"]}: {item["marker"]} ({item["excerpt"]!r})'
            for item in findings[:8]
        )
        raise DeliveryQCError(
            f'livraison refusée — marqueur de production dans {source} : {details}'
        )


def _run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=capture,
            text=True,
        )
    except FileNotFoundError as error:
        raise DeliveryQCError(f'dépendance absente : {command[0]}') from error
    except subprocess.CalledProcessError as error:
        tail = (error.stderr or '').strip().splitlines()[-8:]
        raise DeliveryQCError(
            f'commande vidéo en échec : {" ".join(command[:4])} — '
            + ' | '.join(tail)
        ) from error


def measure_loudness(path: Path) -> LoudnessMeasurement:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise DeliveryQCError(f'fichier audio/vidéo introuvable : {path}')
    completed = _run(
        [
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-i',
            str(path),
            '-map',
            '0:a:0',
            '-af',
            (
                f'loudnorm=I={TARGET_LUFS}:TP={LOUDNORM_TRUE_PEAK_TARGET}:'
                f'LRA={LOUDNORM_LRA}:print_format=json'
            ),
            '-f',
            'null',
            '-',
        ],
        capture=True,
    )
    matches = re.findall(
        r'\{\s*"input_i"[^{}]*\}',
        completed.stderr,
        flags=re.DOTALL,
    )
    if not matches:
        raise DeliveryQCError(
            f'mesure loudness impossible (piste audio absente ?) : {path}'
        )
    try:
        raw = json.loads(matches[-1])
        values = LoudnessMeasurement(
            integrated_lufs=float(raw['input_i']),
            true_peak_dbtp=float(raw['input_tp']),
            loudness_range_lu=float(raw['input_lra']),
            threshold_lufs=float(raw['input_thresh']),
            target_offset_lu=float(raw['target_offset']),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise DeliveryQCError('mesures loudness invalides') from error
    if not all(math.isfinite(value) for value in asdict(values).values()):
        raise DeliveryQCError('mesures loudness non finies')
    return values


def assert_delivery_loudness(
    path: Path,
    measurement: LoudnessMeasurement | None = None,
) -> LoudnessMeasurement:
    measured = measurement or measure_loudness(path)
    errors: list[str] = []
    if abs(measured.integrated_lufs - TARGET_LUFS) > LUFS_TOLERANCE:
        errors.append(
            f'{measured.integrated_lufs:.2f} LUFS hors '
            f'{TARGET_LUFS:.0f} ±{LUFS_TOLERANCE:.0f}'
        )
    if measured.true_peak_dbtp > MAX_TRUE_PEAK_DBTP:
        errors.append(
            f'{measured.true_peak_dbtp:.2f} dBTP > '
            f'{MAX_TRUE_PEAK_DBTP:.0f} dBTP'
        )
    if errors:
        raise DeliveryQCError(
            'livraison refusée — audio final hors norme : ' + ', '.join(errors)
        )
    return measured


def master_video_audio(path: Path) -> LoudnessMeasurement:
    """Normalise en deux passes puis contrôle le MP4 après son encodage AAC."""
    target = path.expanduser().resolve()
    first = measure_loudness(target)
    second_pass = (
        f'loudnorm=I={TARGET_LUFS}:TP={LOUDNORM_TRUE_PEAK_TARGET}:'
        f'LRA={LOUDNORM_LRA}:'
        f'measured_I={first.integrated_lufs}:'
        f'measured_TP={first.true_peak_dbtp}:'
        f'measured_LRA={first.loudness_range_lu}:'
        f'measured_thresh={first.threshold_lufs}:'
        f'offset={first.target_offset_lu}:'
        'linear=false:print_format=summary'
    )
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f'.{target.stem}-mastered-',
        suffix=target.suffix,
        dir=target.parent,
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        _run(
            [
                'ffmpeg',
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                str(target),
                '-map',
                '0:v:0',
                '-map',
                '0:a:0',
                '-c:v',
                'copy',
                '-af',
                second_pass,
                '-c:a',
                'aac',
                '-b:a',
                '256k',
                '-ar',
                '48000',
                '-movflags',
                '+faststart',
                str(temporary),
            ]
        )
        measured = measure_loudness(temporary)
        if (
            abs(measured.integrated_lufs - TARGET_LUFS) > LUFS_TOLERANCE
            or measured.true_peak_dbtp > MAX_TRUE_PEAK_DBTP
        ):
            # Certains programmes très courts avec une longue fin silencieuse
            # ressortent ~1 LU sous la cible loudnorm. Une correction mesurée,
            # bornée et limitée est alors appliquée au candidat, jamais à
            # l'original, puis le résultat est mesuré une dernière fois.
            normalized_source = temporary.with_name(
                f'{temporary.stem}-normalized-source{temporary.suffix}'
            )
            temporary.replace(normalized_source)
            total_gain = 0.0
            try:
                for _attempt in range(24):
                    delta = TARGET_LUFS - measured.integrated_lufs
                    total_gain += max(-0.5, min(0.5, delta))
                    if abs(total_gain) > 12:
                        raise DeliveryQCError(
                            f'correction loudness anormale refusée : '
                            f'{total_gain:+.2f} dB'
                        )
                    _run(
                        [
                            'ffmpeg',
                            '-y',
                            '-hide_banner',
                            '-loglevel',
                            'error',
                            '-i',
                            str(normalized_source),
                            '-map',
                            '0:v:0',
                            '-map',
                            '0:a:0',
                            '-c:v',
                            'copy',
                            '-af',
                            (
                                f'volume={total_gain:+.4f}dB,'
                                'alimiter=limit=0.841395:attack=5:release=50'
                            ),
                            '-c:a',
                            'aac',
                            '-b:a',
                            '256k',
                            '-ar',
                            '48000',
                            '-movflags',
                            '+faststart',
                            str(temporary),
                        ]
                    )
                    measured = measure_loudness(temporary)
                    if (
                        abs(measured.integrated_lufs - TARGET_LUFS)
                        <= LUFS_TOLERANCE
                        and measured.true_peak_dbtp <= MAX_TRUE_PEAK_DBTP
                    ):
                        break
                else:
                    raise DeliveryQCError(
                        'normalisation itérative incapable d’atteindre '
                        'la cible de livraison'
                    )
            finally:
                normalized_source.unlink(missing_ok=True)
        measured = assert_delivery_loudness(temporary)
        temporary.replace(target)
        return measured
    finally:
        temporary.unlink(missing_ok=True)


def write_qc_sidecar(path: Path, measurement: LoudnessMeasurement) -> Path:
    sidecar = path.with_suffix(path.suffix + '.delivery-qc.json')
    temporary = sidecar.with_suffix(sidecar.suffix + '.tmp')
    temporary.write_text(
        json.dumps(
            {
                'schema_version': 1,
                'media': str(path.resolve()),
                'audio': {
                    **asdict(measurement),
                    'target_lufs': TARGET_LUFS,
                    'tolerance_lu': LUFS_TOLERANCE,
                    'max_true_peak_dbtp': MAX_TRUE_PEAK_DBTP,
                    'status': 'OK',
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + '\n',
        encoding='utf-8',
    )
    temporary.replace(sidecar)
    return sidecar
