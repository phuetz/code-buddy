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


class FakeResponse(io.BytesIO):
    def __init__(self, payload: dict, status: int, headers: dict[str, str]):
        super().__init__(json.dumps(payload).encode())
        self.status = status
        self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def test_spending_limit_stops_without_refresh(tmp_path: Path) -> None:
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
        patch.dict(
            grok.os.environ,
            {"GROK_IMAGINE_LOG": str(tmp_path / "api.jsonl")},
        ),
        patch.object(grok, "token", return_value="secret-not-printed"),
        patch.object(grok.urllib.request, "urlopen", side_effect=response),
        patch.object(grok, "refresh") as refresh,
        pytest.raises(grok.QuotaExhausted),
    ):
        grok.api("POST", "/v1/videos/generations", {"prompt": "safe"})
    refresh.assert_not_called()
    record = json.loads((tmp_path / "api.jsonl").read_text())
    assert record["response_headers"] == {"x-ratelimit-remaining": "0"}
    assert "secret-not-printed" not in json.dumps(record)


def test_safe_quota_headers_drops_unrelated_metadata() -> None:
    assert grok.safe_quota_headers(
        {
            "x-ratelimit-remaining": "4",
            "retry-after": "9",
            "x-request-id": "must-not-be-logged",
        }
    ) == {"x-ratelimit-remaining": "4", "retry-after": "9"}


def test_each_api_log_keeps_only_useful_response_headers(tmp_path: Path) -> None:
    response = FakeResponse(
        {"ok": True},
        200,
        {
            "date": "Thu, 03 Sep 2026 09:30:00 GMT",
            "x-request-id": "request-123",
            "x-ratelimit-remaining": "59",
            "set-cookie": "must-not-be-logged",
        },
    )
    with (
        patch.dict(
            grok.os.environ,
            {"GROK_IMAGINE_LOG": str(tmp_path / "api.jsonl")},
        ),
        patch.object(grok, "token", return_value="secret-not-printed"),
        patch.object(grok.urllib.request, "urlopen", return_value=response),
    ):
        payload, meta = grok.api("GET", "/v1/videos/request-secret")

    assert payload == {"ok": True}
    assert meta["path"] == "/v1/videos/{request_id}"
    assert meta["response_headers"] == {
        "date": "Thu, 03 Sep 2026 09:30:00 GMT",
        "x-request-id": "request-123",
        "x-ratelimit-remaining": "59",
    }
    record = json.loads((tmp_path / "api.jsonl").read_text())
    assert record["response_headers"] == meta["response_headers"]
    assert "set-cookie" not in json.dumps(record)
    assert "request-secret" not in json.dumps(record)


def test_cli_model_and_resolution_override_video_jobs(tmp_path: Path) -> None:
    jobs_path = tmp_path / "jobs.json"
    jobs_path.write_text(
        json.dumps([{"name": "clip", "prompt": "safe", "duration": 6}])
    )
    output = tmp_path / "out"
    captured: list[dict] = []

    def fake_gen_video(job: dict, destination: Path, _base_dir: Path) -> Path:
        captured.append(job)
        result = destination / "clip.mp4"
        result.write_bytes(b"0" * 50_001)
        return result

    with (
        patch.dict(grok.os.environ, {"GROK_IMAGINE_OUT": str(output)}),
        patch.object(grok, "gen_video", side_effect=fake_gen_video),
        patch.object(
            grok,
            "probe",
            return_value={"duration": 6.0, "width": 1920, "height": 1080},
        ),
    ):
        assert (
            grok.main(
                [
                    str(jobs_path),
                    "--model",
                    "grok-imagine-video-1.5",
                    "--resolution",
                    "1080p",
                ]
            )
            == 0
        )

    assert captured == [
        {
            "name": "clip",
            "prompt": "safe",
            "duration": 6,
            "model": "grok-imagine-video-1.5",
            "resolution": "1080p",
        }
    ]


def test_main_quota_summary_reports_exact_progress(tmp_path: Path) -> None:
    jobs_path = tmp_path / "jobs.json"
    jobs_path.write_text(
        json.dumps(
            [
                {"name": "existing", "prompt": "safe"},
                {"name": "blocked", "prompt": "safe"},
                {"name": "never-started", "prompt": "safe"},
            ]
        )
    )
    output = tmp_path / "out"
    output.mkdir()
    (output / "existing.mp4").write_bytes(b"0" * 50_001)
    log_path = tmp_path / "api.jsonl"

    with (
        patch.dict(
            grok.os.environ,
            {
                "GROK_IMAGINE_OUT": str(output),
                "GROK_IMAGINE_LOG": str(log_path),
            },
        ),
        patch.object(
            grok,
            "gen_video",
            side_effect=grok.QuotaExhausted(403, grok.QUOTA_SENTINEL),
        ),
        patch.object(
            grok,
            "probe",
            return_value={"duration": 6.0, "width": 1920, "height": 1080},
        ),
    ):
        assert grok.main([str(jobs_path)]) == 0

    records = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert records[-1] == {
        "completed": 1,
        "failed": 0,
        "generated": 0,
        "jobs_total": 3,
        "kind": "batch",
        "skipped_existing": 1,
        "status": "stopped_quota",
        "stopped_at": "blocked",
    }


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
