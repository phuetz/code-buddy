# Reprise 6 — pare-feu ECC

Les deux bloquants de la revue reprise 5 sont corrigés sur les cas reproduits. Les réserves exécutables citées sont traitées. Cette livraison prouve les gardes et les imports décrits ci-dessous ; elle ne prouve pas une détection universelle du code malveillant.

Branche `fix/pare-feu-import-ecc-2026-10-03`. Départ `ecbace93537ba108dd043285704818e6f9f771e7`. Commits de code : `99d565dba7ccc290f8987c557442e77a56398820` et `9517704cc360548ee93802c2e54ad21dd646bc07`. Tête documentaire dans `LIVRAISON.json`. Linux, Node `v24.14.1`. Clone ECC existant vérifié au commit MIT `ef648e01899ba3e8dc6371642deaaf64b4477775`. Archives avant et HOME frais sous `_qa/pare-feu-ecc/`, uniquement pour la recette. Aucun hook modifié, aucune charge des fixtures ECC exécutée, aucun push, aucune tâche détachée.

La revue demandée et les contre-revues Grok, Opus et Gemini ont été lues intégralement. Rapport initial créé dans `docs/reports/2026-10/`, puis déposé dans le partage avant les corrections. Les preuves de cette reprise sont sous `_qa/pare-feu-ecc/reprise-6/` et recopiées dans `preuves/` à côté de ce rapport.

## Bloquant → traitement → preuve

| Bloquant ou réserve | Traitement | Preuve sur cette reprise |
|---|---|---|
| B1 : shebang Node/Python masque `.sh`, `.bash`, `.php` | Une interprétation exécutable du suffixe ou du shebang reste prioritaire sur un langage de données. Les formes inverses `.js` + shell et `.py` + PHP sont couvertes ; les shebangs dans les clôtures Markdown aussi. | Tests `node-sh`, `python-sh`, `node-bash`, `node-php`, `shell-js`, `php-py` : quarantaine, aucune copie avec ou sans include-review, trois réglages de désobfuscation. Mutations `shebang-masks-suffix`, `fenced-shebang-ignored` tuées. |
| B2 : `/bin/bash` et `/usr/bin/bash` avec payload extérieur | Détection des chemins absolus, quotés, relatifs, de `env`, des options et des noms de payload sans extension. Le refus ne dépend pas de la présence du payload dans le skill. | `absolute-bin`, `absolute-usr`, `quoted-absolute`, `relative-launcher`, `env-launcher`, `absolute-option`, `extensionless-payload` : quarantaine. Mutations `absolute-launcher-missed`, `launcher-arguments-missed` tuées. Deux agents de ces formes sont quarantainés, pas préparés. |
| Perl `.pl` / `.perl` | Retrait des langages à backticks inertes ; suffixe et shebang conservés, même sans shebang. | Trois fixtures Perl quarantainées, imports refusés. Mutation `perl-backticks-authorized` tuée. |
| Lanceur pleine chasse avec désobfuscation étendue coupée | Le minimum NFKC et retrait des caractères invisibles couvre aussi le lanceur shell, avec reconstruction des contextes. | `wide-launcher`, `wide-absolute` : quarantaine à true, false et 0 ; prose au minimum revue. Mutation `mandatory-launcher-folding-disabled` tuée. |
| `$(bash ../payload.txt)` | Frontière parenthèse reconnue : finding haut de lanceur, au-delà du finding moyen de substitution. | Quarantaine dans le script et l’agent, même include-review. Mutation `shell-substitution-launcher-missed` tuée. |
| Secret par template, clé quotée | Affectation de credential critique, y compris backticks et clé JSON quotée. Scripts stricts ; mention documentaire reste revue, avec sévérité critique conservée. | `template-secret`, `quoted-template-secret` : quarantaine ; document et agents testés séparément. Mutation `template-credential-missed` tuée. |
| `safeChildProcess.spawn` | Préfixe camelCase reconnu en plus du préfixe avec souligné. | Quarantaine, pas copie en revue. Mutation `camel-process-missed` tuée. |
| Agent `spawn("rm", ["-rf", "/"])` | Motif critique de lancement destructif ; règle moyenne générique `spawn` conservée pour les autres formes. | Script et agent quarantainés. Mutation `destructive-process-missed` tuée. |
| Mot nu `secret`, `${bash ../payload.txt}` | Témoins permis : pas de valeur de credential dans le premier, pas de substitution de commande dans le second. Le finding info du mot est conservé sans exemption documentaire dans le script. | Tests `inert control` verts et trois copies témoins au CLI. Les affectations et `$()` sont des tests distincts refusés. Aucun interpréteur hostile lancé pour ces mesures. |
| Faux positifs apparus pendant la reprise | Boucle Python `for sh in sl.shapes:` dans un diagnostic heredoc quoté distinguée du lanceur. Mentions explicites de l’outil capitalisé Bash distinguées en prose, sans exemption pour les scripts ni les commandes/fences déclarées. | Première barrière avait 3 rouges ; correction puis barrière finale verte. Trois tests prose/script/fence et deux imports d’agents désactivés. Mutations `heredoc-loop-quarantined`, `tool-prose-quarantined` tuées. Les deux agents ECC provisoirement sur-quarantainés redeviennent revue désactivée. |
| Anciens bloquants Grok/Opus/Gemini | Aucun retour des exemptions de commentaire ou de secret dans les scripts, aucun critique documentaire ramené à info. Registre, Exchange, auto-écriture et agents conservent leurs gardes. | 85 mutations historiques ciblées rejouées sur le correctif final, plus 14 nouvelles : 99 tuées par assertion. Plancher documentaire et réécriture stricte des agents ont chacun leur mutation. |

