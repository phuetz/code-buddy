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
#   gmi    GMI Cloud — MiniMax M3 ILLIMITÉ jusqu'au 6/09/2026 (1 M de contexte,
#                                         texte+image+vidéo). La seule voie vers M3 à 0 $
#                                         depuis le retrait du `:free` d'OpenRouter.
#   minimax OpenRouter — m2.7:free (196 K de contexte, 0 $) par défaut ;
#                                         MINIMAX_MODELE=minimax/minimax-m3 pour 1 M de
#                                         contexte + vision, mais PAYANT (~0,30 $/M).
#                                         ⚠️ un palier `:free` peut mourir en deux heures.
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
  gmi)
    # GMI Cloud (api.gmi-serving.com), compatible OpenAI. Offre MiniMax : M3, M2.7, Speech 2.8
    # et Music 3.0 ILLIMITÉS du 24/08 au 6/09/2026 — https://www.gmicloud.ai/minimax-week
    #
    # M3 = 1 048 576 tokens de contexte, texte + image + vidéo. C'est la seule voie vers M3 à
    # coût nul depuis que le palier `:free` d'OpenRouter a été retiré (mesuré le 25/08 : vivant
    # à 05h, mort à 07h). Après le 6/09, vérifier avant de s'en servir.
    #
    # ⚠️ Cloudflare renvoie « error code: 1010 » sur l'agent utilisateur par défaut de Python
    # et de certains clients : il faut un User-Agent de navigateur. curl et Node passent.
    #
    # Identifiants exacts : MiniMaxAI/MiniMax-M3, MiniMaxAI/MiniMax-M2.7, MiniMaxAI/MiniMax-M2.5.
    # Prompts → GMI Cloud : rien de confidentiel.
    GKEY=$(grep -E "^(export )?GMI_API_KEY=" "$HOME/.codebuddy/media.env" 2>/dev/null | head -1 | sed 's/^export //' | cut -d= -f2- | tr -d "'\"")
    [ -n "$GKEY" ] || { echo "GMI_API_KEY introuvable dans ~/.codebuddy/media.env" >&2; exit 2; }
    CB_SRC=${CB_SRC:-$HOME/code-buddy-vitrine}; [ -f "$CB_SRC/src/index.ts" ] || CB_SRC=$HOME/code-buddy
    # `CODEBUDDY_PROVIDER=openai-compatible` + `OPENAI_*` n'est PAS reconnu par le dispatcher
    # (mesuré le 25/08 : « Auto-detected provider: custom » puis « No AI provider configured »,
    # échec en 1 s). La voie qui marche est le couple GROK_API_KEY/GROK_BASE_URL, que
    # `src/codebuddy/client.ts` route vers OpenAICompatProvider — le nom de la variable est
    # historique, il ne désigne pas xAI.
    (cd "$DEPOT" && GROK_API_KEY="$GKEY" GROK_BASE_URL="https://api.gmi-serving.com/v1" \
       "$CB_SRC/node_modules/.bin/tsx" "$CB_SRC/src/index.ts" -m "${GMI_MODELE:-MiniMaxAI/MiniMax-M3}" \
       --permission-mode acceptEdits -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
    ;;

  minimax)
    # OpenRouter, MiniMax. Défaut : m2.7:free (196 608 de contexte, 0 $).
    #
    # ⚠️ Un palier gratuit peut disparaître SANS PRÉAVIS. Le 25/08 à 05h, m3:free répondait
    # (1 048 576 de contexte, mesuré) ; à 07h il rendait « This model is unavailable for free ».
    # Deux heures. Ne jamais bâtir une chaîne de production sur un `:free` sans repli.
    #
    # Pour le très grand contexte — un livre entier, un corpus, un gros diff — passer à
    # MINIMAX_MODELE=minimax/minimax-m3 : 1 048 576 tokens, texte + image + vidéo, mais
    # PAYANT (0,30 $/M en entrée, 1,20 $ en sortie ; ~0,30 $ pour un roman de 300 pages).
    # L'offre GMI Cloud (M3 illimité jusqu'au 6/09) passe par une clé GMI, pas par OpenRouter.
    #
    # En volume, préférer NVIDIA ou le local. OpenRouter voit les prompts : rien de confidentiel.
    OKEY=$(grep -E "^(export )?OPENROUTER_API_KEY=" "$HOME/.codebuddy/media.env" 2>/dev/null | head -1 | sed 's/^export //' | cut -d= -f2- | tr -d "'\"")
    [ -n "$OKEY" ] || { echo "OPENROUTER_API_KEY introuvable dans ~/.codebuddy/media.env" >&2; exit 2; }
    CB_SRC=${CB_SRC:-$HOME/code-buddy-vitrine}; [ -f "$CB_SRC/src/index.ts" ] || CB_SRC=$HOME/code-buddy
    (cd "$DEPOT" && CODEBUDDY_PROVIDER=openrouter OPENROUTER_API_KEY="$OKEY" \
       "$CB_SRC/node_modules/.bin/tsx" "$CB_SRC/src/index.ts" -m "${MINIMAX_MODELE:-minimax/minimax-m2.7:free}" \
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
  darkstar)
    # Les DEUX RTX 3090 de darkstar (48 Go), en agentique. Le moteur `local` ci-dessous ne fait
    # qu'un `ollama run` : il genere du texte mais n'a AUCUN outil, donc il ne peut ni lire ni
    # ecrire un fichier — c'est pourquoi les 3090 restaient a 0 % pendant que tout partait dans
    # le cloud. Ici l'executant est Code Buddy lui-meme, qui lit, edite et lance les commandes,
    # sur un modele servi a la maison : $0, sans quota, et le code ne sort pas de la piece.
    #
    # Modele par defaut : qwen3.8:27b (tient sur une carte, sait appeler des outils). Pour un
    # modele qui ne tient pas sur 24 Go, ollama repartit sur les deux cartes automatiquement.
    # DARKSTAR_MODELE=ornith-1.5:35b|deepseek-r1:32b|qwen3.6:35b-a3b-q4_K_M
    DS_HOTE=${DARKSTAR_HOTE:-http://darkstar:11434}
    curl -sf --max-time 8 "$DS_HOTE/api/tags" >/dev/null || {
      echo "darkstar injoignable sur $DS_HOTE — machine eteinte ou ollama arrete" >&2; exit 2; }
    CB_SRC=${CB_SRC:-$HOME/code-buddy-vitrine}; [ -f "$CB_SRC/src/index.ts" ] || CB_SRC=$HOME/code-buddy
    # Comme pour nvidia : pas de -u (il PERSISTE baseURL dans user-settings.json), mais -m est
    # necessaire sinon le defaultModel perime part vers darkstar et rend 404.
    (cd "$DEPOT" && GROK_BASE_URL="$DS_HOTE/v1" GROK_API_KEY=ollama \
       "$CB_SRC/node_modules/.bin/tsx" "$CB_SRC/src/index.ts" -m "${DARKSTAR_MODELE:-qwen3.8:27b}" \
       --permission-mode acceptEdits -p "$(cat "$CONSIGNE")") 2>&1 | tee "$LOG"
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
