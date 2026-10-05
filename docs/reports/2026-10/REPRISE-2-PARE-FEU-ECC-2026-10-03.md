# Reprise 2 — pare-feu des skills et import ECC, 03/10/2026

**Validation invalidée par la relecture de reprise 2.** Les suppressions nues, les exceptions appliquées à toute une ligne et les allowlists `*`/`!bash` restaient dangereuses sur `6bf228905`. Voir le rapport de reprise 3. Ce document conserve les mesures historiques ; elles ne prouvent pas la sécurité de cette tête.

Les contre-revues Grok et Opus ont reproduit des défauts de sécurité réels sur `17ca8f374`. La conclusion antérieure « PRÊT » est invalidée. Cette reprise corrige les portes de chargement automatique, les exceptions documentaires, les appels directs et les importeurs. Les trois rapports demandés et la mission de reprise ont été lus intégralement. Chantier réservé et rapport initial créé dans ce répertoire avant correction ; même branche `fix/pare-feu-import-ecc-2026-10-03`.

## Bloquant → traitement → preuve

| Bloquant ou réserve réelle | Traitement | Preuve exécutée |
|---|---|---|
| Grok B1 : `os['system']`, `getattr(os, 'system')` | Détection des API quotées et résolution dynamique citées ; scripts traités comme code actif. | Vecteurs `os-bracket` et `os-getattr`, scanner, import avec/sans revue, registre réel, Exchange signé et auto-écriture. Mutants `extended-process-missed`, `registry-scripts-ignored`, `automatic-gate-critical-only`. |
| Grok B2 : `rmSync`, clé `"recursive"`, accès quoté, `!0` | Détection conservatrice des appels de suppression, même avec options variables. | `rm-quoted-key`, `rm-quoted-name`, `rm-bang`, `node-rm-opts-var` ; mutant `quoted-delete-missed`. |
| Grok B3 et Opus B1 : ordre dangereux déguisé en documentation | Une mention conserve la gravité du motif et impose au minimum revue. Un ordre explicite, commentaire HTML hostile, substitution imbriquée ou faux catalogue reste actif. | Les 13 documents hostiles sont quarantinés ; tests des consommateurs et du générateur réel de skills de session ; mutants gravité, impératifs, HTML, catalogue et description. |
| Registre, Skill Exchange et auto-écriture acceptaient des risques non critiques ou documentaires | Les portes automatiques exigent `allow`, y compris la safety gate des skills auto-écrits. Le registre examine aussi le répertoire de support et ses scripts. | Tests sans mock du scanner : registre, import Exchange signé Ed25519, `scanAuthoredSkillContent`, `safetyGate`, `generateSessionSkill`. Un critique documentaire en revue est refusé par ces portes. |
| Opus B3 : lanceurs directs encore allow/100 | Ajout Python asyncio, posix_spawn, execv, pty ; PHP passthru, proc_open, backticks ; Ruby Open3, %x, IO.popen ; PowerShell Invoke-Expression ; Go syscall.Exec/os.StartProcess ; Deno.Command, Bun shell et execa. | Les 29 vecteurs exécutables, dont les témoins, sont quarantinés, jamais copiés avec `--include-review`. Mutants des API étendues, backticks, suppression et portes automatiques. |
| Opus B2 : prose `operating/file/management system (` et Swift `.system(size:)` | Reconnaissance de ces usages distincts d'un lanceur. Les autres exemples d'API restent au minimum en revue en Markdown, actifs dans les scripts. | Tests des phrases exactes, extrait MIT de liquid-glass-design et rejeu intégral : ses trois copies passent de quarantine à allow, sans motif critique. |
| Opus B2 : csrf/access/refresh/id_token, secrets préfixés, `import os as` documentaires | Références documentaires conservées en revue sans cumul de pénalités exécutables ; aucune autorisation automatique. Mots naturels « token/secret » distingués des identifiants et variables. | 18 jeux d'extraits ECC réels, trois guides Code Buddy réels ; mutants des pénalités et des portes. Le client exécutable Itô reste strict, voir la réserve motivée ci-dessous. |
| Grok B4 : racine canonique `skills/` liée symboliquement | Refus explicite d'une racine liée ou spéciale ; aucun repli sur docs. | Fixture symlink et mutant `canonical-symlink-opens-filter`. |
| Réserves : `Skills/`, `skills-extra`, catégories `ops/it/ar/de/es/hi/tr` prises pour des langues | Casse réelle de la racine conservée ; frontière de répertoire avec `path.relative`. La seule ressemblance d'un nom de catégorie ne dédoublonne plus rien. | Tests racine `skills` et `Skills` sous Linux, frontière, sept catégories ; mutants casse, préfixe et dédoublonnage par seul nom. |
| Réserve : traduction ignorée sans scan | Une contrepartie au même chemin relatif doit exister ; candidat scanné avant exclusion. Seule une copie de manifeste identique est dédoublonnée automatiquement. Une variante ambiguë reste distincte. | Candidat de traduction hostile avec script placé en quarantaine ; mutant `translation-not-scanned`. Test de dédoublonnage existant conservé. |
| Réserves agents : chargeurs Markdown secondaires, disabled non prouvé, alias Bash incomplets | Markdown branché dans `CustomAgentLoader`, classe utilisée par `buddy --agent`, chemins synchrones et asynchrones. Les fichiers désactivés sont refusés. Famille bash/terminal/shell_exec/interactive_shell appliquée aux allowlists et denylists. | Trois agents ECC originaux réellement chargés ; six vérifications de droits ; zéro copie importée désactivée active. Tests des quatre formats désactivés et mutants du chargeur et des droits. |
| Réserves agents : YAML descriptif historique, glob, prototype et tools vide | Réparation bornée du seul scalaire description contenant `: ` ; politiques invalides restent refusées. Globs locaux valides conservés. Alias résolus avec `Object.hasOwn`. Tableau tools vide = aucun outil, champ absent = politique héritée. | YAML historique, TOML `*_exec`, quatre motifs, noms constructor/toString ; tests d'absence/vide existants. Documentation de migration et mutants dédiés. |
| Réserves import agents : collision de casse en dry-run, CODEBUDDY_HOME, TOCTOU, provenance/permissions | Réservation des noms aussi en dry-run ; profil centralisé pour agents et skills. Lecture unique par descripteur, fichier régulier, refus du lien final ; scanner, corps importé et SHA256 utilisent les mêmes octets. Métadonnées copiées sur liste explicite ; disabled=true et permissionMode=suggest. | Collisions Planner/planner, profils isolés, symlink, description contenant des délimiteurs, injection de modification entre lectures et non-recopie des champs model/hooks/mcpServers. Six mutants de staging/profil/snapshot/permissions. |
| Réserve précédente : exception arithmétique echo/bc trop large ; Kotlin `require(mods[0])` | Arithmétique limitée aux nombres, variables et opérateurs autorisés ; le texte d'une commande n'est plus admis. Seules assertions Kotlin/Solidity reconnues sont bénignes ; usages inconnus → revue. | Six substitutions déguisées → quarantine ; require avec tableau → review ; assertions connues → allow ; mutants `bc-words-allowed` et `kotlin-require-always-benign`. |

