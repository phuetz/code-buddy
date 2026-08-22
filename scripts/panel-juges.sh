#!/usr/bin/env bash
# Panel de juges — la même question posée en parallèle à trois lignées indépendantes.
#
#   panel-juges.sh "<question>" [fichiers...]
#
# Pourquoi trois lignées et pas trois modèles : deux modèles du même entraîneur
# partagent leurs angles morts et se trompent ENSEMBLE. Un accord entre eux ne
# prouve rien. Ici les trois viennent de familles distinctes :
#
#   free  → NVIDIA Nemotron 3 Ultra 550B  (OpenRouter, 2 × 1000 req/jour)
#   agy   → Google Gemini 3.6 Flash High  (abonnement AI Ultra)
#   cere  → OpenAI gpt-oss-120b           (Cerebras, 2400 req/jour, ~1580 tok/s)
#
# Les trois sont à coût marginal nul. Le panel complet coûte 0 €.
#
# CE QUE LE PANEL PRODUIT, ET CE QU'IL NE PRODUIT PAS :
# il ne rend PAS un verdict par vote. Un défaut vu par un seul juge peut être le
# vrai défaut — c'est arrivé : Kimi seul avait vu les contresens du glossaire
# anglais publié, Qwen seul avait vu un bug Ctrl+W. Le panel sert à SITUER :
#   - ce que les trois disent  → à traiter en priorité, l'accord est du signal ;
#   - ce qu'un seul dit        → à VÉRIFIER soi-même, jamais à écarter d'office.
# L'arbitrage reste humain. Un juge signale, il ne condamne pas.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: panel-juges.sh \"<question>\" [fichiers...]" >&2
  exit 64
fi

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SORTIE="${PANEL_SORTIE:-$(mktemp -d)}"
mkdir -p "$SORTIE"

echo "Panel lancé — sortie dans $SORTIE"
for juge in free agy cere; do
  ( JUGE="$juge" bash "$RACINE/juge-code.sh" "$@" > "$SORTIE/$juge.md" 2>"$SORTIE/$juge.err" \
      && echo "  ✓ $juge" \
      || echo "  ✗ $juge — voir $SORTIE/$juge.err" ) &
done
wait

echo
for juge in free agy cere; do
  echo "═══════════════════ $juge ═══════════════════"
  if [ -s "$SORTIE/$juge.md" ]; then
    cat "$SORTIE/$juge.md"
  else
    echo "(aucun verdict — $(head -c 300 "$SORTIE/$juge.err" 2>/dev/null))"
  fi
  echo
done

echo "Les trois verdicts bruts restent dans $SORTIE — à confronter, pas à additionner."
