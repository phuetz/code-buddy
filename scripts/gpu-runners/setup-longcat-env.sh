#!/usr/bin/env bash
set -euo pipefail

ENV_DIR="${CODEBUDDY_LONGCAT_ENV:-$HOME/.conda-envs/longcat-video}"
CONDA_BIN="${CONDA_EXE:-}"
if [[ -z "$CONDA_BIN" ]]; then
  for candidate in "$HOME/miniconda3/bin/conda" "$HOME/anaconda3/bin/conda" /opt/conda/bin/conda; do
    if [[ -x "$candidate" ]]; then
      CONDA_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$CONDA_BIN" || ! -x "$CONDA_BIN" ]]; then
  echo 'A user-local Conda installation is required.' >&2
  exit 2
fi

if [[ ! -x "$ENV_DIR/bin/python" ]]; then
  "$CONDA_BIN" create --yes --prefix "$ENV_DIR" python=3.10 pip ffmpeg libsndfile
fi

# TorchInductor/Triton builds a tiny CUDA driver extension on first use. Keep
# the compiler inside the isolated environment instead of depending on WSL's
# system packages, which are absent on a clean GPU node installation.
"$CONDA_BIN" install --yes --prefix "$ENV_DIR" \
  'gcc_linux-64=11.2.0' \
  'gxx_linux-64=11.2.0'

PYTHON="$ENV_DIR/bin/python"
PIP=("$PYTHON" -m pip)
export CC="$ENV_DIR/bin/x86_64-conda-linux-gnu-cc"
export CXX="$ENV_DIR/bin/x86_64-conda-linux-gnu-c++"
"${PIP[@]}" install --upgrade 'pip==25.1.1' 'setuptools==80.9.0' 'wheel==0.45.1'
"${PIP[@]}" install \
  'torch==2.6.0' 'torchvision==0.21.0' 'torchaudio==2.6.0' \
  --index-url https://download.pytorch.org/whl/cu124
"${PIP[@]}" install \
  'accelerate==1.7.0' \
  'av==12.0.0' \
  'diffusers==0.35.1' \
  'einops==0.8.0' \
  'ftfy==6.2.0' \
  'imageio==2.37.0' \
  'imageio-ffmpeg==0.6.0' \
  'librosa==0.11.0' \
  'loguru==0.7.2' \
  'numpy==1.26.4' \
  'opencv-python-headless==4.9.0.80' \
  'pillow==11.2.1' \
  'psutil==6.0.0' \
  'pyloudnorm==0.1.1' \
  'safetensors==0.5.3' \
  'scipy==1.15.3' \
  'soundfile==0.13.1' \
  'soxr==0.5.0.post1' \
  'sympy==1.13.1' \
  'torchao==0.10.0' \
  'transformers==4.41.0'

# Use the publisher's prebuilt CUDA 12 / PyTorch 2.6 / CPython 3.10 wheel.
# This avoids an hours-long local CUDA build and fixes the artifact version.
"${PIP[@]}" install \
  'https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/flash_attn-2.7.4.post1%2Bcu12torch2.6cxx11abiFALSE-cp310-cp310-linux_x86_64.whl#sha256=ffe17686fa1a0f288de9eae7c32af209d32a27b037ef28614f042b377af5b15a'

"$PYTHON" - <<'PY'
import torch
import flash_attn
import os
import pyloudnorm
import transformers
from diffusers import __version__ as diffusers_version
from torchao.quantization import int8_weight_only, quantize_

assert torch.__version__.startswith('2.6.0+cu124'), torch.__version__
assert torch.cuda.is_available(), 'CUDA is unavailable inside the LongCat environment'
assert torch.cuda.get_device_capability(0) == (8, 6), torch.cuda.get_device_capability(0)
assert os.path.isfile(os.environ['CC']), os.environ['CC']
assert os.path.isfile(os.environ['CXX']), os.environ['CXX']
linear = torch.nn.Linear(64, 64, bias=False, dtype=torch.bfloat16)
quantize_(linear, int8_weight_only())
linear = linear.cuda()
result = linear(torch.ones(1, 64, device='cuda', dtype=torch.bfloat16))
assert result.shape == (1, 64)
print({
    'torch': torch.__version__,
    'flash_attn': flash_attn.__version__,
    'transformers': transformers.__version__,
    'diffusers': diffusers_version,
    'gpu': torch.cuda.get_device_name(0),
})
PY

"${PIP[@]}" freeze > "$ENV_DIR/codebuddy-lock.txt"
echo "LongCat environment is ready: $ENV_DIR"
