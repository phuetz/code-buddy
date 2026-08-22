#!/usr/bin/env python3
"""
Offline Lisa LoRA trainer for Darkstar using ComfyUI's checkpoint loader
(no HuggingFace downloads). Saves a Comfy-friendly UNet LoRA safetensors.

Run inside ComfyUI tree so `import comfy` works:
  cd D:\\DEV\\ComfyUI
  set CUDA_VISIBLE_DEVICES=1
  venv\\Scripts\\python.exe D:\\DEV\\lisa-lora\\train-lisa-lora-comfy.py ...
"""

from __future__ import annotations

import argparse
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


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--comfy-root", type=Path, default=Path(r"D:\DEV\ComfyUI"))
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--images", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--trigger", default="ohwx lisa")
    p.add_argument("--steps", type=int, default=1000)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--batch", type=int, default=1)
    p.add_argument("--size", type=int, default=512)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--save-every", type=int, default=250)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    comfy_root = args.comfy_root.resolve()
    if str(comfy_root) not in sys.path:
        sys.path.insert(0, str(comfy_root))

    # ComfyUI expects cwd = comfy root for some relative assets
    import os

    os.chdir(comfy_root)

    import comfy.model_management as model_management
    import comfy.sd as comfy_sd
    import comfy.utils as comfy_utils
    from safetensors.torch import save_file

    device = model_management.get_torch_device()
    print(f"[comfy-train] device={device} checkpoint={args.checkpoint}")
    print(f"[comfy-train] images={args.images} steps={args.steps} rank={args.rank}")

    if not args.checkpoint.is_file():
        raise SystemExit(f"Missing checkpoint {args.checkpoint}")

    # load_checkpoint_guess_config returns (model_patcher, clip, vae, clipvision)
    model_patcher, clip, vae, _clipvision = comfy_sd.load_checkpoint_guess_config(
        str(args.checkpoint),
        output_vae=True,
        output_clip=True,
        embedding_directory=None,
    )
    if model_patcher is None or clip is None or vae is None:
        raise SystemExit("Failed to load checkpoint via ComfyUI")

    # Underlying diffusion model
    unet = model_patcher.model.diffusion_model
    unet_dtype = next(unet.parameters()).dtype
    unet.to(device=device, dtype=unet_dtype)
    unet.train()
    print(f"[comfy-train] unet_dtype={unet_dtype}")

    # Freeze base; attach PEFT LoRA on attention projections when possible
    for p in unet.parameters():
        p.requires_grad_(False)

    try:
        from peft import LoraConfig
        from peft.utils import get_peft_model_state_dict

        # Full module paths of Linear attn projections only (leaf names like "0"
        # would incorrectly match Conv2d inside Sequential).
        target: list[str] = []
        for name, mod in unet.named_modules():
            if not isinstance(mod, torch.nn.Linear):
                continue
            if any(k in name for k in ("to_q", "to_k", "to_v", "to_out", "qkv")):
                target.append(name)
        if not target:
            # broader Linear scan under attention-like parents
            for name, mod in unet.named_modules():
                if isinstance(mod, torch.nn.Linear) and (
                    "attn" in name or "attention" in name
                ):
                    target.append(name)
        if not target:
            raise RuntimeError("No Linear attention modules found for LoRA")
        print(f"[comfy-train] LoRA targets={len(target)} sample={target[:8]}")

        lora_config = LoraConfig(
            r=args.rank,
            lora_alpha=args.rank,
            init_lora_weights="gaussian",
            target_modules=target,
        )
        # peft get_peft_model needs nn.Module; diffusion_model is nn.Module
        from peft import get_peft_model

        unet = get_peft_model(unet, lora_config)
        unet.print_trainable_parameters()
        use_peft = True
    except Exception as exc:  # noqa: BLE001
        print(f"[comfy-train] peft attach failed ({exc}); falling back to last N layers finetune")
        use_peft = False
        # Unfreeze last few parameters as weak fallback (not ideal LoRA)
        params = list(unet.named_parameters())
        for name, p in params[-40:]:
            p.requires_grad_(True)

    trainable = [p for p in unet.parameters() if p.requires_grad]
    if not trainable:
        raise SystemExit("No trainable parameters")
    print(f"[comfy-train] trainable tensors={len(trainable)} params={sum(p.numel() for p in trainable):,}")

    opt = torch.optim.AdamW(trainable, lr=args.lr, weight_decay=1e-2)
    ds = CaptionImageDataset(args.images, args.trigger, args.size)
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, num_workers=0)

    # VAE encode helper via Comfy
    vae.first_stage_model.to(device)
    clip.cond_stage_model.to(device)

    step = 0
    print(f"[comfy-train] dataset={len(ds)} starting")
    while step < args.steps:
        for batch in dl:
            if step >= args.steps:
                break
            pixels = batch["pixel_values"].to(device)
            captions: list[str] = list(batch["caption"])

            with torch.no_grad():
                # pixels are NCHW -1..1 ; Comfy VAE expects NHWC sometimes — convert
                # comfy.sd VAE encode: use vae.encode
                x = pixels
                # many Comfy VAEs expect B,H,W,C in 0..1
                x_nhwc = x.permute(0, 2, 3, 1)
                x_nhwc = (x_nhwc + 1.0) / 2.0
                latents = vae.encode(x_nhwc)
                if isinstance(latents, dict):
                    latents = latents.get("samples", latents)
                if isinstance(latents, (list, tuple)):
                    latents = latents[0]
                latents = latents.to(device=device, dtype=unet_dtype)
                noise = torch.randn_like(latents, device=device, dtype=unet_dtype)
                # classic DDPM-ish continuous mix
                t = torch.rand(latents.shape[0], device=device)
                sigma = t.view(-1, 1, 1, 1).to(dtype=unet_dtype)
                noisy = ((1 - sigma) * latents + sigma * noise).to(
                    device=device, dtype=unet_dtype
                )
                # CLIP encode (Comfy tokenize expects one string at a time)
                cond_chunks = []
                for cap in captions:
                    tokens = clip.tokenize(cap)
                    cond = clip.encode_from_tokens(tokens, return_pooled=True)
                    if isinstance(cond, tuple):
                        cond_out, _pooled = cond
                    else:
                        cond_out = cond
                    if isinstance(cond_out, (list, tuple)):
                        cond_out = cond_out[0]
                    cond_chunks.append(cond_out)
                # stack batch if possible
                if all(torch.is_tensor(c) for c in cond_chunks):
                    cond_out = torch.cat(
                        [
                            (
                                c.to(device=device, dtype=unet_dtype)
                                if c.dim() == 3
                                else c.unsqueeze(0).to(device=device, dtype=unet_dtype)
                            )
                            for c in cond_chunks
                        ],
                        dim=0,
                    )
                else:
                    cond_out = cond_chunks[0]
                    if torch.is_tensor(cond_out):
                        cond_out = cond_out.to(device=device, dtype=unet_dtype)

            # UNet forward — positional (x, t, context) works when dtypes match
            t_embed = (t * 999).long().clamp(0, 999).to(device)
            try:
                pred = unet(noisy, t_embed, cond_out)
            except Exception:
                pred = unet(noisy, t_embed, context=cond_out)

            if isinstance(pred, tuple):
                pred = pred[0]
            loss = torch.nn.functional.mse_loss(pred.float(), noise.float())
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            opt.step()

            step += 1
            if step % 25 == 0 or step == 1:
                print(f"[comfy-train] step {step}/{args.steps} loss={loss.item():.4f}")

            if args.save_every > 0 and step % args.save_every == 0:
                mid = args.out.with_name(f"{args.out.stem}-step{step}{args.out.suffix}")
                save_lora(unet, mid, use_peft=use_peft)
                print(f"[comfy-train] saved {mid}")

    save_lora(unet, args.out, use_peft=use_peft)
    print(f"[comfy-train] DONE -> {args.out}")
    return 0


def save_lora(unet, path: Path, use_peft: bool) -> None:
    from safetensors.torch import save_file

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {}
    if use_peft:
        try:
            from peft.utils import get_peft_model_state_dict

            raw = get_peft_model_state_dict(unet)
            for k, v in raw.items():
                # Comfy / kohya-ish prefix
                nk = k.replace("base_model.model.", "").replace(".", "_")
                state[f"lora_unet_{nk}"] = v.detach().cpu().contiguous()
        except Exception as exc:  # noqa: BLE001
            print(f"[comfy-train] peft state export failed: {exc}")
    if not state:
        # dump all trainable as fallback
        for n, p in unet.named_parameters():
            if p.requires_grad:
                state[n.replace(".", "_")] = p.detach().cpu().contiguous()
    save_file(state, str(path))
    print(f"[comfy-train] wrote {path} ({path.stat().st_size} bytes, {len(state)} tensors)")


if __name__ == "__main__":
    raise SystemExit(main())