Implémentation : `src/security/skill-scanner.ts`. Régressions dans les trois fichiers `tests/security/skill-firewall-ecc-reprise-6.test.ts`, `tests/skills/skill-firewall-ecc-reprise-6-consumers.test.ts`, `tests/agents/agent-ecc-reprise-6.test.ts`, avec corpus partagé `tests/helpers/ecc-reprise-6-cases.ts`.

## Tests et mutations

**65 nouveaux tests verts.** Les mêmes tests exécutés sur l’archive de départ donnent **49 rouges par assertion et 16 témoins verts** (`baseline-tests-65.log`). Les consommateurs incluent le vrai registre, les paquets Exchange exportés/signés puis refusés par le pare-feu, et les portes des skills auto-écrits. Exchange contient ici le manifeste avec le code en clôture ; aucune affirmation d’inclusion d’un dossier de scripts dans son format.

**99 mutations tuées par assertion : 14 + 22 + 35 + 23 + 5.** Les résultats par mutant et les assertions rouges sont dans `delivery-new-mutations/`, `delivery-historical5/`, `delivery-historical-adverse/`, `delivery-historical3/`, `delivery-historical4/`. Aucune erreur de compilation n’est comptée comme preuve. Empreintes des **2 745 fichiers source identiques après restauration**, dans `delivery-restoration.json`. Empreinte du scanner final : `f00ba9dce2ec26cefcf98ef1b729df1b7006e2b215e2525c8203bee3f05c62c6`.

| Barrière sur les sources livrées | Résultat |
|---|---|
| `npm run typecheck` | Sortie 0, sous-projets compris |
| `npm run lint` | Sortie 0, 0 erreur, 2 601 avertissements |
| Tests ciblés | 132 fichiers verts / 1 ignoré ; **2 354 tests verts / 3 ignorés** |
| `git diff --check` | Sortie vide, code 0 |
| Garde données personnelles après staging documentaire | **40/40**, sortie 0 ; `privacy-staged.log` et reçu |

Commande ciblée exacte :

```sh
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 tests/security tests/skills tests/agents tests/agent/custom-agent-runtime.test.ts tests/agent/custom-agent-loader-hermes.test.ts tests/agent/custom-agent-tool-filter.test.ts tests/agent/self-improvement/skill-mutator.test.ts
```

## Import réel ECC avant / après

Deux imports réels depuis `tsx src/index.ts skills import --dir <ECC> --apply --agents --json`, source de départ archivée puis sources corrigées, HOME et CODEBUDDY_HOME frais, sous `_qa/pare-feu-ecc/home/`. Scan complet des 934 manifestes à chaque étape. Les ensembles de fichiers réellement copiés sont comparés aux rapports, pas seulement au code de sortie. Détails : `before-scan.json`, `before-import.json`, `delivery-scan.json`, `delivery-import.json`, `delivery-summary.json`.

| Mesure | Avant ecbace935 | Après correctif |
|---|---:|---:|
| 934 scans : allow | 637 | 634 |
| 934 scans : revue | 252 | 255 |
| 934 scans : quarantaine | 45 | 45 |
| 293 canoniques : copies physiques | 190 | 189 |
| 293 canoniques : revue | 78 | 79 |
| 293 canoniques : quarantaine | 25 | 25 |
| Hors racine canonique ignorés | 641 | 641 |
| 68 agents : préparés désactivés | 51 | 51 |
| 68 agents : quarantaine | 16 | 16 |
| 68 agents : refus | 1 | 1 |

