# MISSION X3 — Les dépendances optionnelles qui n'en sont pas

Date : 2026-08-26

Branche : `fix/w2-cli-families-2026-08-26`

Périmètre : les 25 `optionalDependencies` importées par un spécificateur littéral dans `src/`, hors `matrix-js-sdk` déjà corrigée par `cf8130ce`.

## Verdict

- **A — contrat local complet et cast au point de chargement : 2** (`pdf-parse`, `@whiskeysockets/baileys`). Les deux chargeurs sont maintenant indirects et leurs anciennes déclarations ambiantes ont été retirées. Aucun type du paquet n'est remplacé par `any`.
- **B — types/contrats résolus au niveau du module : 17.** Aucun code modifié. Cela inclut les modules déjà protégés par une déclaration ambiante locale : ils ne reproduisent pas `TS2307`, mais leur chargement indirect effacerait le type actuellement consommé ou demanderait d'inventer un nouveau contrat.
- **C — absence qui casse un chemin produit central : 6** (`ws`, `better-sqlite3`, `sharp`, `js-yaml`, `string-width`, `@google/generative-ai`). Recommandation : les reclasser en `dependencies`, sauf si le chemin statique central est d'abord refactoré en vraie frontière optionnelle. `package.json` n'a pas été modifié.

La prémisse « 25 imports littéraux, donc 25 `TS2307` » ne tient pas dans ce projet. Avant correction, un retrait physique unitaire donnait **11 échecs et 14 succès**. Les succès viennent des paquets `@types/*`, des déclarations de `src/types/optional-deps.d.ts` et de `skipLibCheck` pour l'import `d3` interne à la déclaration `d3-node`.

## Méthode

Pour chaque paquet, son répertoire direct a été déplacé sous le même `node_modules`, l'absence du chemin original a été contrôlée, puis `npx tsc --noEmit -p tsconfig.json` a été exécuté avant restauration. Aucun `npm install`, service ou API n'a été utilisé. Pour C, un import réel du chemin produit concerné a aussi été exécuté paquet absent.

La classe C a priorité sur B : un paquet peut fournir de vrais types et être quand même mal rangé si son absence empêche le produit de charger.

## Classement des 25

