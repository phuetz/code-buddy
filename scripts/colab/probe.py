"""GPU compute canary. No local environment or credentials required."""
import json
import os
import subprocess
from pathlib import Path
import torch

smi = subprocess.check_output(["nvidia-smi"], text=True)
print(smi)
assert torch.cuda.is_available(), "CUDA unavailable"
torch.manual_seed(20261003)
a = torch.randn((1024, 1024), device="cuda", dtype=torch.bfloat16)
b = torch.randn((1024, 1024), device="cuda", dtype=torch.bfloat16)
result = a @ b
torch.cuda.synchronize()
assert result.shape == (1024, 1024) and torch.isfinite(result).all()
report = {"gpu": torch.cuda.get_device_name(0), "torch": torch.__version__,
          "shape": list(result.shape), "dtype": str(result.dtype),
          "finite": bool(torch.isfinite(result).all()), "nvidia_smi": smi}
Path(os.environ["CODEBUDDY_COLAB_OUTPUT_DIR"], "gpu.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
