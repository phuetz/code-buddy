#!/bin/sh
# Code Buddy — one-command installer
#
#   curl -fsSL https://raw.githubusercontent.com/phuetz/code-buddy/main/install.sh | sh
#
# What it does (idempotent, never-destructive, no silent sudo):
#   1. Detects your OS/arch (Linux/macOS, x64/arm64).
#   2. Ensures Node.js >= 20 — uses yours if new enough, otherwise downloads an
#      official Node build into ~/.codebuddy/node (no sudo). It never replaces or
#      removes an existing Node.
#   3. Installs the `@phuetz/code-buddy` npm package globally, falling back to a
#      user-local prefix when the global one needs root (so it never runs sudo
#      behind your back).
#   4. Points you at `buddy onboard` (setup wizard) and `buddy login` (ChatGPT
#      OAuth, $0 marginal cost).
#
# Everything is overridable with env vars (see the block below). POSIX sh only.
set -eu

# --------------------------------------------------------------------------
# Configuration (override via environment)
# --------------------------------------------------------------------------
PACKAGE="${CODEBUDDY_PACKAGE:-@phuetz/code-buddy}"
MIN_NODE_MAJOR="${CODEBUDDY_MIN_NODE_MAJOR:-20}"
NODE_VERSION="${CODEBUDDY_NODE_VERSION:-20.18.1}"
NODE_DIST_BASE="${CODEBUDDY_NODE_DIST:-https://nodejs.org/dist}"
CODEBUDDY_HOME="${CODEBUDDY_HOME:-$HOME/.codebuddy}"
NODE_DIR="$CODEBUDDY_HOME/node"
NPM_GLOBAL_DIR="$CODEBUDDY_HOME/npm-global"

# Populated by detect_platform()
NODE_OS=""
NODE_ARCH=""
# Temp dir for downloads (cleaned on exit)
WORKDIR=""

# --------------------------------------------------------------------------
# Pretty output
# --------------------------------------------------------------------------
if [ -t 1 ]; then
  C_BOLD=$(printf '\033[1m')
  C_GREEN=$(printf '\033[32m')
  C_YELLOW=$(printf '\033[33m')
  C_RED=$(printf '\033[31m')
  C_DIM=$(printf '\033[2m')
  C_RESET=$(printf '\033[0m')
else
  C_BOLD='' C_GREEN='' C_YELLOW='' C_RED='' C_DIM='' C_RESET=''
fi

info() { printf '%s\n' "$*"; }
step() { printf '%s->%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%swarning:%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

cleanup() {
  # Only ever removes our own mktemp scratch dir — never user data.
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT INT TERM

# --------------------------------------------------------------------------
# Download helpers (curl or wget, whichever exists)
# --------------------------------------------------------------------------
download_to() { # <url> <dest>
  if have curl; then
    curl -fsSL "$1" -o "$2"
  elif have wget; then
    wget -qO "$2" "$1"
  else
    die "need 'curl' or 'wget' to download files"
  fi
}

fetch_stdout() { # <url>
  if have curl; then
    curl -fsSL "$1"
  elif have wget; then
    wget -qO- "$1"
  else
    return 1
  fi
}

sha256_of() { # <file> -> prints hex digest, or non-zero if no tool
  if have sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  elif have shasum; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

# --------------------------------------------------------------------------
# Platform detection
# --------------------------------------------------------------------------
detect_platform() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Linux)  NODE_OS="linux" ;;
    Darwin) NODE_OS="darwin" ;;
    *)
      die "unsupported OS '$os'. Code Buddy installs on Linux and macOS.
On Windows, use WSL2, or install via npm: npm install -g $PACKAGE"
      ;;
  esac
  case "$arch" in
    x86_64|amd64)   NODE_ARCH="x64" ;;
    aarch64|arm64)  NODE_ARCH="arm64" ;;
    armv7l)         NODE_ARCH="armv7l" ;;
    *)
      die "unsupported CPU architecture '$arch'.
Install Node.js >= $MIN_NODE_MAJOR manually, then: npm install -g $PACKAGE"
      ;;
  esac
  info "${C_DIM}Platform: $NODE_OS/$NODE_ARCH${C_RESET}"
}

