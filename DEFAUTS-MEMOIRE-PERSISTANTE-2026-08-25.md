# CB20 — La mémoire persistante : ce qu'elle garde, ce qu'elle perd

Date : 2026-08-25. Worktree `/home/patrice/code-buddy`, branche `audit/cb7-complacent-tests-2026-08-25` (worktree partagé). Aucun push.

Un seul défaut corrigé. Les quatre autres questions sont reproduites et tiennent, ou relèvent du format de stockage (pas un correctif de logique métier).

`npx tsc --noEmit -p tsconfig.json` : exit 0 avant et après.

---

## Q1 — Le fail-closed de l'oubli est réel (permissions)

**Verdict : rien à signaler.** Archive inécrivable ⇒ aucune entrée n'est supprimée, ni en mémoire ni sur le fichier live.

Code : `src/memory/persistent-memory.ts` `applyForgetting` L854–862. `appendFile` dans un `try/catch` ; en échec, `return { forgotten: [] }` **avant** tout `memories.delete`.

Reproduction (chmod, pas le proxy EISDIR déjà testé) :

```
npx tsx .verification-cb20/q1-fail-closed.mts
```

| Cas | Sortie |
|---|---|
| archive existante `0444` | `forgottenKeys: []`, `liveStillContainsPrecious: true`, `liveUnchanged: true`. WARN `EACCES: permission denied, open '.../CODEBUDDY_MEMORY.archive.md'` |
| parent `0555`, pas d'archive | idem, `threw: null` |
| archive `0000` | idem |

Le test existant (`tests/memory/memory-forgetting.test.ts`) couvrait un répertoire à la place du fichier (EISDIR). Un cas `chmod 0444` a été ajouté (skip Windows).

```
npx vitest run tests/memory/memory-forgetting.test.ts
```

Vert, y compris `fail-closed: chmod 0444 on the archive file deletes nothing`.

---

## Q2 — Le ledger JSONL n'était pas atomique côté Rust

**Verdict : défaut reproduit et corrigé.**

`getconf PIPE_BUF` → `4096`. Sur ce Linux, un `write()` de fichier local (inode lock) reste contigû même au-dessus de PIPE_BUF — **à condition que la ligne entière tienne dans un seul syscall**.

TypeScript (`src/memory/collective-knowledge-graph.ts` L911–913) : `appendFileSync(path, JSON.stringify(event)+'\n')`. `strace -e write` : un syscall par ligne (95 octets, et 8015 octets pour un payload 8 Ko).

Rust **avant** (`buddy-memory/src/store.rs`) : `writeln!(f, "{}", line)`. `strace` du même motif :

```
write(4, "{\"i\":0,\"p\":\"xxxxxxxxxxxxxxxxxxxx"..., 94) = 94
write(4, "\n", 1)                       = 1
```

Le JSON et le `\n` sont deux `O_APPEND`. Un autre writer peut se glisser entre les deux.

Reproduction (8 processus, 400 lignes, payload 80) :

| Writers | lignes | json_ok | torn |
|---|---|---|---|
| `writeln!` (2 syscalls) | 3200 | 795 | **864** (+ 1541 vides) |
| Node `appendFileSync` seul, 80 o | 3200 | 3200 | 0 |
| Node `appendFileSync` seul, 8 Ko (> PIPE_BUF) | 640 | 640 | 0 |
| `write_all` d'un buffer `ligne+\n` | 3200 | 3200 | 0 |
| Node + `writeln!` (TS et Rust sur le même fichier) | 2400 | 1804 | **298** |

Échantillon mixte : deux objets collés, `Extra data: line 1 column 95` — exactement le splice payload / newline.

Le parseur TS (`collective-knowledge-graph.ts` L945–953) **saute** une ligne JSON invalide (`continue // a torn final line is skipped`). Une ligne déchirée au milieu du ledger est une perte silencieuse, pas une erreur.

Test rouge d'abord :

```
cd buddy-memory && cargo test --offline concurrent_appends_keep_whole_json_lines
```

```
torn JSONL line 3: trailing characters at line 1 column 234:
{"v":1,...,"name":"c-0",...}{"v":1,...,"name":"b-1",...}
FAILED
```

Correctif : `serde_json::to_vec` + `buf.push(b'\n')` + `write_all` (un buffer, un write). Après : le même test **ok** (6/6 `cargo test --offline`). Mixed Node + `write_all` : **2400/2400, torn 0**.

Les deux moteurs écrivent toujours le même fichier. `remember()` TS n'emprunte jamais le sidecar Rust (`engineClient` n'est câblé que sur `ingest` / `recallHybrid`). D'où la course réelle TS+Rust dès que `CODEBUDDY_CKG_ENGINE=rust`.

---

## Q3 — `/memory restore` ramène l'entrée, retire la ligne, le second restore est un no-op

**Verdict : rien à signaler.**

```
npx tsx .verification-cb20/q3-restore.mts
```

- Après oubli : `goneAfterForget: true`, archive contient la clé.
- Premier `restoreFromArchive` : `status: "stored"`, `liveValue: "value worth keeping"`, `archiveStillHasKey: false`, `listArchivedLen: 0`.
- Second restore : `null`. L'entrée live reste.
- Slash `/memory restore` : premier message `♻️ Restored "slash-twice"...` ; second `No archived memory found for "slash-twice". See /memory archived.` ; live `restorable`.

