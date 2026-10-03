# Pare-feu des skills et import ECC — 03/10/2026

Branche `fix/pare-feu-import-ecc-2026-10-03`, base Code Buddy `70bcab004f822bccadb73f931e9de1d932b900a5`. ECC [Everything Claude Code](https://github.com/affaan-m/everything-claude-code/tree/ef648e01899ba3e8dc6371642deaaf64b4477775), commit `ef648e01899ba3e8dc6371642deaaf64b4477775`, licence MIT, clone local `_qa/pare-feu-ecc/ecc`. Linux, Node `v24.14.1`. Aucun push, aucun service démarré, aucun travail détaché. Hooks exclus.

## Résultat

Les trois cas A ne sont plus autorisés ; les huit cas B quittent la quarantaine. Les scripts sont traités plus strictement que les mentions documentaires. Les allowlists des agents sont conservées et les politiques illisibles refusées. Les agents externes restent désactivés en revue.

## Reproduction et rejeu complet

La première commande réelle a reproduit exactement les 934 manifestes et les comptes signalés, avant toute correction du code. HOME initial : `_qa/pare-feu-ecc/home`. Le rejeu final utilise le HOME neuf `_qa/pare-feu-ecc/home/complete`, sans suppression ni remplacement du premier profil. Aucun skill hostile exécuté, aucune API de modèle utilisée.

```bash
git clone https://github.com/affaan-m/everything-claude-code.git _qa/pare-feu-ecc/ecc
git -C _qa/pare-feu-ecc/ecc checkout ef648e01899ba3e8dc6371642deaaf64b4477775
# Avant : code à 70bcab004, HOME initial
HOME="$PWD/_qa/pare-feu-ecc/home" CODEBUDDY_HOME="$PWD/_qa/pare-feu-ecc/home/.codebuddy" \
  node_modules/.bin/tsx src/index.ts skills import --dir "$PWD/_qa/pare-feu-ecc/ecc" --apply --json
# Après : code livré, HOME neuf
HOME="$PWD/_qa/pare-feu-ecc/home/complete" CODEBUDDY_HOME="$PWD/_qa/pare-feu-ecc/home/complete/.codebuddy" \
  node_modules/.bin/tsx src/index.ts skills import --dir "$PWD/_qa/pare-feu-ecc/ecc" --apply --agents --json
```

| Parcours réel | Découverts | Importés | Quarantaine | Revue | Ignorés |
|---|---:|---:|---:|---:|---:|
| CLI avant | 934 | 825 | 63 | 46 | 0 |
| CLI après | 934 | 208 | 42 | 43 | 641 |
| Racine canonique skills/ avant, inventaire du scanner | 293 | 245 allow | 31 | 17 | 0 |
| Racine canonique skills/ après, inventaire du scanner | 293 | 208 allow | 42 | 43 | 0 |

Le scanner de contrôle a rejoué **les mêmes 934 répertoires** avant/après, y compris les copies ignorées par le nouvel importeur : avant 825 allow / 63 quarantine / 46 review ; après 696 allow / 95 quarantine / 143 review. Ces totaux ne sont pas les comptes d’import final : celui-ci sélectionne 293 originaux.

| Racine | Manifestes découverts | Importés avant | Ignorés après |
|---|---:|---:|---:|
| skills/ | 293 | 245 | 0 |
| docs/ | 518 | 473 | 518 |
| pi/ | 123 | 107 | 123 |

Les 473 et 107 annoncés désignent bien les copies **importées**, et non tous les manifestes de ces racines. Chaque exclusion est motivée dans le JSON et la sortie texte. Les traductions de même identifiant sous une racine choisie sont aussi dédoublonnées ; les collisions entre skills indépendants restent distinctes.

## Cas A et B, sur les sources ECC réelles

| Cas | Avant | Après | Score avant → après | Test rouge sur le scanner original |
|---|---|---|---|---|
| skill-comply | allow | quarantine | 97 → 0 | oui, assertion nommée |
| homelab-wireguard-vpn | allow | quarantine | 96 → 0 | oui, assertion nommée |
| social-publisher | allow | review | 100 → 56 | oui, assertion nommée |
| pytorch-patterns | quarantine | allow | 0 → 100 | oui, assertion nommée |
| kotlin-patterns | quarantine | allow | 28 → 100 | oui, assertion nommée |
| deep-research | quarantine | review | 55 → 100 | oui, assertion nommée |
| tdd-workflow | quarantine | review | 54 → 99 | oui, assertion nommée |
| safety-guard | quarantine | review | 10 → 100 | oui, assertion nommée |
| defi-amm-security | quarantine | allow | 0 → 90 | oui, assertion nommée |
| github-ops | quarantine | review | 53 → 98 | oui, assertion nommée |
| healthcare-eval-harness | quarantine | review | 0 → 100 | oui, assertion nommée |

Les tests sont dans `tests/security/skill-firewall-ecc.test.ts`. Les snippets viennent des cas réels ; les inventaires exhaustifs prouvent également le verdict du répertoire entier, avec ses scripts/supports. Dans healthcare-eval-harness, les 19 substitutions incluent mktemp, jq et echo/bc. Les modèles `.eval()` et assertions Kotlin/Solidity deviennent bénins ; les avertissements sensibles et substitutions documentaires restent en revue.

Le scanner ajoute les processus Python (subprocess, os.system/popen et imports avec alias), Node/child_process et appels natifs Go/Ruby/PHP/PowerShell, ainsi que les suppressions récursives Python/Node. Les identifiants sensibles préfixés sont reconnus sans dépendre de la casse et avec suffixe. Les fichiers de scripts, exécutables et shebangs restent stricts. Les citations sont bornées à leur propre occurrence : une instruction hostile ajoutée à la même ligne reste bloquée. `window.eval` et `builtins.eval` restent bloquants. Les déobfuscations, attaques cachées et attaques multilignes existantes restent couvertes par leurs tests.

Les copies documentaires ja-JP/zh-CN de skill-comply ne contiennent pas le runner Python fautif et gardent leur propre verdict statique allow ; elles sont toutes ignorées par l’import canonique. Aucun des trois répertoires canoniques A, ni leur payload de régression, ne repasse en allow.

## Agents

`buddy skills import --agents` passe les 68 fichiers directs `agents/*.md` au même pare-feu : **55 préparés en revue et désactivés, 11 quarantainés, 2 refusés**. docs-lookup et gan-evaluator déclarent des outils MCP non traduisibles : l’import refuse ces listes au lieu de retirer silencieusement les restrictions.

Les fichiers préparés sont sous `~/.codebuddy/agents/review/imported-*.md`, avec disabled=true, permissionMode=suggest, source, chemin source, SHA-256 et verdict du pare-feu. Les chargeurs refusent aussi disabled=true après déplacement dans une racine active. Aucun agent préparé n’est chargé automatiquement. Les permissions source, modèles spécifiques et hooks ne sont pas repris.

| Agent réel | Outils Code Buddy | Bash / shell_exec | docker | Agent préparé actif |
|---|---|---|---|---|
| planner | view_file, search | refusés | refusé | non |
| tdd-guide | view_file, create_file, str_replace_editor, bash, search | autorisés | refusé | non |
| security-reviewer | view_file, search, bash | autorisés | refusé | non |

`scripts/qa/verify-ecc-agents.ts` a chargé les **vrais fichiers ECC** dans un projet jetable, testé les deux chargeurs Markdown et l’autorisation effective d’outils, puis vérifié le refus des fichiers préparés. Glob et Grep se traduisent vers search (recherche de fichiers/texte). Les noms natifs existants restent conservés. Les trois chargeurs acceptent les listes en ligne ; YAML est analysé avec le vrai parseur. null, nombre, objet, tableau mixte et frontmatter cassé contenant une politique sont refusés. Une liste vide ferme tous les outils, y compris dans le filtre runtime.

## Mutations et validation

`python3 scripts/qa/verify-ecc-mutations.py` rétablit temporairement un fichier à sa version `70bcab004`, exécute les tests, exige un échec d’assertion et restaure les octets dans un finally. Les six mutations sont détectées. Le mutant scanner rend rouges les trois cas A et les huit cas B, ainsi que les nouveaux cas supplémentaires. Le journal nomme chaque assertion ; un échec de démarrage ne compte pas comme mutation détectée.

| Mutant | Résultat |
|---|---|
| scanner-original | rouge par assertion (23 échecs), code 1 |
| importer-original | rouge par assertion (3 échecs), code 1 |
| markdown-loader-original | rouge par assertion (9 échecs), code 1 |
| definition-loader-original | rouge par assertion (11 échecs), code 1 |
| custom-loader-original | rouge par assertion (5 échecs), code 1 |
| empty-filter-original | rouge par assertion (1 échecs), code 1 |

Après restauration : **54/54 nouveaux tests verts**. Barrières finales sur les fichiers restaurés :

| Vérification | Résultat |
|---|---|
| npm run typecheck (racine + gpuNode identity + companion-core) | code 0 |
| npm run lint | code 0, 0 erreur, 2 601 avertissements du dépôt |
| Tests security/skills/agents + chargeurs/runtime concernés | 114 fichiers verts, 1 fichier ignoré ; 1 831 tests verts, 3 ignorés |
| git diff --check | code 0 |
| Chargement et autorisation réels des trois agents | toutes les assertions passent |

```bash
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 \
  tests/security tests/skills tests/agents \
  tests/agent/custom-agent-loader-hermes.test.ts \
  tests/agent/custom-agent-tool-filter.test.ts \
  tests/agent/custom-agent-runtime.test.ts tests/agent/teams-and-definitions.test.ts
```

Le chargeur Vite runner évite une écriture refusée dans node_modules/.vite-temp, le node_modules étant partagé en lecture seule. Une tentative avec le pool non borné a produit des timeouts ; le rejeu avec deux workers passe sans relâcher les délais ou modifier les anciens tests. Aucune suite globale ni npm run validate global n’a été lancée.

## Changements exhaustifs de verdict

176 changements sur les 934 sources ; 55 sur les 293 originaux. La liste complète, avec scores et motifs, est livrée dans `preuves/CHANGEMENTS-VERDICTS.md` et `preuves/verdict-changes.json`. Les JSON avant/après gardent aussi les verdicts inchangés et les findings par chemin/ligne, sans contenu de secrets.

| Original canonique | Avant | Après |
|---|---|---|
| `skills/backend-patterns` | allow | review |
| `skills/clickhouse-io` | allow | quarantine |
| `skills/codehealth-mcp` | allow | review |
| `skills/dart-flutter-patterns` | allow | review |
| `skills/data-scraper-agent` | allow | quarantine |
| `skills/deep-research` | quarantine | review |
| `skills/defi-amm-security` | quarantine | allow |
| `skills/deployment-patterns` | allow | review |
| `skills/django-patterns` | allow | quarantine |
| `skills/django-security` | allow | quarantine |
| `skills/django-tdd` | allow | review |
| `skills/django-verification` | allow | quarantine |
| `skills/docker-patterns` | allow | quarantine |
| `skills/evm-token-decimals` | allow | review |
| `skills/exa-search` | allow | review |
| `skills/fal-ai-media` | allow | review |
| `skills/fastapi-patterns` | review | quarantine |
| `skills/generating-python-installer` | quarantine | review |
| `skills/github-ops` | quarantine | review |
| `skills/healthcare-eval-harness` | quarantine | review |
| `skills/homelab-wireguard-vpn` | allow | quarantine |
| `skills/ito-baskets` | review | quarantine |
| `skills/ito-compute` | allow | review |
| `skills/jira-integration` | allow | quarantine |
| `skills/kotlin-ktor-patterns` | quarantine | review |
| `skills/kotlin-patterns` | quarantine | allow |
| `skills/kotlin-testing` | allow | review |
| `skills/laravel-security` | review | quarantine |
| `skills/laravel-tdd` | allow | quarantine |
| `skills/lead-intelligence` | allow | quarantine |
| `skills/liquid-glass-design` | allow | quarantine |
| `skills/mysql-patterns` | allow | review |
| `skills/netmiko-ssh-automation` | allow | review |
| `skills/nutrient-document-processing` | allow | quarantine |
| `skills/prediction-market-risk-review` | allow | review |
| `skills/pytorch-patterns` | quarantine | allow |
| `skills/quarkus-patterns` | allow | quarantine |
| `skills/quarkus-security` | allow | quarantine |
| `skills/quarkus-verification` | allow | review |
| `skills/react-native-patterns` | allow | quarantine |
| `skills/redis-patterns` | quarantine | allow |
| `skills/safety-guard` | quarantine | review |
| `skills/scientific-db-pubmed-database` | allow | review |
| `skills/scientific-db-uspto-database` | allow | review |
| `skills/security-review` | allow | review |
| `skills/skill-comply` | allow | quarantine |
| `skills/social-publisher` | allow | review |
| `skills/springboot-security` | allow | review |
| `skills/tdd-workflow` | quarantine | review |
| `skills/ui-to-vue` | allow | review |
| `skills/uncloud` | allow | review |
| `skills/video-editing` | allow | quarantine |
| `skills/windows-desktop-e2e` | allow | quarantine |
| `skills/workspace-surface-audit` | allow | review |
| `skills/x-api` | allow | quarantine |

## Livrables et commits

Rapport de mission créé dans `docs/reports/2026-10/PARE-FEU-ECC-2026-10-03.md` avant la reproduction. Copie remise dans `/home/patrice/Videos/Partage/20261003-cb-pare-feu-ecc/sol61/RAPPORT.md`. Guide : `docs/features/skills-import.md`. Les traces finales, mutations et contrôles réels sont sous `sol61/preuves/`, avec manifeste SHA-256.

- `71e5f055c` — `fix(security): durcir le pare-feu des skills et distinguer les mentions`.
- `994ff7415` — `feat(skills): importer la racine canonique et préparer les agents en revue`.

## Ce que je n’ai pas pu vérifier

- Windows et macOS : non exécutés ; la validation est Linux uniquement.
- Les 3 tests de bundled-skills sont ignorés par leur garde existante : le dossier runtime optionnel est absent de ce worktree. Aucun skip ajouté.
- Aucun tour LLM des agents importés ni exécution des scripts hostiles. La preuve réelle couvre import, fichiers préparés, chargeurs et décisions d’autorisation, pas les réponses d’un modèle.
- Le scanner reste une analyse statique : il ne prouve pas la détection de tous les appels construits dynamiquement ou de toute variante linguistique d’avertissement. Les cas A/B demandés, mutations et protections existantes sont vérifiés.
- Les hooks, leur import et leurs effets sont hors mission et inchangés.

Les artefacts QA restent sous `_qa/pare-feu-ecc/` (ignorés par Git), les profils initiaux sont conservés. Tous les processus lancés pour cette mission sont terminés ; aucun push ni tâche de fond. Le statut Git final et la tête de livraison sont consignés dans `preuves/LIVRAISON.json`.
