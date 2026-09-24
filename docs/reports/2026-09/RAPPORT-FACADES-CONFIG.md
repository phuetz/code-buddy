# Façades de configuration — `[middleware]` et rechargement à chaud

Branche `fix/config-facades-2026-09-24`, départ `7076ab7af`, premier correctif `e298252ca`, reprise `d234b511e` après fusion locale de `origin/main` (`3224d089c`). Pas de push. Le profil réel n'a pas été modifié. La voix n'a pas été touchée.

## Clés

| Clé | Décision | Consommateur |
| --- | --- | --- |
| `middleware.max_turns` | Branchée. Option du constructeur / `--max-tool-rounds`, puis fichier, puis 50 (400 en YOLO). | `src/agent/codebuddy-agent.ts` (`maxToolRounds`) |
| `middleware.turn_warning_threshold` | Branchée. Fichier, sinon 0,8. | `src/agent/middleware/turn-limit.ts` |
| `middleware.max_cost` | Branchée. `--max-price`, puis fichier, puis `MAX_COST`, puis 10 (100 en YOLO, plafond 1000). | `src/agent/codebuddy-agent.ts` (`sessionCostLimit`) |
| `middleware.cost_warning_threshold` | Branchée. Fichier, sinon 0,8. | `src/agent/middleware/cost-limit.ts` |
| `middleware.auto_compact_threshold` | Branchée seulement si la clé est écrite. Sinon le seuil historique (200000, ou la fenêtre). Un `setModel` réapplique la valeur écrite au lieu de la recalculer. `CODEBUDDY_AUTOCOMPACT_PCT` reste prioritaire. | `src/agent/codebuddy-agent.ts` puis `ContextManagerV2` |
| `middleware.context_warning_percentage` | Refusée à l'écriture. L'avertissement réel est l'échelle 50 %, 75 % et 90 %. Remède : retirer la clé. | `src/config/config-schema.ts` |

Les défauts du schéma ne sont pas des choix. Un fichier qui n'écrit pas la clé laisse la constante d'aujourd'hui. `DEFAULT_CONFIG.middleware` et la liste d'émission sortent de ce schéma : 50 tours, 10 dollars, seuils 0,8, pas de compactage implicite, et `context_warning_percentage` n'est plus émise.

## Rechargement à chaud

Le module `src/config/hot-reload` est retiré. Il n'était jamais démarré. Il surveillait le profil et des sous-systèmes de sécurité, pas `config.toml`, et aucun rechargeur n'était inscrit. Le démarrer aurait été risqué sans rendre les limites vivantes. `/reload` ne change pas ces plafonds : ils sont lus au lancement.

## Projet de la session

Contre-revue : l'agent lisait `.codebuddy/config.toml` dans le répertoire du processus, pas dans le `workingDirectory` passé au constructeur. Cowork, lancé depuis A et ouvrant le projet B, appliquait donc les plafonds de A. `/yolo` relisait aussi le fichier et pouvait changer le plafond sans changer les seuils déjà donnés aux middlewares. Correctif : `[middleware]` est lu une seule fois, à la construction, dans le répertoire de travail de l'agent ; `/yolo` réutilise cette lecture. Tests : valeurs de B avec `cwd = A` (et après `/yolo`), tour réel par `CodeBuddyEngineAdapter` (3 appels pour `max_turns = 3` de B, 1 appel pour `max_cost = 0.0001` de B), fichier modifié puis `/yolo` sans effet. Rouge 4/22, vert 22/22, mutant « cwd du processus » 3/22, mutant « relecture à `/yolo` » 1/22.

## Vérification

Barrière Docker sans réseau, racine en lecture seule, profil factice. Rouge 13 échecs sur 16 avant le correctif. Vert 16 sur 16 après. Mutants : tours, coût, deux seuils, compactage, refus, module retiré — chacun refait échouer le test qui le protège. `tests/config` : 36 fichiers, 524 tests. `tsc` : seulement les deux `TS2307` de `@phuetz/companion-core`. Lint ciblé : 0. Confidentialité du diff : 0.

`tests/agent` : 2793 verts et 163 rouges sur le premier correctif. Reprise `d234b511e` : 2812 verts et les mêmes 163 rouges (git absent, arbre en lecture seule). Un tour complet contre un serveur HTTP local compatible OpenAI s'arrête à 3 appels quand le fichier dit `max_turns = 3`, et à 1 appel quand il dit `max_cost = 0.0001`. Retirer la lecture de ces deux clés fait repartir la boucle à 50 appels.