# --------------------------------------------------------------------------
# Node.js
# --------------------------------------------------------------------------
node_major_of() { # <node-binary> -> prints major version, empty on failure
  _v=$("$1" --version 2>/dev/null) || return 1
  _v=${_v#v}
  printf '%s' "${_v%%.*}"
}

# Adds our bundled Node to PATH (this process) if it exists and looks good.
prepend_local_node() {
  if [ -x "$NODE_DIR/bin/node" ]; then
    PATH="$NODE_DIR/bin:$PATH"
    export PATH
  fi
}

install_node_local() {
  step "Installing Node.js v$NODE_VERSION into $NODE_DIR (no sudo)..."

  # Already present and healthy? Stay idempotent — don't re-download.
  if [ -x "$NODE_DIR/bin/node" ]; then
    _have=$(node_major_of "$NODE_DIR/bin/node" || printf '0')
    if [ "${_have:-0}" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
      ok "Reusing existing $NODE_DIR (Node $("$NODE_DIR/bin/node" --version))"
      prepend_local_node
      return 0
    fi
  fi

  _tarball="node-v${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}.tar.gz"
  _url="${NODE_DIST_BASE}/v${NODE_VERSION}/${_tarball}"

  WORKDIR=$(mktemp -d 2>/dev/null || mktemp -d -t codebuddy) \
    || die "could not create a temporary directory"

  step "Downloading $_url"
  download_to "$_url" "$WORKDIR/$_tarball" \
    || die "download failed. Check connectivity, or set CODEBUDDY_NODE_VERSION to an available release."

  # Verify integrity against the official signed checksum manifest.
  _expected=""
  if _shasums=$(fetch_stdout "${NODE_DIST_BASE}/v${NODE_VERSION}/SHASUMS256.txt" 2>/dev/null); then
    _expected=$(printf '%s\n' "$_shasums" | awk -v f="$_tarball" '$2 == f {print $1}')
  fi
  if [ -n "$_expected" ]; then
    if _actual=$(sha256_of "$WORKDIR/$_tarball"); then
      [ "$_actual" = "$_expected" ] \
        || die "checksum mismatch for $_tarball (expected $_expected, got $_actual). Aborting."
      ok "Checksum verified"
    else
      warn "no sha256 tool found — skipping checksum verification"
    fi
  else
    warn "could not fetch SHASUMS256.txt — skipping checksum verification"
  fi

  step "Extracting..."
  tar -xzf "$WORKDIR/$_tarball" -C "$WORKDIR" \
    || die "extraction failed (is 'tar' installed?)"

  _extracted="$WORKDIR/node-v${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}"
  [ -d "$_extracted" ] || die "unexpected archive layout in $_tarball"

  mkdir -p "$NODE_DIR"
  # Copy contents into NODE_DIR (never rm the destination first).
  cp -R "$_extracted/." "$NODE_DIR/" || die "could not install Node into $NODE_DIR"

  prepend_local_node
  persist_path "$NODE_DIR/bin"
  ok "Node.js v$NODE_VERSION installed"
}

ensure_node() {
  prepend_local_node
  if have node; then
    _major=$(node_major_of "$(command -v node)" || printf '0')
    if [ "${_major:-0}" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
      if have npm; then
        ok "Node.js $(node --version) and npm $(npm --version) found"
        return 0
      fi
      warn "Node.js is present but 'npm' is missing — provisioning a self-contained Node."
    else
      warn "Node.js ${_major:-?}.x found, but Code Buddy needs >= $MIN_NODE_MAJOR. Leaving it untouched and installing a private copy."
    fi
  else
    info "Node.js not found — installing a private copy for Code Buddy."
  fi
  install_node_local
  if ! have node || ! have npm; then
    die "Node.js/npm still unavailable after install. Please install Node.js >= $MIN_NODE_MAJOR and re-run."
  fi
}

# --------------------------------------------------------------------------
# PATH persistence (append-only, idempotent)
# --------------------------------------------------------------------------
persist_path() { # <bin-dir>
  _bindir="$1"
  _marker="# added by Code Buddy installer"
  _line="export PATH=\"$_bindir:\$PATH\""
  _written=0
  for _rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ -f "$_rc" ] || continue
    if grep -qF "$_bindir" "$_rc" 2>/dev/null; then
      _written=1
      continue
    fi
    printf '\n%s\n%s\n' "$_marker" "$_line" >> "$_rc"
    info "${C_DIM}Added $_bindir to PATH in $_rc${C_RESET}"
    _written=1
  done
  if [ "$_written" -eq 0 ]; then
    # No shell rc existed — create ~/.profile rather than guessing.
    printf '\n%s\n%s\n' "$_marker" "$_line" >> "$HOME/.profile"
    info "${C_DIM}Created $HOME/.profile with $_bindir on PATH${C_RESET}"
  fi
}

# --------------------------------------------------------------------------
# Code Buddy package
# --------------------------------------------------------------------------
writable_npm_prefix() {
  _p=$(npm config get prefix 2>/dev/null) || return 1
  [ -n "$_p" ] || return 1
  if [ -w "$_p" ] || { [ -d "$_p/lib" ] && [ -w "$_p/lib" ]; }; then
    printf '%s' "$_p"
    return 0
  fi
  return 1
}

install_codebuddy() {
  step "Installing $PACKAGE..."
  if _prefix=$(writable_npm_prefix); then
    info "${C_DIM}npm global prefix: $_prefix${C_RESET}"
    npm install -g "$PACKAGE" || die "'npm install -g $PACKAGE' failed"
  else
    info "Global npm prefix needs root — installing into a user-local prefix instead (no sudo)."
    mkdir -p "$NPM_GLOBAL_DIR"
    npm install -g --prefix "$NPM_GLOBAL_DIR" "$PACKAGE" \
      || die "'npm install -g --prefix $NPM_GLOBAL_DIR $PACKAGE' failed"
    PATH="$NPM_GLOBAL_DIR/bin:$PATH"
    export PATH
    persist_path "$NPM_GLOBAL_DIR/bin"
  fi
  ok "$PACKAGE installed"
}

# Detect a reachable local Ollama so we can surface the $0 path first.
detect_ollama() {
  _oh="${OLLAMA_HOST:-http://localhost:11434}"
  case "$_oh" in
    http://*|https://*) : ;;
    *) _oh="http://$_oh" ;;
  esac
  have curl || return 1
  curl -fsS --max-time 2 "$_oh/api/tags" >/dev/null 2>&1
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  printf '%s\n' "${C_BOLD}Code Buddy installer${C_RESET}"
  info "${C_DIM}open-source multi-provider AI coding agent${C_RESET}"
  info ""

  detect_platform
  ensure_node
  install_codebuddy

  info ""
  if have buddy; then
    ok "Installed: $(buddy --version 2>/dev/null || printf 'buddy')"
  else
    warn "'buddy' is not on your PATH in THIS shell yet."
    info "Open a new terminal (or 'source ~/.profile'), then run the commands below."
  fi

  info ""
  printf '%s\n' "${C_BOLD}Get started — no API key, no env var to edit${C_RESET}"
  # One obvious first move for everyone: the zero-config demo proves it works,
  # then onboard/login make it your default.
  if detect_ollama; then
    ok "Local Ollama detected — prove it works for \$0 right now:"
    info "    ${C_BOLD}buddy try${C_RESET}         — 60-second zero-config coding demo"
    info "    ${C_BOLD}buddy onboard${C_RESET}     — save it as your default (detects Ollama, no env var)"
    info ""
    info "  ${C_DIM}Prefer a hosted brain? ${C_RESET}${C_BOLD}buddy login${C_RESET}${C_DIM} — ChatGPT Plus/Pro OAuth, \$0 marginal cost.${C_RESET}"
  else
    info "  1. ${C_BOLD}buddy try${C_RESET}       — 60-second zero-config demo (start here)"
    info "  2. ${C_BOLD}buddy login${C_RESET}     — sign in with ChatGPT Plus/Pro (OAuth, \$0 marginal cost)"
    info "     ${C_DIM}...or install Ollama (https://ollama.ai) and run 'buddy onboard' — it configures it for you.${C_RESET}"
    info "  3. ${C_BOLD}buddy${C_RESET}           — start chatting"
  fi
  info "  ${C_DIM}Not sure you're ready? ${C_RESET}${C_BOLD}buddy doctor${C_RESET}${C_DIM} (add --fix to auto-configure a running Ollama).${C_RESET}"
  info ""
  info "${C_DIM}Full guide: https://github.com/phuetz/code-buddy/blob/main/docs/install.md${C_RESET}"
}

main "$@"
