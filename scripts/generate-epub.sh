#!/bin/bash
# Generate EPUB from the book markdown files
# Requires: pandoc

set -e

cd "$(dirname "$0")/../docs/livre"

OUTPUT="livre-code-buddy.epub"

CHAPTERS="
00-avant-propos.md
01-premier-agent.md
02-role-des-agents.md
03-anatomie-agent.md
04-tree-of-thought.md
05-mcts.md
06-repair-reflexion.md
07-rag-moderne.md
08-dependency-aware-rag.md
09-context-compression.md
10-tool-use.md
11-plugins-mcp.md
12-optimisations-cognitives.md
13-optimisations-systeme.md
14-apprentissage-persistant.md
15-architecture-complete.md
16-system-prompts-securite.md
17-productivite-cli.md
18-infrastructure-llm-local.md
19-perspectives-futures.md
annexe-a-transformers.md
glossaire.md
bibliographie.md
"

echo "Generating EPUB..."
pandoc \
  --from=markdown+smart \
  --to=epub3 \
  --metadata-file=metadata.yaml \
  --toc \
  --toc-depth=2 \
  --css=styles/epub.css \
  --resource-path=.:images:images/svg \
  -o "$OUTPUT" \
  $CHAPTERS 2>/dev/null || {
    echo "Note: EPUB generation requires pandoc"
    echo "Install with: sudo apt install pandoc"
    exit 1
  }

echo "EPUB generated: $OUTPUT"
ls -lh "$OUTPUT"
