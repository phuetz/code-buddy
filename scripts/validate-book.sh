#!/bin/bash
# Validate book structure and content
# Run this before generating PDF/EPUB

set -e

cd "$(dirname "$0")/../docs/livre"

echo "=== Validation du Livre ==="
echo ""

# Check all chapters exist
echo "1. Verification des chapitres..."
CHAPTERS="00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19"
MISSING=0
for ch in $CHAPTERS; do
  if ! ls ${ch}-*.md 1>/dev/null 2>&1; then
    echo "   MANQUANT: Chapitre $ch"
    MISSING=$((MISSING + 1))
  fi
done
if [ $MISSING -eq 0 ]; then
  echo "   OK - Tous les chapitres presents"
fi

# Check annexes
echo ""
echo "2. Verification des annexes..."
for file in annexe-a-transformers.md glossaire.md bibliographie.md; do
  if [ ! -f "$file" ]; then
    echo "   MANQUANT: $file"
  else
    echo "   OK: $file"
  fi
done

# Count SVG files
echo ""
echo "3. Verification des schemas SVG..."
SVG_COUNT=$(ls images/svg/*.svg 2>/dev/null | wc -l)
echo "   $SVG_COUNT schemas SVG trouves"

# Check for broken internal links
echo ""
echo "4. Verification des liens internes..."
BROKEN_LINKS=$(grep -roh '\[.*\]([^http][^)]*\.md)' *.md 2>/dev/null | while read link; do
  FILE=$(echo "$link" | sed 's/.*(\(.*\))/\1/')
  if [ ! -f "$FILE" ]; then
    echo "   CASSE: $link"
  fi
done)
if [ -z "$BROKEN_LINKS" ]; then
  echo "   OK - Pas de liens casses detectes"
else
  echo "$BROKEN_LINKS"
fi

# Word count
echo ""
echo "5. Statistiques..."
TOTAL_LINES=$(wc -l *.md 2>/dev/null | tail -1 | awk '{print $1}')
TOTAL_WORDS=$(wc -w *.md 2>/dev/null | tail -1 | awk '{print $1}')
echo "   Lignes totales: $TOTAL_LINES"
echo "   Mots totaux: ~$TOTAL_WORDS"
echo "   Pages estimees: ~$((TOTAL_WORDS / 300))"

echo ""
echo "=== Validation terminee ==="
