# Audit adversarial — repli de fournisseur vers modèle local (cœur du client)

- Date : 2026-09-07
- Auditeur : Claude Opus (contexte frais, relecture adversariale)
- Worktree : `~/DEV/cb-audit-failover-2026-09-07`, branche `audit/failover-client-opus-2026-09-07`
- HEAD : `c94033686`
- Cible : `src/codebuddy/client.ts`, `src/codebuddy/provider-handoff.ts`,
  `src/providers/provider-failover-policy.ts`, `src/providers/provider-health.ts`,
  `src/utils/stream-stall-guard.ts`, `src/agent/execution/agent-executor.ts`
- Lot audité : `9fe7669d5` (élagage des outils au handoff), `9b28e4ef7` (pré-filtre par fenêtre),
  `a9d7eeabc` (`ProviderFailoverExhaustedError`), `5b46f3772` (annonce), `3ae522b9c` (alias),
  `68e40ced9` (cap 6 outils), `e738178a5` (cible effective locale)

> Rapport écrit au fil de l'eau (session à budget de temps contraint). Les sections
> non encore remplies portent la mention TRAVAIL EN COURS.

## 1. Byte-identique sans variable d'environnement — TIENT

Preuve par lecture, chemin par chemin (drapeau absent ⇒ `isDeclaredProviderFallbackEnabled()`
retourne `false` sans aucune I/O : elle ne lit que `process.env`,
`src/providers/provider-failover-policy.ts:46-52`).

| Point de couture | Ligne | Comportement drapeau absent |
| --- | --- | --- |
| `chat()` porte d'entrée | `src/codebuddy/client.ts:754` | `usesDeclaredFailover(opts) && isProviderUnavailable(...)` — le `&&` court-circuite, `isProviderUnavailable` (donc la lecture de `provider-health.json`) n'est **jamais** appelée |
| `chat()` retour au primaire | `src/codebuddy/client.ts:763` → `:563` | `maybeReturnToOriginal` sort à la première ligne (`if (!this.usesDeclaredFailover(opts) …) return;`) avant tout accès disque |
| `chat()` catch | `src/codebuddy/client.ts:774-777` | tombe sur `chatWithProviderFallback` — le chemin Hermes historique, inchangé par le lot |
| `chatStream()` porte d'entrée | `src/codebuddy/client.ts:1053` | même court-circuit |
| `chatStream()` retour au primaire | `src/codebuddy/client.ts:1064` | même sortie anticipée |
| `chatStream()` catch | `src/codebuddy/client.ts:1085-1089` | tombe sur `chatStreamWithProviderFallback`, inchangé |
| Élagage des outils | `src/codebuddy/provider-handoff.ts:283` | `prepareFailoverHandoff` n'a que deux appelants, `client.ts:967` et `client.ts:1253`, tous deux **à l'intérieur** de `chat*WithDeclaredFailover` |
| Sonde réseau / registre | `src/codebuddy/client.ts:903` | `this.defaultDeclaredChain ??= resolveDefaultFailoverProviders(...)` est paresseux et n'est atteint que depuis `listDeclaredFailoverCandidates`, elle-même appelée uniquement depuis les deux méthodes de repli. `buildActiveLlmRegistry` (import dynamique) n'est donc jamais chargé |
| Cible effective locale | `src/codebuddy/client.ts:686-693` | `activeFallback` est `undefined`, puis `usesDeclaredFailover()` court-circuite ⇒ retombe sur `isLocalLlmProvider()`, exactement l'expression d'avant le lot |
| Avertissement d'alias | `src/providers/provider-failover-policy.ts:36-38` | `warnLegacyLlmFailoverAlias` sort si le legacy n'est pas vrai |

`npx tsc --noEmit -p tsconfig.json` : **exit 0**.

Conclusion : aucun nouveau chemin, aucune sonde, aucune lecture de
`~/.codebuddy/provider-health.json` quand les deux variables sont absentes. **TIENT.**

### Observation adjacente (drapeau ON seulement) — C