## Résultats et preuves de non-régression

Les quatre nouveaux fichiers de tests représentent **172 tests**. Copiés avec leur helper et leurs données dans une archive complète de la tête initiale `17ca8f374`, ils donnent **126 échecs d'assertion et 46 témoins verts**. Les échecs de préparation des premières sondes ne sont pas utilisés comme preuve : le journal probant est `baseline-final-red.log`.

Le script `scripts/qa/verify-ecc-adverse-mutations.py` applique **35 mutations ciblées**, une par une, à une expression ou une garde. Elles sont toutes tuées par assertion ; chaque journal contient les noms des tests défaillants. Chaque fichier est restauré à l'octet près dans un finally, avec SHA256 dans `mutations/results.json`. Ceci remplace les seules grosses suppressions de fichier comme preuve de sensibilité. Le mutant supplémentaire `compound-warning-imperative` couvre exactement la phrase ECC de tdd-workflow contenant « fetch-and-execute » : elle reste review, pas quarantine.

Barrière ciblée : **2 028 tests verts, 3 skips, 120 fichiers verts et 1 fichier ignoré**. Typecheck : sortie 0. Lint global : sortie 0, **0 erreur et 2 601 avertissements**. Aucun test de la suite complète n'a été lancé. Périmètre : `tests/security`, `tests/skills`, `tests/agents` et les quatre fichiers existants runtime/Hermes/filter/mutator affectés. Un seul test existant a changé : son installation au HOME par défaut neutralise et restaure désormais CODEBUDDY_HOME/GROK_HOME, que le setup Vitest injecte. Toutes ses assertions sont conservées ; le profil explicite a son propre test ajouté.

