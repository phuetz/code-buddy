#!/usr/bin/env python3
"""Build the scored Krea 2 / GPT Image / Qwen-Edit comparison board."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path("/home/patrice/Videos/personas")
KREA = ROOT / "benchmark-krea2-local-2026-07-29"
BASE = ROOT / "benchmark-identite-2026-07-29"
OUT = KREA / "PLANCHE-COMPARATIVE-KREA2-LOCAL-2026-07-29.jpg"

PERSONAS = {
    "ambre": {
        "reference": (
            ROOT
            / "ambre-scenes/automne-composites/"
            "ambre-002-chalet-exterieur-flanelle.png"
        ),
        "label": "AMBRE",
    },
    "lisa": {
        "reference": Path(
            "/home/patrice/.codebuddy/personas/lisa/identity-kit/lisa-hotel-2.png"
        ),
        "label": "LISA",
    },
}


def load_scores(path: Path) -> dict[str, float]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {Path(row["path"]).as_posix(): row["arcface"] for row in rows}


def score_for(scores: dict[str, float], path: Path) -> float:
    return scores[path.resolve().as_posix()]


def fitted(path: Path, width: int, height: int) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), "#15171b")
    canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return canvas


def main() -> int:
    krea_scores = {
        **load_scores(KREA / "arcface-ambre.json"),
        **load_scores(KREA / "arcface-lisa.json"),
    }
    base_scores = {
        **load_scores(BASE / "arcface-ambre.json"),
        **load_scores(BASE / "arcface-lisa.json"),
    }

    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    title_font = ImageFont.truetype(bold_path, 30)
    header_font = ImageFont.truetype(bold_path, 21)
    label_font = ImageFont.truetype(font_path, 18)
    score_font = ImageFont.truetype(bold_path, 18)

    tile_w, image_h, label_h = 300, 210, 58
    gap = 10
    columns = ["Cas", "Référence", "GPT Image", "Qwen-Edit", "Krea 2 (a)", "Krea 2 + LoRA (b)"]
    board_w = gap + len(columns) * (tile_w + gap)
    title_h, header_h = 62, 48
    board_h = title_h + header_h + 6 * (image_h + label_h + gap) + gap
    board = Image.new("RGB", (board_w, board_h), "#0d0f12")
    draw = ImageDraw.Draw(board)
    draw.text(
        (board_w // 2, 28),
        "Benchmark identité — scores ArcFace visibles",
        font=title_font,
        fill="white",
        anchor="mm",
    )

    for col, header in enumerate(columns):
        x = gap + col * (tile_w + gap)
        draw.rounded_rectangle(
            (x, title_h, x + tile_w, title_h + header_h - 5),
            radius=8,
            fill="#252a31",
        )
        draw.text(
            (x + tile_w // 2, title_h + 20),
            header,
            font=header_font,
            fill="white",
            anchor="mm",
        )

    row = 0
    for persona, data in PERSONAS.items():
        for prompt_index in range(1, 4):
            y = title_h + header_h + row * (image_h + label_h + gap)
            case_x = gap
            draw.rounded_rectangle(
                (case_x, y, case_x + tile_w, y + image_h + label_h),
                radius=10,
                fill="#222831",
            )
            draw.text(
                (case_x + tile_w // 2, y + (image_h + label_h) // 2 - 15),
                data["label"],
                font=title_font,
                fill="#f4c66a",
                anchor="mm",
            )
            draw.text(
                (case_x + tile_w // 2, y + (image_h + label_h) // 2 + 25),
                f"P{prompt_index}",
                font=header_font,
                fill="white",
                anchor="mm",
            )

            paths = [
                data["reference"],
                BASE / "gpt" / f"{persona}-p{prompt_index}.png",
                BASE / "qwen" / f"{persona}-p{prompt_index}.png",
                KREA / "a" / f"{persona}-p{prompt_index}.png",
                KREA / "b" / f"{persona}-p{prompt_index}.png",
            ]
            labels = [
                "référence",
                f"ArcFace {score_for(base_scores, paths[1]):.3f}",
                f"ArcFace {score_for(base_scores, paths[2]):.3f}",
                f"ArcFace {score_for(krea_scores, paths[3]):.3f}",
                f"ArcFace {score_for(krea_scores, paths[4]):.3f}",
            ]

            for offset, (image_path, label) in enumerate(zip(paths, labels), start=1):
                x = gap + offset * (tile_w + gap)
                board.paste(fitted(image_path, tile_w, image_h), (x, y))
                color = "#7fd98b" if "ArcFace" in label and float(label.split()[-1]) >= 0.55 else "#e4e7eb"
                draw.rectangle((x, y + image_h, x + tile_w, y + image_h + label_h), fill="#1d2127")
                draw.text(
                    (x + tile_w // 2, y + image_h + label_h // 2),
                    label,
                    font=score_font if "ArcFace" in label else label_font,
                    fill=color,
                    anchor="mm",
                )
            row += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    board.save(OUT, quality=92, subsampling=0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
