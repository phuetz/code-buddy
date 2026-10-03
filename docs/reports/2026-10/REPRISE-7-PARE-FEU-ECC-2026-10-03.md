# Reprise 7 — pare-feu ECC

Le bloquant de la revue reprise 6 est corrigé sur toutes ses charges citées. Les deux réserves qui sont des défauts, boucle Python et double comptage Unicode, sont corrigées. Aucune contestation du bloquant. Ces preuves portent sur les cas exécutés et les portes vérifiées ; elles ne démontrent pas une détection universelle du code malveillant.

Branche `fix/pare-feu-import-ecc-2026-10-03`, départ `7323141123cf87334c6428b16171bb2afb5d6ab9`. Commit de code : `336a1568aa3ecd8c78da6abcca3cef51c02279cb` ; tête documentaire dans `LIVRAISON.json`. Linux, Node `v24.14.1`. Clone ECC MIT vérifié à `ef648e01899ba3e8dc6371642deaaf64b4477775`. Revue demandée et mission lues intégralement. Rapport initial créé sous `docs/reports/2026-10/`, puis copié dans le partage dès le début. Aucun hook modifié, push ou processus détaché. Sources de départ archivées et profils frais sous `_qa/pare-feu-ecc/` ; preuves finales sous `reprise-7/`, et `preuves/` à côté du rapport livré.

## Bloquant → traitement → preuve

| Bloquant ou réserve | Traitement | Preuve |
|---|---|---|
| B1 : terminateurs `-` et `--`, chemins absolus, quotes, payload sans extension | Le motif accepte un jeton commençant par `-` ou `+`, sans exiger une lettre. Les chemins et les frontières de commande restent détectés. | Les neuf formes directes de la revue sont quarantaine avec true, false et 0, sans copie dans les deux modes d’import. Mutant `terminators-missed` tué par assertions. Six exécutions de Bash avec un fichier bénin prouvent que `-` et `--` exécutent le fichier suivant (`benign-execution.json`). |
| Même B1 dans `$(bash -- …)` | Le lanceur haut s’ajoute à la substitution moyenne ; la revue moyenne ne permet plus une copie include-review. | Script quarantainé ; mutation de la frontière parenthèse historique tuée. CLI refuse la copie dans les deux modes. |
| Même B1 en pleine chasse, caractères invisibles et homoglyphes | Repli Unicode obligatoire, sans aplatir les clôtures, commentaires ou heredocs. Le minimum ne dépend pas de la désobfuscation étendue. | Pleine chasse, chemin avec pleine chasse, a cyrillique et zéro-width : quarantaine aux trois réglages. Mutation `mandatory-unicode-folding-disabled` tuée. |
| Même B1 pour les agents | Le contrôle existant des motifs hauts/critiques s’applique au lanceur désormais détecté. | Six agents : auparavant six préparations désactivées ; désormais six quarantaines, aucun fichier préparé. Mutant `agent-documentary-critical-accepted` tué. |
| Options supplémentaires | Détection lexicale des signes et quotes, plutôt qu’une liste d’options autorisées. | `-e --`, `--posix --`, `+e`, `+o posix`, `"--"` et `--rcfile=` quarantainés. Mutants `plus-options-missed` et `quoted-options-missed` tués. |
| Faux positif `for i, sh in enumerate(shots):` en Python | Une liaison de variable Python est distinguée à son occurrence exacte ; aucun appel du corps ou de la même ligne n’est exempté. | Trois en-têtes Python allow ; mêmes textes dans `.sh` quarantaine, corps `os.system` et commande dans la chaîne de l’en-tête quarantaine. Mutants `python-binding-quarantined` et `python-whole-line-exemption` tués. |
| Double finding de `ｂａｓｈ` avec désobfuscation étendue | Un finding contextualisé ne repasse pas par l’aplatissement générique. Le décodage étendu reste disponible pour un lanceur encore invisible. | Aux trois réglages : un seul finding haut, score 76, quarantaine. Mutants `generic-launcher-folding-duplicated` et `unseen-launcher-decoding-lost` tués. Le second protège un lanceur masqué par commentaire HTML. |
| `--rcfile=../payload.txt` | Tentative de processus quarantainée, sans présenter cette syntaxe comme une exécution réussie du payload. | Bash réel retourne 2, sans marqueur. La forme avec espace et la forme avec égal sont quarantaine 76 (`reserves-check.json`). |
| `Use Bash command ../payload.txt` et prose mêlée à une commande | La mention de l’outil reste inerte ; une seconde commande réelle n’est pas exemptée. | Prose simple allow ; `Use Bash only; /bin/bash -- …` revue. Bash réel avec script nommé `command` sort 127 sans exécuter le payload (`benign-reserves.json`). Tests historiques de prose/script/fence et leur mutation rejoués. |
| Mot nu `secret`, `${bash …}`, template CSS et frontmatter | Témoins conservés ; affectations de secrets et substitutions de commande restent des cas dangereux distincts. | Secret nu allow 99 ; autres témoins allow 100, copies CLI conformes. La substitution de paramètre sort 1 sans exécution dans Bash. Frontmatter `tools: Read, Bash` ne fabrique pas de commande à travers son séparateur. |
| Bloquants des reprises et contre-revues précédentes | Aucun retour des exemptions documentaires dans les scripts ni d’un critique documentaire sous revue. Registre, Exchange, auto-écriture et agents restent fermés pour tout verdict non allow. | 99 mutations historiques rejouées sur le code final, toutes tuées par assertions ; plus 11 nouvelles. Les motifs ne sont pas remplacés par des erreurs de compilation comme preuve. |

