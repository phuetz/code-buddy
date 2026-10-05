# Reprise 5 — pare-feu ECC — livraison locale pour contre-revue

Les contournements cités ont des tests et des mutations ciblées. Les fichiers copiés sont tous analysés ; les scripts ne passent plus par les exceptions documentaires. Les motifs critiques d’un document restent au minimum en revue, avec leur sévérité d’origine. Les agents externes suivent une politique plus stricte : leurs findings critiques et élevés sont actifs et peuvent les mettre en quarantaine.

Branche `fix/pare-feu-import-ecc-2026-10-03`, départ `f432faceb30a203e729d9696611f5217984d7c9c`, correctif `396d306c0129e2c1116ca3f069fcdc994b46c097`. Rapport d’état partiel créé avant les modifications, puis actualisé pendant la relance. Le présent rapport remplace cet état provisoire ; la tête documentaire et les empreintes finales figurent dans `LIVRAISON.json` du partage.

La revue de reprise 4 demandée dit en réalité « PRÊT À FUSIONNER » et « Aucun » bloquant. Elle a été lue intégralement, comme Gemini, Grok, Opus et toute la chaîne des missions. Ses deux réserves mesurées, shebang sans extension et repli désactivable, étaient des défauts réels : elles sont corrigées. Aucun verdict de revue n’est tenu pour une preuve de sûreté générale.

## Bloquant → traitement → preuve

Les noms de mutations ci-dessous renvoient aux journaux et `results.json` sous `preuves/`. Une mutation est comptée uniquement si elle provoque un échec d’assertion ; une erreur de compilation ou de harnais ne constitue pas une preuve.

