# Vague — Mission Control OS : brancher les données live

Tu es GPT-5.5 (Codex). Tu branches le cockpit **Mission Control** de Cowork aux vraies données de la flotte/council, au lieu des états vides actuels. Worktree isolé `feat/os-live-data` — ne change pas de branche.

## Contexte
`cowork/src/renderer/components/os/MissionControlView.tsx` compose des vues (`FleetTopologyView`, `FleetLoadStrip`, `CouncilArenaView`, `PeerCapabilityMatrix`) + `AutonomyControlPanel` (de `os-actions/`) avec des **props d'état vide statiques**. Il faut les alimenter avec les vraies données.

Les données existent déjà côté Cowork : `FleetCommandCenter.tsx` consomme `fleetPeers` du store Zustand (rempli par les événements IPC `fleet.peers` / `fleet.peer.update` — grep `fleet.peers`, `fleetPeers`, `fleet.peer` dans `store/index.ts`, `hooks/useIPC.ts`, `preload/index.ts`). Le type `Peer` est dans `types/index.ts`.

## Tâches
1. **Repère la source de vérité fleet** : le champ store `fleetPeers` (+ toute donnée fleet-load / council / DHI déjà disponible). Regarde comment `FleetCommandCenter` les lit (`useAppStore(s => …)`).
2. **Alimente `MissionControlView`** depuis le store (pas de nouvel IPC) : dérive `peers` (Object.values(fleetPeers)), un `load` réel si disponible (sinon calcule un résumé simple depuis les peers : running/queued/utilization), les `capabilities` (union des capabilities des peers), et la `session` council si une source existe (sinon garde l'état vide honnête pour le council). Passe ces vraies données aux vues.
3. **AutonomyControlPanel** : branche ses callbacks (posture/pause/cap) sur ce qui existe côté store/IPC si trouvable ; sinon garde des no-ops avec TODO mais montre l'état réel (posture courante) si accessible.
4. **État vide propre** : si `fleetPeers` est vide (buddy server off), les vues gardent leur EmptyState (« Aucun pair détecté » / « Lance buddy server »). Ne casse pas ce cas.
5. Optionnel : ajoute les panneaux `os-actions` encore non composés (`MissionActionsBar`, `AlertAckStrip`) si des données existent, sinon laisse pour plus tard.

## Contraintes
- Modifie UNIQUEMENT sous `cowork/src/renderer/components/os/` (+ un petit bridge `os/os-live-data.ts` si utile pour dériver les données du store). Tu PEUX lire le store (`useAppStore`) ici — c'est un composant renderer, pas un god-file. **NE TOUCHE PAS** `App.tsx`/`NewShell.tsx`/`store/index.ts`/`preload`/`main`.
- TS strict, tokens Tailwind, imports `.js`. `git add` explicite. NE PUSH PAS.
- Trailer :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  `feat(cowork): wire live fleet data into Mission Control`.
- Gate : `cd cowork && npx tsc --noEmit` = 0 (ignore `openai`) + `npx vite build` exit 0. `git status` propre.

## Compte-rendu (français) : quelles données live branchées, d'où (store/IPC), état vide préservé, tsc/vite, SHA, limites. Ne pousse pas.
