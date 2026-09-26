# Code Buddy — inventaire des fonctionnalités

> État établi le 25/09/2026 à partir des exécutions consignées dans `docs/preuves/`.
> Chaque preuve ci-dessous indique son fichier, sa date et le commit de code testé.
> Les verdicts historiques P1–P4 portent sur leurs commits cités. Une sonde directe sur la branche d’inventaire révèle un écart de nettoyage de sortie détaillé ci-dessous.
>
> Légende — ✅ exécuté réellement avec une mesure · 🧪 exercice partiel avec dépendance simulée · ❌ défaut observé · ⛔ non prouvable dans cette campagne. Une réussite de tests seule ne vaut pas preuve d’usage.

## Ce qui est prouvé au 25/09/2026

- L’agent a lu un fichier avec `view_file` et répondu « indigo » ; la bascule après panne du fournisseur principal a abouti sur Ollama. Les cinq modes d’autorisation et le refus d’écriture en mode `plan` ont été exercés. Bubblewrap a permis l’écriture interne et bloqué la sortie de l’espace. [P1](preuves/p1.md)
- Le contexte a été réduit de 13 à 7 messages, et un segment compacté a été restauré exactement. La mémoire épisodique a consolidé trois tours ; l’oubli a archivé puis restauré un souvenir. [P1](preuves/p1.md)
- La flotte a répondu par `peer.chat`, exécuté une lecture distante et refusé trois accès non autorisés ; un fait a été transféré et intégré. Une équipe a été créée sans tâche confiée ; deux unités `/batch` et un essaim ont abouti. [P1](preuves/p1.md)
- Le harnais Verifier a rendu `CONFIRMED` sur un oracle exécuté via un `executeTool` factice : résultat 🧪. Le cycle de leçons a mesuré un gain puis annulé la proposition en mode `propose-only`. Un outil créé par l’agent a passé quatre cas et a été invoqué. [P2](preuves/p2.md)
- Sur les cas exercés en P2, le pare-feu a mis une compétence injectée en quarantaine, le validateur a refusé `mkfs`, la garde de déploiement a bloqué `fly deploy`, le nettoyeur a préservé le texte visible malgré des marqueurs injectés, et la reprise de session a réparé un transcript puis répondu `P2_OK`. Sur cette branche d’inventaire, la sonde directe de nettoyage laisse passer un caractère de largeur nulle. [P2](preuves/p2.md)
- Le daemon sensoriel Rust a livré six événements en 932 ms via le pont loopback ; le rêve a consolidé 23 percepts ; une règle a refusé `rm -rf /` puis exécuté une action locale autorisée avec audit. [P3](preuves/p3.md)
- Le serveur MCP a répondu à `initialize` et `tools/list` en stdio : 64 outils annoncés, tous marqués lecture seule. Le CLI a aussi exécuté les aides de 116 noms et 73 lectures sûres ; cela ne prouve pas le TUI interactif ni les commandes restées à l’aide seule. [P4](preuves/p4.md)

Ces résultats sont limités aux scénarios, systèmes et configurations décrits par les preuves liées. Ils ne prouvent pas les fournisseurs externes, les systèmes d’exploitation non exécutés, ni les fonctions non rejouées.

## L'ampleur, en chiffres

La commande demandée `npx tsx src/index.ts catalog generate --json` échoue sur cette révision (`error: unknown option '--json'`). Le relevé de repli vient de l’aide runtime et des sondes réellement exécutées :

| Mesure runtime | Valeur | Source |
|---|---:|---|
| Enregistrements de commandes CLI à la racine | **114** | `--help` runtime |
| Noms CLI en comptant les alias | **116** | 114 lignes runtime + 2 alias ; 116 invocations `--help` réussies |
| Lectures sûres CLI supplémentaires | **73** (63 code 0, 10 code 1) | balayage P4 |
| Outils d’agent exposés et uniques | **226** | sonde P1 ; l’assertion attendait 230 et a échoué |
| Entrées directes du catalogue fournisseur | **61** | sonde P1 ; seul Ollama a été appelé réellement |

