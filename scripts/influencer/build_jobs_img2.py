#!/usr/bin/env python3
"""Construit les 50 jobs IMG2 et leurs références i2v aux bons ratios.

Les sources sous ``~/.codebuddy/personas`` sont lues sans être modifiées. Les
canevas et manifestes intermédiaires sont écrits dans ``_img2/`` du clone.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "_img2"
PERSONAS = Path(os.path.expanduser("~/.codebuddy/personas"))
MIN_COMPLETE_BYTES = 50_000
MODEL = "grok-imagine-video-1.5"
RESOLUTION = "1080p"

LISA_RULES = (
    "Vertical 9:16 restrained editorial B-roll. Locked tripod, no pan, no zoom, "
    "no dolly, only the explicitly described tiny motion. Stable straight geometry. "
    "No realistic person, no face, no hands, no readable text, no letters, no numbers, "
    "no logo, no watermark."
)

AMBRE_RULES = (
    "Landscape 16:9 restrained travel B-roll. Preserve the photographed place and "
    "architecture. Locked tripod from a human-height viewpoint, no pan, no zoom, no "
    "dolly, no aerial view, no drone flight, no city flyover. Only the explicitly "
    "described natural motion; buildings, monuments and horizon remain stable. No "
    "people, no faces, no readable text, no logo, no watermark."
)


# Exact validated set: seven corrected LISA2 files plus eight LISA4
# publishable/corrected files. Google Pics and Cursor remain outside this set.
LISA_SCENES: list[dict[str, Any]] = [
    {
        "slug": "gemini-video-agentique",
        "plans": [
            (
                None,
                "A quiet editing room with one blank widescreen monitor showing abstract "
                "video frames as colored rectangles; one frame is isolated by a soft glow.",
            ),
            (
                "digital-brain",
                "An abstract neural core studies a ring of five solid translucent color "
                "tiles containing no images; one restrained pulse links two blank tiles and fades.",
            ),
        ],
    },
    {
        "slug": "gemini-juridique",
        "plans": [
            (
                None,
                "A quiet modern law-library interior, a closed folder, brass desk lamp and "
                "sealed document stack; only the lamp reflection shifts faintly.",
            ),
            (
                None,
                "A private glass meeting room with two closed document boxes and an idle "
                "laptop displaying abstract shapes; a curtain moves almost imperceptibly.",
            ),
        ],
    },
    {
        "slug": "excel-copilot-python",
        "plans": [
            (
                None,
                "A clean office desk with a laptop displaying an abstract spreadsheet grid "
                "without characters; one highlighted cell softly changes color.",
            ),
            (
                None,
                "A calculator, blank graph paper and three small data cubes beside a monitor "
                "with an unlabeled chart; one bar rises slightly and settles.",
            ),
        ],
    },
    {
        "slug": "nvidia-vera-agents",
        "plans": [
            (
                "datacenter",
                "A calm server aisle representing agent orchestration; one narrow line of "
                "status lights travels once between racks, with faint cooling mist.",
            ),
            (
                None,
                "A large processor package on an antistatic laboratory bench beside a neat "
                "motherboard; one cool indicator pulse crosses the traces.",
            ),
        ],
    },
    {
        "slug": "crowdstrike-safemind",
        "plans": [
            (
                None,
                "An empty security operations room with dark monitors showing abstract shield "
                "shapes; one red signal is contained by a quiet blue ring.",
            ),
            (
                "datacenter",
                "A secured server aisle where a single amber anomaly pulse meets a blue "
                "protective pulse and both become steady, with minimal indicator motion.",
            ),
        ],
    },
    {
        "slug": "evaluation-ia-double-aveugle",
        "plans": [
            (
                None,
                "Two identical sealed black test boxes on opposite sides of a neutral lab "
                "table, joined only by a dim encrypted light path that blinks once.",
            ),
            (
                "digital-brain",
                "An abstract neural core sits behind two layers of translucent privacy glass; "
                "two isolated signals pass without revealing either sealed side.",
            ),
        ],
    },
    {
        "slug": "royaume-uni-100m-ia",
        "plans": [
            (
                None,
                "A restrained public-sector meeting room with four blank project folders, a "
                "calculator and a closed laptop; four small desk lights wake in sequence.",
            ),
            (
                "datacenter",
                "A local computing aisle divided into four orderly experimental lanes; four "
                "small indicator groups illuminate once while every rack stays rigid.",
            ),
        ],
    },
    {
        "slug": "gemini-3-8-flash",
        "plans": [
            (
                "digital-brain",
                "A compact abstract neural core inside clear glass emits one fast clean pulse, "
                "then returns to a calm low glow.",
            ),
            (
                None,
                "A minimal workstation with three translucent processing tiles inside a glass "
                "case; the smallest tile completes one soft light cycle first.",
            ),
        ],
    },
    {
        "slug": "fairwind-cyber",
        "plans": [
            (
                None,
                "An empty cyber-defense room with one abstract shield on a blank monitor; a "
                "small fracture appears and is repaired by a controlled blue light.",
            ),
            (
                "datacenter",
                "A quiet server aisle under active protection; one red test pulse is detected "
                "and gently contained while the architecture remains perfectly fixed.",
            ),
        ],
    },
    {
        "slug": "gemini-transcribe",
        "plans": [
            (
                None,
                "A studio microphone beside a blank monitor with a simple unlabeled waveform; "
                "the waveform moves gently while every object stays still.",
            ),
            (
                None,
                "Headphones, a compact recorder and a glass sound booth in a quiet studio; one "
                "tiny recording light breathes slowly.",
            ),
        ],
    },
    {
        "slug": "granite-4-2",
        "plans": [
            (
                "digital-brain",
                "An abstract neural core is housed inside a dark polished stone cube; one "
                "layered circuit glow travels through the stone and stops.",
            ),
            (
                "datacenter",
                "A sober local server aisle with one dense dark compute module; a restrained "
                "sequence of lights demonstrates steady efficient processing.",
            ),
        ],
    },
    {
        "slug": "glm-5-3-flash",
        "plans": [
            (
                "digital-brain",
                "A compact translucent neural lattice with fewer thicker layers emits a brief "
                "precise pulse inside a dim room.",
            ),
            (
                "datacenter",
                "A local server aisle where one compact rack completes a short light sequence "
                "before a larger neighboring rack, then both remain steady.",
            ),
        ],
    },
    {
        "slug": "model-hardware-standard",
        "plans": [
            (
                None,
                "An empty laboratory workbench with a microscope, pipetting robot and compact "
                "robot arm connected by identical unlabeled control modules; one status light moves.",
            ),
            (
                None,
                "A glass-fronted instrument room with three different scientific devices and "
                "one shared controller; a single green readiness pulse crosses the cables.",
            ),
        ],
    },
    {
        "slug": "world-labs-atlas",
        "plans": [
            (
                None,
                "A small architectural room model on a studio table surrounded by a sparse "
                "three-dimensional light grid; only the grid breathes faintly.",
            ),
            (
                "digital-brain",
                "An abstract spatial intelligence holds a stable miniature room, camera frame "
                "and geometric world volume in one glass display; tiny particles drift.",
            ),
        ],
    },
    {
        "slug": "openai-hugging-face-rapport",
        "plans": [
            (
                None,
                "An isolated evaluation lab with sealed server boxes and one cable attempting "
                "to cross a transparent boundary before a relay switches off.",
            ),
            (
                "datacenter",
                "A locked server aisle divided by a clear security partition; one unexpected "
                "amber signal travels briefly, then every connection goes dark and still.",
            ),
        ],
    },
]


AMBRE_SCENES = [
    ("bali", "bali-stills/bali-still-01.png", "Sidemen rice terraces beneath Mount Agung", "rice leaves and water reflections move faintly"),
    ("cambodge", "seedance/_ref_angkor-wat-cambodia-sunrise-reflection.jpg", "the stone galleries and reflecting pool of Angkor Wat", "water ripples and a few leaves move faintly"),
    ("colombie", "seedance/_ref_cartagena-colombia-colonial-street.jpg", "a quiet colonial arcade inside Cartagena's historic walls", "a hanging plant and warm curtain move slightly"),
    ("ecosse", "seedance/_ref_scotland-isle-of-skye-highlands.jpg", "the Old Man of Storr landscape on the Isle of Skye", "low mist drifts very slowly around the rock"),
    ("egypte", "seedance/_ref_egypt-pyramids-giza-desert.jpg", "the Giza pyramids viewed from a stable ground-level desert viewpoint", "fine dust and heat shimmer move barely perceptibly"),
    ("grece", "flow-pexels/santorin/p07-11448243.jpg", "whitewashed Santorini architecture facing the Aegean from a fixed terrace", "sea reflections and one parasol edge move gently"),
    ("indonesie", "seedance/_ref_mount-bromo-indonesia-volcano-dawn.jpg", "Mount Bromo and its volcanic sea of ash at dawn", "thin mist moves slowly across the ash"),
    ("islande", "seedance/_ref_iceland-waterfall-landscape.jpg", "Seljalandsfoss from the safe ground-level path", "water falls naturally and fine spray drifts"),
    ("japon", "seedance/_ref_mount-fuji-japan-cherry-blossom.jpg", "Mount Fuji across a quiet lake framed by cherry branches", "foreground blossoms and lake reflections move faintly"),
    ("jordanie", "seedance/_ref_petra-jordan-treasury.jpg", "Petra's Treasury framed from the narrow Siq", "warm dust floats subtly in the light"),
    ("maroc", "seedance/_ref_sahara-desert-dunes-morocco.jpg", "the sculpted dunes of Erg Chebbi near Merzouga", "a trace of sand moves along one dune ridge"),
    ("mexique", "seedance/_ref_chichen-itza-mexico-pyramid.jpg", "El Castillo at Chichen Itza viewed respectfully from the visitor path", "nearby leaves stir lightly"),
    ("norvege", "seedance/_ref_norway-fjord-aerial.jpg", "Geirangerfjord from a fixed cliffside lookout", "water and distant cloud move almost imperceptibly"),
    ("perou", "seedance/_ref_machu-picchu-peru-sunrise.jpg", "Machu Picchu from a stable visitor terrace", "thin mountain cloud drifts behind the stonework"),
    ("philippines", "seedance/_ref_palawan-philippines-lagoon-turquoise.jpg", "an El Nido lagoon seen from the still shoreline", "small water ripples and palm leaves move gently"),
    ("portugal", "algarve-stills/algarve-still-03.png", "the interior of Benagil sea cave in the Algarve", "small waves and reflected light move softly"),
    ("sri-lanka", "seedance/_ref_sri-lanka-tea-plantation-hills.jpg", "tea terraces near Nuwara Eliya", "tea leaves and light mist move faintly"),
    ("thailande", "seedance/_ref_phi-phi-islands-thailand-turquoise.jpg", "a quiet Phi Phi lagoon from a low shoreline viewpoint", "turquoise water laps gently"),
    ("turquie", "seedance/_ref_cappadocia-turkey-hot-air-balloons.jpg", "Cappadocia's rock formations from a fixed valley terrace", "two distant balloons and thin cloud drift slowly"),
    ("vietnam", "seedance/_ref_halong-bay-vietnam.jpg", "Ha Long Bay from a fixed waterside viewpoint", "water ripples and low mist move slowly"),
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


def build(
    output: Path, prepare_references: bool
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lisa_root = PERSONAS / "lisa"
    ambre_root = PERSONAS / "ambre"
    refs = output / "reference-images"
    lisa_sources = {
        "digital-brain": lisa_root / "broll-local/lisa-digital-brain.png",
        "datacenter": lisa_root / "broll-local/lisa-datacenter.png",
    }
    lisa_prepared = {
        key: refs / "lisa" / f"{key}-9x16.jpg" for key in lisa_sources
    }
    ambre_sources = {
        slug: ambre_root / relative for slug, relative, _, _ in AMBRE_SCENES
    }
    ambre_reference_names = {
        "grece": "grece-santorin-oia-16x9.jpg",
        "japon": "japon-mount-fuji-16x9.jpg",
    }
    ambre_prepared = {
        slug: refs / "ambre" / ambre_reference_names.get(slug, f"{slug}-16x9.jpg")
        for slug in ambre_sources
    }

    source_documents = [
        lisa_root / f"SHORT-LISA-{scene['slug']}.md" for scene in LISA_SCENES
    ] + [ambre_root / "tourisme-v3" / f"{slug}.txt" for slug, *_ in AMBRE_SCENES]
    all_sources = list(lisa_sources.values()) + list(ambre_sources.values())
    missing = [path for path in source_documents + all_sources if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            "Sources absentes: " + ", ".join(str(path) for path in missing)
        )

    if prepare_references:
        for key, source in lisa_sources.items():
            reference_canvas(source, lisa_prepared[key], 1080, 1920)
        for slug, source in ambre_sources.items():
            reference_canvas(source, ambre_prepared[slug], 1920, 1080)

    lisa_jobs: list[dict[str, Any]] = []
    for scene in LISA_SCENES:
        for index, (reference, description) in enumerate(scene["plans"]):
            suffix = "a" if index == 0 else "b"
            if scene["slug"] == "gemini-video-agentique" and suffix == "b":
                suffix = "b-safe"
            job: dict[str, Any] = {
                "name": f"lisa-img2-{scene['slug']}-{suffix}",
                "mode": "video",
                "model": MODEL,
                "prompt": f"{description} {LISA_RULES}",
                "duration": 6,
                "aspect_ratio": "9:16",
                "resolution": RESOLUTION,
                "source_document": str(
                    lisa_root / f"SHORT-LISA-{scene['slug']}.md"
                ),
            }
            if reference:
                job["image_path"] = str(lisa_prepared[reference])
            lisa_jobs.append(job)

    ambre_jobs = [
        {
            "name": f"ambre-img2-{slug}",
            "mode": "video",
            "model": MODEL,
            "prompt": f"{place}; {motion}. {AMBRE_RULES}",
            "duration": 6,
            "aspect_ratio": "16:9",
            "resolution": RESOLUTION,
            "image_path": str(ambre_prepared[slug]),
            "source_document": str(ambre_root / "tourisme-v3" / f"{slug}.txt"),
        }
        for slug, _, place, motion in AMBRE_SCENES
    ]
    return lisa_jobs, ambre_jobs


def validate(lisa_jobs: list[dict[str, Any]], ambre_jobs: list[dict[str, Any]]) -> None:
    lisa_counts = Counter(
        job["source_document"] for job in lisa_jobs
    )
    if len(lisa_jobs) != 30 or set(lisa_counts.values()) != {2}:
        raise ValueError("Le manifeste Lisa doit contenir deux plans pour 15 fiches.")
    if len(ambre_jobs) != 20:
        raise ValueError("Le manifeste Ambre doit contenir exactement 20 plans.")
    names = [job["name"] for job in lisa_jobs + ambre_jobs]
    if len(names) != len(set(names)):
        raise ValueError("Les noms de jobs IMG2 doivent être uniques.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--no-prepare-references", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    lisa_jobs, ambre_jobs = build(output, not args.no_prepare_references)
    validate(lisa_jobs, ambre_jobs)
    (output / "jobs-lisa.json").write_text(
        json.dumps(lisa_jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output / "jobs-ambre.json").write_text(
        json.dumps(ambre_jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Lisa: {len(lisa_jobs)} jobs; Ambre: {len(ambre_jobs)} jobs")
    print(f"Manifestes: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