| Bloquant / réserve | Traitement | Preuve exécutée |
|---|---|---|
| Gemini 1 : `shutil.rmtree('/tmp/foo')` dans Markdown devient revue | Pour un skill documentaire, **revue reste le minimum autorisé par la consigne du pilote**, pas une autorisation : sévérité critique conservée, `scanDeniesInstall` vrai, registre / Exchange / auteur / génération refusent. Pour un agent externe, critique actif → quarantaine. | `gemini-rmtree` dans les trois nouveaux fichiers de tests ; mutations `documentary-floor-removed`, `agent-documentary-critical-accepted`, historiques `documentary-severity-info`, `automatic-gate-critical-only`. CLI : agent destructeur absent du dossier préparé. |
| Gemini 2 : `import SAFE_subprocess; SAFE_subprocess.Popen(...)` | Le préfixe fait partie du motif Python ; même durcissement pour `SAFE_child_process`. Aucun besoin d’une occurrence d’import préalable. | Tests `prefixed-subprocess`, accès entre crochets et Node, trois réglages de désobfuscation, deux modes d’import ; mutations `prefixed-python-missed`, `prefixed-node-missed`. Registre réel et paquet Exchange signé refusent. |
| Gemini 3 : `const apiKey = "REAL_SECRET"` / `const secret = "REAL_SECRET"` | Motif critique d’affectation littérale. La décision stricte des scripts précède les exemptions de tokens de prose. Une référence naturelle de script garde également son finding. | Trois affectations dont `SC_API_KEY`, tests `camel-api-key`, `lower-secret`, `prefixed-secret-value` ; mutations `credential-assignment-missed`, `script-secret-exemption`, `prefixed-reference-missed`. Tous les scripts correspondants sont quarantaine, jamais copiés avec include-review. |
| Gemini 4 : `# Do not run rm -rf /` sanctionné dans un script | Réserve **contestée**, conformément à la précision du pilote : « une exception documentaire ne peut JAMAIS concerner un fichier exécutable copié ». Le commentaire reste un finding critique actif et une quarantaine ; aucune nouvelle exemption de commentaire n’est créée. Les littéraux de backticks dont la grammaire shell conserve les substitutions comme texte à cette occurrence restent distingués d’un opérateur exécuté. | Commentaires Python et shell en quarantaine avant/après ; tests verts `comment-rm-python` / `comment-rm-shell`, findings non documentaires ; garde stricte dans `classifyMention` avant les règles de prose. Tests historiques des chaînes simples, échappements et heredocs littéraux conservés. |
| Gemini 5 : agent destructeur préparé sous `review/` | Les findings critiques et élevés des agents externes sont actifs avant calcul du verdict. Une quarantaine ne prépare aucun fichier, en sec comme avec apply. Les agents non quarantainés restent désactivés et suggest. | Quatre agents malveillants, tests en sec/apply, même charges via le vrai CLI ; mutation `agent-documentary-critical-accepted`. |
| Gemini 6 : `bash ../payload.txt`, fichier racine non scanné | Suppression de la liste de suffixes autorisés au scan des fichiers copiés. Détection du lancement shell. Le payload seul est aussi bloqué : le lanceur n’est pas la seule protection. | Tests `all copied support files`, `launcher plus root payload`, registre réel ; mutations `support-payload-ignored`, `shell-launcher-ignored`. CLI `root-payload` absent des copies. |
| Revue 4 : `scripts/run` sans extension, shebang shell/PHP | Langage reconnu depuis le shebang, dont env -S ; langage inconnu conservateur. JSX/TSX reconnus comme syntaxes de templates, sans exempter leurs appels de processus. | Cas extensionless shell/PHP, interpréteur inconnu, suffixe inconnu ; mutations `shebang-language-ignored`, `unknown-language-authorized`, `tsx-template-mistaken-for-shell`. |
| Revue 4 : U+FF40 avec DEOB_ALL=false/0, langue de clôture invisible | Repli minimal NFKC et caractères invisibles obligatoire pour les backticks, sans strip HTML ni destruction des heredocs. La passe étendue reste réglable. Langage de clôture inconnu : revue, jamais permission de processus. | Scripts sur true/false/0, Markdown langue pleine chasse / zero-width, consommateurs avec opt-out ; mutations `mandatory-folding-optout`, `folded-language-context-ignored`, `unknown-document-quarantined`. F# et littéraux shell historiques restent verts. |
| Grok B1/B2 : `os['system']`, getattr, suppression quotée et !0 | Correctifs antérieurs conservés : processus étendus et suppressions déstructurées, entre crochets ou optionnelles. | Tests `ecc-adverse-cases` et reprise 3/4 ; mutations `extended-process-missed`, `quoted-delete-missed`, `bare-recursive-delete-lost`, `optional-delete-missed` ; 29 scripts historiques via CLI, aucun copié. |
| Grok B3 / Opus B1 : avertissement magique, Watched patterns, description, HTML | Critiques jamais ramenés à info. Les impératifs hostiles restent actifs ; revue interdit toute activation automatique. `--include-review` copie uniquement à des fins d’inspection. | 13 consignes hostiles via CLI → quarantaine même avec le drapeau ; mutations d’impératif, catalogue, HTML, description, severity, registre, auteur et porte automatique. |
| Grok B4, R1 / Opus R5,R8 : canonique lié, casse, frontière, catégories assimilées aux locales | Correctifs antérieurs conservés : refus canonique lié/ambigu ; vraie casse et frontière de répertoire ; scan avant dédoublonnage, même chemin et manifeste identique nécessaires. | Tests d’import adverses ; mutations `canonical-symlink-opens-filter`, `canonical-prefix-loose`, `canonical-case-lost`, `translation-name-only`, `translation-not-scanned`. Cas Skills Linux exécuté ; Windows reste non prouvé. |
| Opus B2 : faux positifs de prose, Swift, csrf, guides, imports Python documentaires | Exceptions limitées au Markdown non exécutable. Mentions de secrets et imports documentaires en revue ; prose/Swift connus restent bénins ; doute conservé en revue. Références TS à propriété require en revue, même code copié en quarantaine. | Extraits ECC et tests historiques ; mutations `native-prose-active`, `prefixed-secret-penalties`, `typed-property-document-quarantined`. Aucun cas B initial nouvellement quarantainé. |
| Opus B3 : appels Python/PHP/Ruby/Go/PowerShell/Deno/Bun/execa | Tous les cas directs cités ont leurs tests et restent quarantaine dans scripts. | 29 charges exécutables historiques, mutation `extended-process-missed` et PHP/backticks ; vrai CLI avant/après. Aucun interpréteur n’exécute ces charges. |
| Grok R2 / Opus R1-R4 : vrais chargeurs, alias, YAML, globs, tools=[], prototype, Kotlin trompeur | Chemin de production CustomAgentLoader et filtre réellement branché vérifiés ; politique vide = aucun outil documentée ; prototype résolu avec Object.hasOwn ; require Kotlin inconnu reste revue. | Tests agents/skills adverses et reprises 3/4 ; mutations production Markdown/disabled, alias allow/deny, globs, prototype, négations/wildcards, Kotlin-always-benign. |
| Opus R6 : collision agents, profil, liens, provenance, permissions, champs transportés | Correctifs antérieurs conservés : scan/hash/corps sur mêmes octets, réservation des collisions en sec/apply, CODEBUDDY_HOME, lien refusé, disabled/suggest et champs autorisés explicites. | Tests et mutations agent-dry-run-collision, agent-profile-home-ignored, agent-symlink-accepted, agent-permission-full-auto, agent-carry-frontmatter, agent-snapshot-reread. |
| Opus R7 : mutations grossières | Mutations ciblées, restauration exacte après chaque essai, empreintes de tout le périmètre source contrôlées après le lot final. | 22 + 35 + 23 + 5 = **85 mutations tuées par assertion**, toutes rejouées après le dernier correctif. |

