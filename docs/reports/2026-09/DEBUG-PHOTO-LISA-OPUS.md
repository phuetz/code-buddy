# DEBUG-PHOTO-LISA — « Envoie-moi une photo de toi » répond « backend non configuré »

- **Lane** : Opus 5 (débogage demandé explicitement), 2026-09-06
- **Worktree** : `~/DEV/cb-debug-photo-2026-09-06`, branche `debug/photo-lisa-2026-09-06`
- **Zone** : `src/tools/media-generation-tool.ts` (résolution du fournisseur d'images), tests associés
- **Lane parallèle (non touchée)** : « cache d'abord + mise en cache des photos générées » (`~/DEV/cb-selfie-2026-09-06`)
- **Original `~/code-buddy`** : LECTURE SEULE ; exécutions headless avec `HOME` isolé et `cwd` hors dépôt

## 1. Symptôme

Sur la PWA mobile (`buddy-mobile.service`) et sur Telegram (`lisa-telegram.service`), à
« Envoie-moi une photo de toi », la compagne répond que le backend de génération d'images
n'est pas configuré (clé API ou ComfyUI) — alors qu'un cache de selfies existe et est câblé,
et qu'au moins deux points de terminaison ComfyUI de repli répondent `200`.

## 2. Chaîne établie par les journaux (pas déduite)

`journalctl --user -u buddy-mobile -u lisa-telegram` :

```
[lisa-selfie] generating tier=safe mood=tender trigger=… loraHint=true
[lisa-selfie] failed: No image generation credentials configured for provider openai
Tool error {"tool":"lisa_selfie","error":"No image generation credentials configured for provider openai"}
```

Toutes les occurrences viennent de `buddy-mobile`. Côté `lisa-telegram`, le journal ne montre
que `Companion channel profile prompt` : ce service tourne sous le profil compagnon
(`CODEBUDDY_CHANNEL_PROFILE=companion`), donc **sans catalogue d'outils** — mais l'intercepteur
selfie de `src/commands/handlers/channel-handlers.ts:1341` s'exécute **avant** la branche profil
(`:1712`), et `isLisaSelfieRequest()` reconnaît bien les quatre formulations testées. Le chemin
Telegram n'a donc **pas** besoin d'exposer l'outil dans le profil compagnon : il partage la même
fonction `createAndMaybeSendLisaSelfie()`, et donc la même panne de fournisseur.

## 3. Cause racine

`resolveImageProvider()` — `src/tools/media-generation-tool.ts:1808-1817` (avant correctif) :

```ts
if (!requested && (envSource.COMFYUI_URL?.trim() || envSource.CODEBUDDY_IMAGE_BASE_URL?.includes('8188'))) {
  requested = 'comfyui';
}
```

La détection de disponibilité ne regarde **que** l'URL primaire. Les points de terminaison de
repli déclarés (`CODEBUDDY_COMFYUI_FALLBACK_URLS`, et l'orthographe courte `COMFYUI_FALLBACK_URLS`
qui voisine `COMFYUI_URL` dans les fichiers d'environnement) sont invisibles à ce stade. Une
installation dont le poste GPU primaire est éteint, ou dont on a retiré `COMFYUI_URL`, retombe
donc sur le fournisseur cloud et meurt dans `assertProviderReady()`
(`media-generation-tool.ts:2138`) sur `No image generation credentials configured for provider openai`
— alors qu'un ComfyUI local répondait.

Second défaut de la même famille, dans la chaîne d'appel : `comfyBaseUrls()`
(`media-generation-tool.ts:1473`) ne lisait que `CODEBUDDY_COMFYUI_FALLBACK_URLS`. Un service qui
ne déclare que l'orthographe courte n'avait **aucun** repli, et l'unique tentative partait sur
l'endpoint mort.

L'outil renvoie l'erreur au modèle, qui la reformule ; c'est le message vu par l'utilisateur.

### Preuve avant correctif (rejeu headless, environnement dégradé)

Fournisseur non épinglé, `COMFYUI_URL` absente, uniquement les replis déclarés :

```
[lisa-selfie] failed: No image generation credentials configured for provider openai
{"result":"Je ne peux pas générer ni envoyer de photo pour l'instant : aucun fournisseur de
 génération d'images n'est configuré (clé OpenAI ou ComfyUI manquante)."}
```

C'est mot pour mot le symptôme rapporté.

## 4. Correctif (minimal)

`src/tools/media-generation-tool.ts` :

1. Nouvelle fonction `comfyFallbackUrls(envSource)` : union dédupliquée des deux orthographes
   d'environnement, dans l'ordre `CODEBUDDY_COMFYUI_FALLBACK_URLS` puis `COMFYUI_FALLBACK_URLS`.
2. `resolveImageProvider()` : un repli déclaré compte désormais comme preuve de disponibilité
   ComfyUI, et sert d'URL primaire quand `COMFYUI_URL` / `CODEBUDDY_IMAGE_BASE_URL` sont absentes
   (au lieu de supposer `127.0.0.1:8188`, ce qui ajoutait une tentative morte).
3. `comfyBaseUrls()` réutilise la même fonction, donc l'orthographe courte donne enfin des replis.

Ce qui **ne change pas** : un fournisseur explicitement demandé (`xai`, cloud) l'emporte toujours
sur les replis déclarés (cas de test dédié) ; aucun ordre de tentative n'est modifié quand
`COMFYUI_URL` est présente ; aucun sondage réseau supplémentaire n'est introduit.

## 5. Tests

`tests/tools/comfyui-fallback-detection.test.ts` (nouveau, vrais serveurs HTTP locaux parlant le
contrat `/prompt` → `/history/{id}` → `/view`, aucun mock) :

| Cas | Sans correctif | Avec correctif |
| --- | --- | --- |
| Détection ComfyUI à partir des seuls replis déclarés | ✗ `No image generation credentials configured for provider openai` | ✓ image écrite, `provider: 'comfyui'` |
| Orthographe courte `COMFYUI_FALLBACK_URLS` honorée quand le primaire est mort | ✗ même erreur | ✓ bascule sur le repli |
| Un fournisseur cloud explicite l'emporte sur les replis | ✓ | ✓ (non-régression) |

Le fichier existant `comfyui-image-real.test.ts` est **exclu** de la configuration Vitest
(`**/*real*.test.ts`) : y loger la régression l'aurait rendue invisible en CI. D'où un fichier
dédié, qui tourne dans la suite normale.

## 6. Vérifications réelles

- `npx vitest run tests/tools/comfyui-fallback-detection.test.ts` : **3/3 verts** ; les 2 cas de
  régression sont **rouges** avec le correctif remisé (`git stash`), avec l'erreur exacte des
  journaux de production.
- Suites voisines : `comfyui-fallback-detection`, `comfyui-lora-workflow`, `comfyui-inpaint`,
  `media-generation-h3-video`, `media-image-edit`, `comfy-recipe-tool`, `tests/companion/` →
  **69 fichiers / 602 tests verts**.
- `npx tsc --noEmit` : **0 erreur**.
- Rejeu headless après correctif, environnement dégradé (fournisseur non épinglé, `COMFYUI_URL`
  absente, cache vidé, un ComfyUI de substitution local) : l'agent appelle `lisa_selfie`, le repli
  est détecté, le fichier est écrit et **le chemin de l'image est rendu** dans la réponse.

## 7. Constats laissés à d'autres lanes (établis, non corrigés ici)

1. **Le cache est contourné dès que le modèle passe un `scene`.** `src/companion/lisa-selfie.ts:412` :
   `options.scene?.trim() ? undefined : await selectCachedLisaSelfie(...)`. Observé en vrai : le
   modèle appelle `lisa_selfie` avec `{"mood":"portrait","scene":"smiling softly at the camera"}`,
   d'où `[lisa-selfie] generating` au lieu de `cache hit` alors que le palier demandé est peuplé.
   C'est ce qui transforme une réponse instantanée en génération complète. **Périmètre de la lane
   « cache d'abord ».**
2. **L'endpoint primaire mort est toujours essayé en premier.** Le poste GPU primaire répond `000` ;
   chaque selfie paie donc `CODEBUDDY_COMFYUI_ENDPOINT_TIMEOUT_MS` (10 s) avant de basculer, puis la
   génération CPU du repli dépasse le budget de l'outil — journal : `aborted by user after 43.5s`.
   Un classement par disponibilité coûterait un sondage réseau : hors du « correctif minimal », à
   arbitrer.
3. **Hygiène d'environnement.** Les deux fichiers d'environnement déclarent les replis sous les deux
   orthographes (l'une d'elles en double dans un fichier, la seconde occurrence l'emportant), et une
   valeur de chaîne de repli contient un `>` non protégé — inoffensif pour `systemd`, mais toute
   lecture par `sh` en fait une redirection. À normaliser côté configuration, pas côté code.
