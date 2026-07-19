#!/usr/bin/env bash
set -euo pipefail

ENV_DIR="${CODEBUDDY_LONGCAT_ENV:-$HOME/.conda-envs/longcat-video}"
REPO_DIR="${CODEBUDDY_LONGCAT_REPO:-$HOME/.local/share/codebuddy/LongCat-Video}"
WEIGHTS_ROOT="${CODEBUDDY_LONGCAT_WEIGHTS_ROOT:-/mnt/d/DEV/LongCat-Video/weights}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

export PATH="$ENV_DIR/bin:$PATH"
export CC="${CC:-$ENV_DIR/bin/x86_64-conda-linux-gnu-cc}"
export CXX="${CXX:-$ENV_DIR/bin/x86_64-conda-linux-gnu-c++}"
export PYTHONPATH="$REPO_DIR"
export CODEBUDDY_LONGCAT_REPO="$REPO_DIR"
export CODEBUDDY_LONGCAT_WEIGHTS_ROOT="$WEIGHTS_ROOT"
export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
export CODEBUDDY_GPU_MAX_TEMP_C="${CODEBUDDY_GPU_MAX_TEMP_C:-88}"
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.6}"
export TORCH_EXTENSIONS_DIR="${TORCH_EXTENSIONS_DIR:-$HOME/.cache/torch_extensions/longcat-video}"
export TORCHINDUCTOR_CACHE_DIR="${TORCHINDUCTOR_CACHE_DIR:-$HOME/.cache/torch_inductor/longcat-video}"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export TOKENIZERS_PARALLELISM=false

REQUEST_PATH="${CODEBUDDY_GPU_JOB_REQUEST:-${1:-}}"
if [[ -z "$REQUEST_PATH" ]]; then
  echo 'CODEBUDDY_GPU_JOB_REQUEST or a request path argument is required' >&2
  exit 2
fi
if [[ ! -x "$ENV_DIR/bin/python" ]]; then
  echo "LongCat environment is unavailable: $ENV_DIR" >&2
  exit 3
fi
if [[ ! -x "$CC" || ! -x "$CXX" ]]; then
  echo "LongCat compiler toolchain is unavailable; rerun setup-longcat-env.sh" >&2
  exit 5
fi
if [[ ! -d "$REPO_DIR/longcat_video" ]]; then
  echo "LongCat source is unavailable: $REPO_DIR" >&2
  exit 4
fi

exec "$ENV_DIR/bin/python" "$SCRIPT_DIR/longcat-runner.py" "$REQUEST_PATH"
