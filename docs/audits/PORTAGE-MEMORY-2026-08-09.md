# Portage Memory des audits de juillet — 2026-08-09

## Périmètre vérifié

- Branche : `codex/portage-memory-july-2026`.
- Base vérifiée avant travaux : `origin/main = f9a31a7eeb2328418107ee5efc6ce93606d45b02`.
- Source relue constat par constat :
  `/tmp/claude-1000/-home-patrice-code-buddy/726a3ac9-1939-43cf-bf7b-aa1b7cd63430/scratchpad/audit-findings/cb-memory/AUDIT-FINDINGS.md`.
- Aucun changement dans `buddy-memory/` : les correctifs sont tous restés côté TypeScript.
- Les salissures préexistantes `.codebuddy/TOOLS.md` et
  `docs/audits/vitrine-commerciale-2026-07-27/` ont été laissées intactes.
  `docs/FABLE5-CODEX-COORDINATION.md` n'a pas été touché.

## Synthèse

| # | Constat | Décision | Commit / preuve |
|---|---|---|---|
| 1 | Replay complet du ledger CKG | PORTÉ | `af026b1c` |
| 2 | Cold start embeddings sans cache persistant ni timeout | PORTÉ | `379c0c8b` |
| 3 | `BuddyMemoryClient.close()` ne termine pas le sidecar | PORTÉ | `b5797122` |
| 4 | Une seconde consolidation écrase le premier umbrella | PORTÉ | `fad16c89` |
| 5 | Archive Ebbinghaus multiligne tronquée | PORTÉ | `668b07ae` |
| 6 | Collision de nom marquée couverte sans validation | PORTÉ | `de8f4ef3` |
| 7 | Restore de skill sans re-gate | PORTÉ | `fa2e191b` |
| 8 | Rédaction CKG incomplète | DÉJÀ EN PLACE | `5a987a78`, ancêtre de `origin/main` |
| 9 | Collision des noms CKG tronqués à 80 caractères | PORTÉ | `5bc9a752` |
| 10 | Trous de tests sur quatre contrats critiques | PORTÉ | `af026b1c`, `b5797122`, `fad16c89`, `668b07ae` |
| 11 | Limite `RunStore.listRuns()` plafonnée implicitement à 20 | PORTÉ | `66470d18` |

## 1. Replay incrémental du ledger CKG — PORTÉ

État de `main` : `CollectiveKnowledgeGraph.load()` vidait les trois vues puis
appelait `readFileSync()` et `JSON.parse()` sur chaque ligne à chaque lecture.
Le chemin TypeScript est atteint quand `CODEBUDDY_COLLECTIVE_MEMORY=true`, ainsi
que par les commandes qui construisent directement un CKG ; le moteur Rust reste
un opt-in séparé via `CODEBUDDY_CKG_ENGINE=rust`.

Rouge :

```text
$ npx vitest run tests/memory/collective-knowledge-graph.test.ts
Test Files  1 failed (1)
Tests       1 failed | 22 passed (23)
expected "parse" to not be called at all, but actually been called 3 times
```

Correctif : curseur en octets, métadonnées taille/mtime/device/inode, lecture du
seul suffixe complet, replay intégral sur remplacement/troncature/réécriture,
et chemin unique append → load → apply. Une fin de ligne déchirée n'avance pas le
curseur. Le test de parité compare une vue incrémentale et un replay neuf après
5 000 écritures, supersede, relation et retraction.

Vert :

```text
$ npx vitest run tests/memory/collective-knowledge-graph.test.ts
Test Files  1 passed (1)
Tests       23 passed (23)
```

Commit : `af026b1c perf(memory): replay collective ledger incrementally`.

## 2. Embeddings persistants et timeout du contexte CKG — PORTÉ

État de `main` : le cache `contentHash → Float32Array` était uniquement en RAM ;
un nouveau processus ré-embeddait séquentiellement tout le corpus. La construction
du bloc de prompt attendait sans borne. Le bloc reste opt-in via
`CODEBUDDY_COLLECTIVE_MEMORY=true`.

Rouge :

```text
$ npx vitest run tests/memory/ckg-hybrid-mmr.test.ts -t "persists corpus vectors"
Test Files  1 failed (1)
Tests       1 failed | 5 skipped (6)
expected false to be true

$ npx vitest run tests/memory/ckg-hybrid-mmr.test.ts -t "bounds collective-context" --testTimeout 150
Test Files  1 failed (1)
Tests       1 failed | 5 skipped (6)
Error: Test timed out in 150ms.
```

Correctif : sidecar append-only `<ledger>.emb.jsonl` contenant
`{hash, model, vec}`, chargé paresseusement et filtré par modèle. Les vecteurs de
corpus sont persistés au fil des embeddings et réutilisés par un nouveau processus.
`formatCollectiveContext()` borne désormais le recall à 3 000 ms par défaut et
retourne un bloc vide en cas de timeout. La borne est placée dans la façade CKG,
donc tous ses consommateurs de contexte en bénéficient sans dupliquer la logique
dans le pipeline.

