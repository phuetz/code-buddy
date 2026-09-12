# Réparation Appbuilder B4 — Astra — 2026-09-12

B4 est fermé : le clic natif sur la croix Historique ferme maintenant le tiroir, sans changer ses coordonnées. La protection porte sur toute la surface superposée. Échap ferme également le tiroir ; `Shift+Tab` puis `Entrée` conserve son comportement. Pendant un renommage, le premier Échap annule seulement la saisie.

Clone : `<clone>`. Branche `astra/appbuilder-b4-2026-09-12`, déjà préparée sur `integration/appbuilder-2026-09-12` / `695f57b6c` à l'arrivée. Correctif : **`7f663e364`**. Rapport et captures : `b16e271b3` ; journaux et compléments de passation : commit portant cette version du rapport. Aucun `npm install`, aucun push, aucune suite complète. Les cinq fichiers gelés de B1/B2/B3 sont intacts. Les suppressions et captures antérieures présentes à l'arrivée ne sont pas intégrées aux commits.

## Cause confirmée avant correction

Fenêtre Electron de 1400×900 dans Xvfb 1600×1000, origine écran (100,50).

| Mesure | Résultat avant correction |
|---|---|
| Barre `Titlebar.tsx` / `globals.css` | Rectangle (0,0,1400,40), `-webkit-app-region: drag` |
| Croix Fermer | Rectangle (283,10,24,24), donc entièrement dans les 40 px de titre |
| Clic X11 | Pointeur écran (395,72), soit centre client (295,22) |
| Hit-test DOM | SVG de cette croix, puis son bouton ; aucun élément au-dessus ne recouvre la cible |
| Région du tiroir et de ses ancêtres superposés | `none`, aucune exclusion native `no-drag` |
| Événement reçu au capture listener du document | **0** ; tiroir toujours ouvert |
| Clic dans la recherche | Rectangle (8,53,303,30), événement natif `isTrusted=true` reçu à (160,68) |
| Échap | Le tiroir reste ouvert |
| Shift+Tab → Entrée | Focus « Fermer », puis tiroir fermé |

Les captures [avant le clic perdu](captures-appbuilder-b4/04-baseline-close-before.png), [après ce clic](captures-appbuilder-b4/04-baseline-close-after.png), [clic plus bas](captures-appbuilder-b4/05-baseline-search-before.png) et [fermeture clavier](captures-appbuilder-b4/08-baseline-keyboard-closed.png) accompagnent les [mesures](captures-appbuilder-b4/native-diagnosis.json). La barre reste présente sous la modale dans le hit-test. Le `z-index` du tiroir suffit pour le DOM mais ne neutralise pas la région native Electron. Le callback fonctionnait déjà.

## Correction

- `globals.css` applique les deux propriétés `-webkit-app-region: no-drag` et `app-region: no-drag` aux couches `.fixed:not(.pointer-events-none)`, en plus de `.titlebar-no-drag`. Tous les futurs contrôles de ces surfaces sont protégés, quelle que soit leur position. Les infobulles transparentes aux événements ne creusent pas de trou dans la région de déplacement.
- `ConversationHistoryDrawer.tsx` conserve la croix et son callback, expose le rôle de dialogue et traite Échap depuis le contenu focalisé. L'annulation du renommage arrête la propagation pour ne pas fermer le tiroir en même temps.
- `conversation-history-drag-region.test.tsx` rend le vrai composant et confronte son DOM aux sélecteurs/propriétés du vrai CSS. Un clic DOM seul ne prétend pas vérifier Electron. Les tests couvrent également un futur contrôle de couche fixe, la barre draggable, les exclusions existantes, les infobulles, la fermeture et le renommage.

Le périmètre global `.fixed` est volontaire : le balayage trouve la même structure dans les panneaux droits, fonds de modales, menus flottants et pages superposées. La seule déclaration `titlebar-drag` du renderer appartient à `Titlebar.tsx`, qui n'est pas une couche fixe.

## Balayage de la bande haute

Recherche `rg` de `fixed`, `top-0`, `inset-0`, `inset-y-0`, `position`, `createPortal` et `app-region`, complétée par le graphe et la lecture des composants. L'[inventaire source avec lignes](captures-appbuilder-b4/source-sweep.txt) conserve les déclarations repérées.

