#!/bin/bash
# Generate PDF from the book markdown files
# Requires: pandoc, xelatex (texlive)

set -e

cd "$(dirname "$0")/../docs/livre"

OUTPUT="livre-code-buddy.pdf"

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

echo "Generating PDF..."
pandoc \
  --from=markdown+smart+yaml_metadata_block \
  --to=pdf \
  --pdf-engine=xelatex \
  --metadata-file=metadata.yaml \
  --toc \
  --toc-depth=3 \
  --number-sections \
  --highlight-style=tango \
  --variable=geometry:margin=2.5cm \
  --variable=fontsize=11pt \
  --variable=documentclass=book \
  --variable=papersize=a4 \
  --variable=lang=fr \
  --resource-path=.:images:images/svg \
  -o "$OUTPUT" \
  $CHAPTERS 2>/dev/null || {
    echo "Note: PDF generation requires pandoc and xelatex"
    echo "Install with: sudo apt install pandoc texlive-xetex texlive-fonts-recommended"
    exit 1
  }

echo "PDF generated: $OUTPUT"
ls -lh "$OUTPUT"