`agent-executor.ts:1658-1660` rappelle `client.isEffectiveTargetLocal()` à **chaque** tour de
stream. Drapeau ON, cette fonction fait un `readProviderHealthSnapshot()` →
`readFileSync` **synchrone** sur `~/.codebuddy/provider-health.json`
(`src/providers/provider-health.ts:162-171`, `:196`). Une I/O bloquante par tour sur le
thread principal : négligeable en volume, mais c'est le genre de coût qui se paie en
latence perçue sur un poste chargé. Aucun cache mémoire n'est interposé. Sans gravité,
à noter.

## 2. État partagé (`activeFallback`, concurrence) — TROU B

`activeFallback` et `didDeclaredFailover` sont des champs d'**instance**
(`src/codebuddy/client.ts:302-305`), sans verrou, lus et écrits par les quatre chemins
(`chat`, `chatStream`, et leurs variantes de repli).

### Ce qui TIENT — pas de client partagé entre sessions WebSocket

- Un `CodeBuddyClient` par `CodeBuddyAgent` (`src/agent/codebuddy-agent.ts:218`).
- Chaque session WS construit **son propre** agent, sous mutex anti-duplication :
  `src/server/websocket/handler.ts:929-940`, `:1097`, `src/server/websocket/desktop-handler.ts:354`.
- Un second tour sur la même session est refusé (`session is busy`,
  `src/server/websocket/desktop-handler.ts:390-399`).

Donc : deux sessions WS ne peuvent pas se polluer. **Le scénario le plus grave est écarté.**

### Ce qui NE tient pas — appels auxiliaires sur la MÊME instance

`agent.getClient()` est exposé (`codebuddy-agent.ts:1737`) et la même instance sert des
appels LLM auxiliaires, potentiellement pendant qu'un tour principal streame :
`src/index.ts:1185`, `:1300`, `src/hooks/use-input-handler.ts:750`,
`src/commands/goal-cli.ts:154` (`judgeClient = agent.getClient()`),
`src/commands/client-dispatcher.ts:207`.

Le vecteur de pollution est le **budget de premier jeton** :

1. `src/agent/execution/agent-executor.ts:1657-1660` passe au garde anti-blocage un
   `firstTokenTimeoutMs` **paresseux** — une closure rappelée au moment de l'attente :
   `() => resolveFirstTokenStallTimeoutMs(inputTokens, process.env, { targetIsLocal: client.isEffectiveTargetLocal?.() })`.
2. `isEffectiveTargetLocal()` (`client.ts:686-693`) répond `true` dès que
   `this.activeFallback` pointe une cible locale.
3. `resolveFirstTokenStallTimeoutMs` (`src/utils/stream-stall-guard.ts:64-79`) accorde alors
   `max(120 s, jetons × 200 ms)` plafonné à **20 minutes**, au lieu des 120 s.

Si un appel auxiliaire bascule (pose `activeFallback = ollama`) **avant** le premier octet du
stream principal encore dirigé vers le nuage, ce stream principal hérite d'un budget de
20 minutes. C'est précisément la régression que le commentaire de
`stream-stall-guard.ts:53-60` s'engage à ne pas produire : « A silent cloud provider must
still fail in 120 s — byte-identical behaviour for Gemini/ChatGPT/xAI ». Le symptôme est
un tour figé 20 minutes au lieu de 2, sans erreur — exactement le mal que le garde existe
pour tuer.

La fenêtre est étroite (avant le premier jeton) et je ne l'ai pas reproduite par un test :
je la donne comme lecture, pas comme mesure. Gravité **B**.

### Fuite d'état sur annulation — C

`activeFallback` est posé **avant** que la tentative réussisse (`client.ts:979`, `:1265`).
Sur les deux chemins, l'annulation coupe la boucle par un `throw` qui **saute** la remise à
zéro de la ligne `client.ts:1029` / `:1330` :

```ts
} catch (fallbackError) {
  if (opts.signal?.aborted) {
    throw createAbortError('Chat request aborted by caller');   // client.ts:1006-1008
  }
```

