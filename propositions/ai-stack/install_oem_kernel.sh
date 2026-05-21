#!/usr/bin/env bash
# install_oem_kernel.sh
#
# Install Ubuntu's linux-oem-24.04 kernel ALONGSIDE the existing HWE
# kernel. Doesn't remove anything — both kernels stay bootable from
# GRUB so a regression can be rolled back at the next reboot.
#
# Why : Gemini recommended the OEM lineage on 2026-05-09 to debloat
# the gfx1150 (Strix Point / Radeon 890M) HSA bug currently blocking
# ROCm path in Ollama and Lemonade Server (cf. /home/patrice/DEV/
# CLAUDE.md TODO #1 + #2). OEM kernels carry AMD patches that hit
# HWE only weeks/months later.
#
# Realistic expectation :
#   ✅ Pourrait débloquer HSA gfx1150 (clinfo crash, rocBLAS timeout)
#   ✅ Pourrait débloquer Lemonade NPU/FLM
#   ❌ NE va PAS accélérer Vulkan dense models — tu es memory-bound
#      DDR5 ~90 GB/s, plafond physique APU.
#
# Run with sudo. Idempotent.

set -euo pipefail

PKG="linux-oem-24.04"
LOG_DIR="/var/log/codebuddy-fleet"
mkdir -p "${LOG_DIR}" 2>/dev/null || true
SNAPSHOT="${LOG_DIR}/kernel-snapshot-$(date +%Y%m%d-%H%M%S).txt"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must run as root (sudo)" >&2
  exit 1
fi

echo "=== install_oem_kernel.sh — $(date -Iseconds) ==="
echo

echo "→ Capturing current kernel state to ${SNAPSHOT}"
{
  echo "=== Pre-install snapshot ==="
  echo "uname -r:"; uname -r
  echo
  echo "Installed linux-* packages:"
  dpkg -l | grep -E '^ii.*linux-(image|generic|hwe|oem|headers)' || true
  echo
  echo "GRUB default:"
  grep -E 'GRUB_DEFAULT|GRUB_TIMEOUT' /etc/default/grub || true
  echo
  echo "ROCm HSA quick check (clinfo):"
  timeout 5 clinfo --raw 2>&1 | head -5 || echo "(clinfo absent or crashed — known)"
} > "${SNAPSHOT}"

# ─── Verify the package is available before doing anything ────────────────
echo "→ Checking package availability"
if ! apt-cache show "${PKG}" 2>/dev/null | grep -q '^Package:'; then
  echo "ERROR: ${PKG} not found in apt cache. Run 'sudo apt update' first."
  exit 1
fi

CANDIDATE=$(apt-cache policy "${PKG}" | awk '/Candidate:/ {print $2}')
INSTALLED=$(apt-cache policy "${PKG}" | awk '/Installed:/ {print $2}')

echo "  Package    : ${PKG}"
echo "  Installed  : ${INSTALLED}"
echo "  Candidate  : ${CANDIDATE}"
echo

if [[ "${INSTALLED}" != "(none)" && "${INSTALLED}" == "${CANDIDATE}" ]]; then
  echo "✅ ${PKG} ${CANDIDATE} already installed at the latest version."
  echo
  echo "Boot kernel: $(uname -r)"
  echo
  echo "If you've already rebooted into OEM, validate with:"
  echo "  uname -r          # should be a -oem build"
  echo "  clinfo --raw      # ROCm HSA bug status"
  echo "  ollama run qwen3:4b 'test'  # quick perf check"
  exit 0
fi

# ─── Install — apt will pull in image + headers + dkms automatically ──────
echo "→ apt update"
apt update -qq

echo "→ Installing ${PKG} (this also pulls headers + dkms modules)"
echo "  Existing HWE kernel STAYS installed — both cohabit in GRUB."
DEBIAN_FRONTEND=noninteractive apt install -y "${PKG}"

echo "→ update-grub (so the new kernel appears in the boot menu)"
update-grub

# ─── Post-install snapshot ─────────────────────────────────────────────────
echo
echo "=== Post-install snapshot ==="
{
  echo
  echo "=== Post-install snapshot ==="
  echo "Installed linux-* packages:"
  dpkg -l | grep -E '^ii.*linux-(image|generic|hwe|oem|headers)' || true
  echo
  echo "Latest installed kernels visible to GRUB:"
  ls -la /boot/vmlinuz-* 2>/dev/null | tail -10
} >> "${SNAPSHOT}"

echo
echo "─── Kernels available after install ───"
ls /boot/vmlinuz-* 2>/dev/null | sed 's|/boot/vmlinuz-|  • |'

echo
echo "============================================================"
echo "  REBOOT REQUIRED"
echo "============================================================"
echo
echo "  Current running kernel : $(uname -r)"
echo "  After reboot, default  : the most-recent kernel installed"
echo
echo "  Reboot:    sudo reboot"
echo
echo "  After reboot, validate:"
echo "    uname -r           # should be a *-oem build"
echo "    clinfo --raw       # is the gfx1150 HSA bug fixed ?"
echo "    rocminfo | head    # ROCm sees gfx1150 ?"
echo "    sudo systemctl status codebuddy-fleet"
echo "    curl http://localhost:3001/api/health"
echo
echo "  If you regret it, boot from GRUB → 'Advanced options for"
echo "  Ubuntu' → pick the HWE kernel ($(uname -r)). Then to fully"
echo "  remove OEM:"
echo "    sudo apt purge ${PKG}"
echo "    sudo apt autoremove"
echo "    sudo update-grub"
echo
echo "  Snapshot saved: ${SNAPSHOT}"
