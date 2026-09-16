# CLI, introspection et tests développeur — 14 septembre 2026

Branche `integration/improvements-persistence-2026-09-13`, base `9024566de`. Correctifs validés dans le worktree ; les résultats ci-dessous ne constituent pas une validation Windows ni une nouvelle publication npm.

## Changements vérifiés

- Le ThemeManager publie ses changements ; le fournisseur Ink s'abonne sans remonter le composant ni effacer le brouillon. `/theme set`, `status` et identifiants explicites ; état de sauvegarde signalé.
- Un instantané borné des paramètres CLI actifs accompagne chaque tour (thème, modèle demandé, fournisseur, permissions, limites, connexions configurées). Aucun objet complet de configuration ni secret n'est sérialisé.
- `self_describe` permet list/read/search des fichiers du cœur attesté, avec lignes, confinement et limites. Un test réel de l'adaptateur compilé retrouve `useSyncExternalStore` et lit `src/ui/context/theme-context.tsx`. Cela ne prouve pas que chaque modèle choisit d'appeler l'outil.
- Les profils lite ne remplacent plus les outils de flotte demandés ; skills_list/skill_view restent exposés pour une demande de skill. Le fournisseur OpenAI-compatible respecte tool_choice en streaming.
- « Utilise tes outils » ne transforme plus une tâche skills/Git, même sans modification, en introspection déterministe. Les demandes explicites d'inspection du propre code restent reconnues.
- Le prompt distingue demandes utilisateur autorisées et données récupérées non fiables ; l'ancienne phrase traitant toute demande utilisateur comme non exécutable a été retirée. Les permissions, protection des secrets et contrôles des commandes restent applicables.
- Une réponse peer.describe aux capacités malformées n'est plus étiquetée à tort comme RPC injoignable ; métadonnées invalides omises. Ce défaut a été signalé par AGY puis couvert par régression.

- Le préflight de `code_exec` attend la fin de transmission IPC avant de quitter : les grands catalogues ne perdent plus leur réponse. Les demandes explicites de programmatic tool calling conservent `code_exec` dans la sélection.
- Le pipeline CLI dispose désormais d'un exécuteur natif et du pont de confirmation normal ; les étapes approval fonctionnent dans un vrai terminal.
- La liste du code propre est paginée : les dossiers au-delà des 100 premières entrées restent consultables.

## Preuves et limites

`npm run validate` isolé : lint, typage, contrôle pack (10 tests) et 336 tests ciblés (15 suites) passent. Build TypeScript réussi. Tests ciblés de lecture bornée et liens symboliques, rendu Ink réel, sélection d'outils, introspection, payload streaming et flotte.

Captures sous `<QA_ARTIFACTS>` (`Z:\Partage`) :

- `20260914-test-reel-cli-*` : vraie interface Ink Node20 + vrai Ollama qwen3:4b-instruct. Thème matrix correctement rapporté ; list_peers réellement invoqué et résultat transmis. Lecture autonome du propre code toujours refusée dans ces captures : scénario rouge, malgré outil disponible et lecture directe fonctionnelle.
- `20260914-self-describe-reel.json` : adaptateur compilé exécuté directement, recherche/lecture du vrai code réussies, sans intervention d'un LLM.
- `20260914-tests-developpeur` puis `-apres`, `-trace`, `-build6` : mêmes trois demandes formulées par AGY, exécutées par runner Buddy dans des dépôts/profils jetables. Avant : skills/Git détournés/refusés. Après : inventaire et skill_view exécutés, trois commandes Git réelles. Restent en échec partiel : application du skill sans lire le fichier demandé, git diff --staged substitué à git diff, lignes affirmées sans preuve textuelle suffisante. Les réponses du modèle ne suffisent pas pour un verdict vert.
- `20260914-revue-flotte` : quatre revues réelles AGY via serveurs Code Buddy/peer.chat, dont DGM ; diagnostics vérifiés et faux constats annotés. Grok CLI non authentifié, aucun basculement API payante.
- `20260914-tests-integrations` : Code Explorer réellement indexé et interrogé via MCP/client Buddy, définition et appelant corrects. LM Resizer récent : compression 61093→962 octets sur fixture JSON, original récupéré exactement, erreurs conservées et récupération intersession refusée. Ancien binaire installé : pas de protocole tool-output, repli brut sans gain. Son fallback compress restitue un JSON minifié équivalent, pas les octets originaux. Tests clients, pas décision autonome du chat ni Windows/HTTP sidecar.

### Fonctions avancées exécutées sur le build final

- `20260914-tests-avances/after-build` : **13/13 contrôles PTC passent**, via le vrai harness, CodeExecTool et les outils natifs : lecture en chaîne, deux lectures Promise.all, découverte puis recherche, outil inconnu, arguments invalides, fichier absent, écriture refusée en plan (hash inchangé), état entre deux cellules, timeout, annulation et préflight valide/invalide. Aucun LLM simulant l'exécution. Le chevauchement temporel des lectures parallèles n'a pas été mesuré.
- `20260914-tests-avances/selection-ptc-fixed.json` : **8/8 demandes proposent code_exec**, contre seulement 2/8 avant correction. Sélection réelle sur deux profils, pas une preuve de décision autonome du modèle.
- `20260914-tests-avances-compiled` : **3/3 parcours passent**, vraie entrée dist/index.js sous Node20 : lecture, approbation refusée et approbation acceptée, ces deux dernières dans un PTY. Les 26 tests pipeline ciblés passent également sous Node20 et Node24.
- `20260914-self-describe-compiled-final.json` : lecture/recherche du source compilé et seconde page contenant le dossier ui vérifiées.
- `20260914-test-reel-cli-qwen27b` : le modèle a réellement appelé list_peers puis self_describe search/list/read ; la réponse d'inspection n'a pas terminé dans le délai de 300 secondes. Verdict global en échec, pas une validation verte. La comparaison développeur 27B séparée a été invalidée pour buffering du proxy puis interrompue après correction ; aucun verdict exploitable.

Ces résultats portent sur l'exécution locale Linux. Le pilotage autonome PTC par un modèle, Windows, la DGM complète et les autres scénarios avancés non cochés restent à tester. Aucun paquet de cette série n'est annoncé comme publié ou installé chez Patrice.

La DGM possède déjà des liens vers Code Explorer (hotspots/weakness-selector) et la mémoire (variant-planner). Un conflit potentiel existe entre le hard limit global sur src/ et le mutateur en worktree ; refus réel du mutateur pas encore démontré. La non-promotion automatique vers main est intentionnelle. Ne pas reprendre les propositions de code AGY sans revue (exemple erroné : traiter `.git` d'un linked worktree comme un répertoire).

## Recette permanente

Voir `DEVELOPER-REAL-TEST-PLAN-2026-09-14.md` : 38 scénarios (26 missions quotidiennes et 12 fonctions avancées), priorités, données et critères ; les scénarios non exécutés sont identifiés. `scripts/verify-cli-live.py` produit capture ANSI rejouable, trafic et verdicts séparant fin de processus et réussite fonctionnelle. Les appels d'outils doivent être suivis d'observations corrélées. Le protocole `/api/show` d'Ollama est routé hors `/v1` ; les premières captures signalent un 404 introduit par l'ancien proxy de test, distinct des réponses de chat.

Avant livraison annoncée comme prête : rejouer les P0 sur paquet installé et plateforme cible, garder les échecs, vérifier aussi l'utilisation autonome des intégrations et la coopération avec un pair configuré. Une liste de scénarios et une revue IA ne sont pas des tests exécutés.
