# Rapport Cowork — phases 5 et 6

Date : 13 août 2026  
Branche : `feat/cowork-phases-5-6`  
Base : `origin/main` (`f9a31a7e`)  
État : implémentation et gates automatisées terminées, aucun push effectué. La validation visuelle Electron reste volontairement humaine.

## Phase 5 — Canaux et appairage DM

### Livraison

- Le panneau Canaux n'est plus limité à l'état d'exécution : il permet d'ajouter, modifier, activer, désactiver et supprimer un canal.
- Les formulaires sont produits depuis un schéma partagé du noyau couvrant les 24 types de canaux concrets. Les champs, listes, booléens, bornes numériques, URL, prérequis et secrets sont propres à chaque adaptateur.
- Le bridge Electron suit le patron vérifié `bridge + IPC + panneau` : chargement du noyau en processus avec `loadCoreModule`, handlers `never-throw`, namespace preload, flag Zustand, montage dans `App.tsx` et accès depuis Labs/navigation. Aucun appel HTTP n'a été ajouté.
- Les champs non secrets sont validés puis écrits atomiquement en mode `0600` dans `channels.json`. Les clés inconnues du fichier restent préservées et un JSON invalide n'est jamais écrasé.
- Les secrets sont en écriture seule dans le renderer. Seule leur présence traverse l'IPC ; les valeurs résident dans le coffre `CredentialManager` chiffré AES-256-GCM (`credentials.enc`, mode `0600`) sous des clés nommées par canal et champ.
- Le chargement du noyau sait résoudre les secrets nommés en donnant priorité au coffre ; le premier enregistrement ou effacement depuis Cowork purge le littéral legacy correspondant de `channels.json`, ce qui rend les rotations effectives. Les adaptateurs IRC, Feishu et Synology ainsi que les options Slack, Nostr, Mattermost, Nextcloud et IRC sont couverts.
- L'onglet Appairage DM expose l'état, les demandes en attente, l'allowlist persistée, l'approbation par code, l'ajout direct et la révocation. La révocation exige une confirmation utilisateur.

### Commit

- `17de40a2 feat(cowork): compléter les canaux et l’appairage DM`

### Couverture dédiée

- Noyau : exhaustivité du catalogue, normalisation/validation, prérequis avant activation, clés de coffre distinctes, compatibilité des tokens et instanciation des adaptateurs.
- IPC : catalogue et configuration, persistance non secrète, refus des configurations incomplètes, absence de fuite des secrets, suppression, entrées secondaires, erreurs `never-throw`, liste/approbation/révocation DM.
- Renderer : formulaire dérivé du schéma, saisie masquée des secrets et confirmation obligatoire avant révocation.

## Phase 6 — Modèle par type de tâche

### Livraison noyau

- Nouvelle section TOML `[task_models]` pour `architect`, `edit`, `review`, `research` et `chat`.
- Compatibilité non intrusive : `[model_pairs]` reste lu et affiché sans être réécrit ni supprimé, mais demeure inactif dans le chat principal comme au merge-base. Seul l'opt-in programmatique historique `setModelPairs(...)` active ces paires.
- Une entrée `[task_models]` absente retombe sur le modèle par défaut ; une carte entièrement absente est un no-op strict, y compris lorsqu'un ancien `[model_pairs]` existe.
- La persistance remplace uniquement la section `[task_models]`, conserve les autres octets/sections TOML, écrit atomiquement en mode `0600` et refuse un modèle dont le provider n'est pas actif.
- `ModelRoutingFacade` classe les cinq types, relit la configuration active à chaque tour et respecte la priorité `/switch` → carte explicite par tâche → paire explicitement activée par API → routage automatique/modèle par défaut.
- Le vrai point d'entrée de tour de `CodeBuddyAgent` consomme cette décision, même quand le routage automatique par complexité est désactivé, puis restaure le modèle initial après le tour.

### Commit noyau

- `80202648 feat(routage): choisir le modèle par type de tâche`

### Livraison Cowork

- Nouveau namespace IPC `taskModels.get/save`, chargé en processus depuis le noyau et intégralement `never-throw`.
- Nouveau panneau « Modèles par type de tâche » : cinq sélecteurs limités aux modèles actifs, affichage du repli effectif (défaut ou `model_pairs`), signalement des modèles devenus indisponibles et sauvegarde à chaud.
- Accès depuis Labs, le centre de commande avancé, la navigation classique et la palette de commandes.

### Commit Cowork

- `cd194db9 feat(cowork): régler les modèles par type de tâche`

### Couverture dédiée

- TOML : round-trip simultané de `model_pairs` et `task_models`, remplacement ciblé de section et conservation des sections adjacentes.
- Routage : no-op sans carte même en présence d'un `[model_pairs]` historique, priorité des nouvelles entrées, opt-in programmatique des paires, configuration relue à chaud, priorité de `/switch`, classification des cinq tâches et consommation au point d'entrée réel de l'agent.
- Cowork : chargement/sauvegarde IPC, erreur propre sur provider inactif, affichage des replis, sélection d'un modèle actif, sauvegarde et fermeture par le flag de store.

## Blocs de fiabilisation

- `e880cecf fix(cowork): fiabiliser le typecheck du noyau partagé` : aligne le contrôle des variables inutilisées sur le `tsconfig` racine (la règle reste portée par ESLint), retire cinq suppressions TypeScript devenues inutiles et normalise une erreur `Worker` typée `unknown`.
- `e8146294 test(cowork): aligner les contrats des services partagés` : remet deux assertions historiques en phase avec le diagnostic IPC coût et l'objectif RMS TTS déjà en vigueur. La suite Cowork complète passe ensuite.