**79 points natifs mesurés après correction : 49 autres boutons, les deux boutons Historique (croix et fond), 28 surfaces de fond. Tous reçoivent le clic.** Le comptage final de 49 exclut les fonds et les deux boutons Historique.

Méthode du balayage : ouverture des vrais composants de l'application via leurs flags de store ; mesure des boutons visibles qui intersectent `0 ≤ y < 40` ; contrôle de `elementFromPoint` ; déplacement et clic `xdotool`. Un listener en capture consigne `isTrusted`, puis arrête le clic **pour éviter d'exécuter les actions** (démarrage serveur, inférence, fermeture de l'application, etc.). Ce balayage prouve la réception native ; la séquence Historique ci-dessous exécute réellement les callbacks sans ce listener. Les points des boutons qui chevauchent y=40 restent dans la bande haute. Les fonds sont testés à (300,20), ou dans le bouton de fond Historique.

Avant correction, les boutons droits ci-dessous répondaient déjà. Ils se superposent souvent aux exclusions des contrôles de fenêtre sous-jacents ; contrairement à la croix Historique à x=295, ces emplacements étaient donc cliquables. La correction leur donne une exclusion propre à toute leur surface, indépendante des contrôles situés dessous.

| Surface | Contrôles dans la bande y < 40 | Avant → après |
|---|---|---|
| titlebar | New tab ; Model: openrouter/free ; No face enrolled — click to enroll yours ; Code Buddy core engine active (middlewares + sanitizer) ; Clipboard summariser ; Voice chat overlay ; Start Code Buddy server ; Show documentation ; Show keyboard shortcuts ; Notifications ; Minimize ; Maximize ; Close Code Buddy Studio | reçus → reçus |
| showConversationHistory | Fermer l'historique ; Fermer | avalés → reçus |
| showMemoryEditor | Close | reçus → reçus |
| showActivityFeed | All ; Fleet ; Scheduled ; Clear activity log ; Close | reçus → reçus |
| showFileActivity | Close | reçus → reçus |
| showSessionInsights | Close | reçus → reçus |
| showBookmarksPanel | Close | reçus → reçus |
| showTestRunner | Refresh ; Close | reçus → reçus |
| showLiveLauncher | Close | reçus → reçus |
| showFleetPanel | Close fleet panel | reçus → reçus |
| showSkillsManager | Refresh ; Close | reçus → reçus |
| showLessonCandidatePanel | Refresh ; Close lesson candidate panel | reçus → reçus |
| showUserModelPanel | Infer working-preference observations from the current session (proposes pending only) ; Refresh ; Close user model panel | reçus → reçus |
| showSpecPanel | Refresh ; Close spec panel | reçus → reçus |
| showMobileSupervisionPanel | Refresh ; Close | reçus → reçus |
| showIdentityPanel | Refresh ; Close | reçus → reçus |
| showDevicePanel | Refresh ; Close | reçus → reçus |
| showChannelsPanel | Close | reçus → reçus |
| showCompanionPanel | Refresh companion panel ; Close companion panel | reçus → reçus |
| file-preview | Copy ; Close | reçus → reçus (contre-épreuve CSS initial) |
| artifact | Copy ; Download ; Close | reçus → reçus (contre-épreuve CSS initial) |

Les **28 fonds** mesurés sont ceux de FleetPanel, LessonCandidatePanel, UserModelPanel, SpecPanel, MobileSupervisionPanel, IdentityPanel, DevicePanel, ChannelsPanel, CompanionPanel, FocusView, NotificationCenter, HelpDocs, CommandPalette, KeyboardShortcutsDialog, GlobalSearchDialog, SnippetsLibrary, PersonaSwitcherDialog, SessionResumeDialog, ModelInstallDialog, OrchestratorLauncher, EvolutionPanel, KnowledgePanel, SciencePanel, ClawMigrationDialog, KanbanPanel, MissionBoardPanel, DesktopSnapshotPanel et de l'hôte WorkflowProPanel. Tous passent d'une interception native à un événement reçu ; cela ne leur invente pas une action de fermeture lorsqu'ils n'en ont pas.

Pour les 11 premiers fonds et les boutons des panneaux, le témoin est l'application construite avant modification ([baseline](captures-appbuilder-b4/baseline-sweep.json)). Le crash Fleet a interrompu ce premier passage. Les 17 fonds restants et les aperçus fichier/artefact ont été complétés dans l'application reconstruite en neutralisant **temporairement et seulement** la nouvelle exclusion CSS par `app-region: initial` ; les couches calculées redeviennent `none` ([contre-épreuve complémentaire](captures-appbuilder-b4/counterfactual-extra-sweep.json)). Cette contre-épreuve est distinguée d'un lancement de la base. La surcharge est retirée à la fin. [Passage corrigé principal](captures-appbuilder-b4/fixed-sweep.json), [aperçus corrigés](captures-appbuilder-b4/fixed-extra-sweep.json).

Autres surfaces trouvées et état de leur protection :

| Composants / contrôles | Constat |
|---|---|
| TabBar : onglets, croix d'onglet, nouveau, menu contextuel | Ancêtre explicite `titlebar-no-drag` ; menu fixe également protégé désormais. Le bouton nouveau est inclus dans le passage natif. |
| HealthBadge et indicateur backend distant, conditionnels | Ancêtres `titlebar-no-drag` dans Titlebar ; pas visibles dans le profil de preuve, protection vérifiée dans le code. |
| ModelSwitcher, HealthPopup | Menus `top-full`, sous leur déclencheur, dans un ancêtre `no-drag`. |
| FocusView | Contenu `inset-6` et en-tête rembourré : pas de bouton dans les 40 px dans le scénario mesuré. Fond reçu après correction. |
| NotificationCenter | Contenu `top-14` : fermeture et marquage sous y=56, hors bande. Fond reçu après correction. |
| HelpDocs, KeyboardShortcutsDialog, SessionResumeDialog, SciencePanel, hôte WorkflowProPanel, EvolutionPanel, KnowledgePanel, ClawMigrationDialog, KanbanPanel, MissionBoardPanel, DesktopSnapshotPanel | Panneaux centrés ; aucun bouton dans la bande lors du passage natif. Fonds mesurés ci-dessus. |
| CommandPalette, GlobalSearchDialog, PersonaSwitcherDialog, SnippetsLibrary, ClipboardSummaryPanel, RunnerDetailsDialog, BtwQuickAsk | Contenu décalé par `pt-24`, `pt-[12vh]` ou `pt-32`. Les contrôles sont sous la bande ; les couches fixes sont maintenant exclues du drag. |
| SessionPruneDialog, CompactStrategyDialog, HooksDryRunDialog, ServerDashboard, ForkFromMessageButton, WatchedFilesPanel, SudoPasswordDialog, VoiceChatOverlay, ExportShareableDialog, ExportDialog, PermissionDialog, DiagnosticsPanel, EnrollmentDialog, ProjectSelector (deux modales), BranchSwitcher, KnowledgeBaseBrowser, SubAgentDashboard, BatchExecutionDialog, LessonsVaultGraph, ShareLinkDialog, PRComposer, SandboxSetupDialog, ModelInstallDialog, OrchestratorLauncher, ApprovalDialog, ConfigModal, OnboardingWizard, OnboardingTour, CommitComposer, SettingsSkills (dialogue), DesignSystemGallery | Inspection structurelle : modales centrées dans une couche fixe. Aucun en-tête explicitement ancré à y=0. La règle commune les exclut entièrement du drag, même si leur contenu ou une petite fenêtre les rapproche du haut. Pas de revendication de clic réel pour chaque variante conditionnelle. `showLessonsGraph` n'a pas monté de couche dans ce profil. |
| ReasoningTraceViewer, AutonomyPanel, TeamPanel, Settings, StudioVersionsPane, vues NewShell | Contenu dans le layout sous Titlebar, ou dans un conteneur interne ; les `top-0` locaux ne désignent pas le haut de la fenêtre. Aucun fichier gelé modifié. |
| ComputerUseOverlay, BrowserOperatorOverlay | Ancrés en bas de fenêtre ; couche fixe protégée également. |
| Tooltip / RichTooltip | Fixes et `pointer-events-none` : non cliquables par conception et expressément exclus de la nouvelle règle. |
| FleetCommandCenter : rafraîchir / fermer | En-tête à la limite haute (`p-4`/`lg:p-6` et `py-3`) ; couche fixe couverte par le CSS. **Clic natif non certifié pour ce panneau** : ouvrir son flag provoque un crash main V8 avant et après correction. Exclu du compte de 49. |

## Preuve écran obligatoire, sans interception des callbacks

Lancement depuis `<clone>/cowork` :

```sh
timeout 900 xvfb-run -a -s "-screen 0 1600x1000x24" env NODE_ENV=production \
  ./node_modules/electron/dist/electron --no-sandbox --disable-gpu ./dist-electron/main/index.js
```

Le harnais ajoute un profil, les répertoires de configuration/cache et `TMPDIR` isolés **dans le clone**, un fichier Xauthority et `--remote-debugging-port=9337` pour lire les rectangles, le focus et la présence du tiroir. Les actions sont `xdotool click/key`, jamais `HTMLElement.click()` ni un clic CDP. Un `TMPDIR` absolu long a fait échouer le premier démarrage (132) ; le chemin relatif `../_qa/b4/tmp` a permis le démarrage suivant. Aucune écriture de travail dans un répertoire temporaire partagé.

Chaque clic de la séquence finale est précédé d'un déplacement du pointeur, d'une capture **`import -window root`**, et d'un relevé `xdotool getmouselocation --shell`. Comme `import` n'inclut pas le curseur X11, une seconde capture brute `ffmpeg -f x11grab -draw_mouse 1` le montre explicitement ; aucune image n'est retouchée.

| Étape | Capture / résultat |
|---|---|
| Ouvrir Historique à la souris | [Pointeur sur History avant clic](captures-appbuilder-b4/20-final-open-history-before-cursor.png), [tiroir ouvert](captures-appbuilder-b4/20-final-open-history-after.png) |
| Cliquer Fermer | [Pointeur sur la croix avant clic](captures-appbuilder-b4/21-final-mouse-close-before-cursor.png), [capture import avant clic](captures-appbuilder-b4/21-final-mouse-close-before.png), **[tiroir fermé](captures-appbuilder-b4/21-final-mouse-close-after.png)** |
| Réouvrir puis Échap | [Avant clic d'ouverture](captures-appbuilder-b4/22-final-reopen-escape-before-cursor.png), [ouvert](captures-appbuilder-b4/22-final-reopen-escape-after.png), **[fermé par Échap](captures-appbuilder-b4/23-final-escape-closed.png)** |
| Réouvrir puis Shift+Tab + Entrée | [Avant clic d'ouverture](captures-appbuilder-b4/24-final-reopen-keyboard-before-cursor.png), [ouvert](captures-appbuilder-b4/24-final-reopen-keyboard-after.png), [focus sur Fermer](captures-appbuilder-b4/25-final-close-focused.png), **[fermé par Entrée](captures-appbuilder-b4/26-final-keyboard-closed.png)** |

Les [assertions et coordonnées](captures-appbuilder-b4/actions.jsonl) confirment l'absence du tiroir après chaque fermeture et le focus « Fermer » avant Entrée. La croix reste exactement (283,10,24,24) avant/après. L'application finale a reçu **SIGTERM** et le lanceur est sorti **0** ; les instances ayant planté sont sorties 132/139, aucune laissée en marche.

## Témoin et portes de qualité

Le test final a été exécuté avec **les deux fichiers de production repris à `695f57b6c`**, sauvegarde/restauration bornée en `try/finally`, puis avec le correctif restauré. Aucun fichier d'autre lane concerné.

| Commande | Résultat |
|---|---|
| `cd cowork` puis `timeout 900 npx vitest run tests/conversation-history-drag-region.test.tsx`, fichiers de base | **3 échecs / 8** : exclusion réelle Historique, futur contrôle fixe, Échap. [Journal brut](captures-appbuilder-b4/witness-before.txt) |
| `cd cowork` puis `timeout 900 npx vitest run tests/conversation-history-drag-region.test.tsx src/renderer/components/conversation-history-model.test.ts` | **10/10 verts**, dont témoin **0/8**, code **0**. [Résultat](captures-appbuilder-b4/final-tests.txt) |
| `timeout 900 npm run typecheck`, racine | **0**, y compris gpuNode-identity et companion-core |
| `timeout 900 npm run lint`, racine | **0** ; 0 erreur, 2497 avertissements, aucune règle modifiée. [Journal brut](captures-appbuilder-b4/lint.txt) |
| `cd cowork` puis `timeout 900 npx vite build` | **0**, renderer et bundles Electron produits. Avertissements de chunks/imports conservés. [Journal brut](captures-appbuilder-b4/vite-build.txt) |
| ESLint Cowork sur le composant et le test touchés | **0**, sortie vide. [Résultat](captures-appbuilder-b4/cowork-lint.txt) |
| `git diff --check` | **0** |

Contrôle supplémentaire, **non vert et hors portes demandées** : `cd cowork && timeout 900 npx tsc --noEmit` sort **2** avec 20 erreurs (`export type` dans os-sandbox et typages adm-zip dans les outils document/archive). Rejoué sur la base : mêmes 20 erreurs, **journaux bruts identiques octet pour octet**. [Après](captures-appbuilder-b4/cowork-typecheck.txt), [base](captures-appbuilder-b4/cowork-typecheck-base.txt). Aucune erreur introduite par B4 dans ce contrôle ; aucun correctif hors sujet ajouté.

Autre limite indépendante : Fleet Command Center provoque `Fatal error in V8: v8::ToLocalChecked Empty MaybeLocal`, sortie 139, sur la base comme après reconstruction. Le clic de ses boutons n'est donc pas présenté comme vérifié. Sa panne native reste ouverte. Le test B4, le balayage des autres surfaces et le scénario Historique ont été exécutés jusqu'au bout dans des instances relancées et arrêtées explicitement.

Le premier essai du nouveau test a également signalé un problème de harnais (URL DOM non `file:` sous happy-dom, aucun test exécuté) : lecture CSS corrigée pour utiliser le chemin du projet, puis vrai témoin 3/8 obtenu. Le premier script de balayage a atteint son délai de 10 s sur `xdotool mousemove --sync` lorsque le pointeur était déjà à destination ; `--sync` a été retiré et la position réelle contrôlée avant clic. Ces essais ne sont pas comptés comme des validations réussies.

## Outillage et passation

**Outillage : 6 appels Code Explorer (context/impact/query), 20 commandes via lm-resizer, 379207 octets économisés** sur 437506 octets de sortie initiale dans le périmètre mesuré jusqu'au commit correctif et à ses preuves. Ce sont des volumes de sortie, pas des tokens facturés. [Métadonnées](captures-appbuilder-b4/tool-metrics.json). Les journaux bruts ont été relus pour le témoin, le build, le lint et la comparaison TypeScript. Les copies publiées remplacent les chemins locaux et normalisent les blancs de fin de ligne ; les originaux sont conservés hors commit. La règle générale `*.txt` du dépôt a nécessité des ajouts forcés nominatifs pour les journaux autorisés par la mission.

Index : **réindexé avant intervention** (105,97 s ; HEAD de base), impact Historique réinterrogé après mise à jour. **À jour après `7f663e364`**, `analyze . --incremental` terminé en 92,43 s, deux fichiers reparsés. Après `b16e271b3`, analyse incrémentale terminée en 103,14 s, aucun fichier source reparsé. Une dernière analyse incrémentale suit le commit des journaux ; aucun simple `status` n'est utilisé à sa place.

Fichiers de production modifiés : `ConversationHistoryDrawer.tsx` et `globals.css` uniquement. Le test est dans `cowork/tests/`. Ajouts Git nominatifs, fichier par fichier. Les 24 captures publiées du scénario B4 et les journaux ont été contrôlés pour éviter les chemins locaux. Les captures du balayage sont conservées hors commit dans `<clone>/_qa/b4/private-sweep-captures/` : certains panneaux affichent le répertoire de travail, et l’OCR seul a manqué ce texte pâle, détecté à la relecture visuelle. Leurs mesures JSON publiques sont anonymisées ; les données runtime du profil isolé et les captures étrangères restent hors commit. Les cinq fichiers gelés sont inchangés depuis `695f57b6c`.

VERDICT: B4 fermé ; 49 autres contrôles de la bande de titre vérifiés ; témoin 3/8
