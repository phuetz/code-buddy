# Code Buddy workspace sandbox
#
# A deliberately small, network-disabled-at-runtime toolchain for the common
# autonomous development loop. The host project is bind-mounted at /workspace;
# DockerSandbox separately overlays .git/.codebuddy/.agents read-only.
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="Code Buddy workspace sandbox"
LABEL org.opencontainers.image.description="Confined local development toolchain for Code Buddy"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      file \
      g++ \
      git \
      jq \
      make \
      procps \
      python3 \
      ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Commands run as the host uid/gid. Keep caches in the writable tmpfs rather
# than relying on a passwd entry or writing to the image filesystem.
ENV HOME=/tmp/codebuddy-home \
    NPM_CONFIG_CACHE=/tmp/codebuddy-npm-cache \
    XDG_CACHE_HOME=/tmp/codebuddy-cache \
    CI=1

WORKDIR /workspace
