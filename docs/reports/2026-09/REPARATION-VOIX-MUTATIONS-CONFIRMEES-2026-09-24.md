# Réparation — une phrase entendue ne modifie plus l'espace de travail sans humain (24/09/2026)

Agent : Opus 5.5 (Claude Code), suite de l'audit de l'assistant vocal (constat A1).

## Défaut

En posture vocale `default`, les commandes shell qui modifient l'espace de travail (`rm`, `mv`,
`truncate`, `chmod`, interpréteurs, commandes inconnues) sont classées `sandbox` par ExecPolicy et
s'exécutent **sans demande** dans le bac à sable workspace-write. C'est un choix raisonnable pour
une session de code, où un développeur est au clavier. Pour la voix, c'est dangereux : la phrase a
seulement été *entendue* (télévision, invité, voix du robot réentendue), et personne n'est devant un
terminal. L'avertissement du service affirmait pourtant « writes and risky actions retain approval
gates ».

## Correctif

- `src/security/turn-origin.ts` : origine du tour dans un contexte asynchrone (AsyncLocalStorage).
- `src/sensory/agent-reply.ts` : chaque tour vocal est marqué `voice`.
- `src/tools/bash/execution-policy.ts` : dans un tour vocal, sous une posture prudente, une action
  `sandbox` devient `ask`. Un `ask` sans personne pour répondre est refusé. Les lectures (`allow`)
  restent disponibles. Une posture vocale explicitement permissive (`dontAsk`, `bypassPermissions`)
  reste le choix de l'utilisateur.
- `src/sensory/voice-loop.ts` : les deux avertissements disent désormais la vérité.

## Vérifications

- `tests/tools/bash-voice-origin-policy.test.ts` : 5/5. Rejoué contre la politique de `main` :
  les deux cas « mutation en tour vocal » tombent, les trois autres passent des deux côtés.
- Voisinage : `tests/sensory`, `tests/security`, tests shell : 142 fichiers, 2 012 tests ; `tsc` 0.

## Incident pendant la preuve

Le premier contre-essai contre l'ancienne politique a **exécuté la faille** : `rm -rf src` a tourné
sans confirmation, et pas dans le dépôt jetable du test. `BashTool` capture son dossier de travail à
sa construction ; le `process.chdir` du test venait après. Le dossier `src/` du worktree de travail a
été supprimé. Rien d'autre n'a été touché ; `src/` a été restauré depuis git et les modifications
réécrites. Deux leçons, appliquées :
- le test passe désormais le dossier de travail explicitement et vise un dossier au nom unique, créé
  seulement dans le dépôt jetable : une erreur de dossier ne peut plus rien effacer de réel ;
- commiter AVANT toute mutation de preuve (règle déjà connue, enfreinte ici).
