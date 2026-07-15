#!/usr/bin/env bash
set -euo pipefail

# Download only the files required by LongCat-Video-Avatar 1.5 INT8 inference.
# The official snapshots contain duplicate FP16/FP32/Flax/PyTorch weights and are
# roughly three times larger. Large LFS files are accepted only after an exact
# byte-size and SHA-256 check against the pinned Hugging Face revisions below.

AVATAR_REPO='meituan-longcat/LongCat-Video-Avatar-1.5'
AVATAR_REV='92016c71d5d318d0f5d84e4db30015a571484ab6'
BASE_REPO='meituan-longcat/LongCat-Video'
BASE_REV='03b55529b1d1d4045f5fbe14d65c8c6e8116b278'
WEIGHTS_ROOT="${CODEBUDDY_LONGCAT_WEIGHTS_ROOT:-/mnt/d/DEV/LongCat-Video/weights}"
AVATAR_DIR="$WEIGHTS_ROOT/LongCat-Video-Avatar-1.5"
BASE_DIR="$WEIGHTS_ROOT/LongCat-Video"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command is unavailable: $1" >&2
    exit 2
  }
}

require_command curl
require_command sha256sum
require_command stat

download_file() {
  local repo="$1"
  local revision="$2"
  local relative_path="$3"
  local expected_size="$4"
  local expected_sha256="$5"
  local destination_root="$6"
  local destination="$destination_root/$relative_path"
  local partial="$destination.partial"
  local actual_size
  local actual_sha256

  mkdir -p "$(dirname -- "$destination")"
  if [[ -f "$destination" ]]; then
    actual_size="$(stat -c '%s' "$destination")"
    if [[ "$actual_size" == "$expected_size" ]]; then
      if [[ "$expected_sha256" == '-' ]]; then
        echo "already present: $relative_path"
        return
      fi
      actual_sha256="$(sha256sum "$destination" | cut -d' ' -f1)"
      if [[ "$actual_sha256" == "$expected_sha256" ]]; then
        echo "already verified: $relative_path"
        return
      fi
    fi
    echo "Removing invalid completed file: $relative_path" >&2
    rm -f -- "$destination"
  fi

  echo "downloading: $relative_path"
  curl --fail --location --retry 8 --retry-all-errors --continue-at - \
    --output "$partial" \
    "https://huggingface.co/$repo/resolve/$revision/$relative_path"

  actual_size="$(stat -c '%s' "$partial")"
  if [[ "$actual_size" != "$expected_size" ]]; then
    echo "Size mismatch for $relative_path: expected $expected_size, got $actual_size" >&2
    exit 3
  fi
  if [[ "$expected_sha256" != '-' ]]; then
    actual_sha256="$(sha256sum "$partial" | cut -d' ' -f1)"
    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
      echo "SHA-256 mismatch for $relative_path" >&2
      exit 4
    fi
  fi
  mv -- "$partial" "$destination"
}

avatar() {
  download_file "$AVATAR_REPO" "$AVATAR_REV" "$1" "$2" "$3" "$AVATAR_DIR"
}

base() {
  download_file "$BASE_REPO" "$BASE_REV" "$1" "$2" "$3" "$BASE_DIR"
}

MAX_PARALLEL_DOWNLOADS="${CODEBUDDY_LONGCAT_DOWNLOAD_CONCURRENCY:-3}"
if [[ ! "$MAX_PARALLEL_DOWNLOADS" =~ ^[1-4]$ ]]; then
  echo 'CODEBUDDY_LONGCAT_DOWNLOAD_CONCURRENCY must be between 1 and 4' >&2
  exit 2
fi
pending_downloads=()

wait_downloads() {
  local status=0
  local pid
  for pid in "${pending_downloads[@]}"; do
    if ! wait "$pid"; then
      status=1
    fi
  done
  pending_downloads=()
  return "$status"
}