Vert :

```text
$ npx vitest run tests/memory/ckg-hybrid-mmr.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

Commit : `379c0c8b perf(memory): persist CKG embeddings and bound recall`.

## 3. Arrêt du sidecar Rust — PORTÉ

État de `main` : le client est instancié par le CKG derrière
`CODEBUDDY_CKG_ENGINE=rust` quand le binaire existe. `close()` est le seam explicite
de shutdown/test ; il appelait `fail()`, qui mettait `this.child` à `null`, avant
le `kill()`. Le moteur Rust lui-même n'a pas été modifié.

Rouge :

```text
$ npx vitest run tests/memory/buddy-memory-engine.test.ts -t "close terminates"
Test Files  1 failed (1)
Tests       1 failed | 4 skipped (5)
Error: Timed out waiting for sidecar process state
```

Correctif : capture de la référence child avant `fail()`, fermeture propre de
stdin, puis `kill()` best-effort. Le test lance un faux binaire Node, lit son PID,
appelle `close()` et attend que `process.kill(pid, 0)` échoue ; son `finally`
force le nettoyage si le test rouge laisse le processus vivant.

Vert :

```text
$ npx vitest run tests/memory/buddy-memory-engine.test.ts
Test Files  1 passed (1)
Tests       4 passed | 1 skipped (5)
```

Commit : `b5797122 fix(memory): terminate buddy-memory sidecar on close`.

## 4. Consolidations successives de skills — PORTÉ

État de `main` : le chemin est branché par
`buddy improve skills-consolidate --apply` et n'écrit rien sans `--apply`.
Une proposition portant le même nom écrasait le seul umbrella qui conservait la
guidance des siblings déjà archivés.

Rouge :

```text
$ npx vitest run tests/agent/self-improvement/skill-consolidator.test.ts -t "preserves the first umbrella"
Test Files  1 failed (1)
Tests       1 failed | 6 skipped (7)
expected 'authored-dev-procedures' to match /^authored-dev-procedures-[a-f0-9]{8}$/
```

Correctif : le premier nom reste inchangé pour compatibilité. En cas de collision,
le nouvel umbrella reçoit un suffixe SHA-256 de huit caractères, puis un compteur
si nécessaire. L'ancien umbrella reste installé ; les siblings absorbés restent
archivés et l'archive évolutive reste append-only.

Vert :

```text
$ npx vitest run tests/agent/self-improvement/skill-consolidator.test.ts
Test Files  1 passed (1)
Tests       7 passed (7)
```

Commit : `fad16c89 fix(self-improve): preserve prior skill consolidations`.

## 5. Archive Ebbinghaus multiligne — PORTÉ

État de `main` : `applyForgetting()` écrivait la valeur brute, tandis que
`parseArchive()` ne lisait qu'une ligne. Le pass automatique est gated par
`CODEBUDDY_MEMORY_FORGET`, mais les API de forget/restore sont directement
atteignables.

Rouge :

```text
$ npx vitest run tests/memory/archive-restore.test.ts -t "round-trips a multiline"
Test Files  1 failed (1)
Tests       1 failed | 6 skipped (7)
expected 'first line' to be 'first line\nsecond line with literal …'
```

Correctif : format versionné `@codebuddy-escaped-v1:`, échappement symétrique des
backslashes et retours ligne, décodage en un passage pour préserver un `\\n`
littéral. Les archives historiques sans préfixe restent inchangées.

Vert :

```text
$ npx vitest run tests/memory/archive-restore.test.ts
Test Files  1 passed (1)
Tests       7 passed (7)
```

Commit : `668b07ae fix(memory): preserve multiline forgotten memories`.

## 6. Collision de nom tool/skill — PORTÉ

État de `main` : les deux moteurs ajoutaient immédiatement l'id du scénario à
`covered` si le nom proposé existait. Ils sont exécutables en propose-only par
défaut ; la persistance est gated par `CODEBUDDY_SELF_IMPROVE=true` ou `--apply`.

Rouge :

```text
$ npx vitest run tests/agent/self-improvement/skill-gate.test.ts tests/agent/self-improvement/tool-gate.test.ts -t "does not mark a homonymous"
Test Files  2 failed (2)
Tests       2 failed | 14 skipped (16)
expected [ true, false ] to deeply equal [ true, true ]
```

Correctif : une skill existante repasse `safetyGateSkill` et `coversScenario` ;
un outil existant repasse les cas visibles et held-out via le gate comportemental.
Si la capacité existante ne couvre pas le scénario, la proposition est re-gatée
sous un nom dérivé de l'id du scénario, sans écraser l'artefact précédent.

Vert :

```text
$ npx vitest run tests/agent/self-improvement/skill-gate.test.ts tests/agent/self-improvement/tool-gate.test.ts
Test Files  2 passed (2)
Tests       16 passed (16)
```

Commit : `de8f4ef3 fix(self-improve): validate coverage on name collisions`.

## 7. Re-gate lors du restore d'une skill — PORTÉ

État de `main` : `buddy improve skills-restore <name>` déplaçait directement le
dossier d'archive vers le chemin live, contrairement à create/update.

Rouge :

```text
$ npx vitest run tests/agent/self-improvement/no-backdoor.test.ts -t "refuses to restore"
Test Files  1 failed (1)
Tests       1 failed | 6 skipped (7)
expected true to be false
```

Correctif : lecture et `safetyGateSkill()` avant tout rename. Une archive illisible
ou dangereuse reste en place, le chemin live n'est pas créé et la raison est
journalisée. L'invariant `authored-*` reste inchangé.

Vert :

```text
$ npx vitest run tests/agent/self-improvement/no-backdoor.test.ts tests/agent/self-improvement/skill-mutator.test.ts
Test Files  2 passed (2)
Tests       15 passed (15)
```

Commit : `fa2e191b fix(self-improve): re-gate archived skills on restore`.

## 8. Rédaction des identifiants et relations CKG — DÉJÀ EN PLACE

Preuve : `5a987a78 fix(security): redact all collective memory fields` est un
ancêtre de `origin/main`. `src/memory/ckg-redaction.ts` clone et rédige `name`,
`text`, `relations[].targetName` et `relations[].reason`. Le même helper est appelé
par `BuddyMemoryClient.redactParams()`, qui complète `abstract` et `title`.

Vérification sans changement :

```text
$ npx vitest run tests/memory/ckg-redaction.test.ts
Test Files  1 passed (1)
Tests       2 passed (2)