L'instance reste alors collée sur un repli qui n'a jamais servi. Effets : `getCurrentProvider()`
et `getCurrentBaseUrl()` (`client.ts:678-684`, publics, lus par l'affichage et le suivi de coût)
annoncent un fournisseur faux, et `isEffectiveTargetLocal()` reste `true`. Le tour suivant le
répare (`maybeReturnToOriginal`, `client.ts:563-570`) **seulement si** le primaire est
redevenu sain dans `provider-health.json` — sinon l'état faux persiste. Même remarque pendant
la boucle : entre deux candidats, `activeFallback` désigne le candidat qui vient d'échouer.

### Course `chat` ↔ `chatStream`

Réelle par construction : les deux méthodes écrivent les mêmes deux champs sans
sérialisation. Aucun `Promise` de garde, aucun verrou par instance. Le dépôt n'a pas de test
qui couvre deux tours entrelacés sur une même instance.

## 3. Élagage des outils et cohérence du transcript — TROU B (prouvé par test)

Test écrit pour cet audit, 110 définitions d'outils, cible `ollama:qwen3.8-ctx32k:latest`
(fenêtre 32 k ⇒ chemin « fenêtre serrée », cap 6 du commit `68e40ced9`).
Fichier joué puis retiré (l'audit n'ajoute pas de test au dépôt) ; source conservée sous
`_qa/af/handoff-audit.test.ts` (répertoire non suivi).

| Cas | Attendu | Résultat |
| --- | --- | --- |
| A — un `tool_call` **sans** résultat (tour coupé par la panne) | pas d'appel orphelin après handoff | **PASSE** |
| B — 60 paires appel/résultat compactées vers 32 k | ni appel orphelin, ni résultat orphelin | **PASSE** |
| C — 9 outils déjà appelés + `tool_search` face au cap 6 | les indispensables survivent | **ÉCHOUE** |
| D — budget respecté après élagage | `estimatedTokens ≤ contextWindow` | **PASSE** (110 → 6 outils) |

### Le transcript reste cohérent — TIENT

`prepareFailoverHandoff` (`src/codebuddy/provider-handoff.ts:283-320`) encadre correctement la
compaction : `repairToolCallPairs` **avant** (`:286`), compaction, puis `repairToolCallPairs`
**après** (`:299`), et la note de reprise est insérée devant le premier message non-système
(`:277-281`), donc jamais au milieu d'une paire. Les cas A et B le confirment : **aucun
risque de 400 « tool result sans tool call »**. Le point le plus dangereux du lot est propre.

Précision utile : un outil élagué ne casse pas le transcript. Les résultats d'outils vivent
dans les messages, pas dans le catalogue `tools` ; retirer une définition n'invalide aucune
paire.

### Le trou : les « toujours inclus » ne sont pas garantis

`pruneToolsForHandoff` (`provider-handoff.ts:196-211`) calcule `always` = outils déjà appelés
+ `tool_search`, puis appelle :

```ts
const cap = tightWindow ? Math.min(HANDOFF_TOOL_CAP, 6) : HANDOFF_TOOL_CAP;
const selected = await ragSelectTools(query, tools, cap, always);
```

et `ragSelectTools` (`provider-handoff.ts:174-176`) termine par
`result.selectedTools.slice(0, maxTools)`. Quand `always.length > cap`, **le `slice` tronque
les indispensables**. Sortie observée du test C :

```
AUDIT C -> n=6 noms=["tool_1","tool_2","tool_3","tool_4","tool_5","tool_6"]
AssertionError: expected [ 'tool_1', 'tool_2', … ] to include 'tool_search'
```

Conséquences pour l'utilisateur, après un repli en milieu de tâche :

1. `tool_search` — l'échappatoire même que le lot conserve pour retrouver un outil élagué —
   **disparaît**. Le modèle de secours n'a plus aucun moyen de redécouvrir les 104 autres.
2. Trois outils que l'agent **venait d'utiliser** (`tool_7`, `tool_8`, `tool_9`) ne sont plus
   appelables. Le modèle local voit dans l'historique qu'il s'en est servi et ne peut pas les
   rappeler : il improvise ou s'arrête. C'est l'inverse de la promesse « conversation reprise ».
3. Effet de bord : `shrinkToolsToBudget` (`provider-handoff.ts:151-153`) boucle sous la
   condition `current.length > alwaysInclude.size` ; ici `6 > 10` est faux, donc **le contrôle
   de budget est entièrement court-circuité** dans ce cas. Sans conséquence avec 6 outils,
   mais la garde ne garde rien.

Le seuil de déclenchement est bas : 6 outils déjà appelés suffisent. Une session ordinaire
(`view_file`, `search`, `str_replace`, `bash`, `create_file`, `list_directory`) l'atteint
avant le premier quart d'heure — c'est-à-dire dans la situation exacte où le repli sert.

**Je ne propose pas de correctif ici** : le remède demande un arbitrage (garantir tous les
« toujours inclus » quitte à dépasser le cap 6, ou borner `always` aux N derniers outils
appelés puis garder `tool_search` en priorité absolue). Ce n'est pas un correctif évident de
dix lignes, c'est une décision de conception qui appartient à l'auteur du lot. Piste : dans
`pruneToolsForHandoff`, `const cap = Math.max(tightWindow ? 6 : HANDOFF_TOOL_CAP, always.length)`
puis laisser `shrinkToolsToBudget` redescendre — mais sa condition d'arrêt doit alors être
revue elle aussi, sinon le budget n'est plus tenu.

## 4. Diagnostic et fuite de secrets — TIENT, avec une réserve C

### Aucune fuite prouvée

- `ProviderFailoverExhaustedError` (`src/codebuddy/provider-failover-error.ts:17-32`) porte
  `details = { primary, attempts }` où `attempts[].target` vaut `fournisseur:modèle` — **pas**
  d'URL de base, **pas** d'en-tête, **pas** de corps de requête. Aucun champ ne transporte
  `apiKey`, alors que l'objet `RuntimeFallbackProvider` disponible dans la portée en contient
  un : l'auteur a bien pris `${fallback.provider}:${fallback.model}` (`client.ts:1010`, `:1318`)
  et rien d'autre. C'est le bon réflexe.
- Journal `[fallback]` (`src/providers/provider-failover-notify.ts:29-43`) : provenance,
  destination, modèle, nature de la panne, horodatage de reprise. **Rien de secret.**
- Journal de saut de cible (`client.ts:876-887`, `provider-handoff.ts:110-116`) : uniquement
  des tailles de fenêtre. Propre.
- La clé Gemini passe par l'en-tête `x-goog-api-key`
  (`src/codebuddy/providers/provider-gemini-native.ts:482`, `:904`), **pas** en paramètre
  d'URL — un `fetch failed` ne peut donc pas l'écho.

### La réserve : l'assainissement du dépôt n'est pas appliqué ici

`describeFailoverAttempt` (`provider-failover-error.ts:52-64`) reprend le message d'erreur
**brut** du fournisseur :

```ts
const raw = err instanceof Error ? err.message : String(err ?? '');
…
if (typeof status === 'number') return { target, status, message: `${status} ${raw}`.trim() };
```

Or ce même dépôt possède `sanitizeProviderHealthMessage`
(`src/providers/provider-health.ts:173-181`) qui masque `Bearer …`, `sk-…`,
`api_key=` / `access_token=` / `authorization=`, et borne à 500 caractères — et il l'applique
avant d'écrire ce **même genre** de message dans `provider-health.json`. L'asymétrie est nette :
le message persisté est assaini, le message **remonté à l'utilisateur** ne l'est pas. Or celui-ci
va plus loin : il traverse `src/channels/provider-failure-speech.ts:75-77`
(`{ kind: 'fallback_exhausted', raw }`) jusqu'à la voix et à Telegram.

Aucun fournisseur du catalogue ne renvoie aujourd'hui un message porteur de secret à ma
connaissance, donc ce n'est pas une fuite constatée — mais c'est une défense en profondeur
gratuite qui manque, et le dépôt a déjà la fonction sous la main. Gravité **C**.
Correctif d'une ligne, si l'auteur le souhaite : envelopper `raw` dans
`sanitizeProviderHealthMessage` au moment de construire `message`. Je ne le pose pas ici,
n'ayant pas vérifié l'effet sur les assertions de messages existantes.

## 5. Alias `CODEBUDDY_LLM_FAILOVER` — TROU B

`src/providers/provider-failover-policy.ts:46-52` :

```ts
export function isDeclaredProviderFallbackEnabled(env = process.env): boolean {
  const declared = isTruthyEnv(env.CODEBUDDY_PROVIDER_FALLBACK);
  const legacy = isTruthyEnv(env.CODEBUDDY_LLM_FAILOVER);
  if (legacy && !declared) warnLegacyLlmFailoverAlias(env);
  return declared || legacy;
}
```

- **`CODEBUDDY_LLM_FAILOVER=true` seul ⇒ même chemin.** Confirmé : c'est un OU strict, un
  seul point de décision, consommé par le seul `usesDeclaredFailover` (`client.ts:550-552`).
  Une dépréciation est journalisée une fois (verrou `legacyAliasWarned`, réinitialisable
  pour les tests). **TIENT.**
- **Valeurs contradictoires.** Il n'y a **pas** de précédence : c'est un OU. Donc
  `CODEBUDDY_PROVIDER_FALLBACK=false` + `CODEBUDDY_LLM_FAILOVER=true` ⇒ **le repli est
  ACTIF**, et le legacy l'emporte silencieusement sur le nom canonique posé à `false`
  (l'avertissement de dépréciation ne se déclenche même pas dans ce cas, puisque
  `declared` est `false` ⇒ `legacy && !declared` est vrai… si, il se déclenche ; mais il
  dit « utilisez `CODEBUDDY_PROVIDER_FALLBACK=true` », pas « votre `false` est ignoré »).
- Cause : `isTruthyEnv` n'a que deux états (vrai / pas-vrai). `=false` n'est pas un
  « éteindre », c'est un « pas allumé ». Il n'existe donc **aucun coupe-circuit par
  variable d'environnement** : le seul vrai coupe-circuit est l'option de code
  `opts.disableProviderFallback` (`client.ts:551`), inaccessible à l'exploitant.
- La documentation du lot (`CLAUDE.md`, en-tête de `provider-failover-policy.ts`) décrit
  l'alias comme « a deprecated alias of the same flag (one path) » — vrai, mais elle ne
  dit nulle part qu'un `CODEBUDDY_PROVIDER_FALLBACK=false` explicite est sans effet face à
  un ancien `CODEBUDDY_LLM_FAILOVER=true` resté dans un `.bashrc` ou une unité systemd.

**Gravité B** (pas de perte de données ni de fuite ; surprise d'exploitation sur un poste
où l'ancien nom traîne, et impossibilité de désarmer sans éditer l'environnement).
**Correctif suggéré** (hors périmètre de cette session) : rendre `CODEBUDDY_PROVIDER_FALLBACK`
tri-état — une valeur explicitement fausse (`false`/`0`/`off`) désarme, y compris l'alias.

## 6. Suites — TIENT

```
HOME=~/DEV/cb-audit-failover-2026-09-07/_qa/af/home env -u FORCE_COLOR \
  npx vitest run tests/codebuddy tests/providers tests/utils
```

- **Fichiers : 1 échec | 74 succès (75)**
- **Tests : 1 échec | 1139 succès | 3 ignorés (1143)** — durée 10,7 s

L'unique échec est `tests/utils/disk-guard.test.ts > uses bavail (non-root available), not bfree` :
`expected 1297597837312 to be 1297597841408`, soit un écart de 4 096 octets (un bloc) entre le
`statfs` de référence et celui mesuré. C'est une **instabilité de mesure** sur un système de
fichiers en cours d'écriture, **sans aucun rapport** avec le lot audité (aucun des six fichiers
cibles n'est chargé par ce test). Les fichiers du lot — `tests/codebuddy/provider-handoff.test.ts`,
`provider-failover.test.ts`, `provider-failover-http.test.ts`, `provider-failover-kind.test.ts`,
`client-provider-fallback.test.ts`, `client-stream-fallback-integrity.test.ts`,
`tests/providers/provider-failover-policy.test.ts`, `provider-health.test.ts`,
`fallback-chain.test.ts`, `provider-fallback.test.ts`, `provider-failover-user-notice.test.ts` —
**passent tous**.

```
npx tsc --noEmit -p tsconfig.json   → exit 0
```

Note d'environnement : `node_modules` du worktree est un lien symbolique vers
`~/DEV/cb-secu-pwa-2026-09-06/node_modules`. Les suites tournent, mais `--reporter=basic`
n'existe plus dans vitest 4.1.9 (il faut l'omettre).

