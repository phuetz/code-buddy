#!/bin/bash
# ============================================================
# Script de Build Complet du Livre
# ============================================================
# Génère le livre complet en PDF et EPUB
#
# Usage:
#   ./scripts/build-book.sh           # Build PDF + EPUB
#   ./scripts/build-book.sh pdf       # Build PDF uniquement
#   ./scripts/build-book.sh epub      # Build EPUB uniquement
#   ./scripts/build-book.sh validate  # Validation sans build
#
# Prérequis:
#   - Pandoc >= 2.19
#   - XeLaTeX (pour PDF)
#   - DejaVu fonts (pour les emojis)
# ============================================================

set -e

# Configuration
BOOK_DIR="$(dirname "$0")/../docs/livre"
OUTPUT_DIR="${BOOK_DIR}/output"
TITLE="LLM Agents: Du Concept à la Production"
AUTHOR="Patrice"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonctions utilitaires
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Vérification des prérequis
check_prerequisites() {
    log_info "Vérification des prérequis..."

    if ! command -v pandoc &> /dev/null; then
        log_error "Pandoc n'est pas installé"
        echo "  Installation: sudo apt-get install pandoc"
        exit 1
    fi

    PANDOC_VERSION=$(pandoc --version | head -1 | cut -d' ' -f2)
    log_success "Pandoc $PANDOC_VERSION détecté"

    if ! command -v xelatex &> /dev/null; then
        log_warning "XeLaTeX n'est pas installé (nécessaire pour PDF)"
        echo "  Installation: sudo apt-get install texlive-xetex texlive-fonts-extra"
    else
        log_success "XeLaTeX détecté"
    fi
}

