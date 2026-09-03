from __future__ import annotations

import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest


ROOT = Path(__file__).resolve().parents[3]


def load_module(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


grok = load_module("grok_imagine_under_test", "scripts/influencer/grok_imagine.py")
jobs_builder = load_module("build_img1_jobs_under_test", "scripts/influencer/build_jobs.py")


def test_spending_limit_stops_without_refresh() -> None:
    payload = json.dumps(
        {"error": {"code": "personal-team-blocked:spending-limit"}}
    ).encode()
    response = urllib.error.HTTPError(
        "https://api.x.ai/v1/videos/generations",
        403,
        "Forbidden",
        {"x-ratelimit-remaining": "0"},
        io.BytesIO(payload),
    )
    with (
        patch.object(grok, "token", return_value="secret-not-printed"),
        patch.object(grok.urllib.request, "urlopen", side_effect=response),
        patch.object(grok, "refresh") as refresh,
        pytest.raises(grok.QuotaExhausted),
    ):
        grok.api("POST", "/v1/videos/generations", {"prompt": "safe"})
    refresh.assert_not_called()


def test_safe_quota_headers_drops_unrelated_metadata() -> None:
    assert grok.safe_quota_headers(
        {
            "x-ratelimit-remaining": "4",
            "retry-after": "9",
            "x-request-id": "must-not-be-logged",
        }
    ) == {"x-ratelimit-remaining": "4", "retry-after": "9"}


def test_local_image_is_encoded_without_modifying_source() -> None:
    source = (
        Path.home()
        / ".codebuddy/personas/lisa/broll-local/lisa-digital-brain.png"
    )
    before = source.stat()
    encoded = grok.local_image_data_url(str(source), ROOT)
    after = source.stat()
    assert encoded.startswith("data:image/png;base64,")
    assert len(encoded) > source.stat().st_size
    assert (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)


def test_img1_manifest_has_expected_jobs_and_constraints() -> None:
    lisa, ambre = jobs_builder.build(ROOT / "_img1", prepare_references=False)
    assert len(lisa) == 16
    assert len(ambre) == 16
    assert {job["aspect_ratio"] for job in lisa} == {"9:16"}
    assert {job["aspect_ratio"] for job in ambre} == {"16:9"}
    assert {job["duration"] for job in lisa + ambre} == {6}
    assert {job["resolution"] for job in lisa + ambre} == {"1080p"}
    assert all(job.get("image_path") for job in lisa + ambre)
    assert all("no readable text" in job["prompt"].lower() for job in lisa + ambre)
    assert all(
        "no face" in job["prompt"].lower()
        or "no realistic face" in job["prompt"].lower()
        for job in lisa
    )
    assert all("no drone flight" in job["prompt"].lower() for job in ambre)
