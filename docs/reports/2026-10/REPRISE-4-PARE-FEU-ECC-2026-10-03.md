# Reprise 4 — pare-feu ECC, 03/10/2026

Départ propre `6927cdc94c45a74d45067cb5ed4e4c31fbfb66ec`, même worktree et branche `fix/pare-feu-import-ecc-2026-10-03`. Nouvelle relecture et mission lues entièrement. Rapport initial créé ici et chantier réservé avant correction. Le bloquant est accepté ; la validation de reprise 3 est invalidée dans le rapport versionné et dans la coordination. Les anciens livrables du partage sont conservés.

## Bloquant → traitement → preuve

| Bloquant ou réserve | Traitement | Preuve exécutée |
|---|---|---|
| B1 — PHP et shell U+FF40 deviennent allow après désactivation du repli | Dans la passe de désobfuscation, les opérateurs de compatibilité sont repliés par NFKC, puis examinés avec des contextes de langage et de syntaxe littérale reconstruits. La passe générique qui fabriquait une exécution PHP depuis F# reste remplacée par cette analyse dédiée. Les clôtures Markdown et délimiteurs de heredoc sont conservés. | U+FF40 PHP/shell, mixtes ASCII/Unicode, multilignes, guillemets doubles, heredoc non quoté et commande après heredoc littéral : quarantine, import refusé même avec include-review. Documents PHP/shell et langage de clôture pleine chasse : review, sans activation automatique. Mutants `folded-backticks-ignored` et `folded-language-context-ignored`. |
| Faux positif F# à conserver corrigé | Le repli ne change pas un identifiant F# en opérateur PHP/shell : le langage et les littéraux sont toujours pris en compte. | Témoins F# ASCII et Unicode, docstring Python et shell littéral acceptés. Quatre guides Cowork réels conservés en allow. Mutant `generic-folding-manufactures-backticks` recrée le défaut et échoue par assertion. |
| Réserve réelle — `rm?.(target, {recursive:true})` | Détection des appels optionnels de suppression, nus, membres et accès quotés ; gravité critique conservée. | `optional-rm`, `optional-rm-sync`, `optional-rmdir`, `optional-quoted-rm` : quarantine dans scripts, review critique en Markdown. Mutant `optional-delete-missed`. |
| Réserve réelle — `operating system(whoami)` | Une parenthèse ambiguë ne constitue plus une exception bénigne. Seules les références espacées à des plateformes ou concepts reconnus sont exemptées, y compris la liste existante Linux/macOS/Windows. Une liste contenant whoami impose revue. | Cinq cas operating/file/management, argument espacé et énumération ambiguë : review. Les témoins existants restent verts, sans changer leurs assertions. Mutant `ambiguous-prose-accepted`. |
| Réserve `?ash` | Aucun changement de politique : c'est un glob positif local borné, autorisé par le contrat existant. Son effet réel est mesuré ; il ne reproduit pas l'allowlist universelle ou négative. | `parseAgentTools` puis `buildCustomAgentToolFilter` et `filterToolNames` sur les huit noms de la revue : seul bash passe. Un refus Bash enlève aussi ce résultat. `translateClaudeTools` refuse ce glob externe non mappé. |
| Réserves historiques echo/bc et scanDeniesInstall non rejouées par la revue | Contrats conservés et à nouveau vérifiés ; les portes automatiques exigent allow. | Tests ciblés antérieurs, substitutions imbriquées et variantes hostiles ; mutants `bc-words-allowed`, porte automatique, registre/scripts et safety gate. |
| Ventilation inexacte des exclusions ECC dans le rapport précédent | Comptage de chaque chemin réellement exclu, correction explicite du rapport versionné précédent. | 641 exclusions, toutes outside canonical skills/ root : 518 sous docs et 123 sous pi, comptées dans les JSON CLI. |

Le blocage des caractères pleine chasse prouve le **contrat de repli du pare-feu** ; il ne prouve pas que PHP ou bash interprète directement U+FF40 comme une commande. Aucun interpréteur n'a exécuté ces charges. Scripts : findings actifs high ou critical, quarantaine. Documents ambigus : gravité conservée et revue obligatoire, jamais allow. Les portes automatiques restent fermées aux revues, même après une copie volontaire avec include-review.

## Normalisation et syntaxe

