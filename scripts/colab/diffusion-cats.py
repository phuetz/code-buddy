"""Four 256×256 cat assets from Google's Apache-2.0 DDPM (~114M params).

Model card: https://huggingface.co/google/ddpm-cat-256
Install: diffusers==0.35.1 accelerate==1.10.1 transformers==4.57.1
"""
import json
import os
import time
from pathlib import Path
import torch
from diffusers import DDIMPipeline

model = "google/ddpm-cat-256"
revision = "82ca0d5db4a5ec6ff0e9be8d86852490bc18a3d9"
out = Path(os.environ["CODEBUDDY_COLAB_OUTPUT_DIR"])
start = time.monotonic()
pipe = DDIMPipeline.from_pretrained(model, revision=revision, torch_dtype=torch.float16).to("cuda")
pipe.set_progress_bar_config(disable=True)
images = pipe(batch_size=4, num_inference_steps=100,
              generator=torch.Generator(device="cuda").manual_seed(20261003)).images
for i, image in enumerate(images):
    assert image.size == (256, 256)
    image.save(out / f"cat-{i+1}.png")
report = {"model": model, "revision": revision, "license": "apache-2.0",
          "gpu": torch.cuda.get_device_name(0), "images": len(images),
          "steps": 100, "seconds": time.monotonic()-start}
(out / "generation.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
