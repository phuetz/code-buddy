# Production de bandes-annonces de livres (qualité cinéma)

Ce document décrit le socle réutilisable et **fail-closed** qui transforme le
canon d'un livre en bande-annonce, en réutilisant les routeurs et moteurs vidéo
existants. Il n'introduit **aucun moteur de rendu concurrent** : le contrat
éditorial se compile vers les `HybridVideoRequest[]` déjà routés par
`routeHybridVideoBatch`.

Modules concernés :

- `src/media/content-tier.ts` — source canonique de `ContentTier`.
- `src/tools/video/cinematic-trailer-plan.ts` — grammaire narrative + contrat de
  plan typé + validation pure + compilation **PREVIEW**.
- `src/lora/identity-dataset-gate.ts` — gate de manifeste dataset d'identité LoRA.
- `src/tools/video/hybrid-video-router.ts` — routage existant (inchangé côté API).

## 1. Méthode « master puis dérivés »

On produit d'abord un **master de 60 à 90 s**, complet mais volontairement
interrompu. Les formats courts (30 s, 15 s) sont ensuite obtenus par
**remontage de clips déjà approuvés**, jamais par une nouvelle génération :

1. écrire le plan éditorial du master (`CinematicTrailerPlan`) ;
2. passer les portes de validation jusqu'à `APPROVED_FOR_GENERATION` ;
3. générer les clips du master via le routeur hybride ;
4. QC humain, puis `APPROVED_FOR_PUBLICATION` du master ;
5. dériver 30 s / 15 s en re-sélectionnant les clips approuvés (hook + escalade
   + coupure + marque), sans régénérer d'image.

`masterDurationSeconds` est contraint à `[60, 90]` et la somme des durées de
plans doit l'égaler (continuité de timeline). Les dérivés ne sont pas modélisés
comme un plan distinct : ce sont des sous-ensembles montés du master.

## 2. Grammaire narrative

Tokens stables (anglais) : `hook`, `world`, `protagonist`, `revelation`,
`escalation`, `price`, `false-resolution`, `withheld`, `brand`, `cta`.

Fonctions **obligatoires** (`REQUIRED_NARRATIVE_TOKENS`) : `hook`, `world`,
`protagonist`, `escalation`, `price`, `withheld`, `brand`, `cta`. `revelation`
et `false-resolution` restent des dispositifs **optionnels**.

Règles codées par plan (`TrailerShot`) :

- une seule **information** nouvelle, une seule **action**, un seul **mouvement
  caméra** — les connecteurs de séquence (`puis`, `then`, `pendant que`,
  `while`, `& `, `+ `) déclenchent un blocker ;
- **source manuscrit** obligatoire pour tout plan narratif ; les plans
  éditoriaux (`brand`, `cta`) en sont dispensés ;
- **texte incrusté dans l'image interdit** (`burnedInText` doit rester `false`) ;
- poignées d'entrée/sortie et conditions de rejet (warnings si absentes).

Statut narratif : `INCOMPLETE` tant qu'une fonction, une source, la timeline ou
la sécurité de publication manque.

## 3. Portes d'approbation (jamais déduites l'une de l'autre)

`validateCinematicTrailerPlan(input)` accepte une valeur **non fiable** : un plan
malformé (non-objet, sections manquantes/mal typées) est coercé prudemment et
rétrogradé en `INCOMPLETE` avec des blockers explicites `malformed-plan[:section]`
au lieu de lever une exception. La fonction calcule un `qualifiedStatus`
**fail-closed** et un `status` effectif = `min(statut revendiqué, statut
réellement atteint)`. Un statut mensonger est donc rétrogradé.

Sémantique de `blockers` (précise) :

- les blockers **structurels** (`malformed-plan…`) et **narratifs** sont
  **toujours** listés — ce sont des diagnostics, jamais masqués, même quand le
  statut revendiqué est `INCOMPLETE` ;
- les blockers des portes **génération** et **publication** ne sont listés que
  lorsque le statut **revendiqué** atteint ce barreau de l'échelle. `blockers`
  répond donc à « pourquoi le statut revendiqué n'est pas atteint » sans jamais
  dissimuler un défaut structurel.

| Statut | Conditions cumulatives |
|---|---|
| `INCOMPLETE` | défaut |
| `READY_FOR_PREFLIGHT` | récit, prompts, son, rétention et sécurité de publication complets |
| `APPROVED_FOR_GENERATION` | + casting revu, références SHA-256 approuvées pour personnages récurrents, **coût affiché ET approuvé** sous plafond |
| `APPROVED_FOR_PUBLICATION` | + approbation de publication **distincte** |

