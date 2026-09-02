"""Install a pinned Krea 2 identity-edit node pack and low-VRAM adapter.

The adapter keeps a consented reference identity while changing pose, framing,
lighting, wardrobe, and background. It is used to prepare a coherent candidate
dataset before any character LoRA training.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
from hashlib import sha256

from huggingface_hub import hf_hub_download


NODE_REPOSITORY = "https://github.com/lbouaraba/comfyui-krea2edit.git"
NODE_REVISION = "dc7940f437e59a1e74b9a74e98b7e900a8bd62cd"
ADAPTER_REPOSITORY = "conradlocke/krea2-identity-edit"
ADAPTER_REVISION = "29f4b0b96bf01bf3de7c9f1313ca3337538ca247"
ADAPTER_FILENAME = "krea2_identity_edit_v1_2_r64.safetensors"
ADAPTER_SHA256 = "f794b47142555c929cf536a2f1e4f335174b9aedbb08572b07d45814d4242423"


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def install_nodes(custom_nodes: Path) -> Path:
    destination = custom_nodes / "comfyui-krea2edit"
    if not destination.exists():
        subprocess.run(
            ["git", "clone", "--no-checkout", NODE_REPOSITORY, str(destination)],
            check=True,
        )
    subprocess.run(
        ["git", "-C", str(destination), "fetch", "origin", NODE_REVISION, "--depth", "1"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(destination), "checkout", "--detach", NODE_REVISION],
        check=True,
    )
    print(f"installed node pack {NODE_REVISION} -> {destination}", flush=True)
    return destination


def download(
    repo: str,
    filename: str,
    destination: Path,
    expected_sha256: str | None = None,
) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    result = Path(
        hf_hub_download(
            repo_id=repo,
            filename=filename,
            revision=ADAPTER_REVISION,
            local_dir=str(destination),
        )
    )
    digest = file_sha256(result)
    if expected_sha256 is not None and digest != expected_sha256:
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

    root = Path(args.comfy_root)
    install_nodes(root / "custom_nodes")
    download(
        ADAPTER_REPOSITORY,
        ADAPTER_FILENAME,
        root / "models" / "loras",
        ADAPTER_SHA256,
    )
    license_dir = root / "models" / "licenses" / "krea2-identity-edit"
    download(ADAPTER_REPOSITORY, "LICENSE.pdf", license_dir)
    download(ADAPTER_REPOSITORY, "NOTICE", license_dir)
    print("Krea 2 identity edit is ready; restart ComfyUI before preflight.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
