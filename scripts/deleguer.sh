#!/usr/bin/env bash
# Déléguer une mission à un moteur à $0, sans repayer les pièges déjà payés.
#
#   deleguer.sh <dépôt> <mission.md> [moteur]
#
# Moteurs, du moins cher au plus cher en ressource RARE :
#   local  ollama sur la machine        — aucun quota, aucun réseau
#   agy    Gemini (Antigravity)         — abonnement AI Ultra, quota généreux
#   grok   xAI Build (abonnement OAuth) — PAS la clé GROK_API_KEY, morte en 402
#   luna   codex gpt-5.6-luna  (DÉFAUT) — quota ChatGPT, le moins lourd
#   sol    codex gpt-5.6-sol            — quota ChatGPT, à réserver au dur
#
# Aucun de ces moteurs ne touche au forfait Claude : c'est tout l'objet.
#
# Pour un JUGEMENT sur des fichiers déjà écrits (pas une mission à exécuter),
# c'est `juge-code.sh` qu'il faut : JUGE=free donne Nemotron 3 Ultra à 0 $, et
# les DEUX clés OpenRouter tournent en alternance, soit 2 000 requêtes par jour.
#
# ⚠️ À lancer depuis un Bash de Claude Code avec `dangerouslyDisableSandbox: true`.
#    Sinon codex tente de construire son bwrap dans celui de Claude, échoue sur
#    `RTM_NEWADDR`, et rend une jolie prose sans avoir exécuté une seule commande.
set -uo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \?//'; exit 2; }
[ $# -ge 2 ] || usage

DEPOT=$(cd "$1" 2>/dev/null && pwd) || { echo "dépôt introuvable : $1" >&2; exit 2; }
MISSION=$2
MOTEUR=${3:-luna}
[ -f "$MISSION" ] || { echo "mission introuvable : $MISSION" >&2; exit 2; }

JOURNAUX=~/.codebuddy/delegations
mkdir -p "$JOURNAUX"
NOM=$(basename "$MISSION" .md)
LOG="$JOURNAUX/$(date +%Y-%m-%dT%H%M%S)-$MOTEUR-$NOM.log"

# Les garde-fous voyagent AVEC la mission. Codex tourne ici sans isolation :
# ce qui n'est pas écrit dans la consigne n'existe pas.
CONSIGNE=$(mktemp)
trap 'rm -f "$CONSIGNE"' EXIT
{
  cat "$MISSION"
  cat <<'GARDE'

---
## Garde-fous — non négociables

- Rester dans le dépôt indiqué. Ne jamais écrire ailleurs, ni dans /tmp partagé.
- Aucun `git push`, aucun `git prune`, aucun `git reset --hard`, aucun `rm -rf`.
- Jamais `git add -A` ni `git commit -a` : ces dépôts contiennent du travail non
  commité qui n'est pas le tien. Ajouter les fichiers un par un, nommément.
- Ne pas toucher aux services qui tournent (ComfyUI sur 8188/8189 notamment).
- Si une vérification échoue, le dire. Un travail annoncé fini mais non vérifié
  coûte plus cher que pas de travail du tout.
- Terminer par un bilan de dix lignes maximum : ce qui est fait, ce qui est
  prouvé (commande + résultat), ce qui reste ouvert.
GARDE
} > "$CONSIGNE"

echo "→ $MOTEUR sur $DEPOT — journal : $LOG"
DEBUT=$(date +%s)
AVANT=$(cd "$DEPOT" && git status --porcelain 2>/dev/null | sort)

case "$MOTEUR" in
  luna|sol)
    codex exec -C "$DEPOT" -m "gpt-5.6-$MOTEUR" \
      --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check \
      - < "$CONSIGNE" 2>&1 | tee "$LOG"
    ;;
  agy)
    # Sans cette option, agy en mode headless refuse TOUS les outils — il ne peut
    # pas demander l'autorisation — et rend un bilan élogieux sans avoir rien fait.
    # Constaté le 07/08/2026 : sortie 0, 12 s, aucun livrable.
    (cd "$DEPOT" && agy --model gemini-3.6-flash-high \
       --dangerously-skip-permissions -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;
  grok)
    # Abonnement xAI (OAuth, ~/.codebuddy/xai-auth.json) — À NE PAS CONFONDRE avec
    # GROK_API_KEY, morte en 402 depuis juillet 2026. C'est l'abonnement qui paie.
    (cd "$DEPOT" && grok --always-approve --cwd "$DEPOT" \
       ${GROK_MODELE:+-m "$GROK_MODELE"} -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;
  local)
    MODELE=${OLLAMA_MODELE:-gemma4:31b-it-qat}
    (cd "$DEPOT" && ollama run "$MODELE" "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;
  *) echo "moteur inconnu : $MOTEUR" >&2; usage ;;
esac

CODE=${PIPESTATUS[0]}
DUREE=$(( $(date +%s) - DEBUT ))

# La preuve qu'il a travaillé, pas qu'il l'a raconté. Un moteur qui échoue rend
# souvent 0 avec un bilan élogieux : les deux moteurs l'ont fait le 07/08/2026,
# codex sur bac à sable imbriqué, agy sur permissions headless refusées.
echo "─────────────────────────────────────────────"
printf 'moteur %s · %d s · sortie %d\n' "$MOTEUR" "$DUREE" "$CODE"
if [ "$MOTEUR" = luna ] || [ "$MOTEUR" = sol ]; then
  EXECS=$(grep -c '^exec' "$LOG" 2>/dev/null || echo 0)
  echo "commandes réellement exécutées : $EXECS"
  [ "$EXECS" -eq 0 ] && echo "⚠️  ZÉRO commande exécutée — bac à sable imbriqué ? relire l'en-tête de ce script."
fi

# Deuxième preuve, valable pour TOUS les moteurs : le dépôt a-t-il bougé ?
APRES=$(cd "$DEPOT" && git status --porcelain 2>/dev/null | sort)
if [ "$AVANT" = "$APRES" ]; then
  echo "⚠️  le dépôt est INCHANGÉ — si la mission demandait un livrable, il n'existe pas."
else
  echo "── ce qui a bougé ──"
  diff <(printf '%s\n' "$AVANT") <(printf '%s\n' "$APRES") | grep '^>' | sed 's/^> /  /'
fi

# Troisième preuve, la seule qui vaille quand la mission nomme son livrable.
#
# Le motif exige un chemin ANCRÉ (`~/…`, `/…`) ou RELATIF AU DÉPÔT (`dossier/…`).
# Première version le 07/08 : elle imposait un `/` initial, si bien qu'un chemin
# relatif comme `Le_Livre/RAPPORT.md` était tronqué en `/RAPPORT.md` et signalé
# absent alors qu'il venait d'être écrit. Une preuve qui crie au loup finit par
# ne plus être lue — c'est le mode d'échec d'un contrôle, pas un détail.
grep -oE '`?(~/|/)?[A-Za-zÀ-ÿ0-9_][A-Za-zÀ-ÿ0-9_.-]*(/[A-Za-zÀ-ÿ0-9_.-]+)+\.(md|json|csv|txt)`?' \
  "$MISSION" 2>/dev/null | tr -d '`' | sort -u | while read -r attendu; do
  case "$attendu" in
    /tmp/*|*/tmp/*) continue ;;
    /*|~/*) chemin="${attendu/#\~/$HOME}" ;;
    *)      chemin="$DEPOT/$attendu" ;;
  esac
  [ -e "$chemin" ] || echo "⚠️  livrable annoncé mais ABSENT : $chemin"
done
exit "$CODE"
