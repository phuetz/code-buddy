#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="$(basename "$0")"
AUDIT_LOG="/tmp/darkstar-audit-$(date +%Y%m%d-%H%M%S).log"

on_error() {
  local exit_code="${1:-1}"
  local line_no="${2:-unknown}"
  echo "[ERROR] ${SCRIPT_NAME} failed at line ${line_no} with exit code ${exit_code}." >&2
  echo "[ERROR] See ${AUDIT_LOG} for phase 0 audit output." >&2
  exit "${exit_code}"
}
trap 'on_error $? $LINENO' ERR

log() {
  printf '[INFO] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*" >&2
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

audit_log() {
  printf '%s\n' "$*" | tee -a "${AUDIT_LOG}"
}

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || die "Required command not found: ${cmd}"
}

confirm_sudo_block() {
  local prompt="$1"
  if [[ ! -t 0 ]]; then
    die "Interactive confirmation required for sudo block, but stdin is not a TTY."
  fi
  read -r -p "${prompt} [y/N] " reply
  case "${reply}" in
    y|Y|yes|YES) ;;
    *) die "User declined sudo block." ;;
  esac
}

run_with_audit() {
  local title="$1"
  shift
  audit_log
  audit_log "===== ${title} ====="
  if "$@" >>"${AUDIT_LOG}" 2>&1; then
    :
  else
    local rc=$?
    audit_log "[ERROR] Command failed (${rc}): $*"
    return "${rc}"
  fi
}

is_ubuntu_supported() {
  [[ -r /etc/os-release ]] || return 1
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || return 1
  [[ "${VERSION_ID:-}" == "22.04" || "${VERSION_ID:-}" == "24.04" ]]
}

pkg_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"
}

install_apt_packages_if_needed() {
  local missing=()
  local pkg
  for pkg in "$@"; do
    if pkg_installed "${pkg}"; then
      log "APT package already present: ${pkg}"
    else
      missing+=("${pkg}")
    fi
  done

  if [[ "${#missing[@]}" -eq 0 ]]; then
    log "APT package set already satisfied."
    return 0
  fi

  log "Missing APT packages: ${missing[*]}"
  confirm_sudo_block "Run sudo apt-get update && sudo apt-get install -y ${missing[*]}?"
  sudo apt-get update
  sudo apt-get install -y "${missing[@]}"
}

node_major_version() {
  if command -v node >/dev/null 2>&1; then
    node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true
  fi
}

phase_0_audit() {
  log "Phase 0: starting hardware/CUDA/disk/RAM/world-model/venv audit"
  : > "${AUDIT_LOG}"
  audit_log "Darkstar phase 0 audit"
  audit_log "Timestamp: $(date --iso-8601=seconds)"
  audit_log "Host: $(hostname 2>/dev/null || echo unknown)"
  audit_log "User: ${USER:-unknown}"
  audit_log "PWD: $(pwd)"

  run_with_audit "OS release" cat /etc/os-release
  run_with_audit "Kernel" uname -a
  run_with_audit "Disk usage" df -h
  if command -v lsblk >/dev/null 2>&1; then
    run_with_audit "Block devices" lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE
  else
    audit_log "===== Block devices ====="
    audit_log "lsblk not available"
  fi

  if command -v free >/dev/null 2>&1; then
    run_with_audit "RAM" free -h
  else
    audit_log "===== RAM ====="
    grep -E 'MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree' /proc/meminfo >>"${AUDIT_LOG}" 2>&1 || true
  fi

  if command -v lscpu >/dev/null 2>&1; then
    run_with_audit "CPU" lscpu
  else
    audit_log "===== CPU ====="
    audit_log "lscpu not available"
  fi

  audit_log
  audit_log "===== GPU / CUDA ====="
  if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi >>"${AUDIT_LOG}" 2>&1 || true
  else
    audit_log "nvidia-smi not available"
  fi
  if command -v nvcc >/dev/null 2>&1; then
    nvcc --version >>"${AUDIT_LOG}" 2>&1 || true
  else
    audit_log "nvcc not available"
  fi
  if command -v lspci >/dev/null 2>&1; then
    lspci | grep -iE 'vga|3d|nvidia' >>"${AUDIT_LOG}" 2>&1 || true
  else
    audit_log "lspci not available"
  fi
  dpkg-query -W '*cuda*' '*nvidia*' >>"${AUDIT_LOG}" 2>&1 || true

  audit_log
  audit_log "===== Python / venv / world-model ====="
  if command -v python3 >/dev/null 2>&1; then
    python3 --version >>"${AUDIT_LOG}" 2>&1 || true
  else
    audit_log "python3 not available"
  fi
  if command -v pip3 >/dev/null 2>&1; then
    pip3 --version >>"${AUDIT_LOG}" 2>&1 || true
  else
    audit_log "pip3 not available"
  fi
  audit_log "VIRTUAL_ENV=${VIRTUAL_ENV:-<unset>}"

  {
    echo "--- world-model directories (cwd + HOME, maxdepth 4) ---"
    find "$(pwd)" "${HOME}" -maxdepth 4 -type d \( -name 'world-model' -o -name 'world_model' -o -name 'world-model*' -o -name 'world_model*' \) 2>/dev/null | sort -u || true
    echo "--- virtualenv markers (cwd + HOME, maxdepth 4) ---"
    find "$(pwd)" "${HOME}" -maxdepth 4 \( -name pyvenv.cfg -o -path '*/bin/activate' \) 2>/dev/null | sort -u || true
  } >>"${AUDIT_LOG}" 2>&1

  log "Phase 0 complete. Audit written to ${AUDIT_LOG}"
}

