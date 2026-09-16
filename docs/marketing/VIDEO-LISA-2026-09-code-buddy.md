# VIDEO — Code Buddy 2.0

Chaîne **Lisa IA** · publication 09/09/2026 · voix ElevenLabs · avatar Lisa  
Durée cible voix : 10 à 12 min · débit visé ~160 mots/min · **le texte à l'écran = le script, mot pour mot**  
Citations `[fichier:ligne]` devant chaque chiffre : à retirer à la relecture.

Les 5 cases

| Case | Valeur |
| --- | --- |
| STAR | Code Buddy 2.0 (Lisa parle en « je » pour le studio Agile Up) |
| CHIFFRE | [README.md:35] 64 fournisseurs, zéro rupture depuis la [README.md:38] 1.8.0 |
| ENNEMI | l'agent qui promet et qui casse l'interface |
| MÉTAPHORE | cinq pièces autour d'un moteur qui, lui, n'a pas bougé |
| TWIST (~70 %) | ce qui n'est pas prêt est dans le README, section Not ready — avant le CTA npm |

---

## 1) Titre

**Titre retenu (38 caractères)**

```
Code Buddy 2.0 vient de sortir sur npm
```

**Repli 1 (50 caractères)**

```
Code Buddy 2.0 : 64 fournisseurs, rien n'est cassé
```

**Repli 2 (48 caractères)**

```
L'agent de code du studio vient de passer en 2.0
```

---

## 2) Miniature

**Texte (3 mots)** : `2.0 SUR NPM`

**Description visuelle.** Fond bleu nuit, grille technique discrète. À gauche, en capitales blanches outline noir : `2.0 SUR NPM` ; en dessous, plus petit, jaune : `64 FOURNISSEURS`. À droite, Lisa détourée (buste, blazer, regard caméra, légère inclinaison), lumière latérale froide. Petit carton npm en bas à gauche : `@phuetz/code-buddy`. Pas de photo d'auteur, pas de prix, pas de logo GitHub envahissant. Contraste fort, lisible à 320 px.

---

## 3) Description YouTube (~150 mots)

```
Contenu synthétique : présentatrice générée par IA. Lisa parle pour le studio Agile Up. Les faits sont sourcés.

Code Buddy 2.0 est sur npm. Un agent de code dans le terminal : il lit ton dépôt, écrit, lance des commandes. 64 fournisseurs derrière un routeur. 220+ outils choisis par requête. La 2.0 ajoute cinq surfaces, toutes optionnelles. Sans la variable d'environnement, le comportement est le même que la 1.8.0. Zéro rupture d'interface.

Un hub multi-IA : outils distants en lecture seule, trois verrous, ça ferme si la racine manque. Cowork, cockpit de bureau (install à part, Node 22). Une boucle à quatre faces, jugée sur les faits, qui ne touche jamais le src de l'agent. Un conseil de modèles dont le juge s'abstient. Une perception muette tant que tu ne l'allumes pas.

npm i -g @phuetz/code-buddy
https://www.npmjs.com/package/@phuetz/code-buddy
https://github.com/phuetz/code-buddy

Le README dit ce qui n'est pas prêt. Section Not ready.

Abonne-toi : youtube.com/@lisaiafr
#LisaIA #CodeBuddy #AgentsIA #Ollama #npm
```

---

## 4) Script — plans numérotés

