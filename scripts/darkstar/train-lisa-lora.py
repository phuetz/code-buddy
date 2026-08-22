#!/usr/bin/env python3
"""
Train a simple character LoRA for Lisa on Darkstar (2x RTX 3090).

Uses the ComfyUI venv (torch+diffusers+peft+accelerate). Supports:
  - SDXL checkpoints (e.g. RealVisXL_V4.0_Lightning.safetensors)
  - SD1.5 / SD-Turbo single-file checkpoints

Example (PowerShell on Darkstar):
  $env:CUDA_VISIBLE_DEVICES='1'
  D:\\DEV\\ComfyUI\\venv\\Scripts\\python.exe train-lisa-lora.py ^
    --images D:\\DEV\\lisa-lora\\images ^
    --checkpoint D:\\DEV\\ComfyUI\\models\\checkpoints\\RealVisXL_V4.0_Lightning.safetensors ^
    --out D:\\DEV\\ComfyUI\\models\\loras\\lisa.safetensors ^
    --steps 1000 --trigger "ohwx lisa"
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


class CaptionImageDataset(Dataset):
    def __init__(self, images_dir: Path, trigger: str, size: int):
        self.items: list[tuple[Path, str]] = []
        for p in sorted(images_dir.iterdir()):
            if p.suffix.lower() not in IMAGE_EXTS:
                continue
            cap = p.with_suffix(".txt")
            text = cap.read_text(encoding="utf-8").strip() if cap.exists() else trigger
            if trigger and trigger not in text:
                text = f"{trigger}, {text}"
            self.items.append((p, text or trigger))
        if not self.items:
            raise SystemExit(f"No images in {images_dir}")
        self.tf = transforms.Compose(
            [
                transforms.Resize(size, interpolation=transforms.InterpolationMode.BILINEAR),
                transforms.CenterCrop(size),
                transforms.ToTensor(),
                transforms.Normalize([0.5], [0.5]),
            ]
        )

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        path, caption = self.items[idx]
        img = Image.open(path).convert("RGB")
        return {"pixel_values": self.tf(img), "caption": caption}


def is_xl_checkpoint(name: str, force: str = "auto") -> bool:
    if force in ("xl", "sdxl", "true", "1"):
        return True
    if force in ("sd", "15", "false", "0"):
        return False
    n = name.lower()
    # flux is not supported by this simple UNet LoRA path
    if "flux" in n:
        raise SystemExit("Flux checkpoints are not supported by this trainer; use RealVisXL or sd_turbo.")
    return "xl" in n or "sdxl" in n


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Lisa character LoRA trainer (Darkstar)")
    p.add_argument("--images", required=True, type=Path)
    p.add_argument("--checkpoint", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--trigger", default="ohwx lisa")
    p.add_argument("--steps", type=int, default=1000)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--size", type=int, default=0, help="0 = auto (768 XL / 512 SD)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="cuda:0")
    p.add_argument("--save-every", type=int, default=250)
    p.add_argument(
        "--arch",
        default="auto",
        help="auto|xl|sd — force architecture if filename is ambiguous (sd_turbo → sd)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.checkpoint.is_file():
        print(f"Missing checkpoint: {args.checkpoint}", file=sys.stderr)
        return 2
    if not args.images.is_dir():
        print(f"Missing images dir: {args.images}", file=sys.stderr)
        return 2

    random.seed(args.seed)
    torch.manual_seed(args.seed)

    xl = is_xl_checkpoint(args.checkpoint.name, force=args.arch)
    # SD-Turbo likes 512; XL portraits prefer 768
    size = args.size or (768 if xl else 512)
    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if device.type == "cuda" else torch.float32

    print(f"[train] device={device} xl={xl} size={size} steps={args.steps} rank={args.rank}")
    print(f"[train] checkpoint={args.checkpoint}")
    print(f"[train] images={args.images}")

    from diffusers import (
        AutoencoderKL,
        DDPMScheduler,
        StableDiffusionPipeline,
        StableDiffusionXLPipeline,
        UNet2DConditionModel,
    )
    from diffusers.loaders import LoraLoaderMixin
    from peft import LoraConfig
    from peft.utils import get_peft_model_state_dict
    from transformers import AutoTokenizer, CLIPTextModel, CLIPTextModelWithProjection

    pipe_cls = StableDiffusionXLPipeline if xl else StableDiffusionPipeline
    print("[train] loading pipeline from single file (first load can take a few minutes)…")
    # Prefer ComfyUI YAML so we don't hit gated HF model config downloads.
    comfy_cfg_root = Path(r"D:\DEV\ComfyUI\models\configs")
    original_cfg = None
    if xl:
        for cand in ("sd_xl_base.yaml", "v1-inference.yaml"):
            p = comfy_cfg_root / cand
            if p.is_file():
                original_cfg = p
                break
    else:
        for cand in ("v2-inference-v.yaml", "v2-inference.yaml", "v1-inference.yaml"):
            p = comfy_cfg_root / cand
            if p.is_file():
                original_cfg = p
                break
    load_kwargs: dict = {
        "torch_dtype": dtype,
        "local_files_only": False,  # may fetch public CLIP tokenizer only
    }
    if original_cfg is not None:
        load_kwargs["original_config_file"] = str(original_cfg)
        print(f"[train] original_config_file={original_cfg}")
    try:
        pipe = pipe_cls.from_single_file(str(args.checkpoint), **load_kwargs)
    except Exception as first_err:
        print(f"[train] from_single_file failed ({first_err!r}); retry without original_config…")
        load_kwargs.pop("original_config_file", None)
        pipe = pipe_cls.from_single_file(str(args.checkpoint), **load_kwargs)
    pipe.to(device)
    pipe.set_progress_bar_config(disable=True)

    unet: UNet2DConditionModel = pipe.unet
    vae: AutoencoderKL = pipe.vae
    text_encoder = pipe.text_encoder
    tokenizer = pipe.tokenizer
    text_encoder_2 = getattr(pipe, "text_encoder_2", None)
    tokenizer_2 = getattr(pipe, "tokenizer_2", None)

    vae.requires_grad_(False)
    text_encoder.requires_grad_(False)
    if text_encoder_2 is not None:
        text_encoder_2.requires_grad_(False)
    unet.requires_grad_(False)

    # Target attention projections (standard character LoRA)
    target_modules = ["to_k", "to_q", "to_v", "to_out.0"]
    lora_config = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank,
        init_lora_weights="gaussian",
        target_modules=target_modules,
    )
    unet.add_adapter(lora_config)
    unet.train()
    for n, p in unet.named_parameters():
        if "lora" in n:
            p.requires_grad_(True)

    trainable = [p for p in unet.parameters() if p.requires_grad]
    print(f"[train] trainable params: {sum(p.numel() for p in trainable):,}")

    noise_scheduler = DDPMScheduler.from_config(pipe.scheduler.config)
    ds = CaptionImageDataset(args.images, args.trigger, size)
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, num_workers=0)
    opt = torch.optim.AdamW(trainable, lr=args.lr, weight_decay=1e-2)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    mid_dir = args.out.parent / (args.out.stem + "_steps")
    mid_dir.mkdir(parents=True, exist_ok=True)

    step = 0
    unet.to(device=device, dtype=dtype)
    vae.to(device=device, dtype=dtype)
    text_encoder.to(device=device, dtype=dtype)
    if text_encoder_2 is not None:
        text_encoder_2.to(device=device, dtype=dtype)

    print(f"[train] dataset size={len(ds)} — starting")
    while step < args.steps:
        for batch in dl:
            if step >= args.steps:
                break
            pixel_values = batch["pixel_values"].to(device=device, dtype=dtype)
            captions: list[str] = list(batch["caption"])

            with torch.no_grad():
                latents = vae.encode(pixel_values).latent_dist.sample()
                latents = latents * vae.config.scaling_factor
                noise = torch.randn_like(latents)
                bsz = latents.shape[0]
                timesteps = torch.randint(
                    0,
                    noise_scheduler.config.num_train_timesteps,
                    (bsz,),
                    device=device,
                    dtype=torch.long,
                )
                noisy = noise_scheduler.add_noise(latents, noise, timesteps)

                tokens = tokenizer(
                    captions,
                    padding="max_length",
                    max_length=tokenizer.model_max_length,
                    truncation=True,
                    return_tensors="pt",
                )
                input_ids = tokens.input_ids.to(device)
                encoder_hidden = text_encoder(input_ids)[0]

                added_cond = None
                if xl and text_encoder_2 is not None and tokenizer_2 is not None:
                    tokens2 = tokenizer_2(
                        captions,
                        padding="max_length",
                        max_length=tokenizer_2.model_max_length,
                        truncation=True,
                        return_tensors="pt",
                    )
                    enc2 = text_encoder_2(tokens2.input_ids.to(device))
                    encoder_hidden = torch.cat([encoder_hidden, enc2[0]], dim=-1)
                    # SDXL micro-conditioning
                    add_time = torch.tensor(
                        [[size, size, 0, 0, size, size]] * bsz,
                        device=device,
                        dtype=encoder_hidden.dtype,
                    )
                    text_embeds = enc2[0].mean(dim=1) if enc2[0].ndim == 3 else enc2[0]
                    # pooled output when available
                    pooled = getattr(enc2, "pooler_output", None)
                    if pooled is None and len(enc2) > 1 and isinstance(enc2[1], torch.Tensor):
                        pooled = enc2[1]
                    if pooled is None:
                        pooled = text_embeds
                    added_cond = {"text_embeds": pooled.to(dtype=encoder_hidden.dtype), "time_ids": add_time}

            if xl and added_cond is not None:
                model_pred = unet(
                    noisy,
                    timesteps,
                    encoder_hidden,
                    added_cond_kwargs=added_cond,
                ).sample
            else:
                model_pred = unet(noisy, timesteps, encoder_hidden).sample

            loss = torch.nn.functional.mse_loss(model_pred.float(), noise.float(), reduction="mean")
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            opt.step()

            step += 1
            if step % 25 == 0 or step == 1:
                print(f"[train] step {step}/{args.steps} loss={loss.item():.4f}")

            if args.save_every > 0 and step % args.save_every == 0:
                mid = mid_dir / f"lisa-step{step}.safetensors"
                save_unet_lora(unet, mid)
                print(f"[train] checkpoint {mid}")

    save_unet_lora(unet, args.out)
    print(f"[train] DONE → {args.out}")
    return 0


def save_unet_lora(unet, path: Path) -> None:
    from safetensors.torch import save_file
    from peft.utils import get_peft_model_state_dict

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    state = get_peft_model_state_dict(unet)
    # Prefix for ComfyUI / diffusers LoRA loader compatibility
    out = {}
    for k, v in state.items():
        key = k if k.startswith("lora_unet_") else f"lora_unet_{k.replace('.', '_')}"
        # keep original peft keys too — Comfy often wants lora_unet_* style
        out[k] = v.detach().cpu().contiguous()
    # Also write kohya-ish aliases when possible
    for k, v in list(out.items()):
        if "lora_A" in k or "lora_B" in k or "lora_embedding" in k:
            continue
    save_file(out, str(path))
    # Prefer diffusers export when available
    try:
        unet.save_attn_procs(str(path.with_suffix("")))
        # pack directory to single file if save_attn_procs wrote a folder
        folder = path.with_suffix("")
        if folder.is_dir():
            proc = folder / "pytorch_lora_weights.safetensors"
            if proc.is_file():
                proc.replace(path)
                # cleanup folder leftovers best-effort
                for child in folder.iterdir():
                    try:
                        child.unlink()
                    except OSError:
                        pass
                try:
                    folder.rmdir()
                except OSError:
                    pass
    except Exception as exc:  # noqa: BLE001
        print(f"[train] save_attn_procs fallback note: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