phase_1_install_tailscale() {
  log "Phase 1: checking Tailscale"
  require_cmd curl

  if command -v tailscale >/dev/null 2>&1; then
    log "Tailscale already installed: $(tailscale version 2>/dev/null | head -n 1 || echo present)"
    return 0
  fi

  log "Tailscale missing; official install script will be used."
  confirm_sudo_block "Run official Tailscale installer with sudo?"
  curl -fsSL https://tailscale.com/install.sh | sudo bash
  command -v tailscale >/dev/null 2>&1 || die "Tailscale install completed but 'tailscale' command is still missing."
  log "Tailscale installed successfully."
}

phase_2_install_system_tools() {
  log "Phase 2: checking system tools"
  require_cmd dpkg-query
  require_cmd apt-get
  require_cmd curl

  install_apt_packages_if_needed git ffmpeg build-essential

  if command -v uv >/dev/null 2>&1; then
    log "uv already installed: $(uv --version 2>/dev/null || echo present)"
  else
    log "uv missing; installing with official Astral script."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="${HOME}/.local/bin:${PATH}"
    command -v uv >/dev/null 2>&1 || die "uv install completed but 'uv' command is still missing from PATH."
    log "uv installed successfully."
  fi

  local current_node_major
  current_node_major="$(node_major_version || true)"
  if [[ "${current_node_major:-}" == "22" ]]; then
    log "Node.js 22 already installed: $(node --version 2>/dev/null || echo present)"
  else
    if [[ -n "${current_node_major:-}" ]]; then
      warn "Node.js present but not version 22 (found major ${current_node_major}). Will upgrade to Node.js 22."
    else
      log "Node.js missing; will install Node.js 22."
    fi
    confirm_sudo_block "Configure NodeSource 22.x and install nodejs with sudo?"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    [[ "$(node_major_version || true)" == "22" ]] || die "Node.js installation finished but version 22 is not active."
    log "Node.js 22 installed successfully."
  fi

  if command -v pnpm >/dev/null 2>&1; then
    log "pnpm already installed: $(pnpm --version 2>/dev/null || echo present)"
  else
    command -v npm >/dev/null 2>&1 || die "npm is required to install pnpm, but it is not available."
    confirm_sudo_block "Install pnpm globally with npm?"
    sudo npm install -g pnpm
    command -v pnpm >/dev/null 2>&1 || die "pnpm installation finished but 'pnpm' command is still missing."
    log "pnpm installed successfully."
  fi

  log "Phase 2 complete."
}

main() {
  is_ubuntu_supported || die "Unsupported OS. This script supports Ubuntu 22.04 and 24.04 only."
  phase_0_audit
  phase_1_install_tailscale
  phase_2_install_system_tools
  log "All requested phases completed successfully."
}

main "$@"