La nouvelle passe dédiée conserve le texte et ses délimiteurs pendant NFKC. Supprimer le balisage HTML ou les espaces avant de reconstruire la syntaxe pouvait effacer une clôture et attribuer la prose suivante au langage shell ; un essai intermédiaire a reproduit ce faux positif sur les guides Cowork. Cette transformation n'est plus utilisée pour classer les backticks. Les autres classes de motifs conservent leur désobfuscation existante.

Une enumeration locale de **U+0000 à U+10FFFF** avec Node v24.14.1, Unicode 17.0, rapproche NFKC et NFKD avec retrait des marques : les seules conversions vers un accent grave ASCII sont U+0060 lui-même, **U+1FEF GREEK VARIA** et **U+FF40 FULLWIDTH GRAVE ACCENT**. Les deux caractères non ASCII sont aussi exposés directement par NFKC et ont leurs régressions PHP et shell. L'analyse après la première fenêtre de 256 KiB est testée dans les deux langages. Ce relevé n'est pas une preuve exhaustive de toutes les obfuscations possibles.

## Tests et mutations

Les trois nouveaux fichiers contiennent **71 tests**. Copiés avec le helper exact dans une archive complète de la tête initiale, ils donnent **61 échecs d'assertion et 10 témoins verts** ; preuve : baseline-final-71-red.log. Aucune assertion existante de sécurité n'est retirée ni affaiblie dans cette reprise. La liste de plateformes légitime a fait échouer la première barrière ; le correctif conserve son assertion allow et ajoute une liste ambiguë en revue.

Les **5 mutations de reprise 4**, **23 mutations de reprise 3** et **35 mutations adverses précédentes** sont rejouées séquentiellement sur les sources finales. Les 63 échouent par assertion ; journaux individuels et résultats JSON joints. Chaque fichier est restauré à l'octet près dans un finally ; ses empreintes restaurées sont rapprochées des sources livrées. Les scripts antérieurs acceptent des chemins de sortie distincts afin de conserver les preuves des précédentes reprises. Le mutant de prose a été adapté à la référence bornée, sans élargir les politiques du produit.

Barrière ciblée : **2 223 tests verts, 3 skips, 126 fichiers verts et 1 fichier ignoré**. Typecheck : sortie 0. Lint global : sortie 0, **0 erreur et 2 601 avertissements**. Les suites security, skills et agents, ainsi que les quatre fichiers runtime/Hermes/filter/mutator affectés, sont vérifiées. La suite complète n'a pas été lancée.

## CLI réel et consommateurs

Les **27 fixtures** passent par le véritable CLI source, avant/après, avec et sans include-review, dans quatre HOME isolés. Les 18 scripts sont refusés dans les deux modes après correction ; les neuf documents imposent revue. Chaque verdict et chaque copie physique est vérifié individuellement. Le registre, Skill Exchange signé Ed25519, scanAuthoredSkillContent et safetyGateSkill sont exercés sans mock du scanner ; les neuf documents passent aussi par le générateur réel de skills de session, qui refuse leur auto-écriture.

| CLI réel, 27 fixtures | Copiées | Quarantaine | Revue restante |
|---|---:|---:|---:|
| Avant, sans include-review | 25 | 2 | 0 |
| Avant, avec include-review | 25 | 2 | 0 |
| Après, sans include-review | 0 | 18 | 9 |
| Après, avec include-review | 9 | 18 | 0 |

Les trois agents ECC originaux sont rechargés par le consommateur de production, sync et async : planner conserve lecture/recherche et refuse les alias shell ; tdd-guide et security-reviewer conservent leurs droits Bash et refusent docker. Les copies désactivées importées, même déplacées vers le répertoire actif, donnent zéro agent actif. Les refus des deux agents avec outils MCP inconnus sont conservés ; ils ne sont pas utilisés comme preuve du défaut des politiques * ou !bash.

## ECC complet avant/après

Clone MIT au commit exact `ef648e01899ba3e8dc6371642deaaf64b4477775`. Import réel `tsx src/index.ts skills import --dir <ECC> --apply --agents --json`, puis scan intégral des **934 dossiers** avant correction et sur le résultat livré. HOME, USERPROFILE et CODEBUDDY_HOME isolés sous `_qa/pare-feu-ecc/home`. Les copies physiques et les agents désactivés sont vérifiés. Aucun script ECC ni hook exécuté.

