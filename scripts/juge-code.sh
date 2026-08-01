#!/usr/bin/env bash
# Juge de code — revue adversariale sur diff/dossier via OpenRouter.
#
#   JUGE=free juge-code.sh "<question>" [fichiers...]     → Nemotron 3 Ultra 550B (0 $, quota gratuit)
#   juge-code.sh "<question>" [fichiers...]              → Qwen 3.7 Flash (~0,007 $, revue systématique)
#   JUGE=kimi juge-code.sh "<question>" [fichiers...]     → Kimi K3 (~0,38 $, jalons irréversibles)
#
# Mesuré le 2026-07-29 sur le même diff Mathery :
#   Qwen 3.7 Flash → a vu la régression de langue par défaut, les clés en clair,
#                    ET un bug Ctrl+W Windows que Kimi avait manqué.
#   Kimi K3        → a vu en plus les contre-sens du glossaire anglais publié
#                    (« Jumpsuit » pour combinaison) et le smoke DMG complaisant.
# Les deux sont complémentaires : Qwen tous les jours, Kimi avant l'irréversible.
#
# La voie `free` : tant que le solde OpenRouter dépasse 10 $, le quota des modèles
# `:free` passe de 50 à 1000 requêtes par jour. Nemotron 3 Ultra (550B, 1 M de
# contexte) devient alors le juge de volume à coût nul — à préférer à Qwen dès
# qu'on enchaîne les revues, et à doubler par un juge payant avant l'irréversible.
# Le solde ne SERT PAS à payer ces requêtes : il sert de seuil d'éligibilité.
set -euo pipefail

case "${JUGE:-qwen}" in
  free)  MODEL="nvidia/nemotron-3-ultra-550b-a55b:free"; MAXTOK=20000 ;;
  kimi)  MODEL="moonshotai/kimi-k3";    MAXTOK=30000 ;;
  qwen)  MODEL="qwen/qwen3.7-flash";    MAXTOK=20000 ;;
  *)     MODEL="${JUGE}";               MAXTOK=20000 ;;
esac

# Deux comptes OpenRouter, donc deux quotas gratuits de 1000 requêtes/jour cumulables
# (le seuil d'éligibilité est un solde > 10 $ sur CHAQUE compte, pas une dépense).
# Le compteur tourne à chaque appel ; sur 429, le script bascule sur l'autre clé.
KEYS_FILE="$HOME/.codebuddy/media.env"
KEY=$(grep "^OPENROUTER_API_KEY=" "$KEYS_FILE" 2>/dev/null | cut -d= -f2)
KEY2=$(grep "^OPENROUTER_API_KEY_2=" "$KEYS_FILE" 2>/dev/null | cut -d= -f2)
[ -n "$KEY" ] || KEY=$(grep "^OPENROUTER_API_KEY=" "$HOME/code-buddy/.env" | cut -d= -f2)

# Alternance : le compteur persistant évite de taper toujours le même quota.
TOUR_FILE="$HOME/.codebuddy/.openrouter-tour"
TOUR=$(( ($(cat "$TOUR_FILE" 2>/dev/null || echo 0) + 1) % 2 ))
echo "$TOUR" > "$TOUR_FILE" 2>/dev/null || true
if [ "$TOUR" = "1" ] && [ -n "$KEY2" ]; then
  KEY_ALT="$KEY"; KEY="$KEY2"; KEY2="$KEY_ALT"
fi

PROMPT="$1"; shift || true
CONTEXT=""
for f in "$@"; do
  [ -f "$f" ] && CONTEXT="$CONTEXT

===== $f =====
$(head -c 400000 "$f")"
done

CTXFILE=$(mktemp)
printf '%s' "$CONTEXT" > "$CTXFILE"
python3 - "$PROMPT" "$CTXFILE" "$KEY" "$MODEL" "$MAXTOK" "${KEY2:-}" <<'PY'
import json, sys, time, urllib.request, urllib.error
prompt, key, model, maxtok = sys.argv[1], sys.argv[3], sys.argv[4], int(sys.argv[5])
key_secours = sys.argv[6] if len(sys.argv) > 6 else ""
context = open(sys.argv[2]).read()
body = json.dumps({
  "model": model,
  "messages": [
    {"role": "system", "content": "Tu es un juge technique adversarial. Tu cherches ce qui cloche : promesses non tenues, tests complaisants, régressions, dette masquée. Tu es concis, factuel, en FRANÇAIS, et tu classes tes constats par gravité. Si tout est correct, tu le dis sans inventer de problème."},
    {"role": "user", "content": prompt + context},
  ],
  "max_tokens": maxtok,
}).encode()
def appel(cle):
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body,
      headers={"Authorization": "Bearer " + cle, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.load(r)

cle_courante, bascule_faite, d = key, False, None
for attempt in range(4):
    try:
        d = appel(cle_courante)
        break
    except urllib.error.HTTPError as e:
        if e.code != 429:
            raise
        # Quota du jour épuisé sur ce compte : on bascule sur l'autre AVANT d'attendre.
        if key_secours and not bascule_faite:
            cle_courante, bascule_faite = key_secours, True
            print("(quota atteint — bascule sur le second compte OpenRouter)", file=sys.stderr)
            continue
        if attempt < 3:
            time.sleep(30 * (attempt + 1))
            continue
        raise
if "choices" not in d:
    # Ne jamais faire passer une erreur d'API pour un verdict : on la montre telle quelle.
    print("ERREUR OpenRouter — aucun verdict rendu :", json.dumps(d, ensure_ascii=False)[:800])
    sys.exit(2)
print(d["choices"][0]["message"].get("content") or "(réponse vide — augmenter max_tokens)")
u = d.get("usage", {})
print(f"\n--- {model} : ${u.get('cost', 0):.4f} | {u.get('completion_tokens_details', {}).get('reasoning_tokens', 0)} tokens de raisonnement")
PY
rm -f "$CTXFILE"
