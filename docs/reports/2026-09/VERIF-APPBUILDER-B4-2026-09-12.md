# Vérification par exécution — App Builder B4 — 2026-09-12

- **Date** : 2026-09-12
- **Vérificateur** : Grok 4.6 (indépendant d'Astra ; n'a rien implémenté)
- **Dépôt** : `<clone>`
- **Branche** : `astra/appbuilder-b4-2026-09-12`
- **HEAD à l'arrivée** : `8f4e6916d`
- **Base** : `695f57b6c`
- **Correctif** : `7f663e364`
- **Rapport à contredire** : `docs/reports/2026-09/REPARATION-APPBUILDER-B4-ASTRA-2026-09-12.md`
- **Règle** : aucune modification de production ; aucun `npm install` ; aucun push.

Preuves visuelles : `docs/reports/2026-09/captures-verif-appbuilder-b4/`. Journal d'actions : `actions.jsonl`. Témoin Vitest : `witness-before.txt`.

## 1. Effet de bord — déplacement de fenêtre sous couche `fixed`

**Tranché : (b)** — le déplacement natif cesse seulement tant qu'une couche plein écran interactive est ouverte. Ce n'est pas (c). Gravité : **écart documenté, non bloquant**.

Mesure Electron, fenêtre 1400×900 à (100,50) sur Xvfb 1600×1000. Pixel de bande de titre sans contrôle : client (400, 4).

| Situation | `webkit-app-region` en (400, 4) | Élément sous le pointeur |
|---|---|---|
| Fenêtre nue (aucune couche) | `drag` | `div.titlebar-drag` (bande 40 px) |
| Tiroir Historique ouvert | `no-drag` | bouton fond `absolute inset-0 bg-black/40` |
| Dialogue Raccourcis (modale centrée `fixed inset-0`) | `no-drag` | couche `fixed inset-0 z-50 … bg-black/50` |

