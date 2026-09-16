# Skills et isolation des profils — 14 septembre 2026

La capture de Patrice montre onze entrées de fixtures (`healthy-helper`,
`tampered-helper`, `missing-helper`, etc.) présentées comme l'inventaire complet,
avec `undefined` devant un titre Markdown. Ces noms existent dans les tests.
Le contenu exact du registre Windows n'a pas été lu ; la capture confirme les noms,
mais ne permet pas de dater ni d'attribuer la copie du registre sur cette machine.

## Défauts corrigés

- `SkillsHub` figeait les chemins HOME lors de l'import : changer HOME ensuite
  ne protégeait pas les tests. Les chemins sont désormais résolus à la construction.
- Deux suites initialisaient le singleton du hub hors du répertoire temporaire.
  Leur hub est maintenant configuré avant toute utilisation et détruit après le test.
- `skills_list` ne présentait que le lockfile du hub. Un inventaire local fournit
  désormais `availableSkills`, `unavailableSkills`, les descriptions, les sources
  et les erreurs de découverte. Les champs historiques du hub restent compatibles.
  `skill_view` lit également les instructions bundled/builtin/workspace ;
  `buddy skills list` utilise ce même inventaire. Aucun watcher ni activation.
- Le callback de style `heading` de marked-terminal reçoit le texte uniquement,
  contrairement au renderer marked : le niveau supposé devenait undefined.
  Les six niveaux de titres sont couverts par un test avec la vraie bibliothèque.
- Audit demandé ensuite : le même gel des chemins existait dans les defaults de
  l'historique, de la mémoire utilisateur, des profils d'authentification et du
  chargeur legacy de skills. Les nouvelles instances utilisent HOME/cwd courants.
- Le garde-fou global des tests surveille maintenant aussi les registres hub,
  mémoire, historique, profils auth et settings du HOME externe aux fixtures.

Les instructions disponibles peuvent nécessiter un outil ou un service externe :
leur présence ne garantit pas que toutes ces dépendances soient configurées.
Les skills désactivés ou altérés dans le hub ne sont pas réactivés par l'inventaire.

## Réparation de l'installation concernée

`scripts/repair-test-skill-records.mjs` prévisualise par défaut. `--apply` retire
uniquement les onze noms exacts signalés, après sauvegarde du registre. Il ne
supprime aucun fichier de skill ni autre entrée. Il refuse un format inconnu
et vérifie que le registre n'a pas changé avant remplacement atomique.
Ce script ponctuel n'est pas une migration automatique ni une liste noire des
noms dans le moteur. Fermer Buddy avant de le lancer, puis ouvrir une session neuve.

## Vérifications

Premiers lots : 144 tests skills/Markdown, 148 profils/auth/history/loader,
16 mémoire en mode persistant, 57 tests Node20. Les anciens tests d'intégration
activés explicitement avaient trois attentes périmées : chemin créé désormais
préfixé `authored-`, suppression effective du fichier après delete, et code de
sortie 1 de doctor lorsque des défauts subsistent. Les assertions ont été alignées
sur ces comportements en conservant la vérification du contenu et des défauts.

Archive précédente contrôlée : 5139 entrées, aucun registre `.codebuddy/`, dossier
de tests ou fichier portant les noms des fixtures signalées. Validation finale,
archive mise à jour et contrôle du paquet installé consignés dans le tableau de
coordination et dans Partage. Ceci est un audit ciblé, pas une certification de
l'absence de tout défaut dans les autres modules.
