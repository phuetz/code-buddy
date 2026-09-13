# Reprise de l’audit Code Buddy — 13 septembre 2026

**Mise à jour : les quatre chantiers sont implémentés.** Les constats ci-dessous décrivent la base avant correctifs ; le bilan d’implémentation en fin de document fait foi pour l’état actuel. La sonde livrée a été convertie pour vérifier le comportement corrigé.

Auteur : Codex. Base examinée : `8b5c61def`. Branche : `codex/audit-ameliorations-2026-09-13`.
Worktree : `~/DEV/cb-audit-ameliorations-2026-09-13`.

Reprise de `RAPPORT-AUDIT-CODE-BUDDY-2026-09-02.md`, le rapport retrouvé qui correspond au sujet indiqué par Patrice. L’identité de la conversation précédente n’est pas établie. Cette tranche revalide les risques de perte de mémoire et de reprise de session ; elle ne prétend pas couvrir tout le dépôt.

## Résultat et ordre proposé

| Priorité | Amélioration | Preuve actuelle | Critère de réussite du correctif |
| --- | --- | --- | --- |
| P1 | Respecter la promesse du chiffrement de session | La sauvegarde chiffrée relue retourne un message assistant contenant `__encrypted`, au lieu du message utilisateur initial. Une exception injectée dans le chiffreur fait sauvegarder le texte en clair avec succès. | Lecture déchiffrée et typée, reprise/export/fork cohérents ; en cas d’échec de chiffrement, aucune nouvelle écriture en clair, ancien fichier conservé et erreur explicite. |
| P1 | Protéger les souvenirs épinglés de la réconciliation | Un faux client LLM renvoie DELETE + ADD ; la vraie chaîne `remember` efface sur disque une préférence `pinned`, sans archive. | Une préférence épinglée survit à une proposition DELETE automatique ; toute suppression automatique admissible possède une archive récupérable avant mutation. |
| P1 | Respecter le projet de la session pour la mémoire | `RememberTool.execute(..., {cwd: B})`, processus lancé en A : succès, écriture en A, aucun fichier en B. | Écriture, rappel, injection dans le prompt, hooks et propositions mémoire utilisent le même projet ; tests avec deux sessions dans des projets distincts. |
| P2 | Reprendre une session avec les détails utiles des outils | Sauvegarde/relecture réelle : arguments remplacés par `{}`, identifiant refabriqué, `toolResult.output` et `error` perdus. Le champ `content`, lui, est conservé. | Aller-retour préservant les arguments, identifiants, résultats et liens appel/résultat ; anciens formats lisibles, taille bornée et filtrage des secrets explicites. |

Ces quatre chantiers prolongent des constats ouverts du 02/09 ; le repli en clair sur échec de chiffrement est une preuve supplémentaire de cette reprise. Aucun changement de production effectué.

## 1. Sessions chiffrées : écriture seule, repli en clair

- `src/agent/facades/session-facade.ts:142` chiffre tout l’historique puis le remplace par un unique message assistant.
- `src/agent/facades/session-facade.ts:155` intercepte l’échec et poursuit vers `updateCurrentSession(chatHistory)` en clair. Le retour de la méthode ne signale pas un échec.
- `src/agent/facades/session-facade.ts:189` délègue la lecture directement au store. La conversion du store ne déchiffre pas non plus.
- Reproduction avec chiffrement réel et HOME temporaire : le message utilisateur original devient un marqueur chiffré dans un message assistant lors de la lecture. Injection d’une exception uniquement dans `SessionEncryption.encryptObject` : le marqueur privé de la fixture est retrouvé littéralement dans le JSON sauvegardé.

La fonctionnalité est opt-in (`SESSION_ENCRYPTION=true`). La sonde démontre les méthodes de sauvegarde/lecture réelles ; aucune session utilisateur ni interface interactive n’est ouverte. Une absence ou corruption de clé doit avoir un résultat explicite, distinct d’une session vide.

## 2. Réconciliation : `pinned` ne contraint pas DELETE