Règles clés :

- la **couverture n'est jamais autorité de casting** : l'approbation passe par
  `castingApproved` / `approvals.castingReviewed`, jamais par la jaquette ;
- un personnage **récurrent** (présent dans plus d'un plan) exige une référence
  approuvée, un `identityVersion` et un `referenceSha256` (64 hex) valides ;
- le **coût** doit être `displayedInUi`, approuvé (`costApproved` + `approvedBy`)
  et sous `approvedCeilingFlowCredits` avant `APPROVED_FOR_GENERATION`. L'estimation
  et le plafond doivent être **finis, non NaN et non négatifs** (sinon blocker
  `invalid-cost-estimate` / `invalid-cost-ceiling`) : un NaN ne peut pas neutraliser
  silencieusement la comparaison au plafond ;
- les identifiants de personnages sont contrôlés : `empty-character-id` et
  `duplicate-character-declaration` bloquent ; un id **répété dans un même plan**
  est dédupliqué pour le comptage, donc ne simule pas un personnage « récurrent » ;
- **visibilité privée** et `autoPublish: false` sont exigés en permanence ;
- **aucun auto-publish**, aucune dépense implicite.

## 4. Compilation PREVIEW → routage hybride

`compileTrailerPreview(input, capacity)` accepte aussi une valeur **non fiable**
et **ne lève jamais** : elle mappe chaque plan vers un `HybridVideoRequest` (un
clip chacun) et appelle `routeHybridVideoBatch` pour **estimer et répartir** la
charge. Elle ne déclenche aucune exécution :

- `executionAuthorized` et `publicationAuthorized` sont **toujours `false`** —
  l'autorisation est une étape humaine séparée, jamais un effet de bord ;
- un plan malformé **ou** une route indisponible (aucun moteur, plafond crédits)
  produit des `requests`/`routing` vides ou partiels et un blocker diagnostic
  (`routing-unavailable:…`), sans masquer l'erreur métier sous-jacente ;
- le coût **réellement routé** est confronté à `approvedCeilingFlowCredits` : un
  dépassement ajoute `routed-cost-exceeds-ceiling:…` et force `readyForGeneration`
  / `readyForPublication` à `false`, même si l'estimation *déclarée* semblait sous
  le plafond ;
- `readyForGeneration` / `readyForPublication` reflètent l'état des portes **et**
  ce contrôle de coût routé ;
- `contentTier` du plan est propagé aux requêtes.

Les bandes-annonces sont **advertiser-safe** : un `contentTier` non `safe` est un
blocker. Le routeur réserve Flow/Veo au contenu safe et garde le contenu privé
sur l'infrastructure locale (voir `hybrid-video-router.ts`).

## 5. Choix des moteurs

- **Google Flow / Veo 3.1** (`browser-assisted`) — plans safe, hero-shots
  premium (Veo Quality), variations en volume (Veo Lite). Coût en crédits Flow.
- **Darkstar LongCat** — lip-sync et continuité d'identité localisée.
- **Darkstar / Ministar ComfyUI** — repli local, contenu privé, recettes
  contrôlées.

Le routage effectif est décidé par `routeHybridVideo` ; ce socle ne le
reparamètre pas, il l'alimente.

## 6. LoRA d'identité

`assessIdentityDataset(manifest, options)` renforce la préparation LoRA :

- **blockers** : `personId` du manifeste ou traits canoniques vides,
  base de droits inconnue, provenance/licence/preuve revue manquantes,
  consentement absent pour une personne réelle, approbation d'identité absente,
  chemin d'image vide ou dupliqué, SHA-256 invalide, doublons exacts, `personId`
  d'image vide ou étranger, empreinte de traits immuables vide ou divergente,
  âge apparent non fini/négatif/non plausible, écart d'âge incohérent
  (`maxAgeSpread`) ;
- **seuils validés** : un seuil non fini/négatif/non entier (ou `maxAgeSpread`
  incohérent) est un blocker `invalid-threshold:…`, pour qu'un NaN ne neutralise
  pas silencieusement le contrôle qu'il pilote ;
- **warnings** : couverture (angles, cadrages, expressions, lumières) sous les
  seuils *par défaut prudents* — promus en blockers via `strictCoverage` ;
  diversité vêtements/fonds toujours en warnings ;
- réutilise `qualityGatePassed` de `quality-gate.ts` (prédicat octet partagé,
  non recopié) lorsqu'un `DatasetQualityReport` est fourni.

Les seuils (`DEFAULT_IDENTITY_COVERAGE`) sont configurables et ne prétendent pas
constituer une norme.

La base de droits est explicite : `consented-person`, `synthetic-owned` ou
`licensed-character`. Le consentement est obligatoire pour une personne réelle,
mais n'est pas artificiellement exigé d'un personnage entièrement synthétique.
Dans tous les cas, `evidenceReviewed` et `identityApproved` restent des portes
humaines distinctes et fail-closed.

### 6.1 Recette Darkstar de continuité d'identité

Le pilote reproductible utilise `scripts/darkstar/generate-krea2-identity-dataset.ts`
contre le service ComfyUI privé de Darkstar :

1. choisir un portrait neutre dont la provenance et le SHA-256 sont connus ;
2. produire d'abord huit candidats Krea 2 Identity Edit (face, deux ¾, profil,
   gros plan, plan taille et plein pied) ;
