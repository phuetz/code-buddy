# Audit — Mode autonome : « il ne me comprend pas » & « les réponses ne sont pas sûres »

> Audit en lecture seule (aucun code modifié). Daté 2026-06-30.
> Deux sous-systèmes « autonomes » audités : (1) le **companion vocal** (tu parles → Lisa répond), (2) le **daemon de codage** `buddy autonomy`. Ta plainte (« ne me comprend pas », « façon de répondre ») pointe surtout vers le **(1) vocal**.

---

## Constat central (en une phrase)

Le système n'est pas « cassé » : ton **robot vocal** tourne sur un **petit modèle local (`qwen2.5:7b-instruct`) en mode « bavardage » sans accès aux fichiers ni aux outils**. Pour toute question factuelle/technique, il ne peut donc que **deviner** — d'où « les réponses ne sont pas sûres ». Et plusieurs réglages le rendent dur à comprendre (pas de mémoire entre tours, réponses canned, coupé à 1-2 phrases).

---

## ✅ Ce qui tourne RÉELLEMENT chez toi (lu dans ta config)

Tu as **deux** « Lisa » distinctes, et elles n'ont pas le même cerveau :

| | **Lisa Telegram** (`lisa-telegram.service` ← `lisa.env`) | **Robot vocal** (`buddy-vision-*` ← `vision.env`) |
|---|---|---|
| Cerveau | **chatgpt-oauth / gpt-5.5** (fort) | **`qwen2.5:7b-instruct`** local (petit) |
| Quand | quand tu **écris** sur Telegram | quand tu **parles** au robot |
| Qualité attendue | bonne | faible (c'est *lui* le problème) |

Donc si « ça ne me comprend pas / réponses pas sûres » concerne **la voix**, le diagnostic ci-dessous est ciblé. Si c'est Telegram (gpt-5.5), c'est un autre sujet.

### Réellement ACTIF chez toi (les vrais coupables) — robot vocal
1. **Mode « bavardage » sans outils ni accès fichiers** — `CODEBUDDY_SENSORY_SPEAK_ACT` **n'est pas posé** → réponse = `qwen 7B` avec un tableau d'outils **vide**. Il ne peut **rien vérifier** : toute question factuelle = hallucination/esquive. → cause n°1 de « réponses pas sûres ».
2. **Cerveau = `qwen2.5:7b-instruct`** (`CODEBUDDY_SENSORY_SPEAK_MODEL`) — petit, et c'est le modèle que le code qualifie lui-même de « chat-only ». Français nuancé limité. → « réponses faibles ».
3. **Aucune mémoire de conversation entre tours** (structurel) → « et l'autre fichier ? », « non je voulais dire X » tombent à plat. → cause n°1 de « ne me comprend pas ».
4. **Réponses canned (regex) AVANT le modèle** → « ça va », « comment s'est passée ta journée » renvoient un script figé, même si tu voulais autre chose. → « ne me comprend pas ».
5. **Coupé à 1-2 phrases** (forcé) → réponses tronquées qui sonnent évasives.
6. **Persona possiblement bancale** : `CODEBUDDY_ROBOT_NAME=Lisa` ✅ mais `persona-state.json = "companion"` (pas `"lisa"`) → répond au nom « Lisa » mais parle peut-être avec le caractère générique, pas la vraie personnalité tendre de Lisa. *(à confirmer)*

### ❌ PAS ton problème (ne perds pas de temps dessus)
- **whisper-base massacre le français** → faux : tu es sur **`CODEBUDDY_SPEECH_ENGINE=parakeet`** (multilingue correct), fallback faster-whisper `small` (pas `base`). *(Caveat : si Parakeet plante silencieusement, tu retombes en `small`/beam 1 ; et tu passes par le micro live `ear.py` → un maillon Rust/Python non audité.)*
- **Sourd au nom « Lisa »** → faux : `CODEBUDDY_ROBOT_NAME=Lisa` est posé.
- **Routage vers un modèle anglophone** → faux : tu as épinglé le modèle (qwen), le routeur n'est pas utilisé.
- **Chime-in / interruptions non sollicitées** → faux : `CHIME_IN` non activé (off).
- **« C'est fait » sans vérif / résumé qui casse la réponse** → propres au **mode ACT**, que tu n'utilises pas (tu es en bavardage).

### Daemon de codage (`codebuddy-autonomy.service`, actif)
- Tourne avec **`qwen2.5:7b-instruct`** + `CODEBUDDY_SELF_IMPROVE=true`. Si tu lui donnes des tâches de code : **« completed » = sortie 0**, aucune vérif (`VERIFY_COMMANDS` non posé), et qwen 7B est « chat-only » → tâches marquées réussies sans l'être. Le self-improve tourne en boucle « théâtre de mots-clés » (cf. Partie 4). Moins prioritaire si ta plainte est conversationnelle.

---

## Partie 1 — « Il ne me comprend pas » (compréhension)

1. **STT par défaut = whisper `base` + beam 1 (greedy)** — la config la *moins* précise pour le français. Les noms propres / termes techniques ("Code Explorer", "devstral") sont massacrés. N'upgrade vers sherpa/Parakeet que si tout est bien installé, sinon retombe en silence sur whisper-base. *(`speech-reaction.ts:721,205,207` ; fallback `:910-952`)*
   - ⚠️ Ne vaut que pour le chemin **batch WAV**. Si tu utilises le micro **live**, la précision se joue dans `buddy-sense/src/senses/live_audio.rs` (non audité).
2. **Des filtres anti-hallucination SUPPRIMENT de vraies phrases.** Des motifs comme « conversation en français », « merci d'avoir regardé », « hum/euh » blanchissent ta phrase → `text=''` → **silence, sans aucun feedback**. Tu as l'impression d'être ignoré. *(`speech-reaction.ts:213-268`)*
3. **Nom/persona mal câblés.** Le hotword STT injecte toujours « Lisa », mais le portier d'adressage retombe sur **« Buddy »** si `CODEBUDDY_ROBOT_NAME` n'est pas posé → dire « Lisa » ne matche rien → **silence**. Et même réglé, `CODEBUDDY_ROBOT_NAME=lisa` choisit l'identité Lisa mais **pas** la voix/caractère parlé (il faut *aussi* activer le persona `lisa`) → répond à « Lisa » mais parle comme un robot générique. *(`respond-decider.ts:189-201` ; `companion-mode.ts:242-246`)*
4. **Aucune mémoire de conversation entre tours.** Chaque phrase part en `[system, user]` sans historique, un `CodeBuddyAgent` neuf à chaque fois. « Et l'autre fichier ? » / « non, je voulais dire X » n'ont **aucun antécédent** → réponses à côté. *(`voice-loop.ts:540-546` ; `agent-reply.ts:84`)*
5. **Demi-duplex + debounce 4 s.** Pendant que Lisa parle (+1,2 s), le micro est sourd (pas de barge-in). Une relance rapide < 4 s est jetée en silence. *(`voice-activity.ts:17-34` ; `speech-reaction.ts:962,975`)*
6. **Routage FR cassé pour le français sans accents.** Le classifieur ne met « français » que s'il voit des accents. « ca va », « lance le build » (ASCII) → type « general » → le routeur peut choisir un modèle anglophone rapide → dérive en anglais / français maladroit. *(`model-capability-heuristics.ts:38-47`)*

---

## Partie 2 — « Les réponses ne sont pas correctes » (qualité)

1. **Mode chat par défaut = LLM SANS outils, sans accès fichiers.** Si `CODEBUDDY_SENSORY_SPEAK_ACT` n'est pas activé, la réponse est un `client.chat(...)` avec un **tableau d'outils vide** sur un petit modèle local. Demande « le build est vert ? / corrige le bug » → par construction il ne peut que **halluciner ou esquiver**. *(`voice-loop.ts:91,526-552,663`)*
2. **Le modèle choisi = le plus RAPIDE = le plus PETIT.** Le sélecteur est latence-first → délibérément le plus petit/rapide. Le code l'admet lui-même : un mini tool-caller tronque son contexte et répond faux. *(`agent-reply.ts:59-73` ; `model-selector.ts:202-247`)*
3. **Une passe de « résumé » peut casser une bonne réponse.** Même quand l'agent a raison, le résultat est re-compressé en 1-2 phrases par le **petit** modèle rapide → peut perdre le fait clé ou en inventer un. *(`agent-reply.ts:101-109`)*
4. **« C'est fait. » sans aucune vérification.** Si le tour d'agent ne renvoie pas de texte final, le robot dit `« C'est fait. »` — il prétend avoir réussi en ayant peut-être **rien fait**. *(`agent-reply.ts:51,93,160`)*
5. **Troncature 1-2 phrases forcée partout** → pour tout sujet non-trivial, la vraie réponse est coupée en fragment qui *sonne* faux/évasif. Pas de « je dis l'essentiel à voix + le détail en texte ». *(`voice-loop.ts:129`)*
6. **(Variante ACT)** Si tu utilises la commande lancée par défaut, elle pose `SPEAK_ACT=true` mais en posture **`plan` = lecture seule** : « corrige le bug » → il enquête mais **ne peut pas agir**, puis doit expliquer une non-action → lu comme « réponse inutile ». *(`agent-reply.ts:14-17`)*

---

## Partie 3 — Si la plainte vise le daemon de code `buddy autonomy`

1. **« completed » = le sous-process sort en code 0.** Aucune vérif que la tâche est faite / que ça compile / que le bon fichier a changé. Un agent qui ne fait rien et sort 0 est « réussi ». *(`agent-task-executor.ts:141`)*
2. **Le seul vrai garde-fou (`verifyCommand`) est OFF par défaut ET injoignable depuis la CLI** (`tasks add` n'a pas de `--verify-command`). *(`native-engine-commands.ts:982-1017`)*
3. **Le modèle installé par défaut (`qwen2.5:7b-instruct`) est décrit par le code lui-même comme « chat-only, cannot edit »… et installé quand même.** *(`native-engine-commands.ts:1138,1176-1178`)*
4. **L'intent = `titre + description` brut**, sans critères d'acceptation (champ injoignable / boilerplate générique). Le juge évalue donc à vide. *(`agent-task-executor.ts:131-133` ; `colab-handler.ts:393`)*
5. **Le juge est fail-open partout** (erreur/garbage → `continue`) → il ne peut jamais *bloquer* un mauvais résultat, juste le retarder.
6. **Self-improvement = théâtre de mots-clés** : la « gate empirique » des leçons/skills vérifie juste que le modèle a recraché les mots-clés qu'on lui a dits d'inclure (circulaire). Les vraies gates rigoureuses (held-out, paired-live, corpus) existent **mais ne tournent pas en autonome**. *(`capability-benchmark.ts:25-45` ; `proposer.ts:104`)*

---

## Ce que disent les bonnes pratiques 2026 (recherche web)

- **Grounding / RAG** : « arrête de demander au modèle de se souvenir, mets les faits devant lui ». → exactement ce que le **mode chat ne fait pas**.
- **Quand l'audio est insuffisant, demander de répéter** (pas supprimer en silence). → l'inverse du point 1.2.
- **SLM rapide OK — mais fine-tuné/calibré**, pas « le plus petit qui passe ». Un 0,6B *fine-tuné* bat un gros teacher sur intent ; « le plus petit brut » non.
- **Juge / cross-validation réels & fail-closed sur les décisions critiques** (seuils 0,98-0,99 pour le wake word). → l'inverse du fail-open + nom-gate sourd.
- **Tester l'intent en multi-tour** : « on ne détecte pas un intent fragile au runtime si on ne l'a jamais cartographié ». → l'inverse de l'absence de mémoire conversationnelle.

Sources : getmaxim.ai (qualité de réponse), openreview.net / arxiv 2604.23366 (grounding contre hallucination), distillabs.ai (SLM vs latence), picovoice.ai & arxiv 2604.08412 (wake-word / device-addressed), joekarlsson.com & towardsai (assistant vocal local).

---

## Verdict

Tu n'as pas tort de sentir que « ça ne te comprend pas ». **Ce n'est pas dans ta tête** : par défaut, chaque maillon est réglé sur le moins cher, et la somme = mal entendre + répondre vite-mais-faux + parfois t'ignorer sans rien dire. La bonne nouvelle : **l'essentiel se corrige par configuration** (engine STT, modèle, nom/persona, mémoire), pas par une réécriture.

### Plan par effet de levier (à valider avant de coder)

**Quick wins (config, ~minutes) :**
- Forcer un meilleur STT : `CODEBUDDY_SPEECH_ENGINE=sherpa-rs` (ou faster-whisper `small`/`medium`, beam>1).
- Poser le nom **et** le persona : `CODEBUDDY_ROBOT_NAME=lisa` **+** persona `lisa` actif.
- Activer le mode utile : `CODEBUDDY_SENSORY_SPEAK_ACT=true` + épingler un **bon** modèle (`CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL=`…capable, pas le plus petit).
- Réduire le debounce, donner une posture qui permet d'agir si tu le veux (`dontAsk`, prudemment).

**Corrections code (petites, ciblées) :**
- Mémoire conversationnelle sur N derniers tours dans le chemin vocal.
- « Je n'ai pas bien entendu, tu peux répéter ? » au lieu du silence sur transcript vide.
- Détecter le français même sans accents (router FR).
- Côté daemon : vérif réelle au lieu de « exit 0 = fait » + warning bloquant sur modèle non-éditeur.

---

## ✅ APPLIQUÉ le 2026-06-30 — choix « les deux » (Lisa tendre + capable + mémoire)

### ⚠️ Découverte en testant en réel → choix (A) routage gpt-5.5
- **devstral 24B LOCAL = trop lent** : mesuré ~27 tok/s prompt-eval → un tour d'agent = PLUSIEURS MINUTES (test tué à 4,5 min). Inutilisable pour la voix.
- **gpt-5.5 via ChatGPT OAuth/Codex = la solution** : appel brut **1,2 s** ; tour d'agent FONDÉ (a lu le vrai `package.json` via `view_file`, 22,5k tokens en entrée) → réponse correcte « version 1.7.0 » en **9,3 s, $0**. ✅ Validé bout en bout.
- Patrice a choisi **(A)**. Le bavardage reste LOCAL (qwen, instantané) ; seules les vraies questions partent vers gpt-5.5.

### Config (réversible — sauvegardes `*.bak.*` dans `~/.codebuddy/`)
- **Persona `lisa`** (`persona-state.json` : `companion` → `lisa`) → vraie personnalité tendre. *(n'impose pas de voix → garde ta voix Piper, pas de mutisme — vérifié)*
- **Mode action ON, lecture seule** : `CODEBUDDY_SENSORY_SPEAK_ACT=true` + `_PERMISSION_MODE=plan`.
- **Agent vocal = gpt-5.5** : `CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL=gpt-5.5` (route OAuth/Codex auto, $0). `_SPEAK_MODEL=qwen2.5:7b` reste pour le bavardage + le résumé parlé.
- **Grounding dépôt** : `CODEBUDDY_SENSORY_SPEAK_CWD=~/code-buddy` (l'agent lit tes vrais fichiers, en lecture seule).

### Code (compilé, typecheck OK, lint OK, 11 nouveaux tests verts)
- **`src/sensory/hybrid-reply.ts`** (nouveau) — aiguillage : phatique → ligne chaleureuse instantanée ; bavardage/émotion → réponse Lisa rapide ; **vraie question/commande → tour d'agent fondé** (lit/cherche puis résume) *quand ACT on*. + **mémoire conversationnelle** (préambule de contexte) pour « et l'autre fichier ? ». Heuristique `isSubstantiveQuery` (gère la perte d'accents STT). Injectable, never-throws.
- **`src/sensory/voice-loop.ts`** — `defaultReply` accepte un historique (mémoire) + exporté.
- **`src/sensory/agent-reply.ts`** — route un modèle gpt-5.x/codex épinglé vers le backend OAuth/Codex ($0) au lieu d'Ollama ; **fallback honnête** : en lecture seule, sortie vide → « je n'ai pas réussi à vérifier » (plus de « C'est fait. » mensonger, finding #10).
- **`src/server/index.ts`** — les DEUX chemins via `makeHybridReply`. ACT on → agent fondé gpt-5.5 + `cwd` dépôt + **ack parlé** (« d'accord, je regarde ça ») pour combler l'attente ; ACT off → bavardage+mémoire.
- **`tests/sensory/hybrid-reply.test.ts`** (nouveau, 11) + `agent-reply.test.ts` (posture honnête). 33 tests verts.

### Vérifié en réel
- Persona → `robotName=Lisa`, spokenPrompt tendre. ✅
- Bavardage live ($0, qwen) : « bonjour » instantané ; « tu m'as manqué » → réponse tendre féminine + mémoire. ✅
- **Justesse gpt-5.5/OAuth** : appel brut 1,2 s ; tour d'agent qui **lit le vrai package.json** (`view_file`) → « version 1.7.0 » correct en **9,3 s, $0**. ✅
- Service redémarré, état final live : `speech_end → STT → gate → agent[plan] → speak` (gpt-5.5, cwd dépôt). ✅

### À surveiller / suite (au besoin)
- **Fuite MCP potentielle** : chaque vraie question construit un nouvel agent qui (re)lance les serveurs MCP de `mcp.json` (pdfcommander échoue déjà) — sur un serveur long-vivant ça peut s'accumuler. À surveiller ; si besoin, désactiver MCP pour l'agent vocal.
- Bavardage FR plus propre : `gemma4:12b` au lieu de qwen 7B (latence/VRAM en plus).
- Côté daemon de code (`buddy autonomy`) : vérif réelle au lieu de « exit 0 = fait » (Partie 3).
- Changements `src/` **non commités** (à revoir/commiter quand tu veux).