- `src/memory/facts-memory.ts:209` applique `splice` à un DELETE valide ; aucune règle concernant les préférences ou les épinglages à cette étape.
- `src/memory/persistent-memory.ts:605` réconcilie puis remplace la map. Les tags des entrées conservées sont désormais préservés, mais cela ne protège pas les entrées retirées.
- La sonde crée une préférence `pinned`, puis injecte un client déterministe renvoyant DELETE de cette entrée et ADD d’une nouvelle note. Toute la chaîne de réconciliation et de sauvegarde reste réelle.
- Résultat : ancienne préférence absente sur disque, nouvelle note présente, aucun fichier `.archive.md`. Une note ajoutée par un autre manager reste présente, ce qui distingue cette suppression du défaut de concurrence historique.

Proposition : interdire la suppression automatique des épinglages et préférences, et archiver les suppressions admissibles. Le choix exact de la politique reste à définir lors du correctif ; l’audit ne modifie aucune règle d’oubli.

## 3. Mémoire : le `cwd` du contexte n’est pas consommé

Les appels `getMemoryManager(undefined, context?.botId)` dans `src/tools/registry/memory-tools.ts` ne transmettent pas le projet. `RememberTool` utilise également `process.cwd()` pour le hook `before_memory_write`. La configuration mémoire par défaut possède un chemin projet relatif.

La sonde fournit un contexte avec un autre dossier existant, puis vérifie les deux chemins physiques. `success: true` correspond bien à une écriture, mais dans le dossier du processus. La correction devra inclure les lecteurs de mémoire : remplacer seulement ce premier argument risquerait de faire écrire dans un manager que le prompt ne lit pas.

## 4. Sessions : l’aller-retour détruit la structure des outils

`src/persistence/session-store.ts:405` ne persiste que le nom et le succès de l’outil en plus du contenu générique. `convertMessagesToChatEntries`, à la ligne 424, recrée un identifiant, force `arguments: '{}'` et ne restaure que `success` dans le résultat.

La sonde écrit un appel `bash` contenant une commande et un résultat structuré avec sortie et erreur, puis recharge depuis un nouveau `SessionStore` JSON. Les champs structurés disparaissent, même si le texte `content` demeure. Ce n’est donc pas une perte de tout l’historique, mais une perte de précision sur ce qui a été exécuté. Le scénario SQLite et les interfaces de reprise n’ont pas été exécutés dans cette tranche.

## Constat ancien à ne pas rouvrir tel quel

La perte de mémoire « dernier écrivain gagne » du 02/09 n’est plus reproduite par le scénario A/B : deux managers chargent le même fichier, A ajoute une note, B ajoute une autre note, les deux restent sur disque. Le code possède maintenant `withSessionLock`, relecture disque et fusion avec le snapshot précédent (`persistent-memory.ts:1332`).

Cette preuve couvre deux instances et des écritures séquentielles depuis des snapshots concurrents. Elle n’est pas une campagne de stress multiprocess ni une preuve sur les coupures brutales.

## Vérifications et reproduction

Sonde livrée : `tests/audit/reprise-2026-09-13.mjs`. C’est un diagnostic ponctuel dont les assertions **constatent les défauts présents**, pas une suite de non-régression définissant le comportement souhaité. Elle n’est pas incluse dans les glob Vitest habituels. Un correctif devra remplacer ces constats par des assertions du comportement attendu.

Depuis ce worktree, dépendances installées ou disponibles par symlink :

```bash
mkdir -p _qa/audit
node --import tsx tests/audit/reprise-2026-09-13.mjs
```

Chaque exécution crée un dossier unique sous `_qa/audit/run-*`, isole HOME/USERPROFILE/cwd avant les imports applicatifs et interdit `fetch`. Aucun fournisseur réel : `NODE_ENV=test`, client de réconciliation injecté pour la seule preuve DELETE. Aucun service démarré. Sortie de la version finale :

