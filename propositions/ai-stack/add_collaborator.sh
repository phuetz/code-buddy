#!/usr/bin/env bash
# Crée un compte collaborateur Linux avec accès SSH par clé publique.
# Usage :
#   sudo ./add_collaborator.sh <username> --github <gh-user>            # full sudo + docker
#   sudo ./add_collaborator.sh <username> --github <gh-user> --no-sudo  # sans sudo
#   sudo ./add_collaborator.sh <username> --key-file /path/to/id.pub
#   sudo ./add_collaborator.sh <username> --key-stdin    (lit la clé sur stdin)
#   sudo ./add_collaborator.sh <username> --no-key       (compte sans clé, à compléter plus tard)
#
# Exemple :
#   sudo ./add_collaborator.sh sebastien --github sebyge

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0 ..."
   exit 1
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
info()  { echo -e "${BLUE}→${NC} $*"; }

# ──────────────────────────────────────────────────────────────────────
# Parse args
# ──────────────────────────────────────────────────────────────────────
USERNAME=""
KEY_SOURCE=""    # "github:<user>" | "file:<path>" | "stdin"
GIVE_SUDO=true
GIVE_DOCKER=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --github)      KEY_SOURCE="github:$2"; shift 2 ;;
    --key-file)    KEY_SOURCE="file:$2"; shift 2 ;;
    --key-stdin)   KEY_SOURCE="stdin"; shift ;;
    --no-key)      KEY_SOURCE="none"; shift ;;
    --no-sudo)     GIVE_SUDO=false; shift ;;
    --no-docker)   GIVE_DOCKER=false; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0 ;;
    -*)
      fail "Flag inconnu : $1" ;;
    *)
      [[ -z "$USERNAME" ]] && USERNAME="$1" || fail "Trop d'arguments positionnels"
      shift ;;
  esac
done

[[ -n "$USERNAME" ]]    || fail "Username manquant. Usage : $0 <username> --github <gh-user>"
[[ -n "$KEY_SOURCE" ]]  || fail "Source de clé manquante (--github / --key-file / --key-stdin / --no-key)"

# Validation username (chars safes Linux)
[[ "$USERNAME" =~ ^[a-z][a-z0-9_-]{1,30}$ ]] || \
  fail "Username invalide : '$USERNAME' (a-z, 0-9, _, -, max 31 chars, commence par lettre)"

# ──────────────────────────────────────────────────────────────────────
# 1. Récupération de la clé publique
# ──────────────────────────────────────────────────────────────────────
KEY_TMP=$(mktemp)
trap "rm -f $KEY_TMP" EXIT

case "$KEY_SOURCE" in
  github:*)
    GH_USER="${KEY_SOURCE#github:}"
    info "Récupération clés depuis https://github.com/$GH_USER.keys"
    if ! curl -fsSL "https://github.com/$GH_USER.keys" -o "$KEY_TMP"; then
      fail "Échec fetch GitHub keys pour '$GH_USER'"
    fi
    [[ -s "$KEY_TMP" ]] || fail "Aucune clé publique sur le compte GitHub '$GH_USER'"
    ok "$(wc -l < $KEY_TMP) clé(s) récupérée(s)"
    ;;
  file:*)
    KEY_FILE="${KEY_SOURCE#file:}"
    [[ -f "$KEY_FILE" ]] || fail "Fichier introuvable : $KEY_FILE"
    cp "$KEY_FILE" "$KEY_TMP"
    ;;
  stdin)
    info "Colle la clé publique (Ctrl+D pour finir) :"
    cat > "$KEY_TMP"
    [[ -s "$KEY_TMP" ]] || fail "Aucune clé reçue sur stdin"
    ;;
  none)
    warn "Mode --no-key : compte créé sans authorized_keys (à compléter plus tard)"
    ;;
esac

# Validation : au moins une ligne ressemble à une clé SSH (sauf si --no-key)
if [[ "$KEY_SOURCE" != "none" ]]; then
  if ! grep -qE "^(ssh-(rsa|ed25519|ecdsa)|ecdsa-) " "$KEY_TMP"; then
    fail "Aucune clé SSH valide trouvée dans la source"
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# 2. Création du user
# ──────────────────────────────────────────────────────────────────────
if id "$USERNAME" >/dev/null 2>&1; then
  warn "User '$USERNAME' existe déjà (skip création)"
