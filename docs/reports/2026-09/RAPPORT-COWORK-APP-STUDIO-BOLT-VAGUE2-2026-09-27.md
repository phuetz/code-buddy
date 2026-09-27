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

**Réserves des deux relectures, traitées** (commit `0666977ff`, par un sous-agent, puis vérifiées) : environnement des builds en liste blanche (plus de clés de l'hôte) et, pour le serveur de dev, clés de l'hôte au nom de secret retirées (liste noire : **insuffisant**, remplacé par une liste blanche au § 6) ; arbre de processus tué au délai dépassé ; `.env*` exclus des versions ; `changedSince` exige la racine de confiance, HOME et dossiers système refusés partout ; `revertPaths` compare des octets ; sonde sans attente de 3 s après un échec de chargement ; exclusions de l'export statique à tous les niveaux ; squelette de départ jamais semé si un de ses fichiers existe ; test de bout en bout de « Ouvrir dans le navigateur » et du Stop du chat.

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
- Le binaire Electron et `dist/` du cœur sont ceux d'un autre worktree / du clone principal, **en lecture** (lien symbolique `dist` — **versionné par erreur** dans `0b6fd96ea`, retiré par `a508f43d4`, voir § 6) ; le cœur `src/` n'a pas changé depuis la vague 1.

## 6. Corrections après relectures (27/09, après-midi)

Deux relectures indépendantes de la tête `cfb381c03` (DeepSeek, puis AGY en contre-revue) concluaient **À REPRENDRE**. Chaque point a été vérifié dans le code avant d'agir ; chaque correctif a un test qui **échoue sur l'ancienne logique** (source de `cfb381c03` remise, test rouge, source rétablie).

| Point relevé | Verdict | Correctif | Preuve |
|---|---|---|---|
| **Bloquant 1** — lien symbolique `dist` versionné (mode `120000`, cible hors dépôt), ajouté par erreur dans `0b6fd96ea` ; le rapport le disait « non versionné » | **Vrai.** Mon affirmation était fausse | `git rm --cached dist`, `/dist` ajouté au `.gitignore` (`dist/` ne couvre pas un lien) (`a508f43d4`) | `git ls-tree HEAD dist` vide |
| **Bloquant 2** — `CommandRunner` (`npm install` automatique et terminal) lancé avec le `process.env` complet de Cowork : un `postinstall` voyait les clés d'API de l'hôte | **Vrai**, manqué par la 1re relecture et par moi | Environnement en liste blanche + secrets du projet, fourni par le processus principal seulement (celui du renderer est ignoré) ; dossier de confiance exigé (`a508f43d4`) | `command-runner.test.ts` : vrai `spawn` qui imprime son environnement, clé de l'hôte absente ; IPC : dossier hors confiance refusé, `env` du renderer écarté — 2 rouges sur l'ancienne logique |
| Serveur de dev en liste **noire** de noms (`DATABASE_URL`, `*_DSN` de l'hôte passaient) ; `studio.dev.start` sans dossier de confiance | Vrai ; le rapport disait à tort « clés de l'hôte retirées » | Liste blanche (toute clé hors liste marquée `undefined`, retirée par `app_server`), dossier de confiance exigé (`a508f43d4`) | `studio-dev-server.test.ts` — 2 rouges sur l'ancienne logique |
| `.env` de sous-dossiers (`apps/web/.env.local`) jamais masqués ni cherchés à l'export | Vrai | Tous les `.env*` du projet (profondeur 6, 50 fichiers, hors dépendances et sorties) (`ec47c2103`) | `studio-secrets-never-leave.test.ts` — rouge sur l'ancienne logique |
| `findLeaks` sautait les liens symboliques | Vrai | Lien vers un fichier lu à travers ; lien vers un dossier non parcouru (pas de boucle) | même test |
| Zip : médias `.codebuddy/media-generation` réinclus mais non fouillés | Vrai (très faible) | Fouillés aussi | même test |
| Demande de **génération initiale** (et son titre) et vérification `web_test` hors du point de passage du masquage | Vrai | Masquées aussi ; si le masquage échoue, rien ne part. Dossier cible pas encore créé : aucun secret possible, le texte part tel quel | `studio-view-request-context.test.tsx` (vrai `StudioView`, vrai service) — rouge sur l'ancienne logique |
| Relais console : message **brut** si le projet est inconnu | Vrai (non atteignable par l'UI) | Échec fermé | `studio-preview-bridge.test.ts` — rouge |
| Contexte : fichier atteint par un **dossier** lien symbolique sortant | Vrai (faible) | Chemin réel exigé dans le projet | `studio-context-and-locate.test.ts` — rouge |
| Pièces jointes perdues quand l'envoi est annulé | Vrai (mineur, relevé par la contre-revue DeepSeek du matin) | Vidées seulement si la demande est partie | test de câblage |
| « Point de passage unique côté renderer, non imposé par le processus principal » | Vrai **en principe** | Non corrigé : le processus d'agent reçoit ses messages du renderer par l'IPC de session, que je n'ai pas modifié. Les trois chemins d'envoi d'App Studio (itération, génération, vérification) passent désormais tous par le masquage | — |
| `studio.files.*` sans dossier de confiance (antérieur à la vague 1) | Vrai | Non traité (hors vague) ; `safeJoin` empêche déjà de sortir du dossier donné | — |
| Tableau de coordination incomplet | Vrai | Mis à jour | — |

### Pic de CPU (1 400 %) : tentative de reproduction

Hypothèses de la contre-revue : un flux de journaux relayé sans limite, ou `xdg-open` sous Xvfb. Protocole : vraie fenêtre Electron sous Xvfb (HOME isolé, session en mode `default`, fournisseur injoignable), app de test qui journalise ~20 000 messages/s dans l'aperçu, onglet Console ouvert, CPU échantillonné toutes les 5 s pendant 30 s.

| Mesure | Processus principal | Renderer de Cowork |
|---|---|---|
| Relais de `cfb381c03` (sans limite) | 100 à 120 % | **figé** : plus aucune réponse CDP, capture impossible |
| Plafond 50 messages/s + regroupement dans le renderer (tête) | 27 à 120 % | réactif (300 lignes affichées) |
| Témoins, même flux : aperçu masqué / affiché avec relais / affiché **sans** surveillance | 0 % / 66 % / 34 % | — |
| `showItemInFolder` → `xdg-open` sous Xvfb | 0 % pendant 40 s (`xdg-open` reste en attente, sans CPU) | — |

Lecture.
- Le relais sans limite était un **vrai défaut** : il figeait l'interface.
- Il est maintenant borné à trois niveaux :
  - 50 messages/s au plus, les messages en trop comptés et signalés en une ligne ;
  - au-delà de 500 messages ignorés dans la seconde, désabonnement pendant 3 s ;
  - côté renderer, un seul rendu par tranche de 150 ms.
  Les valeurs à masquer sont gardées 2 s au lieu de relire le projet à chaque message.
- Le coût qui reste dans le processus principal (~35 %, mesuré même sans surveillance) vient de Chromium, qui reçoit la console de la frame.
- **Aucune des deux hypothèses ne reproduit 1 400 %** : le flux plafonne vers 1,6 cœur au total, et `xdg-open` ne consomme rien. La cause du pic du matin reste **non établie**.

### État après corrections

- Têtes : `a508f43d4`, `ec47c2103`, `59183da72`, puis le rapport.
- Balayage Vitest (studio, preload, ipc, command-runner et fichiers de la vague) : **73 fichiers, 448 tests verts**.
- `tsc --noEmit` : 0 erreur à la racine et dans cowork.
- Balayage des données personnelles du diff : vide.