```json
{
  "session": { "arguments": "{}", "outputLost": true, "contentPreserved": true },
  "encryption": { "restoredType": "assistant", "returnsEncryptedMarker": true, "failureWritesPlaintext": true },
  "memoryCwd": { "success": true, "writtenToProcess": true, "writtenToSession": false },
  "concurrentMemory": { "bothRetained": true },
  "reconciliation": { "pinnedPreferenceDeleted": true, "archiveCreated": false, "unrelatedWriterPreserved": true }
}
```

Suites existantes exécutées avec HOME/USERPROFILE QA :

```bash
node node_modules/vitest/vitest.mjs run tests/unit/session-store.test.ts tests/memory/persistent-memory.test.ts tests/unit/facts-memory.test.ts --maxWorkers=2
```

**3 fichiers, 27 tests verts, exit 0.** Ces tests ne suffisent pas à détecter les quatre problèmes ci-dessus. Journal local : `_qa/audit/targeted-tests.log`. Sonde finale : exit 0. Vérifications syntaxiques et `git diff --check` : exit 0. Aucun build, typecheck ou test global relancé puisque la production est inchangée.

## Passation

Rapport et sonde livrés localement, non commités, aucun push. HEAD reste `8b5c61def`. Fichiers suivis modifiés : coordination seulement ; nouveaux fichiers livrables : ce rapport et la sonde. `_qa/audit/` contient les preuves temporaires non suivies ; `node_modules` est un lien vers les dépendances existantes. Dans le dépôt principal, seule la ligne de coordination de cette mission a été modifiée ; `_dreamina-dom-dump.json` préexistant est intact.

Prochaine tranche conseillée : fermer le contrat de chiffrement, puis la protection des souvenirs et le périmètre projet. Les providers, l’interface Cowork, la performance générale et les modules optionnels restent hors de cette revalidation ; aucun verdict global de qualité ou de sécurité n’est formulé.


## Implémentation des quatre correctifs

Autorisation : « implemente ». Branche de livraison identique à l’audit, sans fusion ni publication. Base inchangée `8b5c61def`.

### Sessions : chiffrement centralisé dans le store

Le chiffrement quitte la facade pour la frontière de persistance (`session-content.ts` + `SessionStore`). Cela couvre aussi les appends directs, mises à jour de coût, recherches, reprises, exports et branches qui ne passent pas par `saveCurrentSession`.

- AES-GCM réel, clé durable créée sous verrou ; pas de repli en clair ni de clé dérivée de la machine dans ce chemin.
- Déchiffrement avec la clé existante uniquement : clé absente, invalide ou contenu altéré = erreur explicite, sans création de remplacement et sans écrasement.
- Les anciens marqueurs contenant un tableau de `ChatEntry` restent lisibles, avec restauration des dates.
- La protection suit une session chargée et ses copies même si la variable d’environnement est ensuite désactivée.
- Les appends et clones chiffrés ne créent pas de miroir de messages en clair dans SQLite ; les titres automatiques dérivés des messages sont désactivés sur ces sessions.
- Un export explicitement demandé rend le contenu déchiffré. Le nom et les métadonnées de session ne sont pas chiffrés. Les anciennes copies en clair déjà présentes dans SQLite avant activation ne sont pas migrées par ce lot.

### Reprise : détails d’outils et historique du modèle

`SessionMessage` conserve l’appel simple, les appels multiples, le résultat et le marqueur de troncature. Le format précédent reste lisible. Le passage vers SQLite conserve ces champs dans les métadonnées ; l’export JSON aussi.

`restoreSessionHistory` est appelé par `hydratePersistedSession` : il restaure les paires appel/résultat, conserve les erreurs et repasse par la réparation canonique du transcript. Les anciens résultats sans identifiant fiable restent visibles comme données historiques, sans inventer un appel. La sortie assistant restaurée passe par le sanitizer existant.

Les champs structurés complets occupent davantage d’espace que les deux anciens indicateurs nom/succès. Ce lot ne définit pas une nouvelle politique de rétention des sessions.

### Mémoire : protection puis archive avant suppression

