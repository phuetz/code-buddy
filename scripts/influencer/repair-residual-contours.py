#!/usr/bin/env python3
"""Inpainting local, étroit et non destructif des contours fantômes d'Ambre.

Ce repli classique n'est utilisé qu'après les deux tentatives Qwen-Edit. Les
masques suivent le résidu commun aux images de plage sur 11 pixels seulement.
Les originaux ne sont jamais modifiés.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


SOURCE_ROOT = (
    Path.home() / 'Videos/personas/garde-robe-reparee/final'
)
OUTPUT_ROOT = (
    Path.home()
    / 'Videos/personas/garde-robe-reparee'
    / 'contours-fantomes-20260731/classical'
)
DEFAULT_REFERENCE = (
    Path.home()
    / 'Videos/personas/garde-robe-reparee/final-short-qc-20260731'
    / 'ambre-maillot-une-piece-corail.png'
)

# Coordonnées établies au zoom 1:1 sur les sources 1080 × 1920. Le même
# résidu de silhouette a été propagé pendant le changement de garde-robe.
LEFT_LINE = (
    (178, 700),
    (174, 780),
    (165, 900),
    (154, 1030),
    (145, 1160),
    (135, 1300),
    (123, 1420),
    (106, 1530),
    (89, 1640),
    (74, 1760),
    (60, 1870),
    (54, 1915),
)
RIGHT_LINE = (
    (895, 1060),
    (895, 1200),
    (890, 1330),
    (883, 1420),
    (872, 1470),
)
RIGHT_LOWER = (
    (872, 1470),
    (840, 1500),
    (803, 1525),
    (811, 1550),
    (816, 1600),
    (833, 1625),
    (816, 1650),
    (840, 1685),
)

TASKS = {
    'ambre-combishort-lin-sable': ('right',),
    'ambre-jupe-pareo-bandeau': ('right',),
    'ambre-kimono-azur-une-piece': ('right',),
    'ambre-robe-longue-fluide-dos-nu': ('right',),
    'ambre-robe-plage-crochet-ecru': ('right',),
    'ambre-une-piece-blanc-pareo-imprime': ('right',),
    'ambre-maillot-une-piece-corail': ('coral-trial',),
}
DEFAULT_TASKS = tuple(
    slug for slug in TASKS if slug != 'ambre-maillot-une-piece-corail'
)
CORAL_TRIAL_POLYGONS = (
    ((760, 920), (860, 890), (925, 1015), (870, 1235), (755, 1185)),
    ((990, 1080), (1079, 1090), (1079, 1715), (985, 1605)),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'slugs',
        nargs='*',
        help='Images à réparer ; toutes si omis.',
    )
    parser.add_argument('--source-root', type=Path, default=SOURCE_ROOT)
    parser.add_argument('--output-root', type=Path, default=OUTPUT_ROOT)
    parser.add_argument('--stroke-width', type=int, default=11)
    parser.add_argument('--radius', type=float, default=7.0)
    parser.add_argument(
        '--method',
        choices=(
            'reference',
            'biharmonic',
            'seamless',
            'blur',
            'clone',
            'guided',
            'telea',
            'ns',
        ),
        default='biharmonic',
        help='Inpainting biharmonique par défaut, ou variantes comparatives.',
    )
    parser.add_argument(
        '--reference',
        type=Path,
        default=DEFAULT_REFERENCE,
        help='Image de même décor où la zone est propre.',
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Remplacer uniquement une sortie dérivée déjà créée.',
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    import cv2
    import numpy as np

    if args.stroke_width < 3 or args.stroke_width > 17:
        raise SystemExit('--stroke-width doit rester entre 3 et 17 px')
    slugs = args.slugs or list(DEFAULT_TASKS)
    unknown = sorted(set(slugs) - set(TASKS))
    if unknown:
        raise SystemExit(f'Slug(s) inconnu(s) : {", ".join(unknown)}')
    args.output_root.mkdir(parents=True, exist_ok=True)
    records = []
    for slug in slugs:
        source = args.source_root / f'{slug}.png'
        output = args.output_root / f'{slug}-inpaint.png'
        mask_path = args.output_root / f'{slug}-mask.png'
        if not source.is_file():
            raise SystemExit(f'Source absente : {source}')
        if (output.exists() or mask_path.exists()) and not args.force:
            raise SystemExit(
                f'Sortie dérivée existante : {output} (utiliser --force)'
            )
        image = cv2.imread(str(source), cv2.IMREAD_UNCHANGED)
        if image is None or image.shape[:2] != (1920, 1080):
            raise SystemExit(f'Image illisible ou dimensions inattendues : {source}')
        mask = np.zeros(image.shape[:2], dtype=np.uint8)
        for side in TASKS[slug]:
            if side == 'coral-trial':
                for polygon in CORAL_TRIAL_POLYGONS:
                    cv2.fillPoly(
                        mask,
                        [np.asarray(polygon, dtype=np.int32)],
                        255,
                        lineType=cv2.LINE_AA,
                    )
                continue
            paths = (
                ((LEFT_LINE, args.stroke_width),)
                if side == 'left'
                else (
                    (RIGHT_LINE, args.stroke_width),
                    (RIGHT_LOWER, min(21, args.stroke_width + 4)),
                )
            )
            for points, stroke_width in paths:
                cv2.polylines(
                    mask,
                    [np.asarray(points, dtype=np.int32)],
                    False,
                    255,
                    thickness=stroke_width,
                    lineType=cv2.LINE_AA,
                )
        binary_mask = np.where(mask >= 16, 255, 0).astype(np.uint8)
        color = image[:, :, :3]
        if args.method == 'reference':
            reference = cv2.imread(str(args.reference), cv2.IMREAD_UNCHANGED)
            if reference is None or reference.shape != image.shape:
                raise SystemExit(
                    f'Référence propre absente ou incompatible : {args.reference}'
                )
            reference_color = reference[:, :, :3]
            repaired_color = color.copy()
            distance = cv2.distanceTransform(binary_mask, cv2.DIST_L2, 5)
            alpha = np.clip(distance / 3.0, 0.0, 1.0)[:, :, None]
            adjusted = reference_color.astype(np.float32).copy()
            for y in np.flatnonzero(binary_mask.any(axis=1)):
                xs = np.flatnonzero(binary_mask[y])
                left = max(0, int(xs[0]) - 8)
                right = min(color.shape[1], int(xs[-1]) + 9)
                ring = np.ones(right - left, dtype=bool)
                ring[np.maximum(0, xs - left)] = False
                if not ring.any():
                    continue
                target_ring = color[y, left:right][ring].astype(np.float32)
                reference_ring = reference_color[y, left:right][ring].astype(
                    np.float32
                )
                delta = np.median(target_ring - reference_ring, axis=0)
                adjusted[y, xs] = np.clip(
                    reference_color[y, xs].astype(np.float32) + delta,
                    0,
                    255,
                )
            repaired_float = (
                color.astype(np.float32) * (1.0 - alpha)
                + adjusted * alpha
            )
            repaired_color = np.clip(repaired_float, 0, 255).astype(np.uint8)
        elif args.method == 'biharmonic':
            from skimage.restoration import inpaint

            ys, xs = np.nonzero(binary_mask)
            top = max(0, int(ys.min()) - 24)
            bottom = min(color.shape[0], int(ys.max()) + 25)
            left = max(0, int(xs.min()) - 24)
            right = min(color.shape[1], int(xs.max()) + 25)
            crop = color[top:bottom, left:right].astype(np.float32) / 255.0
            crop_mask = binary_mask[top:bottom, left:right] != 0
            filled = inpaint.inpaint_biharmonic(
                crop,
                crop_mask,
                channel_axis=-1,
            )
            repaired_color = color.copy()
            repaired_crop = repaired_color[top:bottom, left:right]
            repaired_crop[crop_mask] = np.clip(
                filled[crop_mask] * 255.0,
                0,
                255,
            ).astype(np.uint8)
        elif args.method == 'seamless':
            shifted = np.empty_like(color)
            shifted[:, -24:] = color[:, -24:]
            shifted[:, :-24] = color[:, 24:]
            repaired_color = cv2.seamlessClone(
                shifted,
                color,
                binary_mask,
                (color.shape[1] // 2, color.shape[0] // 2),
                cv2.NORMAL_CLONE,
            )
            repaired_color[binary_mask == 0] = color[binary_mask == 0]
        elif args.method == 'blur':
            local_background = cv2.GaussianBlur(
                color,
                (0, 0),
                sigmaX=12.0,
                sigmaY=12.0,
            )
            distance = cv2.distanceTransform(binary_mask, cv2.DIST_L2, 5)
            alpha = np.clip(distance / 4.0, 0.0, 1.0)[:, :, None]
            repaired_color = np.clip(
                color.astype(np.float32) * (1.0 - alpha)
                + local_background.astype(np.float32) * alpha,
                0,
                255,
            ).astype(np.uint8)
        elif args.method == 'clone':
            shifted = np.empty_like(color)
            shifted[:, -24:] = color[:, -24:]
            shifted[:, :-24] = color[:, 24:]
            distance = cv2.distanceTransform(binary_mask, cv2.DIST_L2, 5)
            alpha = np.clip(distance / 4.0, 0.0, 1.0)[:, :, None]
            repaired_color = np.clip(
                color.astype(np.float32) * (1.0 - alpha)
                + shifted.astype(np.float32) * alpha,
                0,
                255,
            ).astype(np.uint8)
        elif args.method in ('telea', 'ns'):
            repaired_color = cv2.inpaint(
                color,
                binary_mask,
                args.radius,
                (
                    cv2.INPAINT_TELEA
                    if args.method == 'telea'
                    else cv2.INPAINT_NS
                ),
            )
        else:
            repaired_color = color.copy()
            for y in np.flatnonzero(binary_mask.any(axis=1)):
                xs = np.flatnonzero(binary_mask[y])
                left = max(0, int(xs[0]) - 3)
                right = min(color.shape[1] - 1, int(xs[-1]) + 3)
                if right <= left:
                    continue
                left_color = np.median(
                    color[max(0, y - 2): y + 3, max(0, left - 2): left + 1],
                    axis=(0, 1),
                )
                right_color = np.median(
                    color[max(0, y - 2): y + 3, right: right + 3],
                    axis=(0, 1),
                )
                span = right - left + 1
                alpha = np.linspace(0.0, 1.0, span)[:, None]
                fill = (
                    left_color[None, :] * (1.0 - alpha)
                    + right_color[None, :] * alpha
                )
                row_mask = binary_mask[y, left: right + 1] != 0
                repaired_color[y, left: right + 1][row_mask] = np.clip(
                    fill[row_mask],
                    0,
                    255,
                ).astype(np.uint8)
        repaired = image.copy()
        repaired[:, :, :3] = repaired_color
        if not cv2.imwrite(str(output), repaired):
            raise SystemExit(f'Écriture impossible : {output}')
        if not cv2.imwrite(str(mask_path), binary_mask):
            raise SystemExit(f'Écriture impossible : {mask_path}')
        outside = binary_mask == 0
        if not np.array_equal(image[outside], repaired[outside]):
            raise SystemExit(f'Invariant hors masque violé : {slug}')
        record = {
            'slug': slug,
            'source': str(source),
            'output': str(output),
            'mask': str(mask_path),
            'sourceSha256': sha256_file(source),
            'outputSha256': sha256_file(output),
            'maskPixels': int(np.count_nonzero(binary_mask)),
            'maskRatio': round(
                float(np.count_nonzero(binary_mask)) / binary_mask.size,
                8,
            ),
            'outsideMaskExact': True,
            'method': (
                f'cv2.inpaint/{args.method.upper()}'
                if args.method in ('telea', 'ns')
                else (
                    'clean-reference/local-colour-match'
                    if args.method == 'reference'
                    else (
                        'skimage.inpaint_biharmonic'
                        if args.method == 'biharmonic'
                        else (
                            'cv2.seamlessClone/NORMAL'
                            if args.method == 'seamless'
                            else (
                                'local-gaussian-background/feathered'
                                if args.method == 'blur'
                                else (
                                    'right-neighbour-clone/feathered'
                                    if args.method == 'clone'
                                    else 'horizontal-neighbour-guided-fill'
                                )
                            )
                        )
                    )
                )
            ),
            'strokeWidthPx': args.stroke_width,
            'radiusPx': args.radius,
            'costUsd': 0,
        }
        records.append(record)
        print(f'OK {slug}: {record["maskPixels"]} px masqués -> {output}')
    manifest_path = args.output_root / 'manifest.json'
    previous_records = []
    if manifest_path.is_file():
        try:
            previous_records = json.loads(
                manifest_path.read_text(encoding='utf-8')
            ).get('records', [])
        except (json.JSONDecodeError, OSError, AttributeError):
            previous_records = []
    selected_slugs = {record['slug'] for record in records}
    merged_records = [
        record
        for record in previous_records
        if record.get('slug') not in selected_slugs
    ] + records
    merged_records.sort(key=lambda record: record.get('slug', ''))
    manifest = {
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'records': merged_records,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'Manifeste : {manifest_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