Les exclusions indiquent leur raison dans le rapport : **518 sous docs/, 123 sous pi/**, hors `skills/`. Aucun changement de verdict vers allow. Liste exhaustive des changements :

| Chemin ECC | Avant → après | Motif nouveau |
|---|---|---|
| `docs/es/skills/continuous-learning-v2` | allow → revue | `shell-interpreter`, véritable commande `bash skills/…/migrate-homunculus.sh`, ligne 147 du manifeste ; copie hors canonique ignorée |
| `pi/core/skills/django-celery` | allow → revue | `embedded-secret`, clé `password` quotée d’un exemple, ligne 378 ; copie hors canonique ignorée |
| `skills/django-celery` | allow → revue | Même affectation documentaire critique, ligne 378 ; aucun import par défaut |

Aucun changement final de catégorie/verdict d’agent ECC. `planner` reste quarantainé ; `tdd-guide` et `security-reviewer` sont préparés désactivés. `delivery-production-agents.json` vérifie les trois originaux avec le vrai chargeur synchrone et asynchrone branché à `buddy --agent`, et les alias de leurs allowlists. Planner n’obtient aucun outil shell ; les deux autres n’obtiennent pas Docker. Aucun agent préparé actif, même après copie de recette vers le dossier du chargeur.

Cas A et B canoniques après rejeu :

| Cas | Avant → après | Score après |
|---|---|---:|
| `skill-comply` | quarantine → quarantine | 0 |
| `homelab-wireguard-vpn` | review → review | 100 |
| `social-publisher` | review → review | 100 |
| `pytorch-patterns` | review → review | 100 |
| `kotlin-patterns` | review → review | 100 |
| `deep-research` | review → review | 100 |
| `tdd-workflow` | review → review | 100 |
| `safety-guard` | review → review | 100 |
| `defi-amm-security` | allow → allow | 100 |
| `github-ops` | review → review | 100 |
| `healthcare-eval-harness` | review → review | 100 |

**Aucun cas A n’est allow.** Les commandes/documentations des cas B restent en revue ; `defi-amm-security` conserve allow sans finding sur son contenu canonique. Le score 100 des mentions ne vaut pas autorisation : le verdict revue ferme les portes automatiques.

Rejeu de **30 nouvelles fixtures et 85 fixtures historiques**, chacun avant/après et sans/avec include-review : **460 comparaisons de verdict et de copie physique**. Nouveau lot avec désobfuscation étendue coupée ; lot historique avec elle allumée. Nouveaux scripts dangereux : aucune des 23 fixtures n’est copiée après, même include-review ; les quatre documents sont revue, les trois témoins sont copiés. Les six agents dangereux ne sont plus préparés. Rapport CLI nouveau : avant 20 copies / 7 revues / 3 quarantaines ; après 3 copies / 4 revues / 23 quarantaines. Include-review : avant 27 copies / 3 quarantaines ; après 7 copies / 23 quarantaines. Historique : 7 copies / 15 revues / 63 quarantaines avant et après ; include-review 22 copies / 63 quarantaines. Assertions : `cli-final30-before-assertions.json`, `cli-validated30-after-assertions.json`, `cli-historical85-before-assertions.json`, `cli-validated85-after-assertions.json`.

Les échecs intermédiaires et mesures avant correction des faux positifs sont conservés dans les preuves. Les fichiers préfixés `delivery-` et les assertions `validated` désignent l’état final. Les profils HOME, clés locales Exchange et clones ne sont pas recopiés dans le partage.

## Ce que je n'ai pas pu vérifier

- Windows, macOS, CI distante et paquet npm publié : seuls Linux, Node 24 et la CLI depuis les sources locales sont exécutés. Aucun nouveau build ni suite complète, conformément au périmètre demandé.
- Les charges malveillantes et les scripts/hooks ECC n’ont pas été exécutés ; la preuve porte sur refus, copies, chargement et filtres, pas sur leur effet destructif.
- L’analyse reste statique : encodages autres qu’UTF-8, alias calculés arbitraires, nouveaux interpréteurs et constructions non couvertes ne sont pas démontrés sûrs. Les tests prouvent les cas cités et leurs variantes testées, pas l’absence universelle de contournement.
- Pas de mesure de course entre import et daemon en exécution, ni activation volontaire d’un agent importé. Les agents préparés sont vérifiés désactivés ; leur approbation humaine n’est pas simulée.
- Des mentions ambiguës hors syntaxes reconnues peuvent rester revue ou quarantaine. Les commentaires suspects des scripts restent volontairement stricts selon la priorité de sécurité du pilote.
