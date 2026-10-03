# Reprise 3 — pare-feu ECC, 03/10/2026

**Validation invalidée par la relecture de reprise 3.** Sur `6927cdc94`, les backticks révélés par NFKC étaient ignorés. Le rapport de reprise 4 traite cette régression. Les résultats ci-dessous restent historiques.

Départ propre `6bf2289050ee7b7d1fe658dc6119a57de7b6ea48`, même worktree et branche `fix/pare-feu-import-ecc-2026-10-03`. Rapport de relecture de reprise 2 et mission lus entièrement ; trois bloquants acceptés. Rapport initial créé ici et chantier réservé avant les corrections. La validation de reprise 2 est invalidée dans le rapport versionné et dans la coordination ; les anciens livrables du partage sont conservés.

## Bloquant → traitement → preuve

| Bloquant ou réserve | Traitement | Preuve exécutée |
|---|---|---|
| B1 — `import {rm} from 'fs'; rm(target, {recursive:true})` redevient allow | Les appels nus `rm`, `rmSync`, `rmdir`, `rmdirSync` sont détectés, y compris options variables. La déstructuration ne supprime plus la détection. | `destructured-rm`, `bare-rm`, `bare-rm-options`, `bare-rmdir` deviennent quarantine ; le témoin `fs.rmSync(p, {"recursive":true})` reste quarantine. Mutant `bare-recursive-delete-lost`. Import réel avec et sans include-review, registre, Exchange signé et auto-écriture. |
| B2 — une occurrence bénigne exempte toute la ligne | Décision par position de chaque occurrence. Les phrases operating/file/management system et Swift `.system(size:36)` n'exemptent plus le `system("id")` voisin, dans aucun ordre. Un argument quoté ou une taille Swift calculée impose revue. La constante child_process n'exempte plus une invocation précédente. | Huit cas prose/Swift mixtes et `module-before-inert-constant` ; mutants `native-benign-whole-line`, `module-binding-whole-line`, `prose-quoted-argument-benign`, `swift-computed-size-benign`. Les cinq témoins bénins restent allow. Les portes automatiques refusent les cas mixtes en revue, y compris le générateur réel de skills de session. |
| B3 — `tools:"*"`, `tools:["!bash"]` ouvrent tous les outils | Les allowlists refusent les motifs génériques sans nom et les négations ; seuls les motifs positifs bornés restent valides. Le wildcard de refus `disabledTools:"*"` reste utilisable. Validation dans les trois chargeurs et dans le filtre de production pour les configurations programmatiques. Le prédicat secondaire applique aussi le filtre réel et les refus. | Tests YAML/JSON/TOML/Markdown, sync/async, cinq politiques invalides, Read seul, `view_?ile`, deny-all. Mutants wildcard, négation, validation runtime, refus deny-all et prédicat secondaire. Huit vrais lancements `buddy --agent` refusent l'agent avant construction du client de modèle, sortie 1. |
| Réserve — `subprocess['check_output']` sans import | Le préfixe subprocess avec accès entre crochets est détecté directement ; un import n'est plus nécessaire pour ce motif. | `subprocess-bracket-no-import` quarantine ; mutant `quoted-subprocess-without-import-missed` ; mêmes consommateurs réels. |
| Réserve — backticks shell ignorés | Détection dans sh/bash et les langages shell identifiés, y compris substitutions sur plusieurs lignes et sous guillemets doubles. Chaînes entre apostrophes, échappements, commentaires et heredocs quotés sont distingués. Un faux opener de heredoc dans une chaîne ne masque rien. | Sondes shell initiales, substitutions shell/PHP multilignes et deux sondes avec backtick littéral isolé avant une vraie commande. Ces deux dernières ont d'abord donné allow dans `odd-literal-red.log`. Mutants syntaxe shell, scope littéral, heredoc, fermeture et backtick consommant une commande. |
| Réserve — commentaire HTML contenant `os.system` ignoré | Fin de l'exclusion de toute la ligne HTML. Les appels de processus cachés imposent revue ; un eval critique caché reste quarantine. | `html-os-system`, `html-native-system`, ancien test HTML renforcé. Mutant `html-process-line-skipped` et mutations adverses HTML conservées. |
| Défaut découvert pendant le rejeu — backticks reconstruits depuis du Markdown | Les backticks sont examinés dans la syntaxe brute du langage concerné. La désobfuscation ne fabrique plus d'appels PHP/shell à partir de clôtures Markdown, docstrings Python ou identifiants F#. Les substitutions réelles multilignes restent détectées. | Témoins Python/F#, quatre skills Cowork et six exemples shell littéraux ; tests multilignes exécutables et documentaires. Mutants `backticks-reconstructed-from-prose` et `multiline-backticks-missed`. Aucun assouplissement de gravité des motifs critiques documentaires. |
| Réserve — Kotlin `require(mods[0] > 0)` | Pas de défaut pour cette comparaison reconnue ; la condition inconnue `require(mods[0])` reste en revue. | Témoin explicite de comparaison et régression adverse antérieure, mutant `kotlin-require-always-benign`. |
| Réserve — substitution imbriquée echo/bc | Pas de passage automatique pour le cas cité : la substitution reste review, et n'est pas importée par défaut. Les variantes hostiles antérieures restent couvertes. | Témoin exact et mutant antérieur `bc-words-allowed`. |
| Réserve — score des trois guides Code Buddy mal annoncé | Correction du rapport versionné précédent : review **90**, neuf findings chacun, dont un WebSocket actif medium. Le 100 annoncé était inexact. | Scan des trois fichiers réels et assertions exactes ; `final-details.json`. |