| Mesure | Avant, 6927cdc94 | Après reprise 4 |
|---|---:|---:|
| Dossiers de skills trouvés | 934 | 934 |
| Scan intégral : allow / review / quarantine | 666 / 225 / 43 | 666 / 225 / 43 |
| Import canonique : copiés / revue / quarantaine | 203 / 65 / 25 | 203 / 65 / 25 |
| Exclusions avec motif | 641 | 641 |
| Exclusions docs / pi | 518 / 123 | 518 / 123 |
| Agents trouvés | 68 | 68 |
| Agents désactivés en revue / quarantaine / refus | 57 / 9 / 2 | 57 / 9 / 2 |

**Aucun changement de verdict, score ou finding** sur les 934 dossiers. Les listes exhaustives verdict-changes.json et finding-changes.json sont vides, avec explication dans verdict-changes.md. Les 203 copies physiques correspondent exactement au rapport. fsharp-testing et ses trois copies restent allow/100. Les guides Code Buddy restent review/90 ; les quatre guides Cowork restent allow/100. Cette stabilité n'est pas présentée comme la preuve du correctif : les charges Unicode synthétiques importées avant et refusées après l'apportent.

| Cas initiaux A/B sous skills/ | Avant → après | Copié après |
|---|---|---|
| skill-comply | quarantine/0 → quarantine/0 | Non |
| homelab-wireguard-vpn, social-publisher | review/100 → review/100 | Non |
| pytorch-patterns, kotlin-patterns, deep-research | review/100 → review/100 | Non |
| tdd-workflow, safety-guard, github-ops, healthcare-eval-harness | review/100 → review/100 | Non |
| defi-amm-security | allow/100 → allow/100 | Oui |

Aucun cas A ne repasse en allow. La réserve historique defi-amm-security reste motivée : ce manifeste du commit fixé ne contient pas rm-rf ; ses anciens hits concernent des mots naturels « token ». Les régressions de suppression dangereuse documentaire restent en revue et ne sont pas acceptées automatiquement.

## Livraison et reproduction

Correctif de sécurité : `ba5706ae2`. Commits thématiques français ; liste des trois commits et SHA de la tête documentaire dans le reçu. Rapport partagé : `Partage/20261003-cb-pare-feu-ecc/reprise-1/reprise-1/reprise-1/reprise-1/sol61/RAPPORT.md`, preuves dans preuves/. Les empreintes du lot sont vérifiées. Git status vide, aucun push, aucune tâche détachée ; hooks inchangés.

```bash
npm run typecheck
npm run lint
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 tests/security tests/skills tests/agents tests/agent/custom-agent-runtime.test.ts tests/agent/custom-agent-loader-hermes.test.ts tests/agent/custom-agent-tool-filter.test.ts tests/agent/self-improvement/skill-mutator.test.ts
python3 scripts/qa/verify-ecc-reprise-4-mutations.py _qa/pare-feu-ecc/reprise-4/mutations-final-enumeration
python3 scripts/qa/verify-ecc-reprise-3-mutations.py _qa/pare-feu-ecc/reprise-4/reprise3-mutations-final
python3 scripts/qa/verify-ecc-adverse-mutations.py _qa/pare-feu-ecc/reprise-4/adverse-mutations-final
```

## Ce que je n'ai pas pu vérifier

Linux uniquement ; aucun Windows/macOS natif ni CI distante. Aucun modèle, tour d'agent LLM, interpréteur des charges, script ECC ou hook exécuté. Le CLI d'import, les chargeurs/filtres, le registre, l'échange signé et le générateur réel ont tourné. La suite complète est exclue par la mission ; les trois skips ciblés restent signalés. Pas de build supplémentaire, non demandé par la barrière de cette mission. Aucun changement ni validation de la lane hooks.

Le scanner reste une analyse statique de motifs et de contexte, pas un parseur complet de tous les langages. Les renommages arbitraires, constructions calculées, langages non reconnus et toutes les obfuscations possibles ne sont pas démontrés sûrs. Le repli étendu est testé avec son réglage activé par défaut ; cette reprise ne supprime pas le réglage d'opt-out existant. Les contextes ambigus couverts imposent revue et les portes automatiques la refusent. Le corpus ECC ne contient pas nécessairement les charges synthétiques : ses comptes seuls ne prouvent pas la fermeture du défaut, d'où les tests, mutations et consommateurs réels. Cette reprise valide les cas reproduits et les barrières exécutées, sans certification universelle du pare-feu.
