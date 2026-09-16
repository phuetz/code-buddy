$ErrorActionPreference = 'Stop'

$runtime = 'D:\DEV\Krea2TrainerRuntime'
$python = Join-Path $runtime 'venv\Scripts\python.exe'
$toolkit = Join-Path $runtime 'ai-toolkit'

if (-not (Test-Path $python)) { throw "Missing trainer Python: $python" }
if (-not (Test-Path $toolkit)) { throw "Missing ai-toolkit: $toolkit" }

$env:PYTHONUTF8 = '0'
$env:PYTHONIOENCODING = 'utf-8'

# ai-toolkit's current Krea implementation needs the newer SDPA API
# (`sdpa_kernel(set_priority=...)`). The trainer's original torch 2.5.1 pin
# predates it, so keep the upgrade isolated to the dedicated trainer venv.
& $python -m pip install --disable-pip-version-check --upgrade `
  'torch==2.8.0' `
  'torchvision==0.23.0' `
  'torchaudio==2.8.0' `
  --index-url 'https://download.pytorch.org/whl/cu128'
if ($LASTEXITCODE -ne 0) { throw "PyTorch upgrade failed: $LASTEXITCODE" }

$env:PYTHONPATH = $toolkit
$validation = @'
import inspect
import torch
import torchvision
from torch.nn.attention import sdpa_kernel
from toolkit.util.convrot_quant import _int8_act_quant_op, _nvfp4_act_quant_op

assert torch.cuda.is_available(), "CUDA is not available"
assert "set_priority" in inspect.signature(sdpa_kernel).parameters
print(f"torch={torch.__version__}")
print(f"torchvision={torchvision.__version__}")
print(f"cuda_runtime={torch.version.cuda}")
print(f"gpu={torch.cuda.get_device_name(0)}")
print("Krea trainer compatibility: OK")
'@
& $python -c $validation
if ($LASTEXITCODE -ne 0) { throw "Trainer validation failed: $LASTEXITCODE" }