Un motif critique documentaire conserve sa gravité et impose au minimum **review**. Aucun des cas dangereux ne passe en allow. Le registre, Skill Exchange signé et l'auto-écriture exigent allow ; copier un élément avec include-review n'autorise pas son activation automatique. Ces contrats antérieurs sont testés aussi par les mutants gravité, porte automatique et safety gate.

## Tests, mutations et application réelle

Les trois nouveaux fichiers contiennent **124 tests**. Copiés avec leur helper dans une archive complète de `6bf228905`, ils produisent **98 échecs d'assertion et 26 témoins verts** ; le journal probant est `baseline-final-124-red.log`. Les journaux de sondes ayant eu une erreur de préparation ne servent pas de preuve. Les corrections n'enlèvent aucune assertion existante de sécurité : le test qui exigeait zéro finding pour `<!-- eval(...) -->` est renforcé en exigeant le finding critique ; le test parse-only qui acceptait `!bash` exige désormais son refus.

**23 mutations ciblées de reprise 3**, plus **35 mutations adverses antérieures**, sont exécutées séquentiellement et tuées par assertion. Les scripts restaurent chaque fichier à l'octet près dans un finally et inscrivent le SHA256 dans leurs résultats. Les mutations PHP/shell retirent les deux passes du détecteur : retirer seulement la passe de ligne était devenu un mutant redondant, arrêté par la nouvelle passe de syntaxe. Les journaux et résultats distinguent les assertions des erreurs de compilation ou de préparation ; ces dernières ne valent pas preuve.

Barrière ciblée : **2 152 tests verts, 3 skips, 123 fichiers verts et 1 fichier ignoré**. Typecheck : sortie 0. Lint global : sortie 0, **0 erreur et 2 601 avertissements**. Périmètre : tests/security, tests/skills, tests/agents et les quatre fichiers runtime/Hermes/filter/mutator affectés. Aucune suite complète lancée.

**30 fixtures** passent par le vrai CLI source, avant/après, dans quatre HOME isolés. Les 18 scripts restent quarantine même avec include-review ; les 12 documents ambigus deviennent review et sont refusés par toutes les portes automatiques. Tous les verdicts et les copies physiques sont vérifiés individuellement dans `delivery-cli-assertions.json`.

| CLI réel, 30 fixtures | Copiées | Quarantaine | Revue restante |
|---|---:|---:|---:|
| Avant, sans include-review | 29 | 1 | 0 |
| Avant, avec include-review | 29 | 1 | 0 |
| Après, sans include-review | 0 | 18 | 12 |
| Après, avec include-review | 12 | 18 | 0 |

Les huit refus d'agents par le CLI utilisent des modèles inutilisés et une configuration locale sans service. Le code refuse l'agent avant l'instanciation du client ; aucun appel LLM n'a lieu. Les trois agents ECC originaux sont à nouveau chargés par `CustomAgentLoader`, sync et async : planner conserve lecture/recherche et refuse tous les alias shell ; tdd-guide et security-reviewer autorisent leur famille Bash et refusent docker. Les copies importées désactivées, même déplacées dans le répertoire actif, donnent zéro agent actif.

## Rejeu ECC complet avant/après

Clone MIT au commit exact `ef648e01899ba3e8dc6371642deaaf64b4477775`. Rejeu source `tsx src/index.ts skills import --dir <ECC> --apply --agents --json` et scan intégral de 934 manifests, avant les corrections puis sur la version livrée. HOME, USERPROFILE et CODEBUDDY_HOME isolés sous `_qa/pare-feu-ecc/home`. Aucun script ECC, modèle ni hook exécuté.

