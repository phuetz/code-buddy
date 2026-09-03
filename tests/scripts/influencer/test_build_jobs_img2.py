from __future__ import annotations

import importlib.util
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def load_module(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


builder = load_module(
    "build_img2_jobs_under_test", "scripts/influencer/build_jobs_img2.py"
)


def test_img2_manifest_exact_counts_and_constraints(tmp_path: Path) -> None:
    lisa, ambre = builder.build(tmp_path / "img2", prepare_references=False)
    builder.validate(lisa, ambre)

    assert len(lisa) == 30
    assert len(ambre) == 20
    assert len({job["name"] for job in lisa + ambre}) == 50
    assert set(Counter(job["source_document"] for job in lisa).values()) == {2}
    assert len({job["source_document"] for job in lisa}) == 15
    assert len({job["source_document"] for job in ambre}) == 20
    assert {job["model"] for job in lisa + ambre} == {
        "grok-imagine-video-1.5"
    }
    assert {job["resolution"] for job in lisa + ambre} == {"1080p"}
    assert {job["duration"] for job in lisa + ambre} == {6}
    assert {job["aspect_ratio"] for job in lisa} == {"9:16"}
    assert {job["aspect_ratio"] for job in ambre} == {"16:9"}
    lisa_names = {job["name"] for job in lisa}
    assert "lisa-img2-gemini-video-agentique-b-safe" in lisa_names
    assert "lisa-img2-gemini-video-agentique-b" not in lisa_names


def test_img2_prompts_lock_visual_safety_and_motion(tmp_path: Path) -> None:
    lisa, ambre = builder.build(tmp_path / "img2", prepare_references=False)

    assert sum("image_path" in job for job in lisa) == 13
    assert all("image_path" in job for job in ambre)
    assert all("no realistic person" in job["prompt"].lower() for job in lisa)
    assert all("no readable text" in job["prompt"].lower() for job in lisa + ambre)
    assert all("locked tripod" in job["prompt"].lower() for job in lisa + ambre)
    assert all("no drone flight" in job["prompt"].lower() for job in ambre)
    assert all("no city flyover" in job["prompt"].lower() for job in ambre)


def test_img2_sources_are_the_validated_fifteen_and_tourism_twenty(
    tmp_path: Path,
) -> None:
    lisa, ambre = builder.build(tmp_path / "img2", prepare_references=False)

    lisa_names = {Path(job["source_document"]).name for job in lisa}
    assert lisa_names == {
        "SHORT-LISA-crowdstrike-safemind.md",
        "SHORT-LISA-evaluation-ia-double-aveugle.md",
        "SHORT-LISA-excel-copilot-python.md",
        "SHORT-LISA-fairwind-cyber.md",
        "SHORT-LISA-gemini-3-8-flash.md",
        "SHORT-LISA-gemini-juridique.md",
        "SHORT-LISA-gemini-transcribe.md",
        "SHORT-LISA-gemini-video-agentique.md",
        "SHORT-LISA-glm-5-3-flash.md",
        "SHORT-LISA-granite-4-2.md",
        "SHORT-LISA-model-hardware-standard.md",
        "SHORT-LISA-nvidia-vera-agents.md",
        "SHORT-LISA-openai-hugging-face-rapport.md",
        "SHORT-LISA-royaume-uni-100m-ia.md",
        "SHORT-LISA-world-labs-atlas.md",
    }
    assert {Path(job["source_document"]).stem for job in ambre} == {
        "bali",
        "cambodge",
        "colombie",
        "ecosse",
        "egypte",
        "grece",
        "indonesie",
        "islande",
        "japon",
        "jordanie",
        "maroc",
        "mexique",
        "norvege",
        "perou",
        "philippines",
        "portugal",
        "sri-lanka",
        "thailande",
        "turquie",
        "vietnam",
    }
