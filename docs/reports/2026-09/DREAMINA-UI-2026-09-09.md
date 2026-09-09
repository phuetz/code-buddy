# DREAMINA-UI-2026-09-09 — pilote CDP chat agent Seedance

**Statut :** exploration DOM faite ; adaptation du pilote et preuves clips à suivre.  
**Agent :** Grok 4.6  
**Date :** 2026-09-09  
**Branche :** `codex/audit-systeme-nerveux-2026-09-01`  
**HEAD de départ :** `c1c4160faa88aa97576a2de60d7b494f62e24423`  
**Onglet CDP :** `https://dreamina.capcut.com/ai-tool/generate/?type=video` (Brave `:9222`)  
**Jamais touché :** onglet Flow `flow.google.com`, boutons Buy / Manage subscription / All plans / Switch to.

## Mission

Adapter `scripts/influencer/seedance_batch.py` à la nouvelle UI Dreamina « chat agent »,
prouver un clip 16:9 5 s en Seedance 2.0 Mini (25 crédits), puis lancer les 20 plans
2.5 si `~/DEV/vitrine-drafts/videos-lisa-2026-09-09/broll/seedance-jobs.json` existe.

## Garde-fous

- Onglet Dreamina uniquement (jamais l'onglet Flow — autre pilote).
- Jamais d'achat de crédits, jamais de clic sur une offre ou un abonnement.
- Pas de dialogue ni de visage de Lisa.
- Un seul clip de test avant le lot.

## Outillage

| Outil | Volume |
|---|---|
| Code Explorer | 4 appels (`list_repos`, `query`, `context` CDP, `impact` `set_prompt` — symbole Python absent du graphe, complété par `rg`) |
| lm-resizer | 0 (dumps CDP et `code-explorer analyze` déjà bornés) |
| Octets économisés | 0 |
| Index | **réindexé** `--force` (était périmé depuis `6092cbe9` / 2026-08-02) → `c1c4160fa` 2026-09-09T19:54:14Z, 6872 fichiers |

`code-explorer query "seedance batch Dreamina CDP"` a renvoyé `cdp-lib.py:CDP` et le driver Flow TypeScript, pas les fonctions top-level de `seedance_batch.py`. `context conn` / `impact set_prompt` : symbole absent. Relu par `rg` : `conn` / `set_prompt` / `find_generate_button` / `set_ratio` / `real_vids` dans `scripts/influencer/seedance_batch.py`.

## Tranches

| Tranche | Index | Contenu |
|---|---|---|
| 1 | réindexé `--force`, à jour `c1c4160fa` | Exploration DOM (ce rapport) |
| 2 | à réindexer après commit | Adaptation `seedance_batch.py` + preuve 2.0 Mini (3273→3248, 1280×720, 5.09 s) |
| 3 | à venir | Lot 20 plans (si le JSON existe) + tableau clips |

---

## Exploration DOM (mesurée 2026-09-09, viewport 1918×937, dpr=1)

L'ancienne page `ai-tool/generate` n'est plus une barre `dimension-layout` + `textarea`. C'est un **chat agent** :

- Titre vide : « What are we creating today? »
- Compositeur bas de page (y≈742–908, x≈727–1520)
- Deux `div[contenteditable=true]` Tiptap **ProseMirror** (pas de `textarea`, pas de Slate)
- Placeholder : « Describe your video or mention elements »
- Sidebar gauche : Your chats / New chat / Past creations / Recent
- Rail gauche : Explore / Create / Assets / Canvas / Octo Beta / **3.3K** + Advanced
- Panneau Assets à droite (souvent hors viewport, x≈1934) : Images / Videos / Audio / Docs / Elements
- Compte : badge compact `3.3K` ; solde exact **3273** dans la modale (voir ci-dessous)

Les coordonnées du pilote 22/08 (`PROMPT_FIELD=(1799,1072)`, `GEN_BTN=(2123,1186)`, bande `y>1100`) sont **mortes** : le viewport n'est plus ~3438 px de large, le compositeur est vers y=860.

### Compteur d'éléments (page au repos, type=video)

| Sélecteur | Nombre |
|---|---|
| `button` | 23 |
| `[role=button]` | 3 |
| `[contenteditable=true]` | 2 |
| `textarea` | 0 |
| `input[type=file]` | 0 au repos (apparaît après clic TRUSTED sur Reference) |
| `video` | 3 (cartes d'exemple « Try it », **pas** des générations) |
| `[role=dialog]` | 0 au repos |

### Barre d'outils du compositeur (`div.toolbar-settings-content-WjSnae`, y=856, h=52)

De gauche à droite :

| Contrôle | Sélecteur / classe | Valeur mesurée |
|---|---|---|
| Type | `[role=combobox]` « AI Video » | Options du menu : **AI Agent / AI Image / AI Video / AI Audio / AI Avatar / Mimic Motion**. Rester sur **AI Video**. |
| Modèle | `.model-label-li_27b` dans un `lv-select` | « Dreamina Seedance 2.0 Mini » (déjà sélectionné à l'arrivée) |
| Mode réf | `.feature-select-Elualw` | « Omni reference » |
| Ratio + réso | `button.toolbar-button-EJ0kAg` dont `innerText` contient `16:9` | « 16:9 720P » (le texte est coupé : `16:9` + `720P`, un `click_text('16:9 720P')` exact échoue) |
| Durée | même famille de bouton, `innerText` `/\d+s/` | « 4s » par défaut Mini ; « 5s » après clic sur le tick 5 |
| Coût | `.actual-credits-ojfP8I` + `.original-credits-Bx4_lh` | Mini 4s = **20** (44 barré) ; Mini 5s = **25** (55 barré) |
| Envoi | `button.lv-btn-primary.lv-btn-shape-circle.lv-btn-icon-only` | **`disabled=true`** tant que le ProseMirror est vide (attribut HTML, pas `aria-disabled` comme Flow) |

Un second bouton icon-only secondaire (carré, x=1468) est à gauche du rond d'envoi — ne pas le confondre avec Generate.

### 1. Choisir le modèle (Seedance 2.5 / 2.0 Mini)

1. Clic DOM (PointerEvent+MouseEvent, technique `flow-crame.py`) sur `.model-label-li_27b`.
2. Dropdown « Generate with: Dreamina Seedance … by seed ».
3. Options (textes `.option-label-jKuNta`, liste complète après scroll) :

| Option | Note mesurée dans le menu |
|---|---|
| **Dreamina Seedance 2.5** | « More realistic, longer videos, precise editing. Up to 50 references. » |
| **Dreamina Seedance 2.0 Mini** | « Most cost-effective, quicker results. Real human faces are not supported. » |
| Dreamina Seedance 2.0 Fast | visages réels non supportés |
| Dreamina Seedance 2.0 | idem |
| Dreamina Seedance 1.5 Pro | son sync |
| Dreamina Seedance 1.0 / 1.0 Fast | anciens |
| MiniMax H3 | 2K natif — **ne pas sélectionner** pour cette mission |

Clic sur le libellé exact `Dreamina Seedance 2.5` ou `Dreamina Seedance 2.0 Mini`. Vérifier `.model-label-li_27b` après coup. Escape ferme le menu.

### 2. Durée

1. Clic sur le bouton `/\d+s/` (ex. `4s`).
2. Popover « Total duration » : rail `.lv-slider-road` (254 px) + ticks `.tick-label-MCIj9H` **0 / 5 / 10 / 15** (plafond Mini = 15 s) + champ `.lv-input` (valeur numérique) + unité `s`.
3. **Réglage 5 s prouvé** : clic DOM sur le tick `5` → le chip passe à `5s`, l'input à `5`, le coût Mini à **25 / 55**.
4. Le champ numérique existe (contrairement au souvenir 22/08 où il refusait la saisie sur 2.5). Préférer le tick / le rail, plus fiable.

Pour 2.5, le rail ira plus loin (jusqu'à 30 s, mémoire 22/08) : relire les ticks après ouverture, ne pas durcir 15.

### 3. Ratio

1. Clic sur `button` dont `innerText` contient `16:9` (pas une égalité exacte).
2. Popover « Aspect ratio » : puces `.label-AvMqF9` **21:9 · 16:9 · 4:3 · 1:1 · 3:4 · 9:16**.
3. Section « Resolution » : **720P** seul visible (plafond confirmé, pas de 1080p).
4. 16:9 est déjà l'état courant — pour le test et le lot, ne pas toucher si déjà bon.
5. Le 9:16 reste capricieux historiquement ; le menu s'ouvre bien en 2026-09, mais le lot demandé est **16:9**.

### 4. Attacher une image de référence

Au repos : **aucun** `input[type=file]`.

Zone : `.reference-upload-goGAYf` (56×70, x≈747, y≈761), libellé `.label-CWjybQ` « Reference ». Un clic JS synthétique sur le libellé **ne suffit pas**.

**Geste qui marche :**

1. `Page.setInterceptFileChooserDialog({enabled:true})` (évite le sélecteur natif).
2. Clic **TRUSTED** souris (`Input.dispatchMouseEvent` mouseMoved + pressed + released) au centre de `.reference-upload-goGAYf`.
3. Événement CDP `Page.fileChooserOpened` (`mode: selectMultiple`, `backendNodeId`).
4. Un `input[type=file]` `display:none` apparaît, `accept` images+vidéos+audio (`image/jpeg,.jpg,.png,.webp,…,video/mp4,.mov,audio/mpeg,.wav`), `multiple=true`.
5. `DOM.setFileInputFiles` sur ce nœud (ou `backendNodeId`).
6. Texte « Upload references » visible pendant le dialogue.

Ne pas cliquer les cartes « Try it » (déclencherait une génération d'exemple).

### 5. Où apparaît le clip, comment récupérer l'URL CDN

Au repos, trois `<video src>` `https://v16-cc.capcut.com/.../video/tos/alisg/...` sont les **cartes d'exemple** (y≈268, 261×147). Les filtrer par baseline.

Après génération (à confirmer sur le clip test) :

- Nouveau `<video>` hors baseline, `src` http, **hors** placeholders `capcutstatic` / `loading` / `animation` / `static/media` / `record-loading-animation` (piège 22/08).
- Ou URL CDN vue au Network CDP (`Network.requestWillBeSent` / `responseReceived`) sur `v16-cc.capcut.com` / `video/tos/`.
- Filet historique : API `get_asset_list` / `get_history_by_ids` (pilote `harvest.py` du 22/08) — `video.item_list[].video.transcoded_video.origin.video_url`.
- Téléchargement : `Referer: https://dreamina.capcut.com/` + UA navigateur.

Le bouton « Go to bottom » (x=1426, y=700) scrolle le fil du chat vers le compositeur / la dernière carte.

### 6. Lire le solde exact

- Compact UI : `.credit-amount-text-UlvsZC` = `3.3K` (arrondi, **insuffisant**).
- Clic **uniquement** sur `.credit-amount-text-UlvsZC` (pas sur `.upgrade-text-YAMut0` « Advanced », classe `upgrade-*`).
- Modale `.lv-modal.domesticModal-*` : ligne `Credit balance` + **`.credits-R4hAvo` = `3273`**.
- **Fermer tout de suite par Escape.** La même modale affiche Buy credits / Manage subscription / All plans / Switch to Free / Switch to Basic — **interdiction de cliquer**.
- Après chaque clip : relire 3273 → N, journaliser le delta. Mini 5 s attendu −25 ; 2.5 5 s attendu −160.

### Bouton « Auto »

Non trouvé (texte exact, `aria-label`, shadow DOM) ni au repos ni après focus du ProseMirror. Assets est bien là (rail + header). Possible que « Auto » soit un chip d'une autre locale / d'un autre type (AI Agent). Le pilote n'en a pas besoin.

### Saisie du prompt (Tiptap)

Éditeur : `.tiptap.ProseMirror` (le plus grand, 700×96). Focus TRUSTED (clic souris), triple-clic ou Ctrl+A + Delete, puis `Input.dispatchKeyEvent` `type=char` caractère par caractère (comme Flow : `insertText` seul peut peindre le DOM sans committer le modèle). Le bouton Generate reste `disabled` tant que le modèle est vide — attendre `disabled===false` avant le clic TRUSTED.

### Pièges repris / nouveaux

| Piège | État 2026-09-09 |
|---|---|
| Coordonnées 22/08 (x>2100, y>1100) | Mortes (viewport 1918×937) |
| `textarea` / `input[type=file]` au repos | Absents |
| `insertText` sans commit | Même famille de risque (Tiptap) → `dispatchKeyEvent` char |
| Generate qui se déplace | Toujours : le rond primary, plus à droite ; le cibler par classe, pas par (x,y) |
| Animation de chargement | Filtrer les URL `loading`/`animation`/`capcutstatic` |
| Clic « Try it » | Interdit (dépense des crédits d'exemple) |
| Modale solde = page d'offres | Lire `.credits-R4hAvo` puis Escape, jamais Buy |
| Onglet Flow | `conn()` refuse toute URL `flow.google` |
| Ratio 9:16 | Menu visible ; hors scope du lot (16:9) |

## Preuve clip test

Live 2026-09-09, `--model 2.0mini`, 16:9, 5 s, T2V (vignobles vides, aucun visage).

```
python3 scripts/influencer/seedance_batch.py \
  ~/.codebuddy/media-video/seedance-2026-09/proof-mini.json \
  --model 2.0mini --outdir ~/.codebuddy/media-video/seedance-2026-09 --min-credits 20
```

| Champ | Valeur mesurée |
|---|---|
| Fichier | `~/.codebuddy/media-video/seedance-2026-09/proof-mini-16x9-5s.mp4` |
| Taille | 14 368 132 o (14 031 Ko) |
| ffprobe | h264 1280×720 + aac, **duration=5.088005** |
| Solde | **3273 → 3248** (−25, tarif Mini 5 s) |
| Réglages | model=True ratio=True dur=True (`Dreamina Seedance 2.0 Mini` / `5s` / `16:9`) |
| Progression | 2 % … 59 % puis `fresh=1` à 112 s |
| Journal | `seedance-journal.jsonl` `clip_start` + `clip_done` |

Bug corrigé après coup : `journal_write(..., path=got)` collisionnait avec le paramètre `path` du journal — le mp4 et le ffprobe étaient déjà là, seul l'append JSONL a été réécrit. Tests purs : `tests/scripts/influencer/test_seedance_batch.py` 9 verts.

## Lot 20 plans

*(tranche 3)*

## Bilan

*(à la clôture)*