Les 58 fixtures passent aussi par le CLI réel et des HOME isolés. Sans include-review : **6 copiées, 43 quarantaines, 9 revues**. Avec include-review : **15 copiées, 43 quarantaines, 0 revue restante dans le rapport**. Chaque verdict et présence physique du fichier copié est vérifié. Les copies en revue sont disponibles pour inspection ; le registre et les autres portes automatiques refusent toujours leur activation. Un score 100 documentaire ne signifie donc pas allow.

## ECC complet avant/après

Clone local vérifié au commit MIT `ef648e01899ba3e8dc6371642deaaf64b4477775`. Rejeu réel `tsx src/index.ts skills import --dir <ECC> --apply --agents --json`, avant toute correction puis sur le résultat final. HOME, USERPROFILE et CODEBUDDY_HOME isolés sous `_qa/pare-feu-ecc/home/`. Aucun script ECC exécuté.

| Mesure | Avant, 17ca8f374 | Après correction |
|---|---:|---:|
| SKILL.md trouvés | 934 | 934 |
| Scan intégral des 934 : allow / review / quarantine | 690 / 145 / 99 | 663 / 225 / 46 |
| Import canonique skills : copiés / revue / quarantaine | 206 / 43 / 44 | 202 / 65 / 26 |
| Copies hors racine ignorées, motif explicite | 641 | 641 |
| Agents trouvés | 68 | 68 |
| Agents copiés désactivés en revue / quarantaine / refus | 55 / 11 / 2 | 57 / 9 / 2 |

Les 641 exclusions restent les 473 manifests sous docs, 107 sous pi et 61 autres copies/integrations : le rapport donne chaque chemin et le motif. Les **202 fichiers réellement copiés** correspondent au rapport. Les 94 changements de verdict du scan intégral, dont 28 sous skills, figurent tous dans `verdict-changes.json` et `.md` : 53 quarantine→review, 31 allow→review, 3 allow→quarantine, 3 quarantine→allow, 4 review→allow. Les trois quarantine→allow sont exclusivement les copies de liquid-glass-design et ses appels Swift .system(size:). Aucun motif critique documentaire n'est rétrogradé en info.

| Cas initiaux A/B, racine canonique | Après | Conséquence |
|---|---|---|
| skill-comply | quarantine, 0 | Non copié ; processus et suppression du script détectés. |
| homelab-wireguard-vpn | review, 100 | Non copié ; exemples Python et DuckDNS identifiés, accès automatique refusé. |
| social-publisher | review, 100 | Non copié ; SC_API_KEY identifié. |
| pytorch-patterns, kotlin-patterns, deep-research | review, 100 chacun | API/instruction documentaire conservée pour revue. |
| tdd-workflow, safety-guard, github-ops, healthcare-eval-harness | review, 100 chacun | Plus de quarantaine documentaire ; revue obligatoire. |
| defi-amm-security | allow, 100 | Le fichier de ce commit ne contient pas rm-rf ; les anciens hits sont des mots naturels token. La suppression dangereuse documentée reste couverte par les fixtures rm-rf. |