| Mesure | Avant, 6bf228905 | Après reprise 3 |
|---|---:|---:|
| SKILL.md trouvés | 934 | 934 |
| Scan intégral : allow / review / quarantine | 663 / 225 / 46 | 666 / 225 / 43 |
| Import canonique : copiés / revue / quarantaine | 202 / 65 / 26 | 203 / 65 / 25 |
| Exclusions avec motif | 641 | 641 |
| Agents trouvés | 68 | 68 |
| Agents désactivés en revue / quarantaine / refus | 57 / 9 / 2 | 57 / 9 / 2 |

Les **trois seuls changements de verdict** concernent fsharp-testing sous skills/, pi/core/skills/ et docs/ja-JP/skills/ : quarantine/76 → allow/100. Le seul ancien finding était php-backtick « obfuscated » à la ligne 1. Les noms F# entre doubles backticks et les clôtures Markdown avaient produit artificiellement un lancement PHP. Les fichiers ne contiennent aucun appel de processus détecté ni motif critique. Ce faux positif est supprimé avec tests et mutation ; les véritables substitutions PHP/shell restent quarantine dans les scripts et au minimum review dans les documents. Les trois répertoires Python continuous-learning-v2, taste-application et taste-distillation perdent aussi un faux finding PHP, sans changement de quarantine/0. `delivery-finding-changes.json` contient ces six différences complètes. Les **203 copies physiques** correspondent exactement au rapport CLI.

Les 641 exclusions ont chacune un chemin et un motif. Correction de comptage en reprise 4 : **518 sous docs et 123 sous pi**, tous avec la raison outside canonical skills/ root ; la ventilation 473/107/61 annoncée auparavant était inexacte. Les fichiers copiés sont comptés physiquement. L'inventaire des changements de verdict est exhaustif, y compris lorsqu'il est vide ; les différences de findings et de score sont jointes séparément.

| Cas initiaux A/B sous skills/ | Avant → après | Copié après |
|---|---|---|
| skill-comply | quarantine/0 → quarantine/0 | Non |
| homelab-wireguard-vpn, social-publisher | review/100 → review/100 | Non |
| pytorch-patterns, kotlin-patterns, deep-research | review/100 → review/100 | Non |
| tdd-workflow, safety-guard, github-ops, healthcare-eval-harness | review/100 → review/100 | Non |
| defi-amm-security | allow/100 → allow/100 | Oui |

Aucun cas A ne repasse en allow. La réserve historique defi-amm-security reste motivée : ce manifeste du commit fixé ne contient pas rm-rf, ses anciens hits concernent des mots naturels « token ». Les régressions de suppression dangereuse documentaire restent en revue et ne sont pas acceptées automatiquement.

## Livraison et reproduction

Commits de code : `f5f119a67` (scanner et consommateurs) et `926b407dd` (agents). Commits thématiques en français ; SHA de la tête finale et sorties des barrières dans le reçu de livraison. Rapport partagé : `Partage/20261003-cb-pare-feu-ecc/reprise-1/reprise-1/reprise-1/sol61/RAPPORT.md`, preuves dans `preuves/`. Les SHA256 du lot sont vérifiés. Aucune tâche détachée, aucun push, hooks inchangés. Git status vide à la fin.

```bash
npm run typecheck
npm run lint
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 tests/security tests/skills tests/agents tests/agent/custom-agent-runtime.test.ts tests/agent/custom-agent-loader-hermes.test.ts tests/agent/custom-agent-tool-filter.test.ts tests/agent/self-improvement/skill-mutator.test.ts
python3 scripts/qa/verify-ecc-reprise-3-mutations.py
python3 scripts/qa/verify-ecc-adverse-mutations.py _qa/pare-feu-ecc/reprise-3/adverse-mutations-delivery
```

## Ce que je n'ai pas pu vérifier

Linux uniquement : aucun Windows/macOS natif ni CI distante. Aucun modèle, tour d'agent LLM, script ECC ou hook exécuté. La suite complète est exclue conformément à la mission ; les trois skips ciblés restent signalés. Aucun changement ni validation de la lane hooks.

Le scanner reste une analyse statique de motifs et de contexte, pas un parseur complet de tous les langages. Les renommages arbitraires, les constructions calculées et toutes les obfuscations possibles ne sont pas démontrés sûrs. Les cas ambigus couverts imposent revue et aucune porte automatique ne les accepte. Les changements limités de verdict sur ECC ne suffisent pas à prouver la correction des défauts absents de ce corpus : les régressions, mutations et véritables consommateurs en apportent les preuves ciblées. La conclusion de cette reprise porte sur les cas reproduits et les barrières exécutées, sans certification universelle du pare-feu.
