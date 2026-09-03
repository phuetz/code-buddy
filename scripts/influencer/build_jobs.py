#!/usr/bin/env python3
"""Construit le lot IMG1 Lisa/Ambre et ses références aux bons ratios.

Les sources sous ``~/.codebuddy/personas`` sont uniquement lues. Les canevas
et manifestes produits restent dans ``_img1/`` du clone.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "_img1"
PERSONAS = Path(os.path.expanduser("~/.codebuddy/personas"))
MIN_COMPLETE_BYTES = 50_000


LISA_SCENES = [
    (
        "01-echo",
        "digital-brain",
        "A translucent abstract neural core in a quiet dark room. A single soft audio ripple approaches, its reflected echo dissolves before returning. Locked camera, only the tiny particles and one ripple move, no realistic person, no face, no hands, no readable text, no logo, no watermark.",
        "datacenter",
        "A calm server aisle suggesting a companion robot's local computer. One brief light pulse travels from speaker side to microphone side, then is gently blocked and the room returns to silence. Static tripod, architecture perfectly stable, only indicator lights and faint floor mist move, no people, no face, no readable text, no logo, no watermark.",
    ),
    (
        "02-self-evolution",
        "digital-brain",
        "An abstract digital brain quietly reveals three restrained layers of verified memory, each layer glowing once and settling back into place. Locked portrait composition, no camera motion, only subtle internal particles move, no realistic person, no face, no hands, no readable text, no logo, no watermark.",
        "datacenter",
        "A quiet local server aisle at night. Three small groups of status lights wake in sequence like a factual change log, then remain steady. Fixed tripod, no dolly, no zoom, rigid racks remain geometrically unchanged, no people, no readable text, no logo, no watermark.",
    ),
    (
        "03-short-first",
        "digital-brain",
        "An abstract neural core emits one clean concise pulse immediately, pauses, then releases a softer detailed wave behind it. Completely fixed camera, minimal particle drift, no realistic person, no face, no hands, no readable text, no logo, no watermark.",
        "datacenter",
        "In a calm computer aisle, one indicator responds instantly and a measured sequence follows without hurry. Locked camera, no push-in, only tiny server LEDs and faint cooling mist move, geometry stable, no people, no readable text, no logo, no watermark.",
    ),
    (
        "04-pardon",
        "digital-brain",
        "A fuzzy broken audio ripple reaches an abstract digital brain; the brain waits rather than inventing, then the ripple becomes one clear signal. Static portrait shot, extremely subtle motion only, no realistic person, no face, no hands, no readable text, no logo, no watermark.",
        "datacenter",
        "A quiet local computer pauses on an ambiguous signal: one small amber indicator breathes slowly, waiting for confirmation, then turns steady blue. Locked tripod, architecture frozen, no people, no readable text, no logo, no watermark.",
    ),
    (
        "05-night-silence",
        "digital-brain",
        "An abstract companion intelligence settles into night mode in a peaceful dim interior. Its particles slow and the warm glow becomes very soft without disappearing. Camera perfectly still, only gentle particle drift, no realistic person, no face, no hands, no readable text, no logo, no watermark.",
        "datacenter",
        "A silent local server room late at night gradually dims to a restful low blue glow. Fixed tripod, only a trace of cooling mist and slow indicator breathing move, no people, no readable text, no logo, no watermark.",
    ),
    (
        "06-reminder",
        "digital-brain",
        "An abstract neural core stores one small warm reminder pulse, releases it once at the right moment, then the pulse gently closes and does not repeat. Locked camera, minimal particles only, no realistic person, no face, no hands, no clock text, no readable text, no logo, no watermark.",
        "datacenter",
        "A calm local computer marks a single scheduled event: one isolated indicator turns warm, signals once, then switches off cleanly. Static tripod, racks remain stable, faint mist only, no people, no readable text, no logo, no watermark.",
    ),
    (
        "07-local-vision",
        "digital-brain",
        "An abstract digital brain notices a gentle transition from darkness to safe ambient light, processing it locally as a restrained ring of particles. Fixed portrait frame, no camera motion, no realistic person, no face, no hands, no readable text, no logo, no watermark.",
        "datacenter",
        "A dark local computing aisle ignores faint visual noise, then softly wakes when clean room light arrives. Locked tripod, no zoom or pan, only light intensity and a little mist change, no people, no face, no readable text, no logo, no watermark.",
    ),
    (
        "08-barge-in",
        "digital-brain",
        "An abstract neural core is speaking through a flowing light pulse; a distinct new signal arrives and the outgoing pulse stops instantly, leaving space for the new intention. Camera locked, minimal particle motion, no realistic person, no face, no hands, no readable text, no logo, no watermark.",
        "datacenter",
        "A measured sequence of server lights stops cleanly the moment a new input pulse appears, then a different calm sequence begins. Static tripod, stable architecture, only tiny LEDs and mist move, no people, no readable text, no logo, no watermark.",
    ),
]


AMBRE_SCENES = [
    ("04-spain", "04-espagne/seville.jpg", "Seville", "leaves and warm sunlight"),
    ("05-cyprus", "05-chypre/paphos.jpg", "Paphos harbour", "water ripples and moored boats sway almost imperceptibly"),
    ("06-malta", "06-malte/valette.jpg", "Valletta", "Mediterranean light shimmers gently"),
    ("07-portugal", "07-portugal/alfama.jpg", "Alfama in Lisbon", "a curtain and a few leaves move in a light breeze"),
    ("08-dubai", "08-dubai/marina.jpg", "Dubai Marina", "water ripples and small reflections twinkle"),
    ("09-thailand", "09-thailande/longtail.jpg", "Thailand's longtail coast", "the boat rocks subtly and water laps softly"),
    ("10-malaysia", "10-malaisie/petronas.jpg", "Kuala Lumpur", "thin clouds drift slowly behind the towers"),
    ("11-mauritius", "11-maurice/lagon.jpg", "a Mauritius lagoon", "small waves and palm leaves move naturally"),
    ("12-panama", "12-panama/cascoviejo.jpg", "Casco Viejo in Panama", "soft clouds and nearby foliage move gently"),
    ("13-costa-rica", "13-costa-rica/jungle.jpg", "a Costa Rican rainforest", "leaves breathe in a mild breeze and dappled light shifts"),
    ("14-morocco", "14-maroc/riad.jpg", "a Moroccan riad", "patio leaves and fountain water move very slightly"),
    ("15-tunisia", "15-tunisie/sidibou.jpg", "Sidi Bou Said", "bougainvillea leaves and fabric move faintly"),
    ("16-georgia", "16-georgie/tbilissi.jpg", "old Tbilisi", "soft clouds drift slowly while the city stays rigid"),
    ("17-croatia", "17-croatie/dubrovnik.jpg", "Dubrovnik", "the Adriatic glints softly and a few leaves stir"),
    ("18-montenegro", "18-montenegro/kotor.jpg", "the Bay of Kotor", "water ripples and high clouds move almost imperceptibly"),
    ("19-uruguay", "19-uruguay/montevideo.jpg", "Montevideo", "water and distant tree leaves move gently"),
]


def reference_canvas(source: Path, destination: Path, width: int, height: int) -> None:
    if destination.exists() and destination.stat().st_size > MIN_COMPLETE_BYTES:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    filter_graph = (
        f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},boxblur=24:6[bg];"
        f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2"
    )
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-filter_complex",
            filter_graph,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(destination),
        ],
        check=True,
    )


def build(output: Path, prepare_references: bool) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    refs = output / "reference-images"
    lisa_source = PERSONAS / "lisa" / "broll-local"
    lisa_refs = {
        "digital-brain": lisa_source / "lisa-digital-brain.png",
        "datacenter": lisa_source / "lisa-datacenter.png",
    }
    lisa_prepared = {
        key: refs / "lisa" / f"{key}-9x16.jpg" for key in lisa_refs
    }
    ambre_root = PERSONAS / "ambre" / "retraite-illustree" / "photos"
    ambre_prepared = {
        name: refs / "ambre" / f"{name}-16x9.jpg"
        for name, _, _, _ in AMBRE_SCENES
    }

    all_sources = list(lisa_refs.values()) + [
        ambre_root / relative for _, relative, _, _ in AMBRE_SCENES
    ]
    missing = [source for source in all_sources if not source.is_file()]
    if missing:
        raise FileNotFoundError("Sources absentes: " + ", ".join(str(path) for path in missing))

    if prepare_references:
        for key, source in lisa_refs.items():
            reference_canvas(source, lisa_prepared[key], 1080, 1920)
        for name, relative, _, _ in AMBRE_SCENES:
            reference_canvas(ambre_root / relative, ambre_prepared[name], 1920, 1080)

    lisa_jobs: list[dict[str, Any]] = []
    for slug, first_ref, first_prompt, second_ref, second_prompt in LISA_SCENES:
        for plan, ref_name, prompt in (
            ("a", first_ref, first_prompt),
            ("b", second_ref, second_prompt),
        ):
            if "no face" not in prompt.lower():
                prompt += " No realistic face."
            lisa_jobs.append(
                {
                    "name": f"lisa-{slug}-{plan}",
                    "mode": "video",
                    "model": "grok-imagine-video-1.5",
                    "prompt": prompt,
                    "duration": 6,
                    "aspect_ratio": "9:16",
                    "resolution": "1080p",
                    "image_path": str(lisa_prepared[ref_name].relative_to(output)),
                }
            )

    ambre_jobs: list[dict[str, Any]] = []
    for name, _, location, motion in AMBRE_SCENES:
        prompt = (
            f"Preserve this exact documentary travel photograph of {location}: same buildings, "
            f"landscape, proportions, colours and viewpoint. Locked tripod; {motion}. No pan, "
            "no tilt, no zoom, no dolly, no orbit, no drone flight, no added people, no readable "
            "text, no logo, no watermark. Natural realistic motion only; architecture and horizon "
            "must remain perfectly stable for the whole shot."
        )
        ambre_jobs.append(
            {
                "name": f"ambre-{name}",
                "mode": "video",
                "model": "grok-imagine-video-1.5",
                "prompt": prompt,
                "duration": 6,
                "aspect_ratio": "16:9",
                "resolution": "1080p",
                "image_path": str(ambre_prepared[name].relative_to(output)),
            }
        )
    return lisa_jobs, ambre_jobs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--prepare-references", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    lisa_jobs, ambre_jobs = build(output, args.prepare_references)
    for name, jobs in (("jobs-lisa.json", lisa_jobs), ("jobs-ambre.json", ambre_jobs)):
        (output / name).write_text(
            json.dumps(jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(f"Lisa: {len(lisa_jobs)} jobs; Ambre: {len(ambre_jobs)} jobs; sortie: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