Les 18 cas documentaires d'Opus sont mesurés en manifeste **et** en répertoire complet dans `documentary-final-proofs.json`. Les 17 manifests concernés restent review ; liquid-glass-design est allow. Tous les répertoires suivent ce verdict sauf **ito-baskets**, encore quarantine (36). Cette réserve est contestée pour le répertoire entier : il contient un véritable `scripts/ito-baskets.js`, qui lit `environment.ITO_API_KEY` et crée `headers.Authorization = Bearer …` aux lignes 98–100, en plus de mentions répétées et de templates dans le script. Le manifeste seul est review/100. Accorder au script les exceptions de la prose affaiblirait A ; sa quarantaine est conservée, sans prétendre que le client est malveillant. Les trois guides Code Buddy du dépôt passent de la quarantaine signalée à review, jamais allow. Correction de mesure en reprise 3 : chacun est à **90/100**, avec neuf findings dont un WebSocket actif de gravité medium ; le 100 annoncé initialement était inexact.

Les six résultats du chargeur de production dans `production-final-agents.json` prouvent, pour chaque chemin sync/async, que planner autorise lecture/recherche et refuse les quatre alias shell ; tdd-guide et security-reviewer autorisent leurs alias Bash, refusent docker. Les copies importées désactivées, même déplacées dans le répertoire actif, produisent zéro agent actif. Aucun appel LLM n'est nécessaire pour constater ces droits réellement filtrés.

## Livraison et reproduction

Commits de code : `50216d4dd` (pare-feu et consommateurs) et `499613d35` (agents et importeurs). La tête documentaire est inscrite dans le reçu de livraison. Rapport partagé et preuves : `Partage/20261003-cb-pare-feu-ecc/reprise-1/reprise-1/sol61/`. Le reçu joint les SHA256, sorties des barrières sur la tête finale et git status. Les anciens rapports partagés ne sont pas écrasés ; le rapport versionné de reprise 1 est marqué comme invalidé.

```bash
npm run typecheck
npm run lint
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 tests/security tests/skills tests/agents tests/agent/custom-agent-runtime.test.ts tests/agent/custom-agent-loader-hermes.test.ts tests/agent/custom-agent-tool-filter.test.ts tests/agent/self-improvement/skill-mutator.test.ts
python3 scripts/qa/verify-ecc-adverse-mutations.py
```

Les JSON de scan, CLI et mutations, l'inventaire complet des changements et les fixtures sont joints. Aucun push pendant cette reprise, aucune fusion, aucune tâche détachée. Les fichiers de la lane hooks n'ont pas changé. Le push relevé par Opus dans une session précédente n'est pas attribuable à cette reprise ; je ne prétends pas identifier son auteur.

## Ce que je n'ai pas pu vérifier

Linux exécuté uniquement : aucun Windows/macOS natif ni CI distante. La variante Skills est testée sous Linux, ce qui ne remplace pas Windows. Aucun modèle, tour d'agent LLM, hook ou script ECC exécuté ; seuls le CLI d'import, les chargeurs, filtres, générateur et échange signé ont tourné. Suite complète exclue conformément à la mission. Les trois skips de la barrière ciblée restent signalés.

Le scanner reste une analyse statique de motifs et de contexte, pas un analyseur complet de tous les langages : renommages arbitraires, constructions calculées et toutes les obfuscations possibles ne sont pas démontrés sûrs. Les exceptions documentaires n'accordent jamais une activation automatique. Les traductions dont le texte diffère sans identité fiable sont conservées comme variantes ; elles ne sont pas déduites du seul nom d'une catégorie. L'activation volontaire après revue humaine des agents désactivés n'est pas automatisée. Aucune modification ni validation de la lane hooks.
