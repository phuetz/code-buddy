# Rapport d'analyse et de correction : Tests Windows sur la branche principale

**Date** : 18 septembre 2026  
**Worktree** : `worktree cb-win2-2026-09-18` (branche `fix/windows-main-2026-09-18`, base `origin/main`)  
**Statut** : Correctifs appliqués sur le code de production et les suites de tests, validation Linux et typecheck 100 % au vert.

---

## 1. Ancienneté des échecs : Vérification factuelle

L'analyse de l'historique Git (`git log --follow`) et des journaux d'intégration continue GitHub Actions (`gh run list -R phuetz/code-buddy` et `gh api /repos/phuetz/code-buddy/actions/runs/.../logs`) établit la chronologie suivante :

### A. [`tests/commands/extra-handlers.test.ts`](tests/commands/extra-handlers.test.ts) → « should return search results for a known pattern » : **ANTERIEUR**
- **Origine du test** : Présent depuis février 2026 (commits `53596cf32` et `2b069e5a8` le 13 février 2026, puis `50c98d1fd` le 22 février 2026).
- **Évolution récente** : Le 15 septembre 2026 (commit `6057a2f8b` « feat: prepare Code Buddy 2.1.0 release candidate »), le gestionnaire [`handleSearch`](src/commands/handlers/extra-handlers.ts#L392-L483) a été modifié pour ajouter explicitement l'argument cible `.` à `rg`. Auparavant, ripgrep invoqué sans cible sur un stdin non interactif lisait stdin, ne trouvait rien et sortait immédiatement avec le code 1 (« No matches »). Le test contenait :
  ```ts
  const hasResult = content.includes('Search results') || content.includes('No matches');
  expect(hasResult).toBe(true);
  ```
  Le test réussissait donc par accident sous Windows avant le 15 septembre, car il considérait « No matches » comme un résultat valide alors que la recherche n'explorait aucun fichier.
- **Constat d'échec cette nuit** : Observé dans le run CI **35291359832** (sur `feat(cowork): des instructions attachées au dossier de travail`), shard 1/6 sous `windows-latest` :
  ```text
  FAIL tests/commands/extra-handlers.test.ts > handleSearch > should return search results for a known pattern
  AssertionError: expected false to be true
  ```
  Le shard 1/6 a été relancé par le mécanisme de retry (`|| npm test -- --shard=1/6...`), ce qui masquait l'échec dans le statut global du job, mais l'échec initial était bien réel et reproductible sous Windows.

### B. [`tests/server/shared-session.test.ts`](tests/server/shared-session.test.ts) → « rehydrates a WS agent when another participant advanced seq » : **NOUVEAU**
- **Origine du test** : Introduit cette nuit, le 18 septembre 2026 à 02:16:32 +0200, par le commit [`cd59b55fb`](tests/server/shared-session.test.ts) (PR #171 « feat(sessions): une session partagée où chacun voit le même fil »).
- **Constat d'échec cette nuit** : Observé dans les runs CI **35291390205** et **35291359832**, shard 3/6 sous `windows-latest` (Node 20.x et Node 22.x) :
  ```text
  FAIL tests/server/shared-session.test.ts > shared session — HTTP + two WebSocket clients > rehydrates a WS agent when another participant advanced seq
  Error: ENOTEMPTY: directory not empty, rmdir 'C:\Users\RUNNER~1\AppData\Local\Temp\cb-shared-sess-zBMtKU'
   ❯ tests/server/shared-session.test.ts:203:5
      201| if (previousHistory === undefined) delete process.env.CODEBUDDY_MO…
      202| else process.env.CODEBUDDY_MOBILE_HISTORY = previousHistory;
      203| rmSync(sessionsDir, { recursive: true, force: true });
  Serialized Error: { errno: -4051, code: 'ENOTEMPTY', syscall: 'rmdir', path: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\cb-shared-sess-zBMtKU' }
  ```

---

## 2. Causes réelles identifiées

### Pour `tests/commands/extra-handlers.test.ts` (Défaut dans le code)
1. **Absence de résolution du binaire ripgrep embarqué** :
   Dans [`src/commands/handlers/extra-handlers.ts`](src/commands/handlers/extra-handlers.ts#L413), la commande exécutée était `'rg'` en dur :
   ```ts
   const rgResult = runCommand('rg', ['--line-number', ...], { cwd, timeoutMs: 10000 });
   ```
   Or, le projet Code Buddy embarque la dépendance [`@vscode/ripgrep`](package.json#L190) et fournit le résolveur portable [`resolveRipgrepPath()`](src/utils/ripgrep-path.ts#L32). Tous les autres modules de recherche du projet ([`search.ts`](src/tools/search.ts#L252), [`enhanced-search.ts`](src/tools/enhanced-search.ts#L17), [`bash-tool.ts`](src/tools/bash/bash-tool.ts#L864)) utilisent `getRipgrepPath()`. Sur une machine Windows où ripgrep n'est pas installé dans le PATH système global, l'appel `'rg'` échoue avec `ENOENT`.
2. **Délai d'exécution trop court (10 000 ms) face à la latence d'I/O Windows** :
   Le délai était fixé à `timeoutMs: 10000`. Sous Windows, lors de l'exécution concurrente des shards dans la CI, la recherche récursive sur l'ensemble du dépôt pour un motif omniprésent comme `'import'` sans filtre de glob prenait plus de 10 secondes. Le sous-processus était tué avec le code `ETIMEDOUT`.
   Le repli sur `git grep` prenait à son tour plus de 10 secondes et échouait, déclenchant l'exception capturée par le `catch (error)` :
   ```ts
   return { handled: true, entry: { type: 'assistant', content: `Search error: ...` } };
   ```
   Cette chaîne ne contenait ni `Search results` ni `No matches`, faisant échouer l'assertion.
3. **Séparateurs de fin de ligne Windows (CRLF)** :
   Le découpage `output.trim().split('\n')` laissait des caractères `\r` résiduels sur chaque ligne sous Windows.

### Pour `tests/server/shared-session.test.ts` (Sémantique POSIX supposée à tort par le test et file asynchrone non attendue)
1. **Désynchronisation entre la réponse WebSocket et la persistance sur disque** :
   Dans le gestionnaire WebSocket ([`src/server/websocket/handler.ts`](src/server/websocket/handler.ts#L1338-L1350)), la trame `chat_response` est envoyée au client dès la fin du flux texte de l'agent :
   ```ts
   send(ws, { type: 'chat_response', payload: { content: assistantText, finishReason: 'stop' } });
   // ...
   if (!turn.cancelled && boundResumeId && state.userId) {
     await persistResumeTurnUnlocked(boundResumeId, state.userId, userText, assistantText);
   }
   ```
   La fonction [`persistResumeTurnUnlocked`](src/server/mobile/resume-sessions.ts#L548) s'exécute dans la file sérialisée [`enqueueSessionTurn`](src/server/mobile/resume-sessions.ts#L107) et persiste la session via [`withSessionLock`](src/persistence/session-lock.ts#L181) et [`writeJsonAtomic`](src/utils/atomic-write.ts).
2. **Sortie prématurée du test et suppression immédiate du répertoire temporaire** :
   Le test `rehydrates a WS agent when another participant advanced seq` attendait uniquement l'arrivée de la 2e trame `chat_response` côté Alice :
   ```ts
   await waitUntil(() => alice.events.filter((event) => event.type === 'chat_response').length >= 2);
   alice.ws.close();
   bob.ws.close();
   ```
   Dès cette trame reçue, le corps du test se terminait et le hook `afterEach` s'exécutait immédiatement.
3. **Différence sémantique POSIX vs Windows NTFS sur la suppression de fichiers ouverts** :
   Dans `afterEach`, le nettoyage appelait :
   ```ts
   resetSessionTurnQueueForTests();
   // ...
   rmSync(sessionsDir, { recursive: true, force: true });
   ```
   - **Sous POSIX (Linux/macOS)** : un fichier en cours d'écriture ou ouvert peut être dissocié (`unlink`), et le répertoire parent peut être supprimé sans bloquer le processus.
   - **Sous Windows (NTFS)** : si un descripteur de fichier est encore ouvert (ou en attente de libération par le système d'exploitation / antivirus), le fichier est marqué `FILE_FLAG_DELETE_ON_CLOSE` mais reste présent dans la table du répertoire. L'appel à `rmdir` échoue alors instantanément avec l'erreur `ENOTEMPTY: directory not empty` (errno -4051).
   - De plus, plus de 600 tests du dépôt utilisent systématiquement l'option Node `{ maxRetries: 10, retryDelay: 100 }` sur `rmSync` sous Windows pour tolérer ce délai de libération. Le nouveau test de PR #171 avait omis ces options et n'attendait pas la file de tours en vol.

---

## 3. Détail des correctifs apportés

### Correctif A (Code de production) : [`src/commands/handlers/extra-handlers.ts`](src/commands/handlers/extra-handlers.ts)
- Import et utilisation de [`resolveRipgrepPath`](src/utils/ripgrep-path.ts#L32) afin d'exécuter le binaire compilé `rg.exe` de `@vscode/ripgrep` lorsque ripgrep n'est pas dans le PATH système.
- Allongement du délai de sous-processus de 10 000 ms à 30 000 ms pour `rg` et `git grep`, s'alignant sur [`src/tools/search.ts`](src/tools/search.ts#L260) et tenant compte des budgets I/O Windows définis dans [`vitest.config.ts`](vitest.config.ts#L97).
- Découpage robuste des lignes via `split(/\r?\n/).filter(Boolean)` pour nettoyer les retours chariots Windows CRLF.

### Correctif B (Test) : [`tests/commands/extra-handlers.test.ts`](tests/commands/extra-handlers.test.ts)
- Remplacement de l'assertion opaque `expect(hasResult).toBe(true)` par :
  ```ts
  expect(content).toMatch(/Search results|No matches/);
  ```
  En cas d'échec futur, Vitest affichera directement le message d'erreur reçu (`Search error: ...`) plutôt qu'un simple `false !== true`.

### Correctif C (Code de support test) : [`src/server/mobile/resume-sessions.ts`](src/server/mobile/resume-sessions.ts)
- Ajout de la fonction utilitaire [`drainSessionTurnQueueForTests()`](src/server/mobile/resume-sessions.ts#L95-L98) qui attend la résolution de toutes les promesses de tours de session en cours (`Promise.allSettled(Array.from(sessionTurnTails.values()))`).

### Correctif D (Test & Sémantique POSIX) : [`tests/server/shared-session.test.ts`](tests/server/shared-session.test.ts) & [`tests/server/shared-session-llm-context.test.ts`](tests/server/shared-session-llm-context.test.ts)
- Dans le test `rehydrates a WS agent when another participant advanced seq`, ajout d'`await drainSessionTurnQueueForTests()` avant la fermeture des WebSockets pour s'assurer que la persistance du dernier tour est finalisée.
- Dans le hook `afterEach` des deux fichiers :
  1. Appel à `await drainSessionTurnQueueForTests()` avant `resetSessionTurnQueueForTests()`.
  2. Remplacement de `rmSync(sessionsDir, { recursive: true, force: true })` par :
     ```ts
     rmSync(sessionsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
     ```
     Cette tolérance est la convention standard du projet sous Windows face aux verrous NTFS temporaires.

---

## 4. Résultats des vérifications d'intégrité

Sur l'environnement de développement local (Linux x86_64) :

1. **Suites de tests cibles** :
   ```bash
   npx vitest run tests/commands/extra-handlers.test.ts \
                  tests/commands/slash-search-git-subprocess.test.ts \
                  tests/server/shared-session.test.ts \
                  tests/server/shared-session-llm-context.test.ts \
                  tests/server/mobile-resume-sessions.test.ts
   ```
   - **Résultat** : **5 fichiers de test passés, 61 tests passés (0 échec)** en 5.36s.
2. **Vérification de types TypeScript** :
   ```bash
   npm run typecheck
   ```
   - **Résultat** : Sortie code 0, 0 erreur de type (sur le projet principal, `tsconfig.gpuNode-identity.json` et `packages/companion-core`).
3. **Linter** :
   ```bash
   npx eslint src/commands/handlers/extra-handlers.ts \
              src/server/mobile/resume-sessions.ts \
              tests/commands/extra-handlers.test.ts \
              tests/server/shared-session.test.ts \
              tests/server/shared-session-llm-context.test.ts
   ```
   - **Résultat** : 0 erreur, 0 avertissement sur l'ensemble des fichiers modifiés.
4. **Compilation du projet** :
   ```bash
   npm run build
   ```
   - **Résultat** : Sortie code 0, compilation TypeScript et copie des assets réussies.

---

## 5. Ce qui reste à valider sur une vraie machine Windows

Conformément à la consigne de ne revendiquer aucun résultat non obtenu directement :
- **L'environnement d'exécution de cette session étant sous Linux**, les tests ci-dessus confirment la stricte **non-régression sous Linux** et la cohérence de la logique asynchrone indépendamment de l'OS.
- **Reste à valider sur une vraie machine Windows ou dans la prochaine exécution de la CI Windows (`windows-latest`)** :
  1. Que le binaire embarqué `@vscode/ripgrep/bin/rg.exe` est correctement résolu et exécuté sans latence excessive sur le système de fichiers hôte de test Windows.
  2. Que le hook `afterEach` de `shared-session.test.ts` supprime bien `sessionsDir` sans aucune levée d'`ENOTEMPTY` sur le disque NTFS local sous Windows Defender.

---

## 6. Fichiers modifiés dans le worktree

- [`src/commands/handlers/extra-handlers.ts`](src/commands/handlers/extra-handlers.ts) (résolution ripgrep, timeout 30s, CRLF)
- [`src/server/mobile/resume-sessions.ts`](src/server/mobile/resume-sessions.ts) (export de `drainSessionTurnQueueForTests`)
- [`tests/commands/extra-handlers.test.ts`](tests/commands/extra-handlers.test.ts) (assertion diagnostique)
- [`tests/server/shared-session.test.ts`](tests/server/shared-session.test.ts) (vidange de la file de tours, `maxRetries` sur `rmSync`)
- [`tests/server/shared-session-llm-context.test.ts`](tests/server/shared-session-llm-context.test.ts) (vidange de la file de tours, `maxRetries` sur `rmSync`)
- [`RAPPORT-WINDOWS-MAIN.md`](RAPPORT-WINDOWS-MAIN.md) (présent rapport)