queue_download() {
  local source="$1"
  shift
  "$source" "$@" &
  pending_downloads+=("$!")
  if (( ${#pending_downloads[@]} >= MAX_PARALLEL_DOWNLOADS )); then
    wait_downloads
  fi
}

# Avatar INT8 DiT, distilled LoRA and scheduler.
avatar base_model_int8/config.json 853 -
avatar base_model_int8/quantization_config.json 193 -
queue_download avatar base_model_int8/quantized_model-00001-of-00004.safetensors 4264635792 ccf575d8cdf8e762272e2d4e52ae1a7c0b5d1fa81e26dfa4592867de4dd9a4fd
queue_download avatar base_model_int8/quantized_model-00002-of-00004.safetensors 4275232472 af6ddb737ad66d12fd5892adee568c14314143ebd4388d3ab9cc6065754b3688
queue_download avatar base_model_int8/quantized_model-00003-of-00004.safetensors 4275232472 6a349b76592b4752c2967235af457824d8938e3514bad8e78cfa86009e8a9bf5
queue_download avatar base_model_int8/quantized_model-00004-of-00004.safetensors 3065282200 ab54b648a3f6a53946f07dd0a21441e2a8cb1aa8da17996b5f3f7f2e1370705b
avatar base_model_int8/quantized_model.safetensors.index.json 201884 -
queue_download avatar lora/dmd_lora.safetensors 2523077984 d969115a7f3fbc212a277ed4399f77a1a065d170148c6d4bc272e980cd3e907a
avatar scheduler/scheduler_config.json 213 -

# Whisper: safetensors only. Deliberately omit the duplicate .bin, FP32 and Flax files.
avatar whisper-large-v3/added_tokens.json 34648 -
avatar whisper-large-v3/config.json 1272 -
avatar whisper-large-v3/generation_config.json 3903 -
avatar whisper-large-v3/merges.txt 493869 -
queue_download avatar whisper-large-v3/model.safetensors 3087130976 a8e94b85976e5864ba3e9525c7e6c83b2a1eca42d4b797a0c7c24d778e40fd95
avatar whisper-large-v3/normalizer.json 52666 -
avatar whisper-large-v3/preprocessor_config.json 340 -
avatar whisper-large-v3/special_tokens_map.json 2072 -
avatar whisper-large-v3/tokenizer.json 2480617 -
avatar whisper-large-v3/tokenizer_config.json 282843 -
avatar whisper-large-v3/vocab.json 1036558 -
wait_downloads

# Foundation tokenizer, UMT5 encoder and VAE. Deliberately omit the base video DiT.
base tokenizer/special_tokens_map.json 7079 -
base tokenizer/spiece.model 4548313 e3909a67b780650b35cf529ac782ad2b6b26e6d1f849d3fbb6a872905f452458
base tokenizer/tokenizer.json 16837459 20a46ac256746594ed7e1e3ef733b83fbc5a6f0922aa7480eda961743de080ef
base tokenizer/tokenizer_config.json 61758 -
base text_encoder/config.json 854 -
queue_download base text_encoder/model-00001-of-00005.safetensors 4972389712 c0ef3a140898e228a3520c9adec60743d2e8e5b3d229651bb37f1a3921919f99
queue_download base text_encoder/model-00002-of-00005.safetensors 4899225672 481c7b2b39771c44df6dd8d13ee12ed072d731b4a650bd092885d4d52db229ad
queue_download base text_encoder/model-00003-of-00005.safetensors 4966309504 f93148bcc04052a169e1e49bfcf6125df6cf9bf243cb9c627da75266cf8e35c3
queue_download base text_encoder/model-00004-of-00005.safetensors 4999880704 a451792c739c05bca4606190cc2dd16731411bac03b4cf6aacc5767321f857c9
queue_download base text_encoder/model-00005-of-00005.safetensors 2885866152 7e76e18d224531b8197a46231cb53daf7f2f6ca707130252becf933026ac4eea
base text_encoder/model.safetensors.index.json 22476 -
base vae/config.json 724 -
queue_download base vae/diffusion_pytorch_model.safetensors 507591892 d6e524b3fffede1787a74e81b30976dce5400c4439ba64222168e607ed19e793
wait_downloads

READY_MANIFEST="$WEIGHTS_ROOT/codebuddy-longcat-avatar-1.5.json"
READY_TEMP="$READY_MANIFEST.tmp-$$"
printf '%s\n' \
  "{\"avatarRevision\":\"$AVATAR_REV\",\"baseRevision\":\"$BASE_REV\",\"selectedBytes\":44747926126}" \
  > "$READY_TEMP"
mv -- "$READY_TEMP" "$READY_MANIFEST"
echo "LongCat Avatar 1.5 selective checkpoint set is complete in $WEIGHTS_ROOT"
