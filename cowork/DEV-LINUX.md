# Cowork dev on Linux

The default `npm run build` script in `cowork/` was built around the
macOS/Windows ship path: it downloads a standalone Node, then a
standalone Python runtime, then runs WSL/Lima sandbox agents through
their build chain, then `electron-builder` to package an installer.
On Linux these steps either fail or are useless for iterative
development. This guide is the lighter loop.

## One-time setup

```bash
cd /path/to/code-buddy
# Node.js >= 22 is required for Cowork (the root CLI requires >= 20).