# Validation du contenu
validate_book() {
    log_info "Validation du livre..."

    cd "$BOOK_DIR"

    # Vérifier les chapitres
    MISSING=0
    for ch in 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19; do
        if ! ls ${ch}-*.md 1>/dev/null 2>&1; then
            log_warning "Chapitre $ch manquant"
            MISSING=$((MISSING + 1))
        fi
    done

    if [ $MISSING -eq 0 ]; then
        log_success "Tous les chapitres présents (00-19)"
    else
        log_warning "$MISSING chapitres manquants"
    fi

    # Vérifier les annexes
    for file in annexe-a-transformers.md annexe-b-projet-final.md glossaire.md bibliographie.md; do
        if [ -f "$file" ]; then
            log_success "Annexe: $file"
        else
            log_warning "Annexe manquante: $file"
        fi
    done

    # Vérifier les SVG
    SVG_COUNT=$(ls images/svg/*.svg 2>/dev/null | wc -l)
    log_info "$SVG_COUNT schémas SVG trouvés"

    # Statistiques
    TOTAL_WORDS=$(wc -w *.md 2>/dev/null | tail -1 | awk '{print $1}')
    TOTAL_PAGES=$((TOTAL_WORDS / 300))
    log_info "Statistiques: ~$TOTAL_WORDS mots (~$TOTAL_PAGES pages)"

    cd - > /dev/null
}

# Préparation des fichiers
prepare_files() {
    log_info "Préparation des fichiers..."

    mkdir -p "$OUTPUT_DIR"

    # Créer le fichier combiné avec tous les chapitres dans l'ordre
    cd "$BOOK_DIR"

    # Ordre des fichiers
    FILES=(
        "00-avant-propos.md"
        "01-premier-agent.md"
        "02-role-des-agents.md"
        "03-anatomie-agent.md"
        "04-tree-of-thought.md"
        "05-mcts.md"
        "06-repair-reflexion.md"
        "07-rag-moderne.md"
        "08-dependency-aware-rag.md"
        "09-context-compression.md"
        "10-tool-use.md"
        "11-plugins-mcp.md"
        "12-optimisations-cognitives.md"
        "13-optimisations-systeme.md"
        "14-apprentissage-persistant.md"
        "15-architecture-complete.md"
        "16-system-prompts-securite.md"
        "17-productivite-cli.md"
        "18-infrastructure-llm-local.md"
        "19-perspectives-futures.md"
        "annexe-a-transformers.md"
        "annexe-b-projet-final.md"
        "glossaire.md"
        "bibliographie.md"
    )

    # Combiner les fichiers existants
    > "$OUTPUT_DIR/book-combined.md"

    for file in "${FILES[@]}"; do
        if [ -f "$file" ]; then
            cat "$file" >> "$OUTPUT_DIR/book-combined.md"
            echo -e "\n\n\\pagebreak\n\n" >> "$OUTPUT_DIR/book-combined.md"
        fi
    done

    log_success "Fichiers combinés dans output/book-combined.md"
    cd - > /dev/null
}

# Génération PDF
build_pdf() {
    log_info "Génération du PDF..."

    if ! command -v xelatex &> /dev/null; then
        log_error "XeLaTeX requis pour la génération PDF"
        return 1
    fi

    cd "$BOOK_DIR"

    pandoc "$OUTPUT_DIR/book-combined.md" \
        --from markdown \
        --to pdf \
        --pdf-engine=xelatex \
        --toc \
        --toc-depth=2 \
        --number-sections \
        --highlight-style=tango \
        --metadata title="$TITLE" \
        --metadata author="$AUTHOR" \
        --metadata date="$(date +%Y-%m-%d)" \
        --variable geometry:margin=1in \
        --variable fontsize=11pt \
        --variable documentclass=book \
        --variable mainfont="DejaVu Sans" \
        --variable monofont="DejaVu Sans Mono" \
        --output "$OUTPUT_DIR/llm-agents-book.pdf" \
        2>&1 || {
            log_warning "Erreur PDF, essai avec polices par défaut..."
            pandoc "$OUTPUT_DIR/book-combined.md" \
                --from markdown \
                --to pdf \
                --pdf-engine=xelatex \
                --toc \
                --toc-depth=2 \
                --number-sections \
                --highlight-style=tango \
                --metadata title="$TITLE" \
                --metadata author="$AUTHOR" \
                --variable geometry:margin=1in \
                --output "$OUTPUT_DIR/llm-agents-book.pdf"
        }

    if [ -f "$OUTPUT_DIR/llm-agents-book.pdf" ]; then
        PDF_SIZE=$(du -h "$OUTPUT_DIR/llm-agents-book.pdf" | cut -f1)
        log_success "PDF généré: output/llm-agents-book.pdf ($PDF_SIZE)"
    fi

    cd - > /dev/null
}

# Génération EPUB
build_epub() {
    log_info "Génération de l'EPUB..."

    cd "$BOOK_DIR"

    pandoc "$OUTPUT_DIR/book-combined.md" \
        --from markdown \
        --to epub3 \
        --toc \
        --toc-depth=2 \
        --epub-chapter-level=1 \
        --highlight-style=tango \
        --metadata title="$TITLE" \
        --metadata author="$AUTHOR" \
        --metadata language=fr \
        --css styles/epub.css 2>/dev/null \
        --output "$OUTPUT_DIR/llm-agents-book.epub" || {
            # Sans CSS si le fichier n'existe pas
            pandoc "$OUTPUT_DIR/book-combined.md" \
                --from markdown \
                --to epub3 \
                --toc \
                --toc-depth=2 \
                --epub-chapter-level=1 \
                --highlight-style=tango \
                --metadata title="$TITLE" \
                --metadata author="$AUTHOR" \
                --metadata language=fr \
                --output "$OUTPUT_DIR/llm-agents-book.epub"
        }

    if [ -f "$OUTPUT_DIR/llm-agents-book.epub" ]; then
        EPUB_SIZE=$(du -h "$OUTPUT_DIR/llm-agents-book.epub" | cut -f1)
        log_success "EPUB généré: output/llm-agents-book.epub ($EPUB_SIZE)"
    fi

    cd - > /dev/null
}

# Génération HTML
build_html() {
    log_info "Génération du HTML..."

    cd "$BOOK_DIR"

    pandoc "$OUTPUT_DIR/book-combined.md" \
        --from markdown \
        --to html5 \
        --standalone \
        --toc \
        --toc-depth=2 \
        --highlight-style=tango \
        --metadata title="$TITLE" \
        --metadata author="$AUTHOR" \
        --template=templates/html.template 2>/dev/null \
        --output "$OUTPUT_DIR/llm-agents-book.html" || {
            # Sans template si n'existe pas
            pandoc "$OUTPUT_DIR/book-combined.md" \
                --from markdown \
                --to html5 \
                --standalone \
                --toc \
                --toc-depth=2 \
                --highlight-style=tango \
                --metadata title="$TITLE" \
                --output "$OUTPUT_DIR/llm-agents-book.html"
        }

    if [ -f "$OUTPUT_DIR/llm-agents-book.html" ]; then
        HTML_SIZE=$(du -h "$OUTPUT_DIR/llm-agents-book.html" | cut -f1)
        log_success "HTML généré: output/llm-agents-book.html ($HTML_SIZE)"
    fi

    cd - > /dev/null
}

# Nettoyage
cleanup() {
    log_info "Nettoyage des fichiers temporaires..."
    rm -f "$OUTPUT_DIR"/*.aux "$OUTPUT_DIR"/*.log "$OUTPUT_DIR"/*.out
}

# Affichage de l'aide
show_help() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  all       Build PDF + EPUB + HTML (défaut)"
    echo "  pdf       Build PDF uniquement"
    echo "  epub      Build EPUB uniquement"
    echo "  html      Build HTML uniquement"
    echo "  validate  Valider sans build"
    echo "  clean     Nettoyer les fichiers de sortie"
    echo "  help      Afficher cette aide"
}

# Point d'entrée principal
main() {
    echo "================================================"
    echo "  Build du Livre: $TITLE"
    echo "================================================"
    echo ""

    case "${1:-all}" in
        validate)
            check_prerequisites
            validate_book
            ;;
        pdf)
            check_prerequisites
            validate_book
            prepare_files
            build_pdf
            cleanup
            ;;
        epub)
            check_prerequisites
            validate_book
            prepare_files
            build_epub
            ;;
        html)
            check_prerequisites
            validate_book
            prepare_files
            build_html
            ;;
        all)
            check_prerequisites
            validate_book
            prepare_files
            build_pdf
            build_epub
            build_html
            cleanup
            ;;
        clean)
            log_info "Nettoyage de output/..."
            rm -rf "$OUTPUT_DIR"/*
            log_success "Nettoyage terminé"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Commande inconnue: $1"
            show_help
            exit 1
            ;;
    esac

    echo ""
    echo "================================================"
    echo "  Build terminé!"
    echo "================================================"
}

main "$@"
