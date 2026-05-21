#!/usr/bin/env bash
# Configure le SSD2 (nvme1n1, 4 TB vierge) en btrfs zstd monté sur /data,
# avec subvolumes pour Docker volumes / modèles ComfyUI / datasets / sites / backups.
#
# Phase 1 (par défaut) : partitionne, formate, monte, crée subvolumes, fstab.
# Phase 2 (--migrate-comfyui) : déplace ~/DEV/ComfyUI/models vers /data/comfyui-models
#   avec rsync + symlink. ComfyUI ne doit pas tourner.
# Phase 3 (--migrate-docker-volumes) : NON implémentée ici, voir doc en commentaire.
#
# Lance avec : sudo ./setup_data_drive.sh [--migrate-comfyui]

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

DEVICE="/dev/nvme1n1"
PART="/dev/nvme1n1p1"
MOUNTPOINT="/data"
LABEL="data"
SUBVOLS=("docker-volumes" "comfyui-models" "datasets" "sites" "backups")

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
info()  { echo -e "${BLUE}→${NC} $*"; }

# ──────────────────────────────────────────────────────────────────────
# Garde-fous
# ──────────────────────────────────────────────────────────────────────

[[ -b "$DEVICE" ]] || fail "Device $DEVICE introuvable. Vérifie 'lsblk'."

ROOT_DEV=$(findmnt -no SOURCE / | sed 's/p[0-9]*$//' | sed 's/[0-9]*$//')
if [[ "$DEVICE" == "$ROOT_DEV" ]]; then
  fail "$DEVICE est le disque système ($ROOT_DEV). Refus catégorique."
fi

# Vérifie que btrfs-progs est installé (mkfs.btrfs + outils)
if ! command -v mkfs.btrfs >/dev/null 2>&1; then
  info "btrfs-progs absent — installation"
  apt-get update -qq
  apt-get install -y btrfs-progs
  ok "btrfs-progs installé"
fi

# Vérifie que le disque est bien vide (pas de partition, pas de fs)
EXISTING_PT=$(lsblk -no FSTYPE,NAME "$DEVICE" 2>/dev/null | awk 'NR>1 && $1!="" {print}' || true)
if [[ -n "$EXISTING_PT" ]]; then
  warn "Le disque $DEVICE contient déjà des données :"
  lsblk -f "$DEVICE"
  read -p "Continuer va TOUT EFFACER. Taper 'OUI EFFACER' pour confirmer : " ans
  [[ "$ans" == "OUI EFFACER" ]] || fail "Abandon."
fi

# ──────────────────────────────────────────────────────────────────────
# Phase 1 : partitionnement + fs + mount + fstab
# ──────────────────────────────────────────────────────────────────────

if ! lsblk -no FSTYPE "$PART" 2>/dev/null | grep -q "btrfs"; then
  info "Phase 1.1 — Création table GPT + partition sur $DEVICE"
  parted -s "$DEVICE" mklabel gpt
  parted -s "$DEVICE" mkpart primary btrfs 1MiB 100%
  partprobe "$DEVICE"
  sleep 2
  ok "Partition créée : $PART"

  info "Phase 1.2 — Format btrfs avec label '$LABEL'"
  mkfs.btrfs -L "$LABEL" -f "$PART"
  ok "Filesystem btrfs créé"
else
  ok "Partition btrfs déjà présente sur $PART (skip)"
fi

UUID=$(blkid -s UUID -o value "$PART")
info "UUID partition : $UUID"

mkdir -p "$MOUNTPOINT"

if ! mountpoint -q "$MOUNTPOINT"; then
  info "Phase 1.3 — Mount initial $MOUNTPOINT"
  mount -t btrfs -o compress=zstd:3,noatime,space_cache=v2,discard=async \
        "$PART" "$MOUNTPOINT"
  ok "Monté : $MOUNTPOINT"
else
  ok "$MOUNTPOINT déjà monté (skip)"
fi

info "Phase 1.4 — Création des subvolumes"
for sv in "${SUBVOLS[@]}"; do
  if [[ ! -d "$MOUNTPOINT/$sv" ]]; then
    btrfs subvolume create "$MOUNTPOINT/$sv"
    chown patrice:patrice "$MOUNTPOINT/$sv"
    ok "  subvolume créé : $sv"
  else
    ok "  $sv existe déjà"
  fi
done

# ──────────────────────────────────────────────────────────────────────
# Phase 1.5 : /etc/fstab (idempotent)
# ──────────────────────────────────────────────────────────────────────

FSTAB_ENTRY="UUID=$UUID  $MOUNTPOINT  btrfs  compress=zstd:3,noatime,space_cache=v2,discard=async  0  0"

