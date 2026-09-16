# VERIF-SELFIE-CACHE-AGY — Vérification croisée de la lane « selfie cache-first » (Grok) avant fusion

Date : 2026-09-06 (Europe/Paris)
Auteur : Agent Antigravity (AGY)
Dépôt : `~/DEV/cb-selfie-2026-09-06`
Branche : `feat/selfie-cache-2026-09-06`
HEAD vérifié : `aaa9c96ea` (au-dessus de `533b32d47`)
Rapport audité : `docs/reports/2026-09/SELFIE-CACHE-GROK.md`
Environnement de test isolé : `HOME=~/DEV/cb-selfie-2026-09-06/_qa/verif/home` et `env -u FORCE_COLOR`
Règle de sécurité : aucun accès à `~/code-buddy` ni `~/.codebuddy`. Chemins en `~`, aucun prénom ni donnée personnelle.

---

## 1. Synthèse de la vérification

| Point | Description | Statut | Gravité | Preuve |
|---|---|---|---|---|
| (1) | **Byte-identique sans persona** : sans `CODEBUDDY_COMPANION_PERSONA`/profil compagnon, aucune ligne du router n'est atteinte | **TROU** | Gravité B | `channel-handlers.ts:1328` (`telegram`), `voice-loop.ts:1874` atteignent le router sans persona |
| (2) | **Motifs regex FR/EN** : 10 phrases positives et 6 pièges testés | **TROU** | Gravité B | 4 échecs sur 16 : 3 faux négatifs (« t'as une photo ? », « montre-toi », « send me a pic ») ; 1 faux positif (« le selfie de Marie ») |
| (3) | **Paliers** : demande « explicite » sans gate adulte refusée sans substitution | **TIENT** | - | `lisa-selfie-router.ts:92-103` (`reason: 'explicit-gate'`, `imagePath: undefined`) ; test `lisa-selfie-router.test.ts:158` |
| (4) | **Rotation** : anti-répétition (≥ 2 images), comportement avec 1 image, cache vide sans exception | **TIENT** | - | `lisa-selfie.ts:174-178` (`exclude`, repli `candidates`), `lisa-selfie-router.ts:123` (`empty-cache`), test `lisa-selfie-router.test.ts:133` |
| (5) | **Ingest & Confidentialité** : favoris préservés, JSON sans chemin `/home`, prompt sans donnée perso, cache hors dépôt | **TROU** | Gravité A | Fuite prénom dans prompt JSON refill (`user-name.ts` via `lisa-selfie-refill.ts:116`) ; cache par défaut dans le clone (`.codebuddy/lora/lisa/selfie-cache`) |
| (6) | **Refill** : opt-in strict au heartbeat, générateur injoignable skip sans boucle, seuil de charge `load < N` | **TIENT** | - | `server/index.ts:1935` (garde flag), `lisa-selfie-refill.ts:58-72` (`loadavg()[0] >= 4`, `defaultProbe` sans retry) |
| (7) | **Notes Opus** : (a) `scene` contourne le cache, (b) ComfyUI primaire mort essayé en premier | **TIENT** | - | Note (a) **INFIRMÉE** (`skipCache` a remplacé `scene` ; router indépendant) ; Note (b) **CONFIRMÉE** (patch ≤ 10 lignes proposé) |
| (8) | **Suites & Qualité** : Vitest ciblés (175/175), suites requises, `tsc --noEmit` (0), `eslint` (0 err), `diff --check` (0) | **TIENT** | - | Tous échecs externes prouvés 100% préexistants via worktree sur base `codex/audit-systeme-nerveux-2026-09-01` |

---

## 2. Détail des vérifications

### (1) Byte-identique sans persona compagnon — TROU (Gravité B)

L'affirmation selon laquelle « sans `CODEBUDDY_COMPANION_PERSONA` ni profil compagnon, aucune ligne du router n'est atteinte » est contredite par l'implémentation sur deux des trois surfaces :

1. **Surface Telegram (`src/commands/handlers/channel-handlers.ts:1326-1331`)** :
   ```typescript
   const companionProfile = shouldUseCompanionChannelProfile({
     text: message.content,
     isCommand: message.isCommand === true,
   });
   if (
     process.env.CODEBUDDY_LISA_SELFIE !== 'false' &&
     (channel.type === 'telegram'
       || process.env.CODEBUDDY_LISA_SELFIE_CHANNELS === 'all'
       || companionProfile)
   ) {
     const { tryServeCompanionSelfie } = await import('../../companion/lisa-selfie-router.js');
     const served = await tryServeCompanionSelfie(message.content, ...);
   ```
   **Constat** : L'opérateur `channel.type === 'telegram'` court-circuite `companionProfile`. Si une installation Telegram fonctionne sans persona compagnon (`CODEBUDDY_COMPANION_PERSONA` non défini), une demande de photo atteint le nouveau router et sert des images du cache au lieu du comportement préexistant.

2. **Surface Voix (`src/sensory/voice-loop.ts:1874` et `src/sensory/hybrid-reply.ts:792-795`)** :
   ```typescript
   // Lisa selfie — cache-first router BEFORE the LLM. Generation is not on this path.
   if (process.env.CODEBUDDY_LISA_SELFIE !== 'false') {
     try {
       const { tryServeCompanionSelfie } = await import('../companion/lisa-selfie-router.js');
   ```
   **Constat** : Aucun test de `CODEBUDDY_COMPANION_PERSONA` n'est effectué dans `defaultReply` ni dans `hybrid-reply.ts`. Le router est exécuté dès que `CODEBUDDY_LISA_SELFIE !== 'false'`.

3. **Surface WebSocket Mobile (`src/server/websocket/handler.ts:755`)** :
   ```typescript
   if (assistant === 'companion') {
     await runPlainChatTurn(ws, state, turn, {
       stream,
       produce: () => produceCompanionReply(message),
     });
     return;
   }
   ```
   **Constat** : `produceCompanionReply` est conditionné par le paramètre client `assistant === 'companion'`. En mode agent normal, la ligne n'est pas atteinte.

4. **Comportement du router sans persona (`src/companion/lisa-selfie-router.ts:167-181`)** :
   Le router n'exige pas de persona ; si aucune persona n'est active, `pickCaption` utilise `DEFAULT_CAPTIONS` (« Voilà — une photo de moi. »).

---

### (2) Motifs regex FR/EN — TROU (Gravité B)

Regex implémentées dans `src/companion/lisa-selfie.ts:192-219` :
- Normalisation : `normalizeVoiceInteractionText(text)` (suppression diacritiques, accents, ponctuation, espaces multiples).
- Média : `/\b(?:photo|selfie|portrait|image|picture|cliche)\b/`
- AboutSelf : `/\bselfie\b/` ou `media && (/\b(?:toi|de toi|a toi|ta photo|ton selfie|ta tete|ton visage|toi meme|photo de lisa|you|your photo|your picture|picture of you|photo of you)\b/ || ...)`
- SendIntent : `/\b(?:envoie|envoyer|envoi|envoies|send|show|telegram|telephone|phone|montre|montre moi|fais|fait|genere|prend|prends|capture)\b/` ou `/\b(?:selfie|photo de toi|photo a toi|ta photo)\b/`
- Styles (`STYLE_HINTS:256-266`) : `wet-selfie` (plage, beach, mer...), `street-rain` (pluie, rain...), `neon-skate`, `studio`, `soft-editorial` (pull, sweater...), `tender`, `playful`, `bold`, `calm`.

**Résultats de l'évaluation sur les 10 phrases positives et 6 pièges exigés :**

```bash
# Évaluation via script Node tsx dans l'environnement de test isolé
--- POSITIVES ---
"envoie-moi une photo de toi"    => true  [OK]
"t'as une photo ?"               => false [ÉCHEC: faux négatif - 't as' et 'une photo' sans 'de toi']
"selfie"                         => true  [OK]
"montre-toi"                     => false [ÉCHEC: faux négatif - aucun mot clé média]
"send me a pic of you"           => false [ÉCHEC: faux négatif - 'pic' absent de la regex média]
"une photo de toi à la plage"    => true  [OK]
"fais-moi un selfie"             => true  [OK]
"show me a selfie"               => true  [OK]
"ta photo s'il te plaît"         => true  [OK]
"Lisa, send me a photo of you"   => true  [OK]

--- PIÈGES ---
"envoie-moi la photo du contrat" => false [OK]
"photo de mon chien"             => false [OK]
"comment prendre une photo"      => false [OK]
"photoshop"                      => false [OK]
"le selfie de Marie"             => true  [ÉCHEC: faux positif - tout mot 'selfie' déclenche]
"peux-tu analyser cette photo"   => false [OK]
```

**Analyse des 4 anomalies** :
1. `"send me a pic of you"` échoue car seul `picture` figure dans la regex média, pas l'abréviation courante `pic`.
2. `"t'as une photo ?"` échoue car l'expression n'a ni verbe d'envoi (`sendIntent`), ni spécification `de toi`.
3. `"montre-toi"` échoue car il n'y a aucun nom de média (photo/selfie/portrait).
4. `"le selfie de Marie"` est intercepté à tort car les lignes 199 et 213 considèrent que la simple présence du token `selfie` valide simultanément `aboutSelf` et `sendIntent`, sans vérifier si le selfie concerne un tiers.

---

### (3) Paliers `CONTENT_TIER` — TIENT

Vérification du refus poli sans substitution pour une demande explicite sans gate adulte :
- Code : `src/companion/lisa-selfie-router.ts:92-103` :
  ```typescript
  const inferredTier = inferLisaContentTier(text);
  if (inferredTier === 'explicit' && resolveLisaContentTier(env, 'explicit') !== 'explicit') {
    const caption = pickCaption('refusal', env, options);
    logger.info('[lisa-selfie-router] explicit request refused (adult gate off)');
    return {
      handled: true,
      caption,
      refused: true,
      reason: 'explicit-gate',
      contentTier: 'safe',
    };
  }
  ```
- L'objet retourné contient `refused: true`, `reason: 'explicit-gate'`, et **aucun `imagePath`**.
- Aucune image de palier inférieur (safe ou sensual) n'est substituée.
- Test unitaire dédié : `tests/companion/lisa-selfie-router.test.ts:158-173` (`it('refuses an explicit request when the adult gate is off')`). Test passé avec succès.

---

### (4) Rotation anti-répétition — TIENT

1. **Cache avec ≥ 2 images** :
   - `src/companion/lisa-selfie.ts:175-177` et `src/companion/lisa-selfie-router.ts:110-111` :
     Le dernier fichier servi est lu depuis `recent-selfies.json` et placé dans `exclude`.
     `const preferred = candidates.filter((entry) => !exclude.has(entry.file))`
     Tant que `candidates.length >= 2`, `preferred.length >= 1`, l'image précédente est rigoureusement exclue.
   - Prouvé par test unitaire : `tests/companion/lisa-selfie-router.test.ts:133-156` (`expect(second?.imagePath).not.toBe(first?.imagePath)`).
2. **Cache avec 1 image** :
   - Si `preferred.length === 0`, le code bascule sur :
     `const pool = preferred.length > 0 ? preferred : candidates;`
     L'image unique est alors servie à nouveau, sans erreur ni blocage.
3. **Cache vide** :
   - `selectCachedLisaSelfie` renvoie `undefined`.
   - `lisa-selfie-router.ts:123-133` retourne `{ handled: true, caption: pickCaption('empty', ...), reason: 'empty-cache', refused: false }`.
   - Les surfaces (Telegram, WS mobile, voix) transmettent le message d'attente honnête sans lever d'exception.

---

### (5) Ingestion, éviction et confidentialité — TROU (Gravité A)

1. **Plafond 200 et préservation des favoris** : **TIENT**
   - `src/companion/lisa-selfie-ingest.ts:155-157` :
     `const ranked = images.filter((entry) => !entry.favorite).sort(...)`
     Les entrées marquées `favorite: true` dans leur sidecar JSON sont exclues du tableau d'éviction.
   - Prouvé par `tests/companion/lisa-selfie-router.test.ts:216-239` (`oldFile` supprimé, `favFile` et `newFile` conservés).
2. **Chemins absolus dans le sidecar JSON** : **TIENT**
   - `src/companion/lisa-selfie-ingest.ts:123-137` : Le JSON écrit ne contient aucun chemin `/home/...` (uniquement prompt, tier, style, model, provider, date, hash, favorite).
3. **Prompt sans donnée personnelle** : **TROU (Gravité A)**
   - Dans `src/companion/lisa-selfie-refill.ts:116` et `src/companion/lisa-selfie.ts:335, 391` :
     `userName: resolveUserName()`
   - Dans `src/companion/user-name.ts:14, 20-23` :
     `resolveUserName()` retourne `DEFAULT_USER_NAME` (le prénom de l'auteur) ou `CODEBUDDY_USER_NAME`.
   - Dans `src/lora/lisa-avatar-bible.ts:322` :
     `options.forWhom ? \`looking at ${options.forWhom}\` : 'looking at camera'`
   - Par conséquent, lors du refill automatique, le prompt généré contient littéralement `"looking at <Prénom>"`.
   - Ce prompt est ensuite persisté sur disque dans le sidecar JSON (`lisa-selfie-ingest.ts:126` : `prompt: input.prompt`), constituant une fuite directe de donnée personnelle dans les métadonnées de cache.
4. **Cache hors dépôt** : **TROU (Gravité B)**
   - `src/companion/lisa-selfie-ingest.ts:26-33` :
     ```typescript
     export function resolveLisaSelfieCacheDir(env = process.env, rootDir = process.cwd()): string {
       const configured = env.CODEBUDDY_LISA_SELFIE_CACHE_DIR?.trim();
       if (configured) return configured;
       return path.join(defaultLoraRoot(rootDir), 'lisa', 'selfie-cache');
     }
     ```
   - `defaultLoraRoot(rootDir)` (`src/lora/dataset.ts:12`) résout `path.join(cwd, '.codebuddy', 'lora')`.
   - Par défaut, le cache est créé dans `<clone>/.codebuddy/lora/lisa/selfie-cache` (dans l'arborescence du projet), au lieu d'un dossier sous `~/.codebuddy/companion/` comme c'est le cas pour `resolveLisaSelfieRecentPath` (`path.join(homedir(), '.codebuddy', ...)`).

---

### (6) Refill arrière-plan — TIENT

1. **Garde heartbeat** :
   - `src/server/index.ts:1935` :
     `if (process.env.CODEBUDDY_LISA_SELFIE_REFILL === 'true') {`
     Sans cette variable active, aucun handler n'est enregistré sur le heartbeat (`heart.register` n'est pas appelé).
2. **Générateur injoignable** :
   - `src/companion/lisa-selfie-refill.ts:68-72` :
     `const reachable = await probe(comfyUrl);`
     `if (!reachable) return { ran: false, skipped: 'unreachable' };`
     Retour immédiat sans boucle ni nouvelle tentative bloquante.
3. **Mesure de charge « load < N »** :
   - Mesure : `loadavg()[0]` via `node:os` (load average à 1 minute).
   - Variable : `CODEBUDDY_LISA_SELFIE_REFILL_MAX_LOAD`.
   - Seuil par défaut : `DEFAULT_SELFIE_REFILL_MAX_LOAD = 4` (`src/companion/lisa-selfie-refill.ts:26`).
   - Condition : `if (load1 >= maxLoad) return { ran: false, skipped: 'load' };`.

---

### (7) Deux notes du relecteur Opus — TIENT

1. **Note (a) : « le cache est contourné dès que le modèle passe un scene » — INFIRMÉE** :
   - Dans `src/companion/lisa-selfie.ts:437-441`, la condition `options.scene?.trim()` a été remplacée par `options.skipCache`. Le passage d'un paramètre `scene` ne désactive plus le cache.
   - De plus, le router pre-LLM (`src/companion/lisa-selfie-router.ts`) n'appelle pas `createAndMaybeSendLisaSelfie` et consomme directement `selectCachedLisaSelfie`.
2. **Note (b) : « l'endpoint ComfyUI primaire mort est toujours essayé en premier » — CONFIRMÉE** :
   - La lane n'a modifié que l'ingestion post-génération (`src/tools/media-generation-tool.ts:252`).
   - `generateComfyUIImageWithFallback` (`media-generation-tool.ts:1530`) boucle toujours sur `comfyBaseUrls()` qui place systématiquement l'URL primaire morte en tête.
   - **Proposition de correctif minimal (mémorisation de l'endpoint sain, ≤ 10 lignes)** :
     ```typescript
     let healthyComfyEndpoint: { url: string; expiresAt: number } | null = null;
     function getPrioritizedComfyUrls(cfg: ProviderConfig, envSrc: NodeJS.ProcessEnv): string[] {
       const urls = comfyBaseUrls(cfg, envSrc);
       if (healthyComfyEndpoint && Date.now() < healthyComfyEndpoint.expiresAt && urls.includes(healthyComfyEndpoint.url)) {
         return [healthyComfyEndpoint.url, ...urls.filter((u) => u !== healthyComfyEndpoint!.url)];
       }
       return urls;
     }
     ```

---

### (8) Suites de tests & Qualité — TIENT

- **TypeScript** : `npx tsc --noEmit -p tsconfig.json` => Code de sortie **0**, 0 erreur.
- **ESLint** : `npx eslint` sur l'ensemble des fichiers modifiés => **0 erreur**, 4 avertissements préexistants.
- **Git diff** : `git diff --check` => Code **0**, aucune anomalie d'espace ou marqueur de conflit.
- **Privacy** : `tests/security/donnees-personnelles.test.ts` => **40/40 passés**.
- **Tests ciblés de la lane (9 fichiers)** : **175/175 passés**.
- **Suites complètes exécutées** :
  - `tests/companion` : 78 passés, 1 sauté (677 passés, 1 sauté).
  - `tests/sensory` : 84 passés, 1 sauté (778 passés, 4 sautés, 1 todo).
  - `tests/channels` : 63 passés, 1 échec (`tests/channels/provider-failure-speech.test.ts`).
  - `tests/server` : 63 passés, 2 échecs (`peer-tool-bridge.test.ts`, `server-startup.test.ts`).
  - `tests/tools` : 170 passés, 3 échecs (`bash.test.ts`, `bash-tool.test.ts`, `search-tools-context.test.ts`).
- **Analyse des échecs via worktree comparatif** :
  Création d'un worktree temporaire sur la branche de base `codex/audit-systeme-nerveux-2026-09-01` (`533b32d47`).
  Exécution des fichiers en échec sur la base : échecs 100% identiques (problème préexistant d'assertion `out_of_credits` vs `quota`, SQLite non initialisé dans le test serveur, absence du binaire `@vscode/ripgrep` dans l'environnement node_modules partagé). Aucun échec introduit par la lane.

---

## 3. Bilan

1. Le router cache-first fonctionne pour le flux nominal compagnon et protège les paliers explicites sans substitution.
2. La rotation anti-répétition et la préservation des favoris lors de l'éviction à 200 images sont effectives.
3. Le remplissage périodique en arrière-plan est bien opt-in strict au heartbeat et s'arrête si ComfyUI est injoignable.
4. Note Opus (a) infirmée (`scene` ne bypass plus le cache) ; note Opus (b) confirmée et assortie d'un patch minimal mémorisant l'endpoint sain.
5. Les suites de tests exigées sont conformes (175/175 ciblés, tsc 0, eslint 0 err, diff check 0, 40/40 privacy git-tracked).
6. **TROU A** : Le refill injecte le prénom de l'utilisateur (`resolveUserName()`) dans le prompt, qui est écrit en clair dans les sidecars JSON.
7. **TROU B** : Le dossier de cache par défaut est sous `.codebuddy/` du projet local au lieu de `~/.codebuddy/companion/`.
8. **TROU B** : Le router est atteint sans persona sur Telegram (`channel.type === 'telegram'`) et sur la voix (`voice-loop.ts`).
9. **TROU B** : 4/16 motifs de détection échouent (faux positifs sur « le selfie de Marie », faux négatifs sur « send me a pic » et « montre-toi »).
10. La lane ne peut pas être fusionnée avant correction de la confidentialité (sidecar JSON) et de l'emplacement du cache.

VERDICT: NON PUSHABLE (fuite de prenom dans le prompt du sidecar JSON de refill, cache par defaut situe dans le clone du depot au lieu de ~/.codebuddy, declenchement sans persona sur Telegram et voix, et 4/16 motifs de detection errones)