3. vérifier humainement visage, âge, traits immuables, mains, vêtements et
   artefacts ; aucune image n'est promue automatiquement ;
4. étendre ensuite à au moins vingt images seulement si le pilote est stable ;
5. construire le manifeste, exécuter le gate octet puis le gate identité en
   `strictCoverage` ; entraîner uniquement si les deux passent.

Exemple :

```bash
npx tsx scripts/darkstar/generate-krea2-identity-dataset.ts \
  --count 8 --subject-id lisa --trigger-token ohwx \
  --rights-basis synthetic-owned
```

Chaque PNG reçoit une caption et un sidecar (seed, prompts, modèles, hashes,
référence et statut). `claimedIdentityRightsBasis` est volontairement séparé de
`rightsEvidenceStatus`: une option CLI ne constitue jamais une preuve. Le script
ne lance ni entraînement, ni publication. Les URLs de rendu sont limitées au
loopback et au réseau Tailscale ; modèles/adapters et dépôts de nœuds sont
épinglés par révision et les poids critiques par SHA-256.

Les sorties FLUX.1-dev ne servent pas de dataset d'entraînement commercial dans
cette méthode : cette restriction vient de la licence du modèle, indépendamment
de leur qualité visuelle. Les contraintes de licence et de chiffre d'affaires
des modèles Krea doivent être revérifiées avant chaque production commerciale.

## 7. Son, overlays, QC

- **Son** : au moins quatre couches non vides **distinctes** (ambiance, foley,
  motif, parole) attribuées à des masters distincts ; quatre copies d'une même
  couche ne comptent pas — couches insuffisantes = blocker.
- **Overlays** : texte non vide, timecode **fini et borné à
  `[0, masterDurationSeconds]`** (sinon blocker `overlay-timecode-out-of-range`),
  source `manuscript` ou `editorial`, zone sûre 9:16 / 16:9 (hors zone =
  warning). Le texte généré *dans l'image* est proscrit.
- **QC / rejets** : chaque plan porte ses `rejectionConditions` ; la grille
  humaine note récit, identité et continuité avant le spectaculaire.

## 8. Ce qui est codé, heuristique, ou manuel

| Nature | Exemples |
|---|---|
| **Règles codées** (blockers déterministes) | fonctions obligatoires, source manuscrit, une action/mouvement par plan, timeline = master, timecode overlay borné, quatre couches son distinctes, id de personnages non vides/non dupliqués, SHA-256 personnages récurrents, coût fini affiché+approuvé sous plafond, coût routé sous plafond, publication privée/non auto, tier safe, texte incrusté interdit, garde structurel sur plan malformé |
| **Heuristiques** (seuils configurables / warnings) | couverture LoRA (angles/cadrages/expressions/lumières), diversité vêtements/fonds, poignées de montage, zone sûre |
| **Vérifications manuelles** (jamais automatisées) | `castingReviewed`, `costApproved`, `publicationApproved`, test « donne envie de lire », fidélité éditoriale, droits finaux |

Un état supérieur ne se déduit jamais du précédent : chaque approbation humaine
est explicite.

## 9. Pont avec `livres-codex/bandes-annonces`

Le vocabulaire (tokens, fonctions, statuts, cartes de plan, partition sonore,
hypothèses de rétention) est aligné sur :

- `bandes-annonces/FLOW-STORYBOARD-TEMPLATE.md`
- `bandes-annonces/FLOW-CINEMATIC-GRAMMAR.md`

Ce pont est **documentaire** : il n'existe **aucune dépendance runtime** vers ce
dépôt. Les validateurs Python (`validate-flow-storyboard.py`,
`validate-flow-audio.py`) restent des contrôles de package côté livres-codex ;
le socle TypeScript fournit l'équivalent typé et testé côté Code Buddy, sans
importer ni exécuter ces scripts.