Rythme : cold open 2–4 s ; ensuite un visuel toutes les 3–5 s ; Lisa en insert aux plans 1, 8, 48, 62, 78 (jamais plus de 8 s d'affilée). Karaoké = **Dit**, mot pour mot. Sources affichées en bas d'écran au format `README · Lxx` quand un chiffre est dit.

Horloge cumulée en tête de plan. Total visé **~11:05**.

### Acte 0 — Hook et promesse (0:00–0:20)

#### Plan 1 · 0:00–0:04 · 4 s · 🎥 Lisa #1
- **Dit :** Code Buddy [LINKEDIN-2026-09-code-buddy-2.0.md:11] 2.0 est sur npm.
- **Écran :** Lisa regard caméra. Carton `2.0 SUR NPM`. Karaoké identique.

#### Plan 2 · 0:04–0:08 · 4 s
- **Dit :** [README.md:35] 64 fournisseurs derrière un seul routeur.
- **Écran :** infographie routeur, [README.md:35] 64 pastilles (cloud / passerelle / local). Karaoké identique.

#### Plan 3 · 0:08–0:12 · 4 s
- **Dit :** Et rien n'a cassé depuis la [README.md:38] 1.8.
- **Écran :** timeline `1.8.0 → 2.0.0`, tampon `0 BREAKING CHANGE` [README.md:38] [RELEASE-NOTES-2.0.0.md:15].

#### Plan 4 · 0:12–0:16 · 4 s
- **Dit :** Aujourd'hui je te montre ce que la [README.md:33] 2.0 ajoute, comment tu l'installes, et ce qui n'est pas prêt.
- **Écran :** trois cartons qui s'empilent : AJOUTS / INSTALL / NOT READY.

#### Plan 5 · 0:16–0:20 · 4 s
- **Dit :** Tout vient d'un README, de notes de version, d'un post daté du [LINKEDIN-2026-09-code-buddy-2.0.md:3] 9 septembre. Pas d'un slogan.
- **Écran :** trois fichiers sources, noms lisibles. Bandeau `09/09/2026`.

---

### Acte 1 — Le moteur n'a pas bougé, trois commandes (0:20–2:38)

#### Plan 6 · 0:20–0:25 · 5 s
- **Dit :** La [README.md:35] 1.x, c'était un agent de code dans le terminal.
- **Écran :** terminal plein cadre, prompt `buddy`.

#### Plan 7 · 0:25–0:30 · 5 s
- **Dit :** Il lit ton dépôt, il écrit du code, il lance des commandes.
- **Écran :** GIF `docs/assets/coding-demo.gif` (dépôt code-buddy).

#### Plan 8 · 0:30–0:35 · 5 s · 🎥 Lisa #2
- **Dit :** Et tu peux le regarder travailler — sur ta machine.
- **Écran :** Lisa + insert `docs/qa/code-buddy-studio/cowork-demo-moneyshot.gif`.

#### Plan 9 · 0:35–0:40 · 5 s
- **Dit :** Avec Ollama en local. Ou avec l'abonnement ChatGPT que tu as déjà, sans clé API.
- **Écran :** split Ollama | ChatGPT, bandeau `buddy login` [README.md:82].

#### Plan 10 · 0:40–0:44 · 4 s
- **Dit :** `buddy login` accepte aussi `xai` [README.md:86].
- **Écran :** capture à enregistrer : `buddy login --help` (voir liste captures). Karaoké : `buddy login accepte aussi xai`.

#### Plan 11 · 0:44–0:49 · 5 s
- **Dit :** La [README.md:36] 2.0 garde tout ça. Et elle ajoute [README.md:36] cinq surfaces autour.
- **Écran :** schéma moteur central + 5 pièces qui s'enclenchent.

#### Plan 12 · 0:49–0:55 · 6 s
- **Dit :** Chacune est optionnelle. Si tu n'allumes pas la variable d'environnement, le comportement est le même que la [README.md:38] 1.8.0.
- **Écran :** interrupteurs tous OFF, label `1.8.0`.

#### Plan 13 · 0:55–0:59 · 4 s
- **Dit :** Il n'y a aucune rupture d'interface dans la gamme [README.md:38] 2.0.
- **Écran :** tampon `0 BREAKING CHANGE` [RELEASE-NOTES-2.0.0.md:15].

#### Plan 14 · 0:59–1:04 · 5 s
- **Dit :** [README.md:36] 220 outils et plus, choisis par requête. Toujours là. Rien de ça n'a bougé.
- **Écran :** compteur `220+` [README.md:36], liste d'outils qui défile.

#### Plan 15 · 1:04–1:09 · 5 s
- **Dit :** Pour installer : [README.md:78] trois commandes. Le plancher, c'est Node [README.md:78] 20.
- **Écran :** carton `Node ≥ 20` [README.md:78] [README.md:182].

#### Plan 16 · 1:09–1:16 · 7 s
- **Dit :** `npm i -g @phuetz/code-buddy`. Le paquet est scopé : `code-buddy` tout court n'est pas sur npm [README.md:81].
- **Écran :** capture à enregistrer, dossier `captures/code-buddy/` : la commande et le prompt. Karaoké identique.

#### Plan 17 · 1:16–1:22 · 6 s
- **Dit :** Puis `buddy login` — ChatGPT, sans clé API [README.md:82]. Ou tu sautes le login. Tu lances Ollama. Tu fais `buddy onboard` [README.md:87].
- **Écran :** GIF `docs/assets/login-demo.gif` puis carton `buddy onboard`.

#### Plan 18 · 1:22–1:28 · 6 s
- **Dit :** Dans les deux cas, `buddy doctor` te dit en une ligne si tu es prêt [README.md:87].
- **Écran :** GIF `docs/assets/showcase-doctor.gif`.

#### Plan 19 · 1:28–1:35 · 7 s
- **Dit :** `buddy doctor --fix` peut pointer un Ollama qui tourne vers un modèle déjà installé, et dire pourquoi il l'a choisi [README.md:88].
- **Écran :** capture à enregistrer : `buddy doctor --fix` (Ollama local). Ligne de raison visible.

#### Plan 20 · 1:35–1:42 · 7 s
- **Dit :** Sur un poste vierge, l'install a été chronométrée à [LINKEDIN-2026-09-code-buddy-2.0.md:3] 116 secondes. `buddy --version` a répondu [LINKEDIN-2026-09-code-buddy-2.0.md:3] 2.0.0.
- **Écran :** chrono `116 s` + sortie `2.0.0`. Source en bas : LinkedIn 09/09/2026.

#### Plan 21 · 1:42–1:47 · 5 s
- **Dit :** Un tour headless contre Ollama local : OK [LINKEDIN-2026-09-code-buddy-2.0.md:3].
- **Écran :** terminal headless, tampon `OK`.

#### Plan 22 · 1:47–1:55 · 8 s
- **Dit :** Un vrai premier geste, du début à la fin. `buddy loop`, avec une commande de vérification [README.md:106].
- **Écran :** commande exacte à l'écran : `buddy loop "make the failing tests pass" --verify-cmd "npm test"` [README.md:110].

#### Plan 23 · 1:55–2:03 · 8 s
- **Dit :** L'agent planifie, édite, lance ta commande, et s'arrête seulement quand cette commande sort avec le code [README.md:107] 0. La parole du modèle n'est pas la preuve [README.md:107].
- **Écran :** schéma PLANIFIER → ÉDITER → VÉRIFIER → stop si exit 0.

#### Plan 24 · 2:03–2:08 · 5 s
- **Dit :** Le tour de [README.md:116] 60 secondes : `buddy try`.
- **Écran :** GIF `docs/assets/showcase-try.gif`. Carton `60 s`.

#### Plan 25 · 2:08–2:14 · 6 s
- **Dit :** Il écrit FizzBuzz. Il écrit un test. Il le lance. Il vérifie tout seul [README.md:116].
- **Écran :** même GIF, zoom sur le test qui passe.

#### Plan 26 · 2:14–2:20 · 6 s
- **Dit :** Headless, pour un script ou la CI : `buddy -p`, une question, une réponse [README.md:117].
- **Écran :** `buddy -p "explain the entry point"` [README.md:116].

#### Plan 27 · 2:20–2:26 · 6 s
- **Dit :** `buddy research` cartographie un dépôt avec des workers en parallèle [README.md:118]. `buddy cost --latency` mesure le temps jusqu'au premier jeton, en lecture seule [README.md:119].
- **Écran :** deux cartons commandes, jump cut 3 s.

#### Plan 28 · 2:26–2:32 · 6 s
- **Dit :** Tu vois un modèle local raisonner à l'écran, puis créer un vrai fichier [README.md:26].
- **Écran :** `docs/qa/code-buddy-studio/cowork-demo-moneyshot.mp4` (ou le GIF).

#### Plan 29 · 2:32–2:38 · 6 s
- **Dit :** Pas une démo dessinée. Un fichier réel. C'est le moteur. Maintenant, les cinq pièces.
- **Écran :** freeze du fichier créé, puis schéma 5 pièces.

---

### Acte 2 — La flotte, trois verrous, ça ferme (2:38–4:28)

#### Plan 30 · 2:38–2:44 · 6 s
- **Dit :** Premier ajout : un hub multi-IA [README.md:40].
- **Écran :** GIF `docs/qa/code-buddy-studio/cowork-demo-fleet.gif`.

#### Plan 31 · 2:44–2:50 · 6 s
- **Dit :** Plusieurs Code Buddy qui tournent `buddy server` s'observent et s'appellent [README.md:40].
- **Écran :** deux processus, flèches d'événements.

#### Plan 32 · 2:50–2:56 · 6 s
- **Dit :** Un message : `peer.chat`. Une session multi-tours : `peer.chat-session` [README.md:41].
- **Écran :** deux cartons API, jump cut.

#### Plan 33 · 2:56–3:02 · 6 s
- **Dit :** Un outil distant : `peer.tool.invoke` — en lecture seule [README.md:42].
- **Écran :** tampon `READ-ONLY` sur l'appel.

#### Plan 34 · 3:02–3:08 · 6 s
- **Dit :** Cet appel-là passe [README.md:42] trois verrous, dans l'ordre.
- **Écran :** trois portes numérotées 1-2-3.

#### Plan 35 · 3:08–3:12 · 4 s
- **Dit :** Une liste blanche [README.md:43].
- **Écran :** porte 1 `allowlist`.

#### Plan 36 · 3:12–3:16 · 4 s
- **Dit :** Un drapeau `fleetSafe` par outil [README.md:43].
- **Écran :** porte 2 `fleetSafe`.

#### Plan 37 · 3:16–3:20 · 4 s
- **Dit :** Une racine de travail [README.md:43].
- **Écran :** porte 3 `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` [README.md:157].

#### Plan 38 · 3:20–3:27 · 7 s
- **Dit :** Si la racine n'est pas posée, ça ferme [README.md:43]. Un pair mal configuré n'expose pas son disque [README.md:44].
- **Écran :** porte 3 rouge, disque grisé. Bandeau `fail closed`.

#### Plan 39 · 3:27–3:35 · 8 s
- **Dit :** La flotte, ce n'est pas un interrupteur. C'est [README.md:189] deux processus et un JWT [README.md:189].
- **Écran :** schéma 2 process + JWT. Source `README · Not ready`.

#### Plan 40 · 3:35–3:42 · 7 s
- **Dit :** Les outils distants n'exposent rien tant que la racine n'est pas posée [README.md:190]. C'est écrit dans Not ready. Je te le dis avant de t'inviter à l'allumer.
- **Écran :** extrait README section Not ready, phrase surlignée.

#### Plan 41 · 3:42–3:50 · 8 s
- **Dit :** Dans une session, `/batch` découpe un objectif en sous-agents bornés [README.md:128]. Chaque unité est un vrai agent, pas une complétion nue [README.md:129].
- **Écran :** un objectif → N agents bornés.

#### Plan 42 · 3:50–3:56 · 6 s
- **Dit :** La concurrence par défaut vaut [README.md:130] 1. `CODEBUDDY_BATCH_CONCURRENCY` la plafonne [README.md:129].
- **Écran :** `CODEBUDDY_BATCH_CONCURRENCY=1`.

#### Plan 43 · 3:56–4:04 · 8 s
- **Dit :** Un routeur de tâches : `route_peer`, ou `/fleet route`. Il classe un prompt, ramasse les capacités des pairs, applique vie privée, coût, latence. Un lint de vie privée passe en premier [RELEASE-NOTES-2.0.0.md:51].
- **Écran :** schéma routeur : privacy → cost → latency.

#### Plan 44 · 4:04–4:12 · 8 s
- **Dit :** Les sessions multi-tours sont sérialisées FIFO, avec un TTL d'inactivité, persistées. `list` rend des métadonnées seulement — jamais le prompt, jamais la réponse [RELEASE-NOTES-2.0.0.md:46].
- **Écran :** `peer.chat-session.list` → metadata only.

#### Plan 45 · 4:12–4:20 · 8 s
- **Dit :** Sandbox noyau pour `bash`, optionnelle, et ça ferme : si le confinement ne s'applique pas, la commande ne tourne pas sans bac [RELEASE-NOTES-2.0.0.md:83].
- **Écran :** chaîne `Bubblewrap → Landlock → sandbox-exec` [RELEASE-NOTES-2.0.0.md:83].

#### Plan 46 · 4:20–4:28 · 8 s
- **Dit :** Un portail de relecture de diff, avant application, sur les [RELEASE-NOTES-2.0.0.md:85] cinq surfaces d'écriture. Un diff illisible n'est pas appliqué, il est rejeté [README.md:156].
- **Écran :** `CODEBUDDY_DIFF_REVIEW` [README.md:156], tampon REJECT.

---

### Acte 3 — Cowork et dix interrupteurs (4:28–6:28)

#### Plan 47 · 4:28–4:34 · 6 s
- **Dit :** Deuxième surface : Cowork. Une application de bureau, Electron [README.md:46].
- **Écran :** `docs/assets/cowork-welcome.png`.

#### Plan 48 · 4:34–4:40 · 6 s · 🎥 Lisa #3
- **Dit :** Un runner de workflows visuels. Une médiathèque. Un studio vidéo [README.md:47].
- **Écran :** Lisa en PiP + `docs/assets/cowork-panels-demo.gif`.

#### Plan 49 · 4:40–4:46 · 6 s
- **Dit :** Ce n'est pas dans les [README.md:183] trois commandes du début [README.md:183].
- **Écran :** les 3 commandes grisées, Cowork à part.

#### Plan 50 · 4:46–4:52 · 6 s
- **Dit :** Il faut Node [README.md:47] 22. Puis `buddy install-gui`. Puis `buddy gui` [README.md:99].
- **Écran :** `Node ≥ 22` → `buddy install-gui` → `buddy gui`.

#### Plan 51 · 4:52–4:58 · 6 s
- **Dit :** App Studio, tu le vois scaffolder, lancer le serveur, montrer l'aperçu [LINKEDIN-2026-09-code-buddy-2.0.md:5].
- **Écran :** GIF `docs/assets/showcase-appstudio.gif`.

#### Plan 52 · 4:58–5:04 · 6 s
- **Dit :** Autour, [README.md:49] dix innovations. Toutes optionnelles.
- **Écran :** grille 10 cases vides qui se nomment une à une (plans suivants, 3–5 s).

#### Plan 53 · 5:04–5:09 · 5 s
- **Dit :** Des écritures validées dans un worktree fantôme avant de toucher tes fichiers [README.md:49].
- **Écran :** case 1 `CODEBUDDY_SHADOW_WORKSPACE` [README.md:148].

#### Plan 54 · 5:09–5:14 · 5 s
- **Dit :** Des sessions avec voyage dans le temps, tour par tour [README.md:50].
- **Écran :** case 2 `CODEBUDDY_TIMELINE` [README.md:149] · `buddy replay`.

#### Plan 55 · 5:14–5:19 · 5 s
- **Dit :** Des spécifications d'intention que tu peux refaire mentir plus tard [README.md:50].
- **Écran :** case 3 `CODEBUDDY_INTENTS` [README.md:150].

#### Plan 56 · 5:19–5:24 · 5 s
- **Dit :** Une fédération de graphe en pull only entre pairs, fermée des deux côtés si ça dérape [README.md:50] [README.md:154].
- **Écran :** case 4 `CODEBUDDY_CKG_SYNC`.

#### Plan 57 · 5:24–5:28 · 4 s
- **Dit :** Un auto-benchmark de capacité [README.md:50].
- **Écran :** case 5 `CODEBUDDY_SELF_BENCH` [README.md:153].

#### Plan 58 · 5:28–5:33 · 5 s
- **Dit :** Une compaction que l'agent peut redéplier [README.md:51].
- **Écran :** case 6 `CODEBUDDY_CONTEXT_ZOOM` [README.md:151].

#### Plan 59 · 5:33–5:37 · 4 s
- **Dit :** Des widgets génératifs [README.md:51].
- **Écran :** case 7, GIF `docs/qa/code-buddy-studio/cowork-demo-extensibility.gif`.

#### Plan 60 · 5:37–5:44 · 7 s
- **Dit :** Une veille des erreurs à l'écran — débouncée, plafonnée, elle n'agit jamais toute seule [README.md:159].
- **Écran :** case 8 `CODEBUDDY_SENSORY_ERRORWATCH`.

#### Plan 61 · 5:44–5:49 · 5 s
- **Dit :** Des paquets de compétences signés. Une recherche en lecture seule sur plusieurs dépôts [README.md:51].
- **Écran :** cases 9–10 `CODEBUDDY_WORKSPACE` [README.md:152].

#### Plan 62 · 5:49–5:55 · 6 s · 🎥 Lisa #4 (contrat)
- **Dit :** Rien de tout ça n'est allumé par défaut. Le tableau des interrupteurs est dans le README [README.md:141].
- **Écran :** Lisa + tableau Opt-in du README.

#### Plan 63 · 5:55–6:02 · 7 s
- **Dit :** `buddy --yolo`, ou `/yolo on` : autonomie complète, avec garde-fous [README.md:163]. Poser `YOLO_MODE=true` tout seul, ça prévient. Ça n'arme pas [README.md:163].
- **Écran :** `YOLO_MODE=true` → WARN, pas ARM.

#### Plan 64 · 6:02–6:10 · 8 s
- **Dit :** Un serveur, un port. `buddy server` ouvre un seul port, avec `/ws` dessus. Un deuxième port, c'est un deuxième processus [RELEASE-NOTES-2.0.0.md:118].
- **Écran :** un port, `/ws`.

#### Plan 65 · 6:10–6:18 · 8 s
- **Dit :** CORS n'est pas un contrôle d'accès. Une origine non listée reçoit un [RELEASE-NOTES-2.0.0.md:121] 200 sans en-tête. Le [RELEASE-NOTES-2.0.0.md:121] 403 n'existe que sur le handshake WebSocket. Le JWT et le réseau font le vrai travail [RELEASE-NOTES-2.0.0.md:122].
- **Écran :** schéma CORS ≠ ACL.

#### Plan 66 · 6:18–6:28 · 10 s
- **Dit :** `CODEBUDDY_MAX_CONTEXT` surcharge tout, et atteint maintenant un serveur Ollama par son endpoint de chat natif — la route compatible OpenAI ignore l'option de contexte [RELEASE-NOTES-2.0.0.md:126].
- **Écran :** split : endpoint natif OK | route OpenAI ignore.

---

### Acte 4 — Boucle, conseil, perception (6:28–8:08)

#### Plan 67 · 6:28–6:34 · 6 s
- **Dit :** Troisième surface : une boucle d'auto-amélioration. [README.md:55] Quatre faces.
- **Écran :** GIF `docs/assets/showcase-improve-tools.gif`. Quatre faces.

#### Plan 68 · 6:34–6:40 · 6 s
- **Dit :** Des leçons. Des outils que l'agent écrit lui-même. Des compétences. Des stratégies d'exécution [README.md:56].
- **Écran :** 4 cartons, 1,5 s chacun.

#### Plan 69 · 6:40–6:48 · 8 s
- **Dit :** Chaque proposition est jugée sur les faits. On l'applique sur un instantané. On re-note. On annule si ça régresse, ou si ça ne gagne rien [README.md:57].
- **Écran :** snapshot → score → rollback.

#### Plan 70 · 6:48–6:56 · 8 s
- **Dit :** Les outils maison passent des cas cachés, que le proposant n'a pas vus [README.md:58]. Une stratégie, c'est du JSON validé par un schéma. Aucun champ ne peut éteindre un garde-fou [README.md:60].
- **Écran :** held-out cases + JSON schema, champ `disable_guard` barré.

#### Plan 71 · 6:56–7:02 · 6 s
- **Dit :** La boucle ne touche jamais le dossier `src/` de l'agent. C'est un invariant scanné [README.md:60].
- **Écran :** `src/` cadenassé.

#### Plan 72 · 7:02–7:10 · 8 s
- **Dit :** `buddy improve status` montre l'état local [README.md:132]. Les cycles sont en propose-only par défaut [README.md:133].
- **Écran :** capture à enregistrer : `buddy improve status`.

#### Plan 73 · 7:10–7:18 · 8 s
- **Dit :** Pour garder un résultat validé, il faut `CODEBUDDY_SELF_IMPROVE=true` et passer `--apply` [README.md:134]. Sans la variable, `--apply` refuse, et nomme la variable [README.md:135].
- **Écran :** terminal : refus + nom de la variable.

#### Plan 74 · 7:18–7:26 · 8 s
- **Dit :** Un conseil de modèles. Plusieurs modèles répondent sous un contrat de sortie falsifiable. Un juge note. Un tableau de score retient qui gagne quel type de tâche [README.md:62].
- **Écran :** GIF `docs/assets/showcase-reasoning.gif` + scoreboard.

#### Plan 75 · 7:26–7:32 · 6 s
- **Dit :** Le juge s'abstient plutôt que de deviner [README.md:64].
- **Écran :** carton `ABSTAIN > GUESS`.

#### Plan 76 · 7:32–7:38 · 6 s
- **Dit :** Le banc de capacité utilisé comme fitness est passé de [RELEASE-NOTES-2.0.0.md:71] 3 contrôles par sous-chaîne à [RELEASE-NOTES-2.0.0.md:71] 15 scénarios, chacun ancré à un invariant documenté.
- **Écran :** `3 → 15`.

---

### CTA · ~70 % (7:38–8:08)

#### Plan 77 · 7:38–7:46 · 8 s · 🎥 Lisa #5
- **Dit :** Si tu veux l'essayer maintenant : `npm i -g @phuetz/code-buddy` [README.md:81]. Le lien npm est en description.
- **Écran :** Lisa + commande npm + URL `npmjs.com/package/@phuetz/code-buddy`. Bouton S'ABONNER.

#### Plan 78 · 7:46–7:54 · 8 s
- **Dit :** Abonne-toi si tu veux la suite. La prochaine : lm-resizer — comment on évite de noyer l'agent sous les logs. Puis Code Explorer — la carte du dépôt.
- **Écran :** trois briques : Buddy / lm-resizer / Explorer.

#### Plan 79 · 7:54–8:08 · 14 s
- **Dit :** Une couche de perception. Un démon Rust : audio, vision, écran, focus, battement [README.md:66]. Les événements passent par un pont en loopback seulement [README.md:67]. Parole, réactions caméra, rappels parlés s'appuient dessus. Ça reste muet tant que tu ne l'allumes pas [README.md:68].
- **Écran :** `buddy-sense/docs/architecture.svg`. Puis `CODEBUDDY_SENSORY` OFF.

---

### Acte 5 — L'échelle, puis Not ready (8:08–11:05)

#### Plan 80 · 8:08–8:14 · 6 s
- **Dit :** Voix et robot demandent des binaires en plus. Ils ne viennent pas de `npm install` [README.md:192].
- **Écran :** STT / TTS / caméra hors paquet npm.

#### Plan 81 · 8:14–8:20 · 6 s
- **Dit :** L'échelle, pour situer. Pas pour impressionner.
- **Écran :** Lisa voix off, tableau vide qui se remplit.

#### Plan 82 · 8:20–8:28 · 8 s
- **Dit :** Au bump [RELEASE-NOTES-2.0.0.md:12] 2.0.0 : [RELEASE-NOTES-2.0.0.md:12] 575 commits depuis la [RELEASE-NOTES-2.0.0.md:12] 1.8.0.
- **Écran :** `575 commits`. Source `RELEASE-NOTES · L12`.

#### Plan 83 · 8:28–8:36 · 8 s
- **Dit :** Sur la branche : [RELEASE-NOTES-2.0.0.md:13] 1814, avec une campagne de durcissement en septembre [RELEASE-NOTES-2.0.0.md:13].
- **Écran :** `1814 commits`.

#### Plan 84 · 8:36–8:44 · 8 s
- **Dit :** [RELEASE-NOTES-2.0.0.md:14] 661 correctifs. [RELEASE-NOTES-2.0.0.md:14] 537 docs. [RELEASE-NOTES-2.0.0.md:14] 234 fonctionnalités. [RELEASE-NOTES-2.0.0.md:14] 170 tests. [RELEASE-NOTES-2.0.0.md:14] 49 chores.
- **Écran :** barres 661 / 537 / 234 / 170 / 49, une toutes les ~1,5 s.

#### Plan 85 · 8:44–8:50 · 6 s
- **Dit :** [RELEASE-NOTES-2.0.0.md:15] Zéro footer `BREAKING CHANGE`. [RELEASE-NOTES-2.0.0.md:15] Zéro sujet avec un point d'exclamation de rupture.
- **Écran :** `0 BREAKING` · `0 !:`.

#### Plan 86 · 8:50–8:58 · 8 s
- **Dit :** Le prompt système a été mesuré bloc par bloc. De [RELEASE-NOTES-2.0.0.md:98] 203 674 caractères à [RELEASE-NOTES-2.0.0.md:99] 49 489.
- **Écran :** jauge qui descend 203 674 → 49 489.

#### Plan 87 · 8:58–9:06 · 8 s
- **Dit :** Le fichier `TOOLS.md` faisait [RELEASE-NOTES-2.0.0.md:99] 66 pour cent du total. Il n'est plus injecté : les outils ont déjà leur schéma [RELEASE-NOTES-2.0.0.md:99].
- **Écran :** `TOOLS.md 66 %` barré.

#### Plan 88 · 9:06–9:14 · 8 s
- **Dit :** Les fichiers de démarrage canoniques sont `AGENTS.md` et `CODEBUDDY.md` [RELEASE-NOTES-2.0.0.md:100]. Les fichiers d'interop — `CLAUDE.md`, `GEMINI.md`, `CONTEXT.md`, `INSTRUCTIONS.md` — reviennent dans le prompt seulement si tu l'allumes [RELEASE-NOTES-2.0.0.md:102].
- **Écran :** `CODEBUDDY_INCLUDE_INTEROP_CONTEXT` [README.md:161].

#### Plan 89 · 9:14–9:24 · 10 s
- **Dit :** Sur un paquet installé dans un dossier vide, sans optionnel, sans config : [RELEASE-NOTES-2.0.0.md:139] 22 commandes sur [RELEASE-NOTES-2.0.0.md:139] 103 plantaient au démarrage. Plus maintenant. `loop`, `goal`, `research`, `flow`, `tools` : elles démarrent [RELEASE-NOTES-2.0.0.md:140].
- **Écran :** `22 / 103 crashed → 0`.

#### Plan 90 · 9:24–9:32 · 8 s
- **Dit :** Le coût headless est honnête. Un run derrière un abonnement rapporte `total: 0`, au lieu d'un chiffre fabriqué [RELEASE-NOTES-2.0.0.md:110].
- **Écran :** JSON `pricing: subscription` · `total: 0`. (Pas un prix de vente : le champ renvoyé.)

#### Plan 91 · 9:32–9:40 · 8 s
- **Dit :** Si un fournisseur substitue un modèle, la sortie nomme le modèle effectif, et le modèle demandé quand ils diffèrent [RELEASE-NOTES-2.0.0.md:113].
- **Écran :** `{ model, requestedModel }`.

#### Plan 92 · 9:40–9:48 · 8 s
- **Dit :** La publication npm porte une attestation de provenance signée, depuis GitHub Actions. Pas de jeton longue durée [README.md:175].
- **Écran :** badge provenance npm.

#### Plan 93 · 9:48–9:54 · 6 s
- **Dit :** Environ [LINKEDIN-2026-09-code-buddy-2.0.md:23] 27 000 tests.
- **Écran :** `~27 000 tests`. Source en bas : LinkedIn 09/09/2026 (pas le README).

#### Plan 94 · 9:54–10:00 · 6 s
- **Dit :** Maintenant, ce qui n'est pas prêt. C'est dans le README, section Not ready. Je te le lis comme c'est écrit [README.md:171].
- **Écran :** titre de section `Not ready`.

#### Plan 95 · 10:00–10:10 · 10 s
- **Dit :** Le npm peut retarder sur cet arbre [README.md:175]. [README.md:175] 2.0.0 est sur npm, avec provenance. Les commits après le tag arrivent avec la prochaine release. Vérifie `buddy --version` après l'install [README.md:177].
- **Écran :** capture `buddy --version` → `2.0.0`.

#### Plan 96 · 10:10–10:20 · 10 s
- **Dit :** Seules les jambes Linux de la CI sont bloquantes [README.md:178]. macOS et Windows tournent en best-effort. Leurs résultats se voient, ils ne ferment pas un build vert [README.md:179]. L'exécution de shell interactif sur macOS est un problème ouvert [README.md:180].
- **Écran :** CI : Ubuntu blocking · macOS/Windows best-effort.

#### Plan 97 · 10:20–10:28 · 8 s
- **Dit :** Node [README.md:181] 20 est le vrai plancher, CLI et toolchain de tests [README.md:182]. Cowork est une install à part [README.md:183].
- **Écran :** `engines Node ≥ 20` · Cowork à part.

#### Plan 98 · 10:28–10:36 · 8 s
- **Dit :** La prod de film a besoin de `ffmpeg` [README.md:185]. Sans binaire de voix local, les scènes restent muettes plutôt que d'inventer un commentaire [README.md:185].
- **Écran :** `ffmpeg` manquant → scènes silencieuses. Pas de voix fake.

#### Plan 99 · 10:36–10:44 · 8 s
- **Dit :** `buddy loop` a besoin d'un modèle qui appelle vraiment les outils [README.md:187]. Un tout petit modèle peut caler, ou abandonner, sans jamais passer la suite au vert [README.md:187].
- **Écran :** petit modèle → stall.

#### Plan 100 · 10:44–10:52 · 8 s
- **Dit :** `better-sqlite3` est natif [README.md:193]. Optionnel, il se dégrade proprement. Cowork le reconstruit contre les en-têtes Electron [README.md:194].
- **Écran :** native module · degrade clean.

#### Plan 101 · 10:52–11:00 · 8 s · 🎥 Lisa #6
- **Dit :** Ce qui n'est pas prêt est écrit noir sur blanc. Je préfère ça à une promesse [LINKEDIN-2026-09-code-buddy-2.0.md:27].
- **Écran :** Lisa regard caméra. Punchline en capitales.

#### Plan 102 · 11:00–11:05 · 5 s
- **Dit :** `npm i -g @phuetz/code-buddy`. Lien en description. À tout de suite.
- **Écran :** carton final commande + npm + `@lisaiafr`.

---

**Durée voix estimée : 11 min 05 s.**  
**Plans : 102 (médiane ~6 s, cold open ≤ 4 s, aucun insert Lisa > 8 s).**

---

## 5) Captures à enregistrer

Dossier de dépôt des fichiers : `videos-lisa-2026-09-09/captures/code-buddy/`  
Racine des GIF/PNG déjà dans le dépôt produit : `~/DEV/code-buddy-main-release/`  
Ne pas modifier ce dépôt. Copier les assets existants vers le dossier captures, ou pointer le montage vers le chemin ci-dessous.

| # | Fichier cible | Commande / source | Dossier de travail | On doit voir |
| --- | --- | --- | --- | --- |
| C1 | `01-buddy-version.mp4` | `buddy --version` | n'importe lequel, binaire npm [LINKEDIN-2026-09-code-buddy-2.0.md:3] 2.0.0 | la ligne `2.0.0` |
| C2 | `02-npm-install.mp4` | `npm i -g @phuetz/code-buddy` | poste de tournage (ne pas rejouer sur un poste déjà installé sans le dire) | la commande scopée, fin d'install |
| C3 | `03-doctor.mp4` | `buddy doctor` | dépôt de démo | une ligne de readiness |
| C4 | `04-doctor-fix.mp4` | `buddy doctor --fix` | même, Ollama déjà lancé, un modèle installé | le modèle choisi + la raison |
| C5 | `05-try.mp4` | `buddy try` | dossier vide jetable | FizzBuzz + test + run + vérif [README.md:115] |
| C6 | `06-loop.mp4` | `buddy loop "make the failing tests pass" --verify-cmd "npm test"` | petit dépôt avec un test rouge puis vert | stop quand exit 0 |
| C7 | `07-p-headless.mp4` | `buddy -p "explain the entry point"` | `~/DEV/code-buddy-main-release` en lecture | une réponse headless |
| C8 | `08-improve-status.mp4` | `buddy improve status` | même | état local, pas d'apply |
| C9 | `09-improve-apply-refus.mp4` | `buddy improve cycle --apply` **sans** `CODEBUDDY_SELF_IMPROVE` | même | le refus qui nomme la variable [README.md:135] |
| C10 | `10-login-help.mp4` | `buddy login --help` | n'importe | mention ChatGPT / `xai` |
| A1 | (existant) | — | `docs/qa/code-buddy-studio/cowork-demo-moneyshot.gif` et `.mp4` | modèle local, fichier réel |
| A2 | (existant) | — | `docs/assets/showcase-try.gif` | FizzBuzz |
| A3 | (existant) | — | `docs/assets/showcase-doctor.gif` | doctor |
| A4 | (existant) | — | `docs/assets/showcase-appstudio.gif` | scaffold + serveur + aperçu |
| A5 | (existant) | — | `docs/assets/cowork-chat-demo.gif` | modèle local à l'écran |
| A6 | (existant) | — | `docs/assets/cowork-panels-demo.gif` · `cowork-welcome.png` | Cowork |
| A7 | (existant) | — | `docs/qa/code-buddy-studio/cowork-demo-fleet.gif` | flotte |
| A8 | (existant) | — | `docs/assets/showcase-improve-tools.gif` | improve |
| A9 | (existant) | — | `docs/assets/showcase-reasoning.gif` | raisonnement |
| A10 | (existant) | — | `buddy-sense/docs/architecture.svg` | perception |
| A11 | (existant) | — | `docs/assets/coding-demo.gif` · `login-demo.gif` | moteur / login |

Contraintes de tournage : ne pas allumer `CODEBUDDY_SELF_IMPROVE` ; ne pas lancer `buddy --yolo` ; ne pas montrer de secrets ; ne pas promettre Cowork dans les trois commandes ; si le modèle local cale sur `buddy loop`, garder le plan 99 (limite honnête) au lieu de recouper.

---

## 6) Cinq chapitres YouTube

```
00:00 Code Buddy 2.0 est sur npm
00:20 Trois commandes, le moteur n'a pas bougé
02:38 La flotte, trois verrous
04:28 Cowork et dix interrupteurs
07:38 Ce qui n'est pas prêt
```
