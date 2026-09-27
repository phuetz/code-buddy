# RAPPORT — App Studio de Cowork, vague 2 de l'écart bolt.new (27/09/2026)

## Dépôt

- Branche `opus/cowork-app-builder-bolt-vague2-2026-09-27`, partie de `d57fc9529` (vague 1, PR #253).
- Ni PR, ni fusion.
- Les captures et les données brutes du banc sont conservées hors dépôt, avec le rapport de mission.

## 1. Écarts comblés

Chemins relatifs à `cowork/src/`. Chaque fonctionnalité est câblée IPC → interface → effet, et prouvée par un test de câblage qui rend le **vrai** `StudioView` sur un vrai dossier (`tests/studio-iterate/studio-view-request-context.test.tsx`, 6 scénarios), puis dans la vraie fenêtre Electron.

| # | Écart | Ce qui est livré | Fichiers principaux |
|---|---|---|---|
| 1 | Sélection d'un élément dans l'aperçu | Bouton **Sélectionner** dans l'aperçu ; un script fixe est injecté dans la seule frame loopback de l'aperçu (`WebFrameMain.executeJavaScript`) ; survol surligné, clic → description (balise, texte, classes, composant React/Vue, `_debugSource`) postée au parent, origine vérifiée ; le processus principal la localise en **fichier + lignes + code actuel** ; pastille dans le chat ; la demande suivante porte ce bloc. Instance d'un composant réutilisé : le prompt dit d'où vient la donnée et comment ne changer que cette instance. | `main/studio/preview-bridge.ts`, `main/studio/studio-context-service.ts` (`locate`), `renderer/components/studio/request-context.ts`, `use-studio-request-context.tsx`, `PreviewPane.tsx` |
| 2 | Console du navigateur + journaux du serveur de dev | Panneau du bas **Terminal / Console** ; onglets Navigateur (messages `console-message` de la seule frame de l'aperçu) et Serveur de dev (journaux `app_server`, interrogés toutes les 2 s) ; boutons **Joindre au chat** (erreurs/avertissements) et **Corriger** (demande immédiate). Les deux flux sont **masqués** (secrets) par le processus principal. | `main/studio/preview-bridge.ts`, `main/studio/dev-server-service.ts`, `StudioConsolePane.tsx` |
| 3 | Image / maquette | Glisser-déposer, coller ou bouton **Image** (PNG/JPEG/WebP/GIF, 5 Mo) ; envoyée en bloc `image` **seulement** si `model.capabilities(modèle).supportsVision` ; sinon message clair et rien n'est joint. | `use-studio-request-context.tsx`, `StudioChatPanel.tsx` |
| 4 | Sélection du contexte | Bouton **Contexte** : liste des fichiers texte (jamais `.env*`, ni `node_modules`/`dist`/`.codebuddy`), un clic = inclus (contenu joint, « inutile de relire »), deux = exclu (« ne lis pas »), estimation en jetons par fichier et pour la demande (≈ 4 caractères/jeton), affichée aussi à côté d'Envoyer. | `main/studio/studio-context-service.ts`, `StudioContextPanel.tsx` |
| 5 | Secrets `.env` du projet | Onglet **Secrets** (nom + valeur masquée) ; valeurs rangées **hors du projet** (données de Cowork, un fichier 0600 par projet) ; le renderer ne reçoit que noms et longueurs ; injectées seulement dans le serveur de dev et les builds ; seuls leurs **noms** sont donnés au modèle. **Point de passage unique** : tout texte qui part vers le modèle est masqué par le processus principal, et rien ne part si le masquage échoue. `.env*` exclus des versions, du zip, de l'export du site ; export du site **refusé** (dossier supprimé) si une valeur se retrouve dans le site construit. | `main/studio/project-secrets-service.ts`, `studio-export-excludes.ts`, `NewShell.tsx` (`sendTurn`), `StudioSecretsPane.tsx` |

**Réserves des deux relectures, traitées** (commit `0666977ff`, par un sous-agent, puis vérifiées) : environnement des builds en liste blanche (plus de clés de l'hôte) et, pour le serveur de dev, clés de l'hôte retirées ; arbre de processus tué au délai dépassé ; `.env*` exclus des versions ; `changedSince` exige la racine de confiance, HOME et dossiers système refusés partout ; `revertPaths` compare des octets ; sonde sans attente de 3 s après un échec de chargement ; exclusions de l'export statique à tous les niveaux ; squelette de départ jamais semé si un de ses fichiers existe ; test de bout en bout de « Ouvrir dans le navigateur » et du Stop du chat.

**Défauts trouvés en pilotant la vraie fenêtre, corrigés** :
- Cowork lancé avec `NODE_ENV=production` le transmettait au **serveur de dev** : React servi en mode production (pas de source des éléments, pas d'avertissements). Retiré de l'environnement du serveur de dev (`0b6fd96ea`).
- La recherche par texte prenait le placeholder « Ajouter une nouvelle tâche… » pour le bouton « Ajouter » (`0b6fd96ea`).
- `_debugSource` annonçait la ligne 46 pour un bouton à la ligne 27 (décalage constant de 19 lignes, plugin React de Vite) : la ligne n'est prise que si la balise s'y trouve, sinon le fichier guide la recherche (`61dca3079`).
- Le panneau de contexte se faisait écraser par la liste des messages (`61dca3079`).

**Commits** : `62ab1a1b9` (réservation), `0666977ff` (réserves), `bcbee1616` (services), `88ea45717` (interface), `0b6fd96ea`, `61dca3079`, `6f59c4fb6`, `b49253185`, `cac42a8af` (localisation et consigne d'instance), `5881599fb` (tests Stop/navigateur), `8ad751b91` (garde d'export du site), `7b7d056b3` (contre-revue), rapport.

## 2. Preuves

- **Tests Vitest** (cowork) : balayage `studio preload ipc` + fichiers de la vague : **72 fichiers, 434 tests verts** sur la tête finale. `tsc --noEmit` : **0 erreur** à la racine et dans cowork. ESLint des fichiers touchés : 0 erreur.
- **Mutations** (ancienne logique remise, test rouge, logique rétablie) : sans masquage au point de passage → rouge ; cible ignorée → rouge ; zip sans exclusion `.env` → rouge ; console sans filtre d'origine → rouge ; journaux du serveur non masqués → rouge ; lecture d'un `.env` pour le contexte → rouge ; ancienne heuristique de localisation → rouge. Réserves : chaque correctif du sous-agent a son test rouge sur l'ancienne logique.
- **« Les secrets ne sortent jamais », test par test** (`tests/studio-secrets-never-leave.test.ts`, `studio-dev-server.test.ts`, `studio-view-request-context.test.tsx`) : **journal** (espions console/stdout/stderr : aucune valeur ; journaux du serveur de dev masqués), **prompt** (message réellement passé à `continueSession` masqué ; échec du masquage = rien n'est envoyé), **export** (vrai `archiver` avec les exclusions de Cowork : ni `.env`, ni `sous/.env.production` ; site construit contenant la valeur → refusé et supprimé), **version** (vrai git : aucun objet ne contient la valeur rangée ni celle d'un `.env.local`), **renderer** (onglet Secrets : la valeur n'est jamais dans le DOM).
- **Vraie fenêtre Electron** (Xvfb, HOME isolé, session en mode `default` — **aucun agent en `bypassPermissions`** —, fournisseur local volontairement injoignable) :

| Capture | Ce qu'elle montre |
|---|---|
| `10-console-navigateur-erreur.png` | App cassée : l'erreur `reading 'map'` de l'aperçu, pastille rouge sur « Console » |
| `11-console-jointe-serveur-de-dev.png` | Journaux du serveur de dev ; pastille « 2 ligne(s) — console du navigateur » jointe au chat |
| `12-onglet-secrets.png` | Secret saisi : nom et points seulement ; la valeur n'est ni dans le projet, ni dans les journaux (vérifié par `grep`) |
| `13-secret-injecte-et-masque.png` | L'app lit `import.meta.env.VITE_API_KEY` : la console affiche `[secret masqué]` (valeur bien injectée **et** masquée) |
| `14-selection-survol.png`, `15-selection-cible-fichier-lignes.png` | Mode Sélectionner : bouton surligné, puis pastille `<button> « Ajouter » — src/components/TodoForm.tsx:27-29` (lignes exactes) |
| `16-image-modele-sans-vision.png` | Image déposée avec `mistral-medium-latest` : message clair, rien n'est joint |
| `17-contexte-inclus-exclus-jetons.png` | 1 fichier inclus, 1 exclu, estimation en jetons |
| `18-demande-envoyee.png` + `18-prompt-envoye-electron.json` | Le message **réellement enregistré** par Cowork : cible (lignes 27-29 et leur code), fichier joint, exclusion, noms des secrets, et la clé tapée dans la demande remplacée par `[secret masqué]` |

## 2 bis. Contre-revue indépendante (DeepSeek v4.1 Flash, diff `d57fc9529..b49253185`)

Consigne : contester, défauts réels seulement, citation du diff à l'appui, finir par « ce que je ne peux pas savoir ». Chaque point a été vérifié dans le code avant d'agir.

| Point relevé | Verdict après vérification | Suite |
|---|---|---|
| Journaux du serveur de dev renvoyés **sans masquage** si le pid est inconnu du studio | **Vrai** (échec ouvert) | Échec fermé : aucun journal (`7b7d056b3`), testé |
| Export **zip** : `dist/` (bundle avec une variable `VITE_`) inclus, aucun contrôle de fuite | **Vrai** | `dist`, `build`, `out` exclus du zip ; refus si un fichier exporté contient une valeur en clair (`7b7d056b3`), testé |
| Valeur de moins de 4 caractères acceptée mais jamais masquée | **Vrai** | Refusée à la saisie, testé |
| `valuesFor` lit les `.env*` d'une racine fournie par le renderer, non validée | **Vrai** (oracle d'existence, aucune valeur renvoyée) | `.env*` lus seulement dans un espace de confiance, testé |
| Surveillance de la console jamais retirée ; marqueur « Effacer » non remis à zéro au changement de projet | Vrai, mineur | Corrigé |
| `devServerEnv` ne serait pas une liste blanche : façade ? | **Faux** : le cœur `app_server` fusionne `{ ...process.env, ...env }` et supprime les clés `undefined` (lu dans `src/tools/app-server-tool.ts`) | Aucune |
| Pièces jointes perdues si le masquage échoue ; PID réutilisé dans la fenêtre de grâce de `killProcessTree` | Vrais, mineurs | Non corrigés, notés |
| `VERSIONS_EXCLUDES` exclut-il `dist/` ? | Oui (`dist/`, `build/`) | Aucune |

## 3. Mesures : demande ciblée par sélection contre la même demande en texte libre

**Protocole.** Banc hors Electron (le lancement d'un agent en `bypassPermissions` est exclu) : `buddy -p` en `acceptEdits`, Mistral `mistral-medium-latest` par l'API (clé lue dans l'environnement, jamais affichée ni copiée), HOME isolé, `--ephemeral`, un seul tour, copie neuve de l'app par exécution. Prompts construits par les **vrais** modules (`buildIterationPrompt`, `buildContextBlock`) ; descripteur d'élément capturé par le **vrai** script de sélection dans Chromium (clic réel), localisé par le **vrai** `StudioContextService`. « Rendu correct » = observation indépendante dans Chromium : style calculé de l'élément visé changé comme demandé **et** les autres éléments du même type inchangés, aucune erreur de page. Scripts, prompts et résultats bruts conservés hors dépôt.

- Liste de tâches — « Rends ce bouton rouge (fond rouge, texte blanc) » / libre : « Rends le bouton « Ajouter » rouge (…) ».
- Tableau de bord — « Affiche cette valeur en vert » (valeur « Revenus » d'une carte `KpiCard` partagée par 4 cartes) / libre : « Affiche la valeur de la carte « Revenus » en vert ».

| Variante | n | Jetons d'entrée, médiane (min–max) | Sortie (méd.) | Durée méd. | Fichiers touchés | Build | **Rendu correct** |
|---|---|---|---|---|---|---|---|
| todo, texte libre | 5 | 31 346 (25 050–45 380) | 319 | 17,7 s | 1 (TodoForm) | 5/5 | **1/5** |
| todo, sélection | 5 | **15 049** (15 049–15 081) | 120 | **10,1 s** | 1 (TodoForm) | 5/5 | **5/5** |
| tableau, texte libre | 5 | 47 491 (38 468–104 575) | 601 | 20,3 s | 1 à 3 | 5/5 | **1/5** |
| tableau, sélection v0 (sans indication d'instance) | 3 | 15 036 | 115 | 12,3 s | 1 (KpiCard) | 3/3 | 0/3 — **les 4 valeurs** en vert |
| tableau, sélection v1 (« instance », 1 fichier) | 3 | 23 348 | 437 | 12,6 s | 1 | 3/3 | 0/3 — prop jamais activée |
| tableau, sélection v2 (prop + donnée) | 4 (+1 échec fournisseur) | 24 651 | 564 | 13,3 s | 2 | 4/4 | 0/4 — classe sans règle CSS, variable non déstructurée |
| tableau, sélection **v3 (livrée)** | 5 | **24 856** (24 610–33 619) | 607 | **13,3 s** | 2 (App, KpiCard) | 5/5 | **4/5** |

**Lecture.**
- **Élément local (todo)** : la sélection divise par deux les jetons d'entrée (−52 %), la sortie par 2,7, la durée de 43 %, et le rendu passe de 1/5 à 5/5. Les 4 échecs du texte libre : classes Tailwind (`bg-red-500`) dans un projet sans Tailwind — le fichier change, le rendu non. Avec le code réel des lignes sous les yeux, le modèle a écrit un style effectif 5 fois sur 5.
- **Instance d'un composant réutilisé (tableau)** : la sélection naïve (v0) cible le composant et colore **toutes** les cartes — elle est *pire* que le texte libre sur la justesse. L'indication d'instance a été itérée **sur ce même cas** (v1 → v3) : c'est un réglage sur le banc, pas une preuve de généralité. v3 : 4/5 contre 1/5 en texte libre, deux fois moins de jetons, 35 % plus rapide.
- Limites : un seul fournisseur et un seul modèle, n = 5, deux apps écrites pour le banc, un seul tour (dans Cowork, la sonde de l'aperçu et les corrections automatiques suivent le tour : l'erreur `isGreen is not defined` aurait été renvoyée au modèle). Le texte libre n'a pas reçu d'indication équivalente sur les classes CSS : une partie de l'écart tient au contenu du prompt, pas seulement à la sélection.

## 4. Écarts restants

1. **Import depuis GitHub, base de données locale, Stripe** (matrice 11 et 15) — non traités.
2. **Figma** et génération à partir d'une capture sans modèle multimodal.
3. **Sélection sur des pages non React/Vue** : la localisation retombe sur le texte, les attributs et les classes (pas de source exacte).
4. **Numéros de ligne `_debugSource`** : décalés par le plugin React de Vite dans le cas mesuré ; on s'en sert comme indice de fichier. La vraie cause du décalage n'est pas établie.
5. **Résumé des longues conversations** (idée bolt.diy) et `@fichier` dans le chat.
6. Affichage du prompt de génération complet dans la 1re bulle (reporté de la vague 1).

## 5. Ce que je n'ai pas pu vérifier

- **Un vrai tour d'agent dans la fenêtre Cowork.** Fournisseur volontairement injoignable ; le message envoyé est prouvé par sa relecture dans la base de Cowork, pas par une réponse de modèle.
- **L'image jusqu'au modèle.** Le refus (modèle sans vision) est vu en Electron ; l'envoi du bloc `image` à `continueSession` est prouvé en test ; qu'un fournisseur multimodal reçoive et exploite l'image dans Cowork n'est pas observé.
- **Le refus d'export du site dans Electron** : la boîte de dialogue native n'a pas été pilotée ; `guardSiteExport` est testé sur un vrai dossier.
- **Une variable `VITE_` est publique par nature** : Vite l'écrit dans les modules servis au navigateur. Un outil navigateur de l'agent (`web_test`) qui lit la page ou le code servi peut donc la voir. Les secrets sans préfixe `VITE_` restent côté serveur. Non corrigé : c'est le modèle de Vite ; l'onglet Secrets le dit.
- **Accès de l'agent aux données de Cowork** : les secrets sont hors du projet ; que l'agent ne puisse pas lire ce dossier dépend de son confinement, que je n'ai pas testé.
- **Un blocage du processus principal (≈ 1 400 % de CPU, 12 fils)** lors de la 1re session Electron, après un clic automatisé sur un bouton « Close » (qui a lancé `showItemInFolder`/`xdg-open`). Non reproduit en deux relances avec les mêmes étapes sans ce clic, CPU à 0 % à chaque étape. **Cause non établie** ; processus arrêtés par PID.
- **Windows et macOS** non exécutés (`taskkill`, chemins `C:\`, `npm.cmd`).
- **La suite complète** de la racine et de cowork n'a pas été rejouée : seulement les balayages ciblés ci-dessus.
- Le binaire Electron et `dist/` du cœur sont ceux d'un autre worktree / du clone principal, **en lecture** (lien symbolique `dist` non versionné) ; le cœur `src/` n'a pas changé depuis la vague 1.
