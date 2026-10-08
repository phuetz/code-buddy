# Code Buddy - Official Docker Image
# Multi-stage build for optimized production image
# Supports AMD64 and ARM64 architectures

# ============================================================================
# Stage 1: Build
# ============================================================================
FROM node:20-bookworm AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY vendor ./vendor

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ============================================================================
# Stage 2: Production
# ============================================================================
FROM node:20-bookworm-slim AS production

# Image version — override at build time: --build-arg CODEBUDDY_VERSION=1.8.0
ARG CODEBUDDY_VERSION=1.8.0

# Labels for container registry
LABEL org.opencontainers.image.title="Code Buddy"
LABEL org.opencontainers.image.description="Open-source multi-provider AI coding agent (terminal, HTTP server, desktop)"
LABEL org.opencontainers.image.version="${CODEBUDDY_VERSION}"
LABEL org.opencontainers.image.vendor="phuetz"
LABEL org.opencontainers.image.source="https://github.com/phuetz/code-buddy"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.documentation="https://github.com/phuetz/code-buddy#readme"

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash -u 1001 codebuddy

# Copy built application from builder stage
COPY --from=builder --chown=codebuddy:codebuddy /app/dist ./dist
COPY --from=builder --chown=codebuddy:codebuddy /app/node_modules ./node_modules
COPY --from=builder --chown=codebuddy:codebuddy /app/vendor ./vendor
COPY --from=builder --chown=codebuddy:codebuddy /app/package.json ./

# Create directories for config and data
RUN mkdir -p /home/codebuddy/.codebuddy /home/codebuddy/data \
    && chown -R codebuddy:codebuddy /home/codebuddy

# Set environment
ENV NODE_ENV=production
ENV HOME=/home/codebuddy
ENV CODEBUDDY_HOME=/home/codebuddy/.codebuddy

# Switch to non-root user
USER codebuddy

# Set working directory for projects
WORKDIR /workspace

# Health check — meaningful in server mode (CMD ["server", ...]).
# Honest: reports unhealthy if /api/health stops responding (was `|| exit 0`,
# which always passed and hid real failures).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:3000/api/health || exit 1

# Expose server port (for server mode)
EXPOSE 3000

# Entry point
ENTRYPOINT ["node", "/app/dist/index.js"]

# Default command (show help)
CMD ["--help"]

# ============================================================================
# Stage 3: Development
# ============================================================================
FROM node:20-bookworm AS development

WORKDIR /app

# Install dev dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install
COPY package*.json ./
COPY vendor ./vendor
RUN npm ci

# Copy source
COPY . .

# Environment
ENV NODE_ENV=development

# Expose for dev server
EXPOSE 3000 5173

# Dev entry point
CMD ["npm", "run", "dev:node"]
