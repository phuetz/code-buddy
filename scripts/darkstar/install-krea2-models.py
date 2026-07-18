"""Install the official Krea 2 training and ComfyUI inference assets on Darkstar."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download


def download_file(repo: str, filename: str, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    path = Path(
        hf_hub_download(
            repo_id=repo,
            filename=filename,
            local_dir=str(destination),
        )
    )
    size_gb = path.stat().st_size / (1024**3)
    print(f"installed {repo}/{filename} -> {path} ({size_gb:.2f} GiB)", flush=True)
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--comfy-root", default=r"D:\DEV\ComfyUI")
    parser.add_argument("--trainer-root", default=r"D:\DEV\Krea2TrainerRuntime")
    parser.add_argument("--skip-raw", action="store_true")
    parser.add_argument("--skip-comfy", action="store_true")
    args = parser.parse_args()

    comfy_root = Path(args.comfy_root)
    trainer_root = Path(args.trainer_root)
    hf_home = trainer_root / "hf_cache"
    os.environ["HF_HOME"] = str(hf_home)
    os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")

    if not args.skip_raw:
        raw_dir = trainer_root / "models" / "Krea-2-Raw"
        download_file("krea/Krea-2-Raw", "raw.safetensors", raw_dir)
        # ai-toolkit loads these two components separately during Krea 2 training.
        snapshot_download(repo_id="Qwen/Qwen3-VL-4B-Instruct", cache_dir=str(hf_home))
        snapshot_download(
            repo_id="Qwen/Qwen-Image",
            allow_patterns=["vae/*", "model_index.json", "LICENSE*", "README*"],
            cache_dir=str(hf_home),
        )
        print("installed Krea 2 RAW training dependencies", flush=True)

    if not args.skip_comfy:
        repo = "Comfy-Org/Krea-2"
        download_file(
            repo,
            "diffusion_models/krea2_turbo_fp8_scaled.safetensors",
            comfy_root / "models",
        )
        download_file(
            repo,
            "text_encoders/qwen3vl_4b_fp8_scaled.safetensors",
            comfy_root / "models",
        )
        download_file(
            repo,
            "vae/qwen_image_vae.safetensors",
            comfy_root / "models",
        )

    print("Krea 2 model installation complete", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
