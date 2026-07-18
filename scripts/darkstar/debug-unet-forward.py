import os
import sys
from pathlib import Path

import torch
from PIL import Image
from torchvision import transforms

os.chdir(r"D:\DEV\ComfyUI")
sys.path.insert(0, r"D:\DEV\ComfyUI")

import comfy.model_management as mm
import comfy.sd as comfy_sd

device = mm.get_torch_device()
print("device", device)
mp, clip, vae, _ = comfy_sd.load_checkpoint_guess_config(
    r"D:\DEV\ComfyUI\models\checkpoints\sd_turbo.safetensors",
    output_vae=True,
    output_clip=True,
)
unet = mp.model.diffusion_model.to(device)
print("unet", type(unet))

img = Image.open(r"D:\DEV\lisa-lora\images\lisa_001.png").convert("RGB")
tf = transforms.Compose(
    [
        transforms.Resize(512),
        transforms.CenterCrop(512),
        transforms.ToTensor(),
        transforms.Normalize([0.5], [0.5]),
    ]
)
px = tf(img).unsqueeze(0).to(device)
x = (px.permute(0, 2, 3, 1) + 1) / 2
lat = vae.encode(x)
print("lat", type(lat), getattr(lat, "shape", None), getattr(lat, "device", None))
if not torch.is_tensor(lat):
    print("lat repr", lat)
    raise SystemExit(1)
lat = lat.to(device)
tokens = clip.tokenize("ohwx lisa portrait")
cond = clip.encode_from_tokens(tokens, return_pooled=True)
print("cond type", type(cond))
if isinstance(cond, tuple):
    print("len", len(cond), [type(x) for x in cond])
    c = cond[0]
else:
    c = cond
if isinstance(c, (list, tuple)):
    print("c list", len(c), type(c[0]), getattr(c[0], "shape", None))
    c = c[0]
print("c", c.shape if torch.is_tensor(c) else type(c))
c = c.to(device)
t = torch.tensor([500], device=device)
noise = torch.randn_like(lat)
noisy = 0.5 * lat + 0.5 * noise
print("noisy", noisy.shape, "t", t.shape, "c", c.shape)
for label, fn in [
    ("positional", lambda: unet(noisy, t, c)),
    ("context kw", lambda: unet(noisy, t, context=c)),
    ("apply_model", lambda: mp.model.apply_model(noisy, t.float(), c)),
]:
    try:
        y = fn()
        print(label, "OK", type(y), getattr(y, "shape", None))
    except Exception as e:
        print(label, "FAIL", type(e).__name__, e)
