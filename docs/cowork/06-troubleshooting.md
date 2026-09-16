# Dépannage (gotchas)

Pièges connus de **Cowork** (l'app desktop Electron de Code Buddy) et leur correctif. Le tableau distingue trois natures de problème — ne pas tout lire comme un bug actif :

- **corrigé** — landmine déjà fixée dans le code. La sévérité indique *ce qui casse si on régresse*, pas un bug courant. À ne pas réintroduire.
- **actif** — gotcha que vous rencontrerez réellement à l'install ou au boot.
- **expérimental / dégradé** — fonctionnalité incomplète ou chemin de repli, pas un bug.

## Tableau symptôme → cause → fix

| Symptôme | Cause | Fix | Sévérité | Statut |
|---|---|---|---|---|
| Plus aucun event main→renderer (UI muette, pas de stream, MicButton figé) | Double `let mainWindow` : `cowork/src/main/index.ts` et `cowork/src/main/window-management.ts` déclaraient chacun leur variable ; seule la première était assignée, donc `getMainWindow()` (utilisé par `sendToRenderer()` de `ipc-main-bridge.ts`) renvoyait toujours `null` et tous les push main→renderer étaient silencieusement perdus | Exporter `setMainWindow()` depuis `window-management.ts` et l'appeler après création de la `BrowserWindow`. Ne **jamais** redéclarer la variable dans un nouveau module — importer le setter | CRITIQUE | corrigé (`751f7eb6`) |
| `Cannot find package '@phuetz/ai-providers'` | Ancien lien de workspace vers un repo frère non cloné | Le package est **inliné** dans `cowork/src/providers/_shared/`. Ne pas réintroduire le symlink ni la dépendance (un test de régression `cowork/tests/no-ai-providers-workspace-dep.test.ts` échoue si elle revient) | MAJEUR | corrigé (`5757b197`) |
| Health DB en `error`, modules natifs qui refusent de charger (`NODE_MODULE_VERSION` mismatch) | `better-sqlite3` est un module natif compilé contre l'ABI Node, pas celle d'Electron | `npm run rebuild` dans `cowork/` (rebuild `better-sqlite3` contre les headers Electron ; déjà appelé par `postinstall`) | MAJEUR | actif |
| Auth serveur qui jette au boot en prod (`NODE_ENV=production` sans `JWT_SECRET`) | Le démarrage `startServer()` du serveur core exige `JWT_SECRET` en production | `ServerBridge` (`cowork/src/main/server/server-bridge.ts`) **mint** un secret 64 octets hex et le **persiste** en `~/.codebuddy/.jwt_secret` (mode `0600`), ou réutilise celui persisté en Settings → Embedded server. Repli éphémère si l'écriture échoue. Largement invisible en usage normal | INFO | actif (auto) |
| `EADDRINUSE` sur le port 3000 au démarrage du serveur embarqué | Un `buddy server` résiduel occupe déjà le port (`cf. cowork/DEV-LINUX.md`) | Trouver puis tuer le process : `ss -tlnp \| grep ':3000'` → `kill <pid>` | MINEUR | actif |
| Electron freeze au boot sous Linux distant (xrdp / VNC) | Probing du contexte GL qui bloque sans GPU | Toujours lancer avec `--disable-gpu` (et `--no-sandbox` pour sauter le setup suid du chrome-sandbox). Détails dans `cowork/DEV-LINUX.md` | MAJEUR | actif |
| Build renderer qui paraît incomplet / obsolète en dev Linux | `npm run build` lourd, parfois sauté dans la boucle de dev | Utiliser le chemin rapide documenté : `npx vite build` depuis `cowork/` (~30 s), puis relancer Electron (`cf. cowork/DEV-LINUX.md`) | MINEUR | actif |
| Workflow visuel bloqué (queue jamais drainée) ou `instanceId`/`workflowId` jamais mappés | Deux bugs runtime du `workflow-bridge.ts` : `processQueue()` en deadlock après `queueTask`, et ordre des listeners de `workflow_started` | Drainage via listener `task_created` + `queueMicrotask(() => orchestrator.processQueue())` ; capture du run via `prependListener('workflow_started', …)` pour passer **avant** l'émetteur de cycle de vie global (`cowork/src/main/workflows/workflow-bridge.ts`) | MAJEUR | corrigé |
| Bandeau `[Runtime] Using pi-coding-agent runner (engine not loaded)`, fonctionnalités réduites | Le bundle du moteur Code Buddy n'a pas pu se charger → repli sur le runner legacy `pi-coding-agent` (`cowork/src/main/index.ts`, ~l.1506) | C'est un **mode dégradé** volontaire, pas un crash : capacités réduites mais l'app reste utilisable. Vérifier la résolution du moteur embarqué (logs `[Main] Failed to load Code Buddy engine, falling back to pi-coding-agent`) | INFO | expérimental (fallback) |
| Voix / TTS qui ne répond pas ou reste muet | Chaîne voix/synthèse encore partielle (`cowork/src/main/voice/` : `voice-bridge.ts`, `tts-bridge.ts`, `kyutai-bridge.ts`, `conversation-session.ts`) | Fonctionnalité **expérimentale** (Phase 8 voix) — non garantie de bout en bout. À ne pas considérer comme cassée mais comme incomplète | INFO | expérimental |

## Notes

- **Distinguer corrigé vs actif.** Les lignes `CRITIQUE`/`MAJEUR` marquées *corrigé* ne sont pas des bugs courants : la sévérité dit ce qui re-casserait si on régresse. Les seuls gotchas que vous rencontrerez vraiment à l'install/au boot sont marqués *actif* (`better-sqlite3`, port 3000, GPU Linux, build vite).
- **mainWindow — règle d'or.** Si un nouveau module a besoin de la fenêtre principale, **importer `setMainWindow()` / `getMainWindow()` depuis `cowork/src/main/window-management.ts`** ; ne jamais redéclarer un `let mainWindow` local (c'est exactement le bug `751f7eb6`).
- **Diagnostic serveur embarqué.** Une fois le serveur lancé, vérifier la santé : `curl -s http://127.0.0.1:3000/api/health | jq` (`cf. cowork/DEV-LINUX.md`).
- **Référence Linux complète.** `cowork/DEV-LINUX.md` détaille la boucle de dev (build, flags Electron, ports, sandbox) ; l'architecture est dans `cowork/ARCHITECTURE.md`.