## Gates finaux

Les gates ont été exécutés dans l'ordre imposé, après le dernier changement de code :

1. `npm run typecheck` à la racine — **OK**, 0 erreur.
2. `cd cowork && npx tsc --noEmit` — **OK**, 0 erreur.
3. `cd cowork && npx vitest run` — **OK**, 527 fichiers / 2 941 tests réussis ; 9 fichiers / 12 tests explicitement ignorés.
4. `cd cowork && npx vite build` — **OK** ; bundles renderer, main Electron et preload produits. Vite signale seulement ses avertissements non bloquants de taille de chunks et d'imports statiques/dynamiques mixtes.
5. Tests racine ciblés — **OK**, 6 fichiers / 156 tests :

   ```bash
   npm test -- \
     tests/channels/channel-config-schema.test.ts \
     tests/channels/resolve-channel-secret.test.ts \
     tests/config/task-models.test.ts \
     tests/toml-config.test.ts \
     tests/agent/facades/task-model-routing.test.ts \
     tests/agent/codebuddy-agent.test.ts
   ```

Les dépendances racine et Cowork ont été installées/vérifiées avec leurs scripts habituels, y compris le rebuild Electron de `better-sqlite3`. Aucun lockfile n'a été modifié.

## Validation visuelle Electron — guide humain

### Préparer et lancer sous Linux

Depuis la racine du dépôt :

```bash
npm install
(cd cowork && npm install)
npx tsc -p .
(cd cowork && npx vite build)

cd cowork
DISPLAY=:0 NODE_ENV=production \
  ./node_modules/electron/dist/electron \
  --no-sandbox --disable-gpu \
  ./dist-electron/main/index.js
```

Adapter `DISPLAY` à la session (`:10.0` est courant sous xrdp). Vérifier au démarrage que le journal contient `Using Code Buddy engine (embedded)` ; sinon reconstruire le noyau avec `npx tsc -p .` depuis la racine.

### Scénario canaux

1. Ouvrir **Labs**, puis **Canaux et appairage DM**. Vérifier les trois onglets État, Configuration et Appairage.
2. Dans Configuration, ajouter Telegram sans l'activer. Ouvrir son formulaire : les champs doivent être propres à Telegram et le token doit être masqué.
3. Tenter l'activation sans token : l'interface doit afficher l'erreur de validation et laisser le canal désactivé.
4. Enregistrer un token de test, recharger le panneau et confirmer que seule la mention « secret stored » revient, jamais sa valeur. Vérifier que `~/.codebuddy/channels.json` ne contient aucun token en clair.
5. Renseigner une option non secrète et les allowlists, sauvegarder, fermer puis rouvrir le panneau et vérifier leur persistance.
6. Ajouter Matrix pour contrôler un second formulaire (homeserver, user ID, access token, chiffrement), puis vérifier qu'un homeserver ou user ID manquant bloque l'activation.
7. Désactiver puis supprimer un canal. La suppression doit demander confirmation et retirer aussi ses secrets stockés.

### Scénario appairage DM

1. Dans Appairage, ajouter directement un identifiant expéditeur à un type de canal ; il doit apparaître dans l'allowlist avec sa date et sa provenance.
2. Si une demande en attente existe dans ce processus, l'approuver par son code et vérifier son déplacement vers les autorisations. Une liste vide est normale lorsque la réception du canal tourne dans un autre processus, car les demandes en attente sont en mémoire.
3. Cliquer sur Révoquer, annuler la confirmation et vérifier que l'entrée reste présente.
4. Recommencer, confirmer, puis vérifier que l'entrée disparaît et reste absente après réouverture du panneau.

### Scénario modèles par tâche

1. Depuis Labs, ouvrir **Modèles par type de tâche**. Vérifier les cinq lignes et que chaque liste ne propose que les modèles de providers actifs.
2. Avec un ancien `[model_pairs]`, vérifier les mentions legacy inactives pour Architecture et Editing sans modifier le fichier ni le routage du chat.
3. Choisir des modèles explicites pour Review et Research, sauvegarder, fermer puis rouvrir le panneau.
4. Vérifier dans `~/.codebuddy/config.toml` que `[task_models]` contient les choix et que `[model_pairs]` ainsi que les autres sections sont intactes.
5. Lancer de nouveaux tours représentatifs (revue de code, recherche, édition) et contrôler dans les journaux/indicateurs de modèle que le modèle attendu est sélectionné, puis que le modèle de session est restauré après chaque tour.
6. Effacer une association, sauvegarder et vérifier que cette tâche affiche et utilise de nouveau le modèle par défaut.
7. Ouvrir DevTools avec `Ctrl+Shift+I` et confirmer l'absence d'erreur renderer ou IPC pendant tout le parcours.

## Inventaire des blocs

1. Canaux éditables et appairage DM (`17de40a2`).
2. Routage noyau par type de tâche (`80202648`).
3. Réglage Cowork des modèles par tâche (`cd194db9`).
4. Fiabilisation du typecheck partagé (`e880cecf`).
5. Alignement des contrats de tests Cowork (`e8146294`).
6. Rapport et guide de recette (présent commit documentaire).

COWORK56 TERMINEE 6 blocs