| Dépendance | Classe | `tsc` avant correction, paquet absent | Motif décisif |
|---|---:|---:|---|
| `ws` | **C** | exit 0 | Le serveur active WebSocket par défaut (`src/server/index.ts:171`) et appelle sans repli `setupWebSocket` (`:1171-1174`), qui charge `ws` (`src/server/websocket/handler.ts:1142`). Les types viennent de `@types/ws`, mais le runtime manque. |
| `better-sqlite3` | **C** | exit 0 | `CodeBuddyAgent` importe `getActiveRunStore` (`src/agent/codebuddy-agent.ts:33`) et `run-store.ts` importe statiquement le constructeur (`src/observability/run-store.ts:17`). `@types/better-sqlite3` masque l'absence au typecheck, pas à l'exécution. |
| `sharp` | **C** | exit 0 | Le registre importe statiquement `vision-tools` (`src/tools/registry/index.ts:845`), qui importe `image-processor` (`src/tools/registry/vision-tools.ts:12`), qui importe statiquement `sharp` (`src/tools/vision/image-processor.ts:7`). La déclaration ambiante `any` ne protège que `tsc`. |
| `js-yaml` | **C** | exit 0 | La TUI importe `useInputHandler` (`src/ui/components/ChatInterface.tsx:4`), qui importe statiquement `js-yaml` (`src/hooks/use-input-handler.ts:5`). `@types/js-yaml` masque seulement l'absence de runtime. |
| `d3-node` | **B** | exit 0 | Les cinq générateurs SVG sont synchrones et consomment le constructeur, `d3`, `createSVG` et les sélections typées par `src/types/d3-node.d.ts`. Remplacer leurs imports statiques par une indirection ne serait pas gratuit. |
| `string-width` | **C** | exit 2, 6 `TS2307` | La TUI charge `ChatHistory`, puis le rendu Markdown/table (`src/ui/components/ChatHistory.tsx:5-8`, `src/ui/utils/markdown-renderer.tsx:8`), et `InkTable` importe statiquement `string-width` (`src/ui/components/InkTable.tsx:8`). |
| `playwright` | **B** | exit 2, 7 erreurs | `src/agent/hermes-browser-backends.ts:14` importe les vrais types `Browser` et `BrowserContext`; les connexions Chromium/Firefox utilisent ensuite les objets Playwright typés. |
| `adm-zip` | **B** | exit 0 | La déclaration locale de module rend déjà l'absence compilable, mais huit chargeurs consomment directement le constructeur et ses entrées typées. Il n'existe pas de cast unique de module comparable à Matrix. |
| `jszip` | **B** | exit 2, 4 erreurs | `src/lora/pack-dataset.ts:7` importe explicitement le type réel `JSZipInstance`, utilisé pour le constructeur, `file()` et `generateAsync()`. |
| `pdf-parse` | **A** | exit 0 | `PDFAgent` avait déjà `PdfParseResult` et une fonction locale; PaperQA avait déjà `PdfParseModuleV2` et ses casts. Les trois chargeurs runtime sont désormais indirects et la déclaration ambiante redondante est supprimée. |
| `xlsx` | **B** | exit 0 | La déclaration locale de module protège déjà `tsc`, tandis que `document-generator.ts` consomme directement `utils.book_new`, `json_to_sheet`, `book_append_sheet` et l'écriture typée. Pas de cast local unique à substituer. |
| `@google/generative-ai` | **C** | exit 2, 3 erreurs | La TUI charge `ClientCommandDispatcher`, puis `enhanced-command-handler`, qui réexporte `handleUltraplan`; ce handler importe statiquement `GoogleGenerativeAI` (`src/commands/handlers/ultraplan-handler.ts:3`). L'absence casse donc la TUI avant `/ultraplan`. |
| `alasql` | **B** | exit 0 | La déclaration locale protège l'absence, mais le module installé apporte un vrai contrat (`AlaSQL`, `parse`, `promise`, options) au chargement; le code ne possède pas un cast de module complet analogue à Matrix. |
| `node-llama-cpp` | **B** | exit 0 | Les déclarations locales rendent déjà le retrait compilable, mais `local-llm-provider.ts` utilise les types constructeurs via `InstanceType` et `ConstructorParameters`. Une indirection non castée les effacerait. |
| `tar` | **B** | exit 0 | L'absence est déjà couverte par une déclaration ambiante `any`, mais il n'existe précisément **pas** de contrat local complet permettant le correctif A. En inventer un dépasserait la mission. |
| `tree-sitter` | **B** | exit 2, 2 `TS2307` | Le scanner construit le vrai `Parser`; le parseur Bash charge aussi le module. Les champs locaux sont `any`/`unknown`, pas un contrat complet de module à caster. |
| `@nut-tree-fork/nut-js` | **B** | exit 2, 7 erreurs | Le provider et son mock utilisent partout `typeof import('@nut-tree-fork/nut-js')`; claviers, souris, fenêtres, `Point` et enums reposent donc sur les vrais types. |
| `@anthropic-ai/sdk` | **B** | exit 2, 1 `TS2307` | Le client est ensuite ramené aux contrats locaux de réponse, mais la construction de `Anthropic` et ses options restent validées par le vrai SDK. Le contrat local ne couvre pas le module complet. |
| `@mlc-ai/web-llm` | **B** | exit 0 | La déclaration locale rend déjà l'absence compilable; le code construit toutefois directement `MLCEngine` avant de le caster en `ChatCompletionEngine`. Il n'y a pas de cast local complet au point d'import. |
| `@picovoice/porcupine-node` | **B** | exit 2, 1 `TS2307` | Le code s'appuie sur le constructeur réel, `BuiltinKeyword`, ses clés et `getBuiltinKeywordPath`; `PorcupineInstance` ne décrit que l'instance après construction. |
| `@whiskeysockets/baileys` | **A** | exit 0 | `BaileysModule`, `BaileysSocket`, messages et loader local couvraient déjà tous les membres utilisés. Le chargeur est maintenant indirect et la déclaration ambiante `any` a été supprimée. |
| `@xenova/transformers` | **B** | exit 2, 1 `TS2307` | Le vrai type de `pipeline()` valide le type de tâche, le modèle et les options. Le cast local ne couvre que la fonction de feature-extraction **après** sa création. |
| `d3` | **B** | exit 0 | L'import littéral est type-only dans `src/types/d3-node.d.ts:2`; ses `Selection`, génériques, scales et shapes sont consommés par le contrat `d3-node`. Aucun chargeur runtime applicatif à rendre indirect. |
| `node-pty` | **B** | exit 2, 3 erreurs | `interactive-bash.ts` possède un contrat local, mais `src/fleet/capability-registry.ts:423` utilise les vrais types de `spawn`, `IPty` et des callbacks. Le paquet entier n'est donc pas A. |
| `tree-sitter-bash` | **B** | exit 2, 1 `TS2307` | Le module de grammaire est résolu avec sa vraie forme dans `src/security/bash-parser.ts:26`; le stockage `unknown` n'est pas un contrat local complet de module. |