$ git merge-base --is-ancestor 5a987a78 origin/main
(aucune sortie, code 0)
```

Aucun portage supplémentaire : retoucher ce chemin aurait dupliqué un correctif
déjà présent sur `main`.

## 9. Noms CKG longs fusionnés — PORTÉ

État de `main` : `normalizeName()` appliquait systématiquement `.slice(0, 80)`.
Le cas est atteint notamment par `ingestPublication()` lorsque le CKG opt-in est
activé et que le titre sert de nom.

Rouge :

```text
$ npx vitest run tests/memory/collective-knowledge-graph.test.ts -t "keeps long names"
Test Files  1 failed (1)
Tests       1 failed | 23 skipped (24)
expected 'discovery:collective:aaaaaaaa…' not to be 'discovery:collective:aaaaaaaa…'
```

Correctif : les noms normalisés de 80 caractères ou moins restent bit-identiques.
Les noms plus longs utilisent 71 caractères, `-`, puis huit caractères d'un hash
stable du nom normalisé complet.

Vert :

```text
$ npx vitest run tests/memory/collective-knowledge-graph.test.ts
Test Files  1 passed (1)
Tests       24 passed (24)
```

Commit : `5bc9a752 fix(memory): disambiguate long CKG entity names`.

## 10. Trous de tests critiques — PORTÉ

Les quatre contrats demandés ont chacun été ajoutés avec leur correctif, sans
test artificiel sur le moteur Rust :

- parité incrémental/replay complet sur 5 000 événements et preuve de non-reparse
  (`af026b1c`) ;
- terminaison d'un faux sidecar observée par PID (`b5797122`) ;
- deux consolidations successives conservant les termes du premier cluster
  (`fad16c89`) ;
- round-trip forget/list/restore d'une valeur multiligne (`668b07ae`).

Les sorties rouge→vert sont consignées dans les constats 1, 3, 4 et 5.

## 11. Limite de RunExperienceSource — PORTÉ

État de `main` : `RunExperienceSource` acceptait une limite arbitraire mais son
adaptateur réel appelait `store.listRuns()` sans argument, donc avec le défaut 20.
L'appelant actuel demande 10 : l'impact présent est latent, mais le seam était faux
et est réellement branché par la commande d'amélioration.

Rouge :

```text
$ npx vitest run tests/agent/self-improvement/experience-source.test.ts -t "passes limits above"
Test Files  1 failed (1)
Tests       1 failed | 9 skipped (10)
expected "vi.fn()" to be called with arguments: [ 25 ]; received: []
```

Correctif : `listRunIds(limit)` reçoit la borne normalisée et l'adaptateur appelle
`RunStore.listRuns(limit)`. Le slice défensif côté source est conservé.

Vert :

```text
$ npx vitest run tests/agent/self-improvement/experience-source.test.ts
Test Files  1 passed (1)
Tests       10 passed (10)
```

Commit : `66470d18 fix(self-improve): honor configured run experience limit`.

## Vérifications finales

```text
$ npm run typecheck
> @phuetz/code-buddy@1.8.0 typecheck
> tsc --noEmit
(code 0)

$ npx vitest run tests/memory tests/agent/self-improvement
Test Files  48 passed (48)
Tests       392 passed | 1 skipped (393)
Duration    5.92s

$ git diff --check origin/main..HEAD
(aucune sortie, code 0)
```

Le skip est le test sémantique Rust conditionné à la présence d'un build release
avec embeddings ; les tests du client et du faux sidecar passent. Le diff final
ne contient aucun chemin interdit et aucun fichier sous `buddy-memory/`.
