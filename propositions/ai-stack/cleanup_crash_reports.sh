#!/usr/bin/env bash
# Archive les crash reports d'/var/crash/ qui nous intéressent (clinfo HSA gfx1150)
# vers ai-stack/crash-reports/ pour référence diagnostic, puis nettoie /var/crash/.
#
# Lance avec : sudo ./cleanup_crash_reports.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_DIR="$SCRIPT_DIR/crash-reports"
mkdir -p "$ARCHIVE_DIR"

# 1. clinfo (bug HSA gfx1150 — diagnostic confirmé indépendamment d'Ollama)
CLINFO_SRC="/var/crash/_opt_rocm-7.2.2_bin_clinfo.1000.crash"
CLINFO_DST="$ARCHIVE_DIR/2026-04-30_clinfo_hsa_gfx1150.crash"
if [[ -f "$CLINFO_SRC" ]]; then
  echo "==> Archive clinfo crash → $CLINFO_DST"
  mv "$CLINFO_SRC" "$CLINFO_DST"
  chown patrice:patrice "$CLINFO_DST"
fi

# 2. python3.12 (159 MB du 23 avril — vérifier nature avant suppression)
PYTHON_SRC="/var/crash/_usr_bin_python3.12.1000.crash"
if [[ -f "$PYTHON_SRC" ]]; then
  SIZE=$(du -h "$PYTHON_SRC" | cut -f1)
  echo "==> Crash python3.12 trouvé ($SIZE) — extrait des champs clés :"
  head -c 4000 "$PYTHON_SRC" | grep -E "^(ProblemType|ExecutablePath|Signal|ProcCmdline|Date|Package):" || true
  echo
  read -p "Archiver dans crash-reports/ ? [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    DST="$ARCHIVE_DIR/2026-04-23_python3.12.crash"
    mv "$PYTHON_SRC" "$DST"
    chown patrice:patrice "$DST"
    echo "  archivé : $DST"
  else
    echo "  laissé en place — tu peux relancer le script ou faire 'sudo rm $PYTHON_SRC' manuellement"
  fi
fi

echo
echo "==> État actuel /var/crash/"
ls -la /var/crash/ | grep -v "^total"

echo
echo "==> État archive locale"
ls -la "$ARCHIVE_DIR"