## Vérifications et preuves

**66 tests nouveaux** : 46 rouges par assertion et 20 témoins verts sur l’archive exacte de `f432faceb`, puis tous verts sur le correctif. Le contrôle avec les 35 tests A/B initiaux donne 101/101 verts. Les charges existent en fixtures et ne sont jamais exécutées. Les trois fichiers nouveaux couvrent scanner/import, consommateurs réels et agents.

Le test historique qui exigeait d’ignorer `readme.txt` a été **renforcé**, avec la même charge `eval("bad")` désormais détectée. Aucune suppression d’assertion, de fichier ni de test de sécurité. Les autres attentes existantes restent inchangées.

| Barrière finale, code identique au commit correctif | Résultat |
|---|---|
| `npm run typecheck` | 0, incluant gpuNode-identity et companion-core |
| `npm run lint` | 0 erreur, 2 601 avertissements |
| Vitest ciblé, maxWorkers 2, configLoader runner | **2 289 verts, 3 ignorés ; 129 fichiers verts, 1 ignoré** |
| `git diff --check` | 0 |

Commande ciblée exacte :

```sh
node_modules/.bin/vitest run --configLoader runner --maxWorkers 2 tests/security tests/skills tests/agents tests/agent/custom-agent-runtime.test.ts tests/agent/custom-agent-loader-hermes.test.ts tests/agent/custom-agent-tool-filter.test.ts tests/agent/self-improvement/skill-mutator.test.ts
```

Artefacts retenus : `baseline-delivered-66-tests.log`, `delivered-tests.log`, `delivered-typecheck.log`, `delivered-lint.log` ; dossiers `delivered-mutations`, `delivered-adverse-mutations`, `delivered-reprise3-mutations`, `delivered-reprise4-mutations` ; `delivered-restoration-verified.json`. Les essais intermédiaires de harnais ratés, dont une erreur de regex et un nom de répertoire Exchange incorrect, ne sont pas comptés comme mutations tuées. L’invariant est restauré et vérifié avant toute barrière ou tout rejeu de l’arbre courant.