Le changement touche `src/security/skill-scanner.ts` et la factorisation Unicode dans `src/security/text-deobfuscation.ts`. Les tests sont les trois fichiers `skill-firewall-ecc-reprise-7.test.ts`, `skill-firewall-ecc-reprise-7-consumers.test.ts` et `agent-ecc-reprise-7.test.ts`, avec `tests/helpers/ecc-reprise-7-cases.ts`. L’ancre du mutant historique des arguments a été adaptée à la nouvelle syntaxe ; sa régression et ses assertions restent les mêmes.

## Tests, mutations et barrière

**62 nouveaux tests couverts par la barrière verte.** Sur l’archive du départ, ces mêmes tests donnent **48 rouges par assertion et 14 témoins verts**, soit 62 au total (`baseline-tests-62.log`). Les tests couvrent le vrai registre, les paquets Exchange exportés/signés puis refusés, et les portes de l’auto-écriture. Le paquet Exchange contient le code dans une clôture du manifeste ; son format n’embarque pas ici un dossier de scripts.

**110 mutations tuées par assertion : 11 nouvelles + 99 historiques (14 + 22 + 35 + 23 + 5).** Chaque mutant, ses assertions et son empreinte restaurée sont dans les répertoires `final-new-mutations/` et `final-verify-ecc-…/`. Tous les **2 745 fichiers source restaurés à l’identique**, puis comparés à nouveau avant livraison (`final-restoration.json`). Scanner final SHA-256 : `16102bcdddc422fca118fed40beaa62b6f03c2e3e604252eb35a66bd31b37d1e`.

| Barrière sur sources finales | Résultat |
|---|---|
| `npm run typecheck` | Sortie 0, sous-projets compris |
| `npm run lint` | Sortie 0, 0 erreur / 2 601 avertissements |
| Tests ciblés | **135 fichiers verts / 1 ignoré ; 2 416 tests verts / 3 ignorés** |
| `git diff --check` | Sortie 0, vide |
| Garde données personnelles après staging des documents | 40/40, sortie 0 (`privacy-staged.log`) |

Commande ciblée exacte :

```sh
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 tests/security tests/skills tests/agents tests/agent/custom-agent-runtime.test.ts tests/agent/custom-agent-loader-hermes.test.ts tests/agent/custom-agent-tool-filter.test.ts tests/agent/self-improvement/skill-mutator.test.ts
```

Un blanc final du nouveau test agents, découvert au staging, a été retiré après les barrières ; aucune instruction ou assertion n’a changé.

Les trois tests ignorés sont ceux de `tests/skills/bundled-skills.test.ts`. Les vérifications finales suivent la dernière correction du dédoublonnage, pas seulement son premier état vert.

## Rejeu réel ECC avant / après

CLI depuis les sources : `tsx src/index.ts skills import --dir <ECC> --apply --agents --json`, archive de départ puis code final, HOME/USERPROFILE/CODEBUDDY_HOME frais sous `_qa/pare-feu-ecc/home/`. Les ensembles de fichiers réellement copiés sont comparés aux rapports ; tous les agents préparés sont désactivés et en permission suggest. Scan des 934 manifestes avant/après. Preuves : `before-scan.json`, `before-import.json`, `delivery-scan.json`, `delivery-import.json`, `delivery-ecc-physical.json`, `ecc-summary.json`.

