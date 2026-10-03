# Import de hooks externes derrière le pare-feu — 03/10/2026

Livraison locale sur `feat/import-hooks-2026-10-03`, depuis `70bcab004`.
Rapport de mission créé avant l'implémentation et versionné dans le premier commit
`b97ee1332`. Implémentation : **`b987a1251`**, fermeture des chargeurs indirects : **`e24157cb0`**. Aucun push.

## Résultat et point d'insertion

Les cinq commandes `hooks import`, `imported`, `enable`, `disable`, `remove` sont
raccordées à la CLI. Le rapport seul est le défaut ; `--apply` installe désactivé.

Le point d'insertion est **UserHooksManager**, déjà appelé par CodeBuddyAgent,
la boucle unique d'AgentExecutor et la frontière de compaction. Aucun second
runner n'a été créé. L'ancien HookManager bloque sur 77 ; HookRunner et
UserHooksManager utilisent 2. Les imports utilisent ce dernier. PostToolUseFailure
existe déjà et est effectivement produit lorsque le résultat d'outil échoue.
Stop figure dans les types, mais n'a pas de producteur utilisateur dans cette
boucle : son import est refusé explicitement.

Le gestionnaire ajoute les manifests importés aux hooks natifs sans réécrire
`.codebuddy/hooks.json`. SessionStart est attendu avant la première requête ;
la CLI headless attend SessionEnd avant sa fermeture. Les arguments modifiés par
PreToolUse et le contexte supplémentaire parviennent maintenant à la vraie boucle.

## Sécurité et contrat

- Commande et scripts copiés : mêmes règles que le scanner des skills. Extraction
  de `scanSkillText` depuis `scanFile`, sans duplication du pare-feu. Ceci permet
  d'analyser les snapshots en mémoire sans fichier temporaire en mode rapport.
- Provenance : source, empreinte du document source, empreinte du hook et SHA-256
  des fichiers copiés. Installation sous `.codebuddy/imported-hooks/<id>`, désactivée.
- Tout verdict review/quarantine est conservé, inerte, dans
  `.codebuddy/hook-quarantine/<id>`, avec motif. La CLI ne permet pas son activation.
- Activation : empreintes et nouveau passage de scanSkillFirewall. Avant chaque
  exécution : fichiers et état d'activation revérifiés, y compris après disable
  dans une autre CLI. Aucun hook exécuté et aucun accès réseau lors de l'import.
- Les chemins source absolus, symlinks, traversées, fichiers spéciaux/binaire,
  sources trop grandes, chargeurs dynamiques et dépendances non copiables sont
  refusés ou mis en quarantaine. Aucun npm install ni téléchargement implicite.
- Commandes littérales POSIX Node/sh/bash et quelques primitives. Dépendances JS
  statiques copiées ; dépendances shell via CLAUDE_PLUGIN_ROOT. Les constructions
  non maîtrisées donnent un refus clair. Windows est refusé pour ce sous-ensemble.
- Bash/Edit/Write/Read/Grep/Glob/WebFetch/WebSearch sont traduits avec les alias
  existants. PowerShell/MultiEdit/Skill et les regex sans traduction exacte sont refusés.
- CLAUDE_PLUGIN_ROOT désigne le bundle copié ; CLAUDE_PROJECT_DIR le cwd courant.
  Autres variables Claude, transcript_path et settings.env non vide : refus explicite.
  L'environnement du hook utilise le mode core de ShellEnvPolicy ; pas de clés API,
  NODE_OPTIONS, NODE_PATH ni variables de préchargement héritées.
- stdin : noms Claude et champs snake_case, file_path, tool_use_id, session_id,
  résultat/error. Le résultat reste au format Code Buddy success/output/error.
  Aucun identifiant n'est inventé lorsque le cœur n'en fournit pas.
- stdout : hookSpecificOutput, deny/reason, updatedInput, additionalContext.
  Code 2 bloque PreToolUse, 77 ne bloque pas. Pour les événements déjà accomplis
  et les sessions, code 2 donne un feedback. PreCompact garde le contrat natif
  **consultatif**, plafonné à 5 s, sans blocage de compaction. Ces limites sont
  présentes dans le rapport JSON et la documentation, pas dissimulées.
- Sorties importées bornées à 256 KiB ; arrêt forcé après timeout si SIGTERM est ignoré.
  L'analyse statique n'est pas une preuve générale d'innocuité de tout programme.

Documentation : `docs/import-hooks.md` et une ligne dans `CLAUDE.md`.

## Essai réel sur ECC

Clone public MIT dans `_qa/import-hooks/ecc`, commit exact
`ef648e01899ba3e8dc6371642deaaf64b4477775`. HOME des essais :
`_qa/import-hooks/home`. Aucune configuration personnelle de production utilisée.

| Événement | Total | Admissibles | Quarantaine | Refus |
|---|---:|---:|---:|---:|
| PreToolUse | 9 | 0 | 4 | 5 |
| Stop | 7 | 0 | 0 | 7 |
| SessionStart | 2 | 0 | 2 | 0 |
| PostToolUse | 2 | 0 | 1 | 1 |
| PostToolUseFailure | 2 | 0 | 1 | 1 |
| PreCompact | 1 | 0 | 1 | 0 |
| SessionEnd | 1 | 0 | 0 | 1 |
| **Total** | **24** | **0** | **9** | **15** |

Les neuf quarantaines sont motivées par le bootstrap de chargement dynamique
(`dynamic-require` du pare-feu existant). Leurs commandes sont conservées comme
preuves inertes ; aucune fermeture de dépendances dynamiques n'est prétendue.
Les quinze refus : Stop 7 ; hooks asynchrones hors Stop 3 ; matchers comprenant
PowerShell 2, MultiEdit 2 et Skill 1. Aucun événement ignoré en silence.
Les commandes individuelles et leurs motifs sont conservés dans les traces JSON.