if ! grep -q "UUID=$UUID" /etc/fstab; then
  info "Phase 1.5 — Ajout dans /etc/fstab"
  cp /etc/fstab "/etc/fstab.backup-$(date +%Y%m%d-%H%M%S)"
  echo "" >> /etc/fstab
  echo "# SSD2 data drive (btrfs zstd) — ajouté par setup_data_drive.sh $(date +%Y-%m-%d)" >> /etc/fstab
  echo "$FSTAB_ENTRY" >> /etc/fstab
  ok "fstab mis à jour (backup dans /etc/fstab.backup-*)"

  info "Test du fstab via 'systemctl daemon-reload + mount -a'"
  systemctl daemon-reload
  mount -a
  ok "fstab OK"
else
  ok "fstab contient déjà cette entrée (skip)"
fi

echo
echo "═══ État après Phase 1 ═══"
df -h "$MOUNTPOINT"
echo
btrfs filesystem show "$MOUNTPOINT"
echo
btrfs subvolume list "$MOUNTPOINT"
echo
ls -la "$MOUNTPOINT"

# ──────────────────────────────────────────────────────────────────────
# Phase 2 : migration ComfyUI/models (optionnelle)
# ──────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--migrate-comfyui" ]]; then
  echo
  info "Phase 2 — Migration ~/DEV/ComfyUI/models → /data/comfyui-models"

  COMFY_SRC="/home/patrice/DEV/ComfyUI/models"
  COMFY_DST="/data/comfyui-models"

  if [[ ! -d "$COMFY_SRC" ]]; then
    fail "Source $COMFY_SRC introuvable"
  fi

  if [[ -L "$COMFY_SRC" ]]; then
    ok "$COMFY_SRC est déjà un symlink — migration déjà faite ?"
    ls -la "$COMFY_SRC"
    exit 0
  fi

  # Vérifie que ComfyUI ne tourne pas
  if pgrep -f "ComfyUI/main.py" > /dev/null; then
    fail "ComfyUI tourne encore (PID $(pgrep -f ComfyUI/main.py)). Arrête-le avant la migration."
  fi

  SRC_SIZE=$(du -sb "$COMFY_SRC" | cut -f1)
  SRC_HUMAN=$(du -sh "$COMFY_SRC" | cut -f1)
  info "Taille source : $SRC_HUMAN"

  info "rsync en cours..."
  rsync -ahP --info=progress2 "$COMFY_SRC/" "$COMFY_DST/"
  chown -R patrice:patrice "$COMFY_DST"

  DST_SIZE=$(du -sb "$COMFY_DST" | cut -f1)
  if [[ "$SRC_SIZE" != "$DST_SIZE" ]]; then
    warn "Tailles différentes : src=$SRC_SIZE dst=$DST_SIZE"
    warn "Vérification manuelle requise — symlink NON créé."
    exit 1
  fi
  ok "Tailles identiques ($DST_SIZE bytes)"

  BACKUP="${COMFY_SRC}.backup-$(date +%Y%m%d-%H%M%S)"
  mv "$COMFY_SRC" "$BACKUP"
  ln -s "$COMFY_DST" "$COMFY_SRC"
  chown -h patrice:patrice "$COMFY_SRC"
  ok "Symlink créé : $COMFY_SRC → $COMFY_DST"
  ok "Original sauvegardé : $BACKUP"
  echo "  (à supprimer manuellement après validation : sudo rm -rf $BACKUP)"
fi

# ──────────────────────────────────────────────────────────────────────
# Phase 3 : migration Docker volumes (NON automatisée — danger)
# ──────────────────────────────────────────────────────────────────────
# Pour Phase 3, voir doc séparée. Étapes (à faire en session dédiée) :
#  1. docker compose stop (ai-stack) + docker stop monartisan-* (et tout container)
#  2. systemctl stop docker docker.socket
#  3. rsync -ahP /var/lib/docker/volumes/ /data/docker-volumes/
#  4. mv /var/lib/docker/volumes /var/lib/docker/volumes.old
#  5. mount --bind /data/docker-volumes /var/lib/docker/volumes  (+ fstab entry)
#  6. systemctl start docker
#  7. docker compose up -d  +  vérifier que webui.db est encore là
#  8. Quand validé : rm -rf /var/lib/docker/volumes.old
# ──────────────────────────────────────────────────────────────────────

echo
ok "Phase $([[ "${1:-}" == "--migrate-comfyui" ]] && echo "1+2" || echo "1") terminée."
echo
echo "Prochaines étapes :"
echo "  • Sans migrate-comfyui : tu peux maintenant écrire dans /data/{docker-volumes,comfyui-models,datasets,sites,backups}/"
echo "  • Phase 2 (modèles ComfyUI) : sudo $0 --migrate-comfyui"
echo "  • Phase 3 (Docker volumes) : voir commentaire dans le script, à faire en session dédiée"