| Mesure | Avant 732314112 | Après |
|---|---:|---:|
| 934 scans : allow | 634 | 634 |
| Revue | 255 | 255 |
| Quarantaine | 45 | 45 |
| 293 canoniques : copies physiques | 189 | 189 |
| Revue canonique | 79 | 79 |
| Quarantaine canonique | 25 | 25 |
| Hors racine canonique ignorés | 641 | 641 |
| 68 agents : préparés désactivés | 51 | 51 |
| Quarantaine agents | 16 | 16 |
| Refus agents | 1 | 1 |

**Liste exhaustive des changements de verdict : aucun.** Deux seules différences de findings : `skills/taste-application` et `skills/taste-distillation` perdent chacun le faux lanceur de leur variable Python ; tous deux restent quarantaine 0. Les 641 exclusions indiquent leur raison : 518 sous docs/ et 123 sous pi/, hors racine canonique skills/. Le seul agent écarté est `agents/docs-lookup.md` : ses outils MCP Context7 ne sont pas pris en charge par la traduction de l’allowlist ; le refus reste fermé.

`delivery-production-agents.json` utilise le vrai chargeur synchrone et asynchrone avec le filtre branché à `buddy --agent` pour planner, tdd-guide et security-reviewer. Planner garde son interdiction de shell ; les deux autres n’obtiennent pas Docker. Planner reste quarantainé ; les deux autres restent préparés désactivés, aucun agent importé actif dans le chargeur de recette.

| Cas A/B canonique | Avant → après | Score après |
|---|---|---:|
| skill-comply | quarantine → quarantine | 0 |
| homelab-wireguard-vpn | review → review | 100 |
| social-publisher | review → review | 100 |
| pytorch-patterns | review → review | 100 |
| kotlin-patterns | review → review | 100 |
| deep-research | review → review | 100 |
| tdd-workflow | review → review | 100 |
| safety-guard | review → review | 100 |
| defi-amm-security | allow → allow | 100 |
| github-ops | review → review | 100 |
| healthcare-eval-harness | review → review | 100 |

**Aucun cas A allow.** Le score 100 d’un document n’autorise pas son chargement : le verdict revue ferme les portes automatiques. Le contenu canonique de defi-amm-security conserve allow sans finding.

Rejeu de **28 fixtures nouvelles + 30 et 85 historiques**, avant/après et sans/avec include-review : **572 comparaisons verdict/copie physique**. Les 115 anciennes conservent leurs verdicts et leurs copies. Lots nouveau et reprise 6 à désobfuscation étendue false ; lot de 85 à true. Les six agents dangereux nouveaux passent de revue désactivée à quarantaine sans préparation.

| 28 nouvelles fixtures CLI | Avant | Après final |
|---|---:|---:|
| Copies par défaut | 23 | 4 |
| Revue sans copie | 2 | 4 |
| Quarantaine | 3 | 20 |
| Copies avec include-review | 25 | 8 |
| Quarantaine avec include-review | 3 | 20 |

Après : les 20 scripts dangereux ne sont jamais copiés, les quatre documents sont revue, les quatre témoins sont copiés. Les assertions finales sont `cli-delivery-cli-after-assertions.json`, `cli-delivery-historical30-after-assertions.json` et `cli-delivery-historical85-after-assertions.json`, comparées aux trois fichiers before correspondants. Les profils HOME, clés Exchange locales et clones ne sont pas copiés dans le partage.

## Ce que je n'ai pas pu vérifier

- Windows, macOS, CI distante et paquet npm publié : seuls Linux, Node 24 et CLI depuis les sources sont exécutés. Aucun nouveau build ni suite complète, conformément au périmètre.
- Aucun script ou hook ECC ni charge destructrice exécuté. Bash réel a seulement exécuté le fichier bénin créé pour la mesure ; les formes invalides n’ont pas émis son marqueur.
- L’analyse statique reste bornée aux cas testés : encodages autres qu’UTF-8, alias calculés arbitraires, nouveaux interpréteurs et constructions non couvertes ne sont pas démontrés sûrs.
- Aucune course import/daemon ni activation humaine d’un agent préparé simulée. Les protections de chargement, allowlists et états désactivés ont été vérifiés séparément.