Un premier essai a découvert que le rapport créait le journal CLI. Correction :
pas de journal ni de nettoyage de démarrage pour hooks import sans --apply.
Le nouvel essai compare **les octets de tous les fichiers** du HOME, du projet
et d'ECC avant/après : identiques, code 0. Le registre final contient neuf
quarantaines ECC et trois hooks de recette, tous désactivés. La vraie CLI
disable/remove/imported a aussi été exercée sur le workspace du premier essai :
retrait confirmé par une seconde lecture du registre, autres hooks désactivés.

## Preuve utilisateur : vrai buddy -p et vrai Ollama

Trois hooks admissibles de recette au format `.claude/settings.json`, distincts
d'ECC, ont été importés désactivés : SessionStart, PreToolUse/Read, SessionEnd.
Ils utilisent le même script local copié, analysé et chargé par le vrai gestionnaire.
Le modèle est `qwen3:4b-instruct`, via Ollama local, sans réponse simulée.

1. **Désactivés** : buddy -p demande de lire target.txt. Aucun marqueur de hook.
   Le résultat d'outil lit target.txt et contient `DISABLED_HOOK_CONTROL_0310`.
2. **Activés par la CLI** : PreToolUse reçoit tool_name Read, file_path target.txt,
   l'identifiant du tool call et l'identifiant de session. Son updatedInput dirige
   la lecture vers redirect-proof.txt. Le vrai résultat view_file et la réponse
   finale contiennent `ACTIVATED_IMPORTED_HOOK_PROOF_0310`.
3. Les trois fichiers observés prouvent SessionStart, PreToolUse et SessionEnd.
   SessionEnd a fini avant le retour processus. Les hooks ont ensuite été désactivés.

Exécution finale : 40,37 s désactivée, 14,51 s activée, codes 0. Les lignes numérotées
sont celles réellement rendues par view_file. Le premier essai a rejeté l'option
obsolète --allowedTools : il est conservé et **ne compte pas comme preuve**.
Les essais valides utilisent --allowed-tools.

## Tests, mutations et barrières

**65 tests d'import/hooks**, dont vrais sous-processus, passent après restauration.
Gardes : traduction/alias/matcher, commandes et dépendance transitive dangereuses,
désactivation initiale, événements inconnus, chemins et liens, provenance modifiée,
stdin/env/stdout, code 2/77, timeout, sortie excessive, CLI et compaction consultative.

**9 mutations indépendantes**, chaque fois détectées par une assertion rouge,
puis source restaurée : mauvaise traduction Bash ; quarantaine transformée en
installation ; activation par défaut ; helper non scanné ; événement inconnu accepté ;
code 2 rendu permissif ; empreinte ignorée ; matcher ignoré ; chargeur indirect admis. Ce ne sont pas des
échecs de démarrage du runner. Les journaux rouges et le témoin vert sont conservés.
La dernière revue a aussi fermé module.require, module.constructor._load,
process.mainModule et les constructeurs de fonctions, qui pouvaient échapper
à la collecte des dépendances statiques. Quatre régressions et un mutant dédié
prouvent ce refus ; la sélection complète ciblée a été rejouée verte.

Commande ciblée finale (aucune suite complète) :

```sh
VITEST_MAX_WORKERS=1 npm test -- tests/hooks tests/skills \
  tests/security/skill-scanner tests/security/skill-firewall \
  tests/agent/execution/fleet-tool-hooks.test.ts \
  tests/agent/execution/agent-executor.test.ts \
  tests/agent/agent-executor-lanes.test.ts \
  tests/security/donnees-personnelles.test.ts
```

Résultat : **47 fichiers passent, 1 sauté ; 1 029 tests passent, 3 sautés**.
Les trois cas viennent de bundled-skills, dont le répertoire local optionnel est absent.
Deux tests CLI skills ont dépassé leur délai sous charge avec plusieurs workers ;
ils passent isolément (7/7), puis avec toute la sélection à un worker, sans
modifier les assertions ni augmenter leurs timeouts. Une garde post-outil a
révélé un feedback perdu dans mergeResult ; corrigé et vérifié rouge → vert.

`npm run typecheck` : code 0, y compris gpuNode-identity et companion-core.
`npm run lint` : code 0, zéro erreur, 2 601 avertissements globaux.
`git diff --check` : vert. État de travail propre après les commits de livraison.
Le cache Vite a été isolé dans le worktree ; le lien node_modules initial est restauré.
Aucun service lancé, aucun serveur ni tâche de fond conservé, aucun push.

## Ce que je n'ai pas pu vérifier

- **Aucun hook ECC activé** : les 24 sont inadmissibles dans leur forme actuelle.
  La preuve runtime porte sur des hooks admissibles de recette, pas sur une
  compatibilité ECC complète. Lever le pare-feu pour obtenir un chiffre positif
  aurait contredit le cœur de la demande.
- Compatibilité universelle Claude : programmes inline, paquets externes,
  regex arbitraires, autres types/options et décisions universelles ne sont pas
  tous pris en charge. Les options d'import non compatibles sont refusées.
- Blocage Claude de PreCompact : Code Buddy conserve sa frontière consultative.
  Stop reste refusé ; pas de boucle de continuation Claude ajoutée artificiellement.
- Windows/macOS, binaire npm/dist, Electron et CI distante non exécutés.
  Le sous-ensemble POSIX importé ne s'active pas sous Windows.
- Les trois tests bundled-skills sautés ne constituent pas une validation.

Références : [contrat Claude Code](https://code.claude.com/docs/en/hooks),
[projet ECC](https://github.com/affaan-m/everything-claude-code).
