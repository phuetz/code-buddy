"""Install the public XLabs Flux IP-Adapter assets for ComfyUI on Darkstar.

The installer is idempotent: huggingface_hub reuses its cache and leaves the
files in the directories discovered by x-flux-comfyui.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
from pathlib import Path

from huggingface_hub import hf_hub_download


REVISIONS = {
    "XLabs-AI/flux-ip-adapter": "18f6940238ab5dc3744df7a8e30315892279d5f9",
    "openai/clip-vit-large-patch14": "32bd64288804d66eefd0ccbe215aa642df71cc41",
}
SHA256 = {
    ("XLabs-AI/flux-ip-adapter", "ip_adapter.safetensors"): "750f912149b84bbb0c2a6ce90ffa7e78afd1795821407718724ebcd36372dc2d",
    ("openai/clip-vit-large-patch14", "model.safetensors"): "a2bf730a0c7debf160f7a6b50b3aaf3703e7e88ac73de7a314903141db026dcb",
}


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(repo: str, filename: str, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    result = Path(
        hf_hub_download(
            repo_id=repo,
            filename=filename,
            revision=REVISIONS[repo],
            local_dir=str(destination),
        )
    )
    digest = file_sha256(result)
    if digest != SHA256[(repo, filename)]:
        raise RuntimeError(f"SHA-256 mismatch for {result}: {digest}")
    print(
        f"installed {repo}/{filename} -> {result} "
        f"({result.stat().st_size / (1024**2):.1f} MiB)",
        flush=True,
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--comfy-root", default=r"D:\DEV\ComfyUI")
    args = parser.parse_args()

    models = Path(args.comfy_root) / "models"
    download(
        "XLabs-AI/flux-ip-adapter",
        "ip_adapter.safetensors",
        models / "xlabs" / "ipadapters",
    )
    download(
        "openai/clip-vit-large-patch14",
        "model.safetensors",
        models / "clip_vision",
    )
    print("Flux IP-Adapter assets are ready; restart ComfyUI to refresh model lists.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