## Tableau de synthèse

| # | Point demandé | Verdict | Gravité | Ancrage |
| --- | --- | --- | --- | --- |
| 1 | Byte-identique sans les deux variables | **TIENT** | — | `client.ts:754`, `:763`, `:1053`, `:1064`, `:686-693` ; `provider-failover-policy.ts:46-52` |
| 1b | I/O synchrone par tour quand le drapeau est ON | TROU | **C** | `agent-executor.ts:1658` → `client.ts:687` → `provider-health.ts:162,196` |
| 2a | Pas de client partagé entre sessions WS | **TIENT** | — | `codebuddy-agent.ts:218` ; `handler.ts:929-940` ; `desktop-handler.ts:354,390-399` |
| 2b | Budget de blocage pollué par un appel auxiliaire concurrent | TROU | **B** | `client.ts:302-305,686-693` ; `agent-executor.ts:1657-1660` ; `stream-stall-guard.ts:53-79` |
| 2c | `activeFallback` non remis à zéro sur annulation | TROU | **C** | `client.ts:979,1006-1008,1029` et `:1265,1330` |
| 2d | Course `chat` ↔ `chatStream` sur les mêmes champs | TROU | **C** | `client.ts:302-305` (aucun verrou) |
| 3a | Transcript cohérent après élagage + compaction | **TIENT** | — | `provider-handoff.ts:286,299,277-281` — cas A, B, D **passés** |
| 3b | `tool_search` et outils déjà appelés garantis | **TROU (prouvé)** | **B** | `provider-handoff.ts:174-176,205-207` — cas C **échoué** |
| 3c | Contrôle de budget court-circuité quand `always > cap` | TROU | **C** | `provider-handoff.ts:151-153` |
| 4a | Pas de secret dans l'erreur ni le journal | **TIENT** | — | `provider-failover-error.ts:17-32` ; `provider-failover-notify.ts:29-43` ; `provider-gemini-native.ts:482` |
| 4b | Assainissement du dépôt non appliqué au message utilisateur | TROU | **C** | `provider-failover-error.ts:52-64` vs `provider-health.ts:173-181` |
| 5a | `CODEBUDDY_LLM_FAILOVER=true` seul ⇒ même chemin | **TIENT** | — | `provider-failover-policy.ts:46-52` |
| 5b | `PROVIDER_FALLBACK=false` + legacy `true` ⇒ legacy gagne, non documenté | TROU | **B** | `provider-failover-policy.ts:46-52` ; aucun coupe-circuit par variable |
| 6 | Suites vitest + tsc | **TIENT** | — | 1139/1143 (échec sans rapport) ; tsc exit 0 |