Code : `restoreFromArchive` L907–932 (re-remember, puis `removeArchiveLine` seulement si `stored`/`updated`). Un doublon de contenu laisse l'archive (déjà testé). Test ajouté : second restore après succès → `null`.

```
npx vitest run tests/memory/archive-restore.test.ts
```

Vert.

---

## Q4 — Une réécriture manuelle détruit les compteurs (et un flush vivant écrase le fichier)

**Verdict : comportement reproduit, pas corrigé** (le format *est* un commentaire HTML dans un `.md` éditable — changer ça serait un changement de stockage).

`renderMemoryMeta` / `parseMemoryMeta` : `src/memory/persistent-memory.ts` L138–157. Pas de watcher : `saveMemories` réécrit tout le fichier depuis les maps en mémoire.

```
npx tsx .verification-cb20/q4-meta.mts
```

| Cas | Résultat |
|---|---|
| save / load via le commentaire | `diskHasMetaComment: true`, `accessCount: 3`, `lastAccessedAt` présent |
| l'utilisateur retire les `<!-- meta: ... -->` puis un manager frais charge | `accessCountAfterReload: 0`, `lastAccessedAtAfterReload: null`, la valeur textuelle survit |
| l'utilisateur réécrit le fichier pendant qu'un manager est vivant, puis `flushAccessMetadata` | `userEditSurvived: false`, `userNewEntrySurvived: false`, `metaRestored: true` — le flush **écrase** l'édition manuelle et restaure les compteurs mémoire |

La promesse « persistés dans un commentaire méta » tient tant que le commentaire reste. Une édition humaine qui le considère comme du bruit le détruit au prochain chargement. Un rappel pendant la session (debounce 10 s, `flushAccessMetadata` L709–735) réécrit le fichier entier et perd les ajouts manuels non rechargés.

---

## Q5 — `CODEBUDDY_COLLECTIVE_MEMORY` est respecté sur l'injection chat

**Verdict : le pipeline de contexte chat respecte le drapeau. Pas d'injection hors `'true'`.**

`src/agent/execution/context-pipeline.ts` L321–329 : `process.env.CODEBUDDY_COLLECTIVE_MEMORY === 'true'` **et** `ctxLevel.collectiveGraph`. `injectNextRoundContext` n'injecte **pas** le graphe collectif (seulement le knowledge graph local si `complex`).

```
CODEBUDDY_HOME=.verification-cb20/q5-home npx tsx .verification-cb20/q5-ckg-gate.mts
```

(le script pinne `CODEBUDDY_HOME` dans le dépôt, jamais `~/.codebuddy`)

| Flag | `<collective_knowledge>` | marqueur |
|---|---|---|
| unset / `''` | non | non |
| `'true'` | oui | oui |
| `'1'` | non | non |

Test de régression : `tests/agent/execution/context-pipeline-ckg-gate.test.ts`.

```
npx vitest run tests/agent/execution/context-pipeline-ckg-gate.test.ts
```

Vert.

Autres surfaces qui *lisent* le CKG **sans** ce drapeau (pas l'injection chat automatique ; documenté ou gated par un autre opt-in) :

| Surface | Fichier | Note |
|---|---|---|
| MCP `ckg_recall` / `ckg_ingest` | `src/mcp/mcp-ckg-tools.ts` L22–25 | **volontaire** : « NOT gated… flag governs AUTOMATIC injection » |
| Deep Research Phase D | `src/agent/deep-research-ckg.ts` L347–351 | `--ckg` **ou** le drapeau |
| Self-improvement drafter / planner | `src/agent/self-improvement/llm-drafter.ts` L46–51, `variant-planner.ts` L177–187 | gated par `CODEBUDDY_SELF_IMPROVE`, pas par le drapeau CKG |
| `buddy science` novelty | `src/commands/science/deps.ts` L127–131 | CLI science, pas le chat |
| Auto-ingest publications | `src/research/auto-ingest.ts` L66–89 | gated par topics de recherche |

Ce ne sont pas des injections dans le tour de chat principal. Pas corrigé (autre contrat / autre drapeau).

---

## Correctif

Un commit : `writeln!` → un seul `write_all` de `JSON + \n` dans `buddy-memory/src/store.rs`, test concurrent rouge puis vert, commentaire d'accompagnement sur l'appendeur TS.

Tests lock-in (chmod, restore twice, gate env) en commit séparé.

## Vérifications

- `npx tsc --noEmit -p tsconfig.json` : 0 avant, 0 après
- `npx eslint` sur les fichiers TS touchés : 0
- `npx vitest run tests/memory/memory-forgetting.test.ts tests/memory/archive-restore.test.ts tests/agent/execution/context-pipeline-ckg-gate.test.ts tests/memory/collective-knowledge-graph.test.ts` : 45/45
- `npx vitest run tests/memory/buddy-memory-engine.test.ts tests/memory/persistent-memory.test.ts` : 19 passed, 1 skipped
- `cd buddy-memory && cargo test --offline` : 6/6
- `git diff --check` sur les fichiers CB20 : 0
- Suite complète non lancée

Fichiers sales des autres lots, `src/commands/try.ts`, services (ComfyUI 8188/8189) : intacts. Aucun push. `docs/FABLE5-CODEX-COORDINATION.md` déjà dirty : ligne CB20 ajoutée dans le working tree, **non commitée** pour ne pas emporter les hunks étrangers.