La garde porte sur le résultat final de la réconciliation, pas seulement sur l’action DELETE. Les omissions et renommages ne peuvent plus supprimer les épinglages, préférences et décisions. Une mise à jour automatique ne peut pas non plus retirer leur protection ; un `remember` explicite visant la même clé peut changer sa valeur.

Les anciennes valeurs ordinaires supprimées ou remplacées sont écrites atomiquement, en mode 0600 et sous verrou, dans le format d’archive déjà utilisé par `/memory archived` et `/memory restore`. La sauvegarde courante n’intervient qu’ensuite. Échec de l’archive : `remember` restaure son snapshot et garde son repli d’écriture directe ; `autoCapture` restaure également son snapshot avant son repli. La suppression explicite via `forget` conserve son contrat.

### Mémoire par projet : outils, prompt et commandes raccordés

Les managers non liés à un bot sont désormais indexés par dossier de projet absolu. Les chemins relatifs sont figés dès leur création, ce qui empêche une écriture retardée de changer de destination après un changement de cwd. Les bots gardent leur contrat historique de mémoire par bot.

`remember`, `replace_memory`, `recall`, `forget`, les hooks et `memory_propose` consomment le contexte d’exécution. Le prompt de l’agent prend le même manager lors de la construction, d’un changement de projet, d’une restauration HTTP ou d’un changement de bot. Les files de propositions et leur acceptation suivent ce contexte, y compris le raccord dispatcher → `/memory accept` et `/remember`.

### Preuves de livraison

- Cinq tests sessions initialement rouges, puis verts : détails d’outils, reprise/export/fork chiffrés, erreur de chiffrement, clé manquante, ancien format.
- Tests mémoire initialement rouges, puis verts : séparation A/B, propositions, épinglages, archive et son échec ; compléments sur autoCapture, UPDATE, restauration d’archive et acceptation par bot.
- Tests de raccord du prompt au changement de projet et à la restauration d’une conversation ; test de l’historique réellement destiné au fournisseur.
- SQLite : tests de frontière avec repository simulé, conversion/écriture réelles dans `SessionStore`, plus fichiers JSON réels. Ce ne sont pas des tests du moteur SQLite natif.
- Sonde réelle `node --import tsx tests/audit/reprise-2026-09-13.mjs` : exit 0. Le dossier de session reçoit maintenant la mémoire, les détails d’outils survivent, la session est relue comme message utilisateur, l’échec de chiffrement n’écrit pas en clair et la préférence épinglée reste présente.
- Suite fonctionnelle : **58 fichiers, 721 tests verts, 5 ignorés**, incluant sessions, mémoire, agent, prompt, crypto, commandes, dispatcher et isolation HTTP.
- Validation finale `npm run validate -- <58 fichiers ciblés> --maxWorkers=2` : **exit 0**, lint global sans erreur (2 488 avertissements), typecheck principal + GPU + companion-core verts, contrôle du paquet 10/10, suite fonctionnelle 721 verts / 5 ignorés. Le garde-fou de confidentialité, exécuté séparément et lors du premier validate, reste rouge sur cinq fichiers préexistants non modifiés.
- Témoin indépendant sur `8b5c61def`, worktree `~/DEV/cb-audit-baseline-2026-09-13` : le même garde-fou rend **39 verts / 1 rouge**, avec les mêmes cinq chemins. Aucune assertion du garde-fou n’a été affaiblie.

Incident de harnais consigné : le premier rejeu rouge du test cwd a précisément écrit dans le Markdown mémoire du worktree QA, comme le défaut le prédisait. Le garde-fou l’a détecté ; les octets suivis ont été restaurés depuis la base et le test corrigé pour que même sa version rouge cible un fichier temporaire. La copie de travail principale et la mémoire utilisateur réelle n’ont pas été modifiées.

Logs non versionnés : `_qa/audit/{validate,validate-final,final-functional,privacy-baseline,probe-fixed}.log`. Aucun service, appel LLM réel, push ou migration des données personnelles. Le dépôt principal ne reçoit que la mise à jour de coordination.