## Rejeu réel complet ECC

Clone existant MIT, commit exact `ef648e01899ba3e8dc6371642deaaf64b4477775`. Source CLI `tsx src/index.ts skills import --dir <ECC> --apply --agents --json`. Avant sur archive f432faceb, après sur code correctif ; HOME/USERPROFILE/CODEBUDDY_HOME neufs sous `_qa/pare-feu-ecc/home`, aucun profil habituel utilisé. Chaque import a fini en code 0. Les 934 scans et les copies physiques ont été contrôlés.

| Mesure | Avant reprise 5 | Après reprise 5 |
|---|---:|---:|
| Tous les dossiers | 934 | 934 |
| allow / review / quarantine sur les 934 | 666 / 225 / 43 | 637 / 252 / 45 |
| Skills canoniques copiés | 203 | 190 |
| Skills canoniques en revue | 65 | 78 |
| Skills canoniques en quarantaine | 25 | 25 |
| Ignorés hors racine | 641 | 641 |
| Agents directs | 68 | 68 |
| Agents préparés désactivés | 57 | 51 |
| Agents quarantainés | 9 | 16 |
| Agents refusés avant préparation | 2 | 1 |

Les 641 exclusions sont toutes justifiées : **518 docs et 123 pi**, hors racine canonique. Le nouveau refus de gan-evaluator est compté en quarantaine avant validation des outils, ce qui explique skipped 2 → 1 ; aucune autorisation ajoutée.

**31 changements de verdict**, aucun vers allow. La liste exhaustive est `delivered-verdict-changes.json`, reconstruite sur les scans du dernier code. Les 13 changements canoniques sont tous allow → review :

- `skills/angular-developer` : dynamic-require, prefixed-secret, secret-ref.
- `skills/brand-discovery` : native-process.
- `skills/codebase-onboarding` : shell-backtick.
- `skills/e2e-testing` : shell-backtick.
- `skills/frontend-a11y` : embedded-secret.
- `skills/homelab-pihole-dns` : embedded-secret, shell-interpreter.
- `skills/operator-approval-loop` : pénalités conservées des scripts/supports.
- `skills/plan-orchestrate` : shell-backtick.
- `skills/remotion-video-creation` : fetch-http, template-injection.
- `skills/scientific-pkg-gget` : shell-backtick.
- `skills/scientific-thinking-literature-review` : shell-backtick.
- `skills/skill-scout` : shell-backtick.
- `skills/tinystruct-patterns` : extended-process.

Deux nouvelles quarantaines restent hors racine, `docs/ja-JP/skills/videodb` et `docs/zh-CN/skills/videodb`. L’analyse complète révèle des instructions `kill $(cat …)` : cinq substitutions shell inconnues dans leurs références, en plus de trois WebSocket actifs du manifeste. Les mentions réseau des références sont désormais documentaires ; score final 20, quarantaine conservée par prudence pour les substitutions inconnues. Aucune exception dédiée à videodb/PID n’a été ajoutée. **Sur-quarantaine assumée**, sans perte à l’import canonique puisque ces copies sont ignorées dans les deux mesures.

| Cas initial | Avant → après | Score final |
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

Aucun cas A ne revient en allow ; ils ne sont pas copiés par l’import ECC par défaut. `defi-amm-security` conserve allow pour ses assertions Solidity ; le corpus canonique ne contient pas la commande rm-rf imputée dans la mission initiale. Les variantes hostiles restent couvertes séparément.

## CLI et agents de production

**85 fixtures × 4 imports réels** (avant/après, défaut/include-review), HOME tous neufs. Les fichiers présents correspondent exactement aux lignes imported des rapports.

| Passage | Copies | Quarantaines | Revues non copiées |
|---|---:|---:|---:|
| Avant, défaut | 19 | 51 | 15 |
| Avant, include-review | 34 | 51 | 0 |
| Après, défaut | 7 | 63 | 15 |
| Après, include-review | 22 | 63 | 0 |