## Preuve des deux corrections A

### `pdf-parse` — commit `33df9f22`

```text
PROOF pdf-parse: node_modules/pdf-parse absent
PROOF pdf-parse: tsc exit=0 elapsed=0:15.14
PROOF pdf-parse: restored=yes
```

Vérification fonctionnelle ciblée :

```text
npx vitest run tests/research/paper-qa/pdf-structure.test.ts tests/unit/pdf-agent.test.ts tests/specialized-agents.test.ts
Test Files  3 passed (3)
Tests      104 passed (104)
```

### `@whiskeysockets/baileys` — commit `539bff4c`

```text
PROOF @whiskeysockets/baileys: node_modules/@whiskeysockets/baileys absent
PROOF @whiskeysockets/baileys: tsc exit=0 elapsed=0:14.92
PROOF @whiskeysockets/baileys: restored=yes
```

Vérification fonctionnelle ciblée :

```text
npx vitest run tests/channels/whatsapp.test.ts tests/channels/channel-handlers-additional-channels.test.ts
Test Files  2 passed (2)
Tests      114 passed (114)
```

## Preuve d'indispensabilité des C

Chaque ligne ci-dessous a été obtenue avec le paquet direct physiquement absent, puis restauré. Les imports n'ouvrent aucun service.

```text
ws|setupWebSocket|exit=1|ERR_MODULE_NOT_FOUND depuis src/server/websocket/handler.ts
better-sqlite3|import CodeBuddyAgent|exit=1|ERR_MODULE_NOT_FOUND depuis src/observability/run-store.ts
sharp|import CodeBuddyAgent|exit=1|ERR_MODULE_NOT_FOUND depuis src/tools/vision/image-processor.ts
js-yaml|import ChatInterface|exit=1|ERR_MODULE_NOT_FOUND depuis src/hooks/use-input-handler.ts
string-width|import ChatInterface|exit=1|ERR_MODULE_NOT_FOUND (chaîne TUI/handlers)
@google/generative-ai|import ChatInterface|exit=1|ERR_MODULE_NOT_FOUND depuis src/commands/handlers/ultraplan-handler.ts
```

### Recommandation de reclassement

Reclasser ces six paquets en `dependencies` :

```text
ws
better-sqlite3
sharp
js-yaml
string-width
@google/generative-ai
```

Cette recommandation documente l'état actuel. Si le choix produit est de garder `sharp` ou le SDK Google optionnels, il faut d'abord supprimer leur remontée statique dans les chemins centraux; les laisser tels quels dans `optionalDependencies` ne correspond pas au comportement du produit.

Pendant X3, un chantier concurrent a créé `d5835293` et a déjà reclassé `js-yaml`. Cette décision n'appartient à aucun des commits X3; elle n'a été ni indexée, ni modifiée, ni annulée ici. Le tableau conserve `js-yaml` parmi les 25 paquets du périmètre initial et constate que l'analyse indépendante arrive au même verdict C.

## Intégrité du chantier

- `package.json` et `package-lock.json` : non modifiés par X3. Le commit concurrent `d5835293`, hors des trois commits X3, touche `package.json` pour `js-yaml`.
- `scripts/influencer/` : non touché; son changement préexistant est resté hors index.
- Aucun `git add -A`, `git commit -a`, push, API payante ou service lancé.
- Les artefacts non suivis `.x4-repro-current` et `.x4-repro.JCoQDQ/`, apparus pendant la mission et étrangers à X3, ont été laissés intacts.
