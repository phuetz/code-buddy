# Façades de configuration — `[middleware]` et rechargement à chaud

Branche `fix/config-facades-2026-09-24`, départ `7076ab7af`. Commit local, pas de push, pas de fusion. Le profil réel n'a pas été modifié. La voix n'a pas été touchée.

## Clés

| Clé | Décision | Consommateur |
| --- | --- | --- |
| `middleware.max_turns` | Branchée. Option du constructeur / `--max-tool-rounds`, puis fichier, puis 50 (400 en YOLO). | `src/agent/codebuddy-agent.ts` (`maxToolRounds`) |
| `middleware.turn_warning_threshold` | Branchée. Fichier, sinon 0,8. | `src/agent/middleware/turn-limit.ts` |
| `middleware.max_cost` | Branchée. `--max-price`, puis fichier, puis `MAX_COST`, puis 10 (100 en YOLO, plafond 1000). | `src/agent/codebuddy-agent.ts` (`sessionCostLimit`) |
| `middleware.cost_warning_threshold` | Branchée. Fichier, sinon 0,8. | `src/agent/middleware/cost-limit.ts` |
| `middleware.auto_compact_threshold` | Branchée seulement si la clé est écrite. Sinon le seuil historique (200000, ou la fenêtre). `CODEBUDDY_AUTOCOMPACT_PCT` reste prioritaire. | `src/agent/codebuddy-agent.ts` puis `ContextManagerV2` |
| `middleware.context_warning_percentage` | Refusée à l'écriture. L'avertissement réel est l'échelle 50 %, 75 % et 90 %. Remède : retirer la clé. | `src/config/config-schema.ts` |

Les défauts du schéma ne sont pas des choix. Un fichier qui n'écrit pas la clé laisse la constante d'aujourd'hui.

## Rechargement à chaud

Le module `src/config/hot-reload` est retiré. Il n'était jamais démarré. Il surveillait le profil et des sous-systèmes de sécurité, pas `config.toml`, et aucun rechargeur n'était inscrit. Le démarrer aurait été risqué sans rendre les limites vivantes. `/reload` ne change pas ces plafonds : ils sont lus au lancement.

## Vérification

Barrière Docker sans réseau, racine en lecture seule, profil factice. Rouge 13 échecs sur 16 avant le correctif. Vert 16 sur 16 après. Mutants : tours, coût, deux seuils, compactage, refus, module retiré — chacun refait échouer le test qui le protège. `tests/config` : 36 fichiers, 524 tests. `tsc` : seulement les deux `TS2307` de `@phuetz/companion-core`. Lint ciblé : 0. Confidentialité du diff : 0.

`tests/agent` : 2793 verts et 163 rouges. Les rouges contrôlés sur la base non modifiée sont `spawn git ENOENT` et un outil auteur dont la sortie est vide dans l'image (pas de git, arbre en lecture seule). Ils ne viennent pas de ce correctif.
