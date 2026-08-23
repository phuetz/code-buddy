#!/usr/bin/env bash
# Déléguer une mission à un moteur à $0, sans repayer les pièges déjà payés.
#
#   deleguer.sh <dépôt> <mission.md> [moteur]
#
# Moteurs, du moins cher au plus cher en ressource RARE :
#   local  ollama sur la machine        — aucun quota, aucun réseau
#   agy    Gemini (Antigravity)         — abonnement AI Ultra ; ⚠️ PLAFOND DUR
#                                         de ~305 s : découper les missions
#   oc     OpenCode Go (abonnement)     — 61 modèles, 5 lignées inédites
#                                         (kimi, minimax, deepseek, glm, qwen) ;
#                                         choisir avec OC_MODELE=<id>
#   nvidia NVIDIA Build (clé GRATUITE ~40 RPM) — Code Buddy headless sur Kimi K3 /
#                                         Nemotron 3 ; 0 quota perso ; prompts → NVIDIA (pas de confidentiel)
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
    # Gemini 3.7 Flash par défaut (sorti le 16/08/2026) ; surcharge via AGY_MODELE=…
    # --print-timeout à 25m : lire un livre entier (150k+ tokens) dépasse le défaut 5m
    (cd "$DEPOT" && agy --model "${AGY_MODELE:-gemini-3.7-flash-high}" \
       --print-timeout "${AGY_TIMEOUT:-25m}" \
       --dangerously-skip-permissions -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;
  grok)
    # Abonnement xAI (OAuth, ~/.codebuddy/xai-auth.json) — À NE PAS CONFONDRE avec
    # GROK_API_KEY, morte en 402 depuis juillet 2026. C'est l'abonnement qui paie.
    (cd "$DEPOT" && grok --always-approve --cwd "$DEPOT" \
       ${GROK_MODELE:+-m "$GROK_MODELE"} -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;
  qwen)
    # Qwen 3.8 27B LOCAL (Ollama, 0 €, aucun quota) — exécutant = Code Buddy headless (agentique : lit,
    # édite, lance). OLLAMA_MODELE pour changer (gemma4:31b-it-qat, …). Un seul job à la fois (GPU).
    CB_SRC=${CB_SRC:-$HOME/code-buddy-vitrine}; [ -f "$CB_SRC/src/index.ts" ] || CB_SRC=$HOME/code-buddy
    (cd "$DEPOT" && CODEBUDDY_PROVIDER=ollama OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}" \
       "$CB_SRC/node_modules/.bin/tsx" "$CB_SRC/src/index.ts" -m "${OLLAMA_MODELE:-qwen3.8:27b}" \
       --permission-mode acceptEdits -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;
  nvidia)
    # NVIDIA Build (build.nvidia.com) = palier GRATUIT (~40 RPM), clé NVIDIA_API_KEY dans
    # ~/.codebuddy/lisa.env. Exécutant = Code Buddy lui-même en headless (agentique : lit, édite,
    # lance les commandes) sur Kimi K3 par défaut (FR excellent) — ou NVIDIA_MODELE=nvidia/nemotron-3-ultra-550b-a55b.
    # Modèles vivants vérifiés le 22/08/2026 : docs/providers/nvidia-nim-probe-2026-08-22.md (worktree vitrine).
    NKEY=$(grep -E "^(export )?NVIDIA_API_KEY=" "$HOME/.codebuddy/lisa.env" 2>/dev/null | head -1 | sed 's/^export //' | cut -d= -f2- | tr -d "'\"")
    [ -n "$NKEY" ] || { echo "NVIDIA_API_KEY introuvable dans ~/.codebuddy/lisa.env" >&2; exit 2; }
    CB_SRC=${CB_SRC:-$HOME/code-buddy-vitrine}; [ -f "$CB_SRC/src/index.ts" ] || CB_SRC=$HOME/code-buddy
    # ⚠️ PAS de -u/-m : ces flags PERSISTENT baseURL/modèle dans ~/.codebuddy/user-settings.json (effet de
    # bord vu le 22/08). On sélectionne le provider par l'environnement, sans rien écrire.
    # -m ne persiste rien (seul -u écrit user-settings) mais il est NÉCESSAIRE : sans lui, le
    # defaultModel périmé de ~/.codebuddy/user-settings.json (grok-code-fast-1) part vers NVIDIA → 404.
    (cd "$DEPOT" && CODEBUDDY_PROVIDER=nvidia NVIDIA_API_KEY="$NKEY" \
       "$CB_SRC/node_modules/.bin/tsx" "$CB_SRC/src/index.ts" -m "${NVIDIA_MODELE:-moonshotai/kimi-k3}" \
       --permission-mode acceptEdits -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;
  oc)
    # ⛔ UN SEUL TRAVAIL OPENCODE À LA FOIS. Le quota d'une fenêtre de 5 h
    # (12 $) est trop étroit pour le partage : deux missions concurrentes se
    # font couper à mi-course toutes les deux — budget consommé, zéro livrable.
    # En séquentiel, la première aboutit. Constaté le 08/08.
    if pgrep -f 'opencode run' | grep -qv "^$$\$"; then
      echo "⛔ REFUS — un travail OpenCode tourne déjà. Le quota de 5 h ne" >&2
      echo "   supporte pas le parallélisme : attends son livrable." >&2
      exit 3
    fi
    # OpenCode — abonnement Go (`opencode auth login`, jeton dans
    # ~/.local/share/opencode/auth.json). 61 modèles, dont cinq LIGNÉES que la
    # flotte n'a pas par ailleurs : Moonshot (kimi), MiniMax, DeepSeek, Zhipu
    # (glm), Alibaba (qwen). C'est ce qui sert le croisement d'audits — deux
    # modèles de la même famille se trompent ensemble.
    #
    # ⚠️ DEUX FOURNISSEURS, ne pas les confondre — c'est ce qui m'a fait perdre
    # une heure le 08/08 :
    #   opencode/<m>      → Zen, payé au crédit ; seuls les `-free` répondent
    #   opencode-go/<m>   → l'ABONNEMENT ; c'est celui-ci qu'on veut
    # Un `opencode/kimi-k3` rend « 401 Insufficient balance » et donne
    # l'illusion d'un problème de facturation. `opencode models` liste les
    # identifiants réels avec leur préfixe : s'y fier plutôt qu'au catalogue
    # HTTP, qui ne le montre pas.
    MODELE=${OC_MODELE:-kimi-k3}  # deepseek-v4-pro exige un opt-in « hébergé en Chine » depuis le 22/08 → Kimi K3 par défaut
    (cd "$DEPOT" && opencode run --dir "$DEPOT" -m "opencode-go/$MODELE" \
       "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
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