Les quatre agents malveillants sont tous quarantainés après, dans les deux modes. Preuves `cli-final85-before-assertions.json` et `cli-delivered85-after-assertions.json`, rapports JSON bruts et stderr associés. Le paquet Exchange signé est réellement créé puis refusé ; le registre réel charge zéro skill hostile, et les gardes d’auteur et de session refusent. Pour Exchange, les scripts sont présentés dans le manifeste : le test ne prétend pas qu’un format de paquet transporte des scripts Python/shell interdits par ce transport.

ECC physique final : **190 dossiers de skills, 51 agents désactivés**, ensemble exact correspondant au rapport. CustomAgentLoader et buildCustomAgentToolFilter ont été appelés en modes sync/async sur les trois originaux : planner autorise view_file/search et refuse tous les alias shell ; tdd-guide et security-reviewer gardent Bash et ses alias, docker refusé. Ceci teste leur politique, **pas une activation des agents importés**. À l’import, planner est maintenant quarantainé par la politique stricte des findings élevés ; aucun planner préparé n’existe. tdd-guide et security-reviewer restent préparés, disabled/suggest ; leur copie dans le dossier actif charge **0 agent importé**. Preuves `delivered-production-agents.json`, `delivered-physical-copies.json`.

Le premier harnais supposait les trois fichiers préparés et échouait sur ENOENT de planner. Il a été corrigé pour exiger le verdict de quarantaine et l’absence réelle, ou la présence préparée selon le rapport. Le contrôle final a terminé en code 0. La nouvelle sur-quarantaine de planner est annoncée, pas masquée.

## Passation

Aucun hook modifié, aucun push, aucune tâche détachée ni sous-agent. Les sous-processus des contrôles sont tous terminés. Le fichier non suivi initial `test_agent_import.ts` a été déplacé sans changer ses octets sous `_qa/pare-feu-ecc/reprise-5/test_agent_import-preserved.ts`, copie également livrée ; son auteur n’est pas établi. Les anciennes preuves et livraisons sont conservées.

Le rapport et la coordination sont commités séparément du correctif. La garde des données personnelles est rejouée après ajout nominatif du rapport ; le statut final et la tête sont consignés dans le reçu. SHA256SUMS permet de vérifier tous les artefacts livrés.

## Ce que je n'ai pas pu vérifier

- Windows, macOS, CI distante et toute la suite du dépôt : non exécutés. Linux et Node v24.14.1 uniquement ; le cas Skills est un essai Linux, pas une preuve de système insensible à la casse.
- Exécution de charges par Python, PHP, shell, PowerShell, Go ou un LLM : aucune. Le résultat prouvé est le verdict, le refus/copie physique et les gardes de chargement, pas les dégâts d’une intrusion.
- Analyse exhaustive de code arbitraire : appels calculés, alias inconnus, réinterprétation de textes littéraux par un autre programme, autres encodages que le texte UTF-8 lu par le scanner, constructions/obfuscations non citées restent non prouvés. Les motifs statiques ne constituent pas un confinement d’exécution ni une preuve universelle d’innocuité.
- La désobfuscation étendue reste réglable ; seuls le repli minimal des backticks et les contextes de langage associés sont rendus obligatoires. Ne pas déduire une couverture générale identique quand DEOB_ALL=false.
- Concurrence avec un daemon, course concurrente d’import, remplacement de fichiers pendant copie, état du binaire publié, permissions Windows : non rejoués dans cette reprise.
- Les commandes humaines futures d’activation, suppression du disabled, révision de quarantaine ou exécution des scripts importés : non effectuées. Aucun modèle distant interrogé pour cette validation.
- Les deux copies videodb hors canonique et planner restent sur-quarantainés par prudence ; je ne certifie pas qu’ils sont malveillants. Le rapport précise les motifs et les conséquences, sans transformer cette prudence en allow.