## Bilan

Le lot est honnêtement construit et son invariant central tient : sans
`CODEBUDDY_PROVIDER_FALLBACK` ni `CODEBUDDY_LLM_FAILOVER`, `chat()` et `chatStream()`
n'empruntent aucun chemin neuf — les court-circuits `&&` empêchent jusqu'à la lecture du
fichier de santé. Aucun utilisateur non-optant n'est touché.

Le point que je craignais le plus — un handoff qui casse la paire appel/résultat et déclenche
un 400 chez le modèle local — **ne se produit pas** : le double `repairToolCallPairs` encadre
correctement la compaction, vérifié sur 60 paires et sur un appel laissé sans résultat.

Le trou réel est ailleurs, et il est prouvé : dès six outils déjà utilisés, le `slice` du
sélecteur RAG tronque la liste des indispensables et fait tomber `tool_search` — l'échappatoire
même que le lot conserve — en même temps que des outils dont l'agent vient de se servir. Dans
son cas nominal, le modèle de secours reprend donc une conversation qu'il ne peut pas
continuer. C'est une fonctionnalité incomplète, pas une régression : sans le lot, l'utilisateur
était simplement bloqué.

Deux réserves de moindre poids méritent une ligne de suivi : le budget anti-blocage peut
hériter du mode « local » (20 min au lieu de 2) via un `activeFallback` posé par un appel
auxiliaire concurrent, et un `CODEBUDDY_PROVIDER_FALLBACK=false` explicite n'éteint rien face à
un ancien `CODEBUDDY_LLM_FAILOVER=true` traînant dans un profil shell. Le diagnostic ne fuit
aucun secret ; il gagnerait seulement à réutiliser l'assainisseur déjà présent dans le dépôt.

VERDICT: PUSHABLE