else
  info "Création du compte $USERNAME"
  # --disabled-password : pas de mot de passe interactif
  # le user devra utiliser SSH par clé. Si tu veux qu'il ait aussi un mot de passe
  # pour sudo, runner `sudo passwd $USERNAME` après ce script.
  adduser --gecos "$USERNAME (collaborateur)" --disabled-password "$USERNAME"
  ok "Compte créé : /home/$USERNAME"
fi

# ──────────────────────────────────────────────────────────────────────
# 3. authorized_keys
# ──────────────────────────────────────────────────────────────────────
SSH_DIR="/home/$USERNAME/.ssh"
AUTH_KEYS="$SSH_DIR/authorized_keys"

if [[ "$KEY_SOURCE" == "none" ]]; then
  warn "Pas de clé installée — le user devra fournir sa clé publique avant de pouvoir SSH"
  warn "  À faire plus tard : sudo $0 $USERNAME --key-file <path> (ou --github / --key-stdin)"
else
  mkdir -p "$SSH_DIR"
  cat "$KEY_TMP" > "$AUTH_KEYS"
  chmod 700 "$SSH_DIR"
  chmod 600 "$AUTH_KEYS"
  chown -R "$USERNAME:$USERNAME" "$SSH_DIR"
  ok "authorized_keys écrit ($(wc -l < $AUTH_KEYS) clé(s))"
fi

# ──────────────────────────────────────────────────────────────────────
# 4. Groupes (sudo + docker selon flags)
# ──────────────────────────────────────────────────────────────────────
if $GIVE_SUDO; then
  usermod -aG sudo "$USERNAME"
  ok "Ajouté au groupe sudo (full sudo)"
  info "  Pour qu'il puisse sudo, soit il définit un mot de passe via 'sudo passwd $USERNAME',"
  info "  soit tu lui mets NOPASSWD via /etc/sudoers.d/$USERNAME"
fi

if $GIVE_DOCKER; then
  if getent group docker > /dev/null; then
    usermod -aG docker "$USERNAME"
    ok "Ajouté au groupe docker"
  else
    warn "Groupe docker inexistant — Docker pas installé ?"
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# 5. Vérif config SSH globale (clé uniquement, pas de mot de passe)
# ──────────────────────────────────────────────────────────────────────
SSHD_CONFIG="/etc/ssh/sshd_config"
if grep -qE "^[[:space:]]*PasswordAuthentication[[:space:]]+yes" "$SSHD_CONFIG" 2>/dev/null; then
  warn "PasswordAuthentication=yes dans $SSHD_CONFIG"
  warn "  → recommandé : passer à 'no' pour forcer auth par clé uniquement"
  warn "  (à faire manuellement, le script ne touche pas sshd_config)"
fi

# ──────────────────────────────────────────────────────────────────────
# 6. Récap
# ──────────────────────────────────────────────────────────────────────
echo
echo "═══ Compte $USERNAME prêt ═══"
echo "  Sudo   : $($GIVE_SUDO && echo OUI || echo NON)"
echo "  Docker : $($GIVE_DOCKER && echo OUI || echo NON)"
if [[ "$KEY_SOURCE" == "none" ]]; then
  echo "  Clés   : AUCUNE (à ajouter avant connexion SSH)"
else
  echo "  Clés   : $(wc -l < $AUTH_KEYS) dans $AUTH_KEYS"
fi
echo

TS_HOSTNAME=$(tailscale status --self --peers=false 2>/dev/null | awk 'NR==1{print $2}' || echo "ministar-linux")
TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || echo "100.98.18.76")

cat <<EOF

═══ À envoyer à $USERNAME ═══

Tu as été ajouté comme collaborateur sur ${TS_HOSTNAME} (PC Linux de Patrice).

1. Accepte l'invitation Tailscale dans tes mails (compte Tailscale).
2. Une fois sur le tailnet, vérifie que tu vois la machine :
   tailscale status | grep $TS_HOSTNAME

3. Connecte-toi en SSH :
   ssh $USERNAME@$TS_HOSTNAME       (MagicDNS)
   ssh $USERNAME@$TS_IP             (IP directe)

EOF

if $GIVE_SUDO; then
  echo "Tu auras sudo. Demande à Patrice de te configurer un mot de passe via :"
  echo "  sudo passwd $USERNAME    (côté Ministar)"
  echo "ou demande-lui un sudo NOPASSWD si vous préférez."
fi