Le total historique **105 commandes** était une affirmation de l’ancien inventaire sans mesure conservée. La liste historique contient **103 noms** ; 102 figurent encore dans les 116 noms runtime, 14 noms s’y sont ajoutés et `message` n’y figure plus. Les 114 lignes d’enregistrement runtime comprennent deux lignes à alias (`autonomy|colab`, `session|sessions`). Les unités et les dates des trois comptes diffèrent ; le chiffre courant mesuré est 116 noms, sans prétendre expliquer les deux noms manquants derrière l’ancienne affirmation 105. [P4](preuves/p4.md)

Les autres totaux précédemment affichés (lignes de code, variables d’environnement, fichiers/tests, composants) ne sont pas fournis par ce générateur absent et ne sont pas recalculés ici. [P1](preuves/p1.md) · [P4](preuves/p4.md)

---

## 1. Le socle : un agent qui exécute

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Boucle agentique | Le modèle appelle un outil et utilise son résultat | ✅ `view_file` a rendu « indigo », repris dans la réponse. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| 230 outils | Nombre d’outils exposés à l’agent | ❌ 226 définitions uniques ; assertion 230 échouée. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| 15 fournisseurs | Fournisseurs compatibles et Gemini natif | ⛔ 61 entrées catalogue ne prouvent pas 15 fournisseurs exécutables ; seul Ollama a été appelé. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Sélection d’outils par RAG | Filtrage par embeddings du prompt | ⛔ 19 outils et 55 721 → 3 814 jetons mesurés par TF-IDF ; le chemin embeddings n’a pas été prouvé. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Bascule de fournisseur | Reprise sur un fournisseur secondaire après panne | ✅ port primaire fermé → événement `unreachable` → réponse Ollama « indigo ». [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Modes d’autorisation | Modes `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` | ✅ 5 modes × 3 outils ; `plan` refuse l’écriture. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Bac à sable noyau | Isolation de commandes par Bubblewrap, Landlock ou seatbelt | ✅ Bubblewrap autorise une écriture interne et bloque l’écriture hors espace. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |

## 2. Mémoire — les cinq couches

| Couche | Chez nous | Preuve |
|---|---|---|
| Travail — ce qu’il voit | Compression du contexte | ✅ 13 → 7 messages et 1 804 → 912 jetons. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Travail étendue — compaction réversible | Déploiement d’un segment compacté | ✅ 2 segments ; restauration exacte du marqueur `unique-0`, 5 863 caractères. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Épisodique — ce qui s’est passé | Consolidation d’épisodes et promotion en mémoire | ✅ 3 tours fournis par `readConversation` injecté, 1 ligne JSONL, 6 sujets, 1 point ouvert et promotion. Lecture de la vraie session et rejeu : ⛔. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Sémantique — ce qu’il sait | Graphe collectif et rappel pertinent | ⛔ Le rapport P1 précise que cette fonction déjà marquée prouvée n’a pas été réexécutée dans la campagne. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Procédurale — comment faire | Création d’outils et savoir-faire sous garde empirique | ⛔ L’outil créé est prouvé en section 5 ; les 189 améliorations historiques n’ont pas été rejouées ici. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Oubli | Archivage et restauration d’un souvenir | ✅ un souvenir archivé après avance contrôlée de 90 jours, puis restauré. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |

## 3. Vérification — ne pas se croire sur parole

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Verifier indépendant | Un agent séparé juge le travail | 🧪 `VerifierAgent.execute` avec `llmCall` et `executeTool` injectés ; l’oracle `node --test` a tourné, mais registre et exécuteur de production non exercés. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Porte de preuves sur les buts | Un résultat sans preuve est rétrogradé | ⛔ Non rejouée par P1–P4. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| `buddy loop` | Plan, exécution, vérification et jugement | ⛔ Non rejoué par P1–P4. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Porte de revue de diff | Refus d’écritures non revues | ⛔ Non rejouée par P1–P4. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Espace de travail fantôme | Validation dans un clone avant écriture | ⛔ Non rejoué par P1–P4. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Registre d’intentions | Spécifications falsifiables et détection de dérive | ⛔ Non rejoué par P1–P4. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |

## 4. Plusieurs cerveaux

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Flotte (`peer.chat`) | Appel d’un pair par WebSocket | ✅ réponse Ollama réelle, 74 jetons, serveur local éphémère arrêté après le test. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Outils distants | Outil lecture seule soumis aux barrières du pair | ✅ `view_file` distant en 2 ms ; refus allowlist, `fleetSafe` et espace de travail. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| Conseil de modèles | Délibération et arbitrage pour le routage | ⛔ Deux modèles ont répondu, mais juge non neutre et apprentissage refusé. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |
| `/batch` | Décomposition en unités | ✅ 2 unités terminées, 44 événements. [P1](preuves/p1.md) — 2026-09-25, correctif `a8dc11fb2` |
| `/swarm` | Exécution d’un essaim | ✅ essaim réussi en 38 s. [P1](preuves/p1.md) — 2026-09-25, correctif `a8dc11fb2` |
| `/team` | Délégation à un coéquipier | 🧪 équipe créée avec 1 membre puis dissoute : `0/0 tasks completed` ; aucune délégation de tâche prouvée. [P1](preuves/p1.md) — 2026-09-25, correctif `a8dc11fb2` |
| Fédération de graphes | Tirage et intégration de faits entre pairs | ✅ un fait reçu et intégré via WebSocket réel. [P1](preuves/p1.md) — 2026-09-25, commit `6715ab53d` |

## 5. Auto-amélioration — bornée par l’expérience

Quatre surfaces apprenables. L’invariant « jamais `src/` » n’est pas revalidé par ces preuves.

| Surface | Ce que c'est | Preuve |
|---|---|---|
| Leçons | Score, proposition, validation empirique puis conservation ou annulation | ✅ couverture 0/15 → 1/15 ; application en mode `propose-only` annulée, puis cas appliqué conservé dans l’essai séparé. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Outils | Création d’outil, cas visibles et cachés, invocation | ✅ 2/2 cas fonctionnels et 2/2 robustesse ; outil invoqué. Le cycle CLI cité a accepté une autre proposition : 2/2 visibles et 3/3 cachés. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Savoir-faire | Rédaction de `SKILL.md` et filtre anti-injection | ⛔ Le candidat de compétence a été refusé au cycle ; le brouillon direct était fautif. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Stratégies | Apprentissage borné des plafonds et du raisonnement | ⛔ Rejeu synthétique de 6 gains, mais expériences synthétiques seulement. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |

## 6. Perception — le robot

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Système nerveux (Rust) | Canaux sensoriels, thalamus et diffusion | ✅ 42 tests Rust puis 6 événements réels via WAV fixture et pont loopback en 932 ms. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Yeux (Python/MediaPipe) | Détecteurs à états | ⛔ Aucun parcours caméra/MediaPipe exercé. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Voix | Parole, transcription, réponse parlée et interruption | ⛔ Microphone, voix et transcription réelle non rejoués dans P3. Le WAV de recette ne prouve pas ce parcours. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Rêve | Consolidation du tampon court terme et promotion du saillant | ✅ 23 percepts et `dream:recent` observés lors du rejeu cité ; le harnais attend désormais la promotion avant d’arrêter le serveur. Les tailles de fichiers varient. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Rappels | Annonce vocale/Telegram et acquittement vocal | ⛔ Non rejoués par P1–P4. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Règles sensorielles | Refus d’actions dangereuses et exécution d’actions autorisées | ✅ `rm -rf /` refusé ; action locale autorisée exécutée et auditée. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |

## 7. Médias

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Film long | Clips, transitions, musique, narration et contrôle qualité | ⛔ Aucun rendu film long dans P1–P4. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Prompt → vidéo | Scènes, clips, sous-titres | ⛔ Aucun parcours de génération vidéo dans P1–P4. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Images | ComfyUI local ou fournisseurs cloud | ⛔ Aucune génération d’image dans P1–P4. [P3](preuves/p3.md) — 2026-09-25, commit `6715ab53d` |
| Entraînement de la perception | Évaluation YOLO de scènes annotées | ⛔ Un cas vide a été exécuté, sans objet positif ; il ne prouve ni détection utile ni classement des faiblesses. [P3](preuves/p3.md) — 2026-09-25, correctif de rapport `3faa23973` |

## 8. Interfaces

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| CLI Ink/React | Aides et commandes CLI, complétion, thèmes | ✅ 116 noms ont répondu à `--help` et 73 lectures sûres ont été tentées (63 réussites, 10 refus/préconditions). Le TUI interactif et 43 aides seules ne sont pas prouvés. [P4](preuves/p4.md) — 2026-09-25, commit `e197572ac` |
| Cowork | Application de bureau Electron | ⛔ Runtime Electron et main compilé absents ; application non lancée. [P4](preuves/p4.md) — 2026-09-25, commit `e197572ac` |
| PWA mobile | Compagnon mobile et historique | ⛔ Non rejouée dans la campagne ; l’ancien ✅ n’est pas reconduit ici. [P4](preuves/p4.md) — 2026-09-25, commit `e197572ac` |
| Serveur HTTP | API, A2A et WebSocket | ⛔ Aucune route HTTP testée dans P4 ; les ports visés étaient occupés. [P4](preuves/p4.md) — 2026-09-25, commit `e197572ac` |
| Serveur MCP | Exposition des outils par protocole MCP | ✅ échange stdio `initialize` → `tools/list` ; 64 outils et 64 annotations lecture seule, alias vérifié aussi. [P4](preuves/p4.md) — 2026-09-25, commit `e197572ac` |

## 9. Garde-fous

| Fonctionnalité | Ce que c'est | Preuve |
|---|---|---|
| Pare-feu de compétences | Scan anti-injection avec dé-obfuscation | ✅ compétence propre admise et échantillon injecté par caractère zéro-largeur mis en quarantaine. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Validateur de commandes | Analyse du shell avant exécution | ✅ `mkfs /dev/p2-fixture` refusé avant exécution. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Garde des secrets | Détection de secrets dans les fichiers suivis | ⛔ Une clé factice est masquée ; l’absence universelle de secrets n’a pas été établie. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |
| Garde de déploiement | Confirmation avant opération sensible | ✅ `fly deploy` refusé sans approbation, faux binaire non exécuté ; test rouge, vert et mutant rouge. [P2](preuves/p2.md) — 2026-09-25, correctif `98e2cb0c2` |
| Nettoyage de sortie | Retrait des marqueurs internes des réponses | ❌ sur cette branche : la sonde directe conserve un caractère de largeur nulle (`removedChars=59`). ✅ historique limité au correctif P2 `98e2cb0c2` (`removedChars=60`), non présent dans le code de cette branche. [P2](preuves/p2.md), [sortie de la branche](preuves/p2-brut/output-sanitizer-inventaire.log) — 2026-09-25 |
| Réparation de transcript | Réparation des appels d’outils après compaction | ✅ reprise CLI a injecté un résultat synthétique et répondu `P2_OK`. [P2](preuves/p2.md) — 2026-09-25, commit `98e2cb0c2` |

---

## Ce qu'il reste à prouver

- Les fournisseurs externes et Gemini natif ; les 15 fournisseurs ne sont pas établis par le catalogue d’entrées.
- La sélection d’outils réellement fondée sur les embeddings et un juge neutre pour le conseil de modèles.
- Les expériences réelles pour stratégies et savoir-faire, ainsi que l’absence universelle de secrets.
- Les parcours caméra, voix, rappels, génération média, PWA, HTTP, Cowork et TUI interactif.
- La commande `catalog generate --json`, absente de cette révision, et les 43 commandes pour lesquelles seule l’aide a été lancée.

## Provenance des artefacts

Les fichiers P1–P4 proviennent des branches correspondantes : le commit de preuves P4 `ed425fe32` est apparu pendant ce travail après le premier relevé de l’arbre. Les journaux bruts P2 inclus sous `docs/preuves/p2-brut/` sont les fichiers cités par `p2.md`.
