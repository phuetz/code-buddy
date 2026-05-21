#!/usr/bin/env bash
# ROCm 7.2 install pour Ubuntu 24.04 (noble) — Radeon 890M / RDNA 3.5
# Source : https://rocm.docs.amd.com/projects/install-on-linux/en/latest/install/quick-start.html
# Lance avec : sudo ./install_rocm.sh   (ou via Claude Code : `! sudo ./install_rocm.sh`)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

REAL_USER="${SUDO_USER:-patrice}"
KERNEL="$(uname -r)"
echo "==> Kernel : $KERNEL  |  User : $REAL_USER"

# Sanity : kernel 6.17 est très récent, amdgpu-dkms peut ne pas compile sur >6.14
if [[ "$KERNEL" =~ ^6\.(17|18|19|20) ]]; then
  echo "!! Kernel $KERNEL est plus récent que ce que ROCm 7.2 supporte officiellement."
  echo "   Si amdgpu-dkms échoue, options :"
  echo "    - downgrader vers HWE 6.14 : sudo apt install linux-image-generic-hwe-24.04"
  echo "    - skipper amdgpu-dkms (le module amdgpu mainline du kernel suffit souvent)"
  read -rp "Continuer ? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || exit 0
fi

cd /tmp
DEB="amdgpu-install_7.2.2.70202-1_all.deb"
URL="https://repo.radeon.com/amdgpu-install/7.2.2/ubuntu/noble/$DEB"

echo "==> 1. Téléchargement amdgpu-install"
[[ -f "$DEB" ]] || wget -q --show-progress "$URL"

echo "==> 2. Installation du repo AMD"
apt-get install -y "./$DEB"

echo "==> 3. Bascule repo 7.2.2 -> 7.2.1 (workaround doc officielle)"
sed -i "s|graphics/7.2.2|graphics/7.2.1|" /etc/apt/sources.list.d/rocm.list

echo "==> 4. apt update"
apt-get update

echo "==> 5. Headers kernel"
apt-get install -y "linux-headers-$KERNEL" "linux-modules-extra-$KERNEL" || \
  echo "!! headers indisponibles pour $KERNEL — amdgpu-dkms va peut-être échouer"

echo "==> 6. amdgpu-dkms (peut prendre 5-10 min)"
apt-get install -y amdgpu-dkms || {
  echo "!! amdgpu-dkms a échoué. Le module amdgpu mainline du kernel suffit pour ROCm runtime."
  echo "   On continue sans dkms."
}

echo "==> 7. Outils Python"
apt-get install -y python3-setuptools python3-wheel

echo "==> 8. Groupes render + video pour $REAL_USER"
usermod -a -G render,video "$REAL_USER"

echo "==> 9. ROCm runtime"
apt-get install -y rocm

echo
echo "============================================="
echo "ROCm installé. Reboot recommandé."
echo "Après reboot, vérifier :"
echo "  rocminfo | head -20"
echo "  rocm-smi"
echo "  ls /dev/kfd /dev/dri/render*"
echo "============================================="