La règle CSS `.fixed:not(.pointer-events-none)` s'applique à toute couche fixe interactive. Un `fixed inset-0` recouvre donc aussi la bande de titre et **annule** la région de déplacement tant qu'il est monté. Fermer la couche rend le `drag` de `.titlebar-drag`. Compteur source : **64** `className` contenant `fixed` + `inset-0` sans `pointer-events-none` sous `cowork/src/renderer` (le rapport Astra parlait de 63 ; l'ordre de grandeur tient).

`xdotool windowmove` déplace bien la fenêtre (100,50 → 180,90, puis restauration). En revanche, un presser-glisser `xdotool` sur la bande `drag`, y compris fenêtre nue, **n'a pas changé** `getwindowgeometry` dans cet Xvfb (avec et sans `marco --sm-disable` dans le même serveur). Le discriminant utilisable ici est donc la région CSS native mesurée sous Electron, pas un delta X/Y. Ce n'est pas (c) : la bande nue reste `drag` ; seules les couches plein écran la recouvrent en `no-drag`.

Conséquence produit : pendant un tiroir ou une modale plein écran, on ne saisit plus la fenêtre par la bande de titre (ni les contrôles de fenêtre sous le fond, qui reçoivent le clic du fond). C'est le prix de la correction. Une fois la couche fermée, la bande redevient draggable. Pas un échange « bouton mort contre fenêtre immobile en permanence ».

## 2. Le défaut d'origine est-il fermé ?

**Oui.** Reproduit sur worktree `695f57b6c`, fermé sur la branche.

Même croix, mêmes coordonnées qu'Astra : rectangle (283, 10, 24, 24), clic écran (395, 72). Actions `xdotool`, jamais `HTMLElement.click()`.

| Étape | Base `695f57b6c` | Branche (correctif) |
|---|---|---|
| Pointeur sur la croix avant clic | [baseline-mouse-close-before-cursor.png](captures-verif-appbuilder-b4/baseline-mouse-close-before-cursor.png) | [mouse-close-before-cursor.png](captures-verif-appbuilder-b4/mouse-close-before-cursor.png) |
| Après le clic | tiroir **encore ouvert** `show=true` [baseline-mouse-close-after.png](captures-verif-appbuilder-b4/baseline-mouse-close-after.png) | tiroir **fermé** `show=false` [mouse-close-after.png](captures-verif-appbuilder-b4/mouse-close-after.png) |

Autres fermetures, sur la branche seulement (le worktree de base n'a pas le `onKeyDown` Échap) :

| Action | Résultat | Capture |
|---|---|---|
| Échap depuis le tiroir ouvert | fermé (`show=false`, nœud absent) | [escape-closed.png](captures-verif-appbuilder-b4/escape-closed.png) |
| `Shift+Tab` puis `Entrée` | focus `BUTTON` `aria-label=Fermer`, puis fermé | [close-focused.png](captures-verif-appbuilder-b4/close-focused.png), [keyboard-closed.png](captures-verif-appbuilder-b4/keyboard-closed.png) |
| Renommage puis premier Échap | saisie annulée (`renaming=false`, titre `Original title`), **tiroir toujours ouvert** | [start-rename-after.png](captures-verif-appbuilder-b4/start-rename-after.png), [rename-escape.png](captures-verif-appbuilder-b4/rename-escape.png) |

Le détail le plus facile à casser (Échap pendant le renommage) tient : `stopPropagation` sur l'input empêche le `onKeyDown` du dialogue de fermer le tiroir.

## 3. Témoin et tests

Fichiers de production remis à `695f57b6c` **en gardant** `conversation-history-drag-region.test.tsx`, puis restaurés à `7f663e364`. `git diff --quiet` contre `7f663e364` pour les deux fichiers de production : **0**.

| Commande | Résultat |
|---|---|
| `cd cowork` + test neuf, production = base | **3 échecs / 8** : exclusion Historique, futur contrôle `.fixed`, Échap. [witness-before.txt](captures-verif-appbuilder-b4/witness-before.txt) |
| Même test + `conversation-history-model.test.ts` après restauration | **10/10**, exit **0** |

Le test est **honnête** : il parse le **vrai** `src/renderer/styles/globals.css` via PostCSS (`readFileSync` + `stylesheet.walkRules`) et confronte `element.matches(selector)` au DOM rendu de `ConversationHistoryDrawer`. Il ne se contente pas d'assertér qu'une classe existe. Un `click()` happy-dom n'est pas présenté comme preuve Electron.

## 4. Cinq contrôles de la bande haute (échantillon)

Pris dans la liste Astra, dont un onglet de barre et un déclencheur de menu. Clics `xdotool` après disparition de l'assistant d'accueil ([after-onboarding.png](captures-verif-appbuilder-b4/after-onboarding.png)).

| Contrôle | Clic | Effet à l'écran |
|---|---|---|
| Onglet / « New session » (TabBar, y < 40) | écran (159, 70) | reçu ; déjà sur nouvelle session, pas de nouvel onglet (no-op attendu) [ctrl-new-tab-after.png](captures-verif-appbuilder-b4/ctrl-new-tab-after.png) |
| Model: openrouter/free (menu `absolute top-full`) | écran (856, 70) | clic dans la bande ; le menu n'a pas été figé dans la capture à 2 rAF (liste vide au relevé DOM) |
| Show documentation | écran (1256, 70) | panneau Documentation ouvert [ctrl-docs-after.png](captures-verif-appbuilder-b4/ctrl-docs-after.png) |
| Notifications | écran (1336, 70) | volet Notifications ouvert [ctrl-notif-after.png](captures-verif-appbuilder-b4/ctrl-notif-after.png) |
| Show keyboard shortcuts | écran (1296, 70) | dialogue Configurable shortcuts [ctrl-shortcuts-after.png](captures-verif-appbuilder-b4/ctrl-shortcuts-after.png) |

Aucun des cinq n'est resté mort comme la croix Historique de la base. Le menu modèle n'a pas une preuve visuelle aussi nette que Documentation / Notifications / Raccourcis ; le clic a bien atterri sur le déclencheur `titlebar-no-drag`. Pas de contrôle supplémentaire trouvé inerte dans cet échantillon.

## 5. Portes de qualité

HOME isolé `_qa/verif-b4/home`. Aucune suite complète.

| Commande | Exit | Détail |
|---|---|---|
| `timeout 900 npm run typecheck` | **0** | y compris gpuNode-identity et companion-core |
| `timeout 900 npm run lint` | **0** | **0 erreur, 2497 avertissements** (même nombre qu'Astra ; aucune règle assouplie) |
| `cd cowork && timeout 900 npx vitest run tests/conversation-history-drag-region.test.tsx src/renderer/components/conversation-history-model.test.ts` | **0** | 10/10 |
| `cd cowork && timeout 900 npx vite build` | **0** | renderer + `dist-electron/main` + preload produits (20:01) |
| Application démarre, App Studio s'ouvre | oui | [app-studio-open.png](captures-verif-appbuilder-b4/app-studio-open.png), `primaryView=studio` |
| Cinq fichiers gelés B1/B2/B3 | identiques à `695f57b6c` | `command-runner.ts`, `NewShell.tsx`, `AppStudioView.tsx`, `use-app-studio.ts`, `project-scaffolding.ts` |
| `git diff --check` sur les 3 fichiers hors docs | **0** | |

Electron arrêté par `SIGTERM` (instance courante puis instance de base). `marco` d'un autre DISPLAY (`:10`) non touché. ComfyUI non touché.

## 6. Relecture du diff `695f57b6c..7f663e364` hors `docs/`

Trois fichiers seulement :

1. `cowork/src/renderer/styles/globals.css` — `.titlebar-no-drag` étendu à `.fixed:not(.pointer-events-none)`. **C'est la vraie correction souris.** La règle est **large** (toute couche fixe interactive), volontairement ; trop large pour le drag pendant overlay (section 1), juste assez pour ne pas recréer le trou au prochain bouton dans les 40 px.
2. `cowork/src/renderer/components/ConversationHistoryDrawer.tsx` — `role="dialog"`, Échap sur le conteneur, `stopPropagation` sur l'Échap du renommage. **Ce n'est pas un raccourci de compensation à la place du CSS** : sur la base, le clic souris est avalé et Échap ne ferme pas ; sur la branche, le clic ferme *sans* passer par le clavier. L'Échap est un plus, et le `stopPropagation` du rename est nécessaire dès qu'Échap ferme le dialogue.
3. `cowork/tests/conversation-history-drag-region.test.tsx` — test neuf (voir §3).

Aucun chemin local en clair dans ces trois fichiers.

## Outillage

**Outillage : 6 appels Code Explorer (context/impact/query + analyze --force), 6 commandes via lm-resizer, 461544 octets économisés** (lint 434272 + vite 27272 ; les Vitest/typecheck n'ont pas compressé). Volumes de sortie, pas des tokens facturés.

Index : **réindexé `--force` avant inspection** (MCP « Repository not found » alors que `status` disait INDEXED ; 119,29 s, HEAD du stub). CLI `context ConversationHistoryDrawer`, `impact`, `query "titlebar drag region overlay no-drag"`. Index : **à jour** sur le stub ; **réindexé `--incremental` après le commit de ce rapport**.

Worktree de base : `_qa/verif-b4/baseline` @ `695f57b6c`, `node_modules` en lien, `npx vite build` local au worktree. Electron : `timeout 900 xvfb-run` + `--remote-debugging-port=9338`, `TMPDIR` relatif (un TMPDIR absolu long a déjà sorti 132).

VERDICT: PUSHABLE

===LANE_VERIF_APPBUILDER_B4_TERMINE===
