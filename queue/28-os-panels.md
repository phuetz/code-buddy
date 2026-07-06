# Vague — Panneaux OS agentique manquants (props-driven, dashboards)

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/os-panels`.

## But
Crée les composants de dashboard de l'« OS agentique » qui manquent — **props-driven** (données par props typées,
actions par callbacks ; AUCUN accès store/IPC). Fable les câblera. Info-design : résumé avant détail, état encodé
dans la forme (pill/chip/barre), `tabular-nums`, EmptyState honnête quand pas de données.

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/os-panels/`
Pour chacun : (a) le `.tsx` props-driven ; (b) un module logique pur `*-model.ts` (types + agrégation/tri/format purs) ;
(c) un test Vitest `cowork/tests/os-panels/*.test.ts` du module pur (no-mocks).
1. **AutonomyDashboard.tsx** — `{ posture:'plan'|'dontAsk'|'bypass', running:number, queued:number, costUsd:number, capUsd:number,
   turns:number, maxTurns:number, onSetPosture?(p), onPause?() }` → cartes d'état + barres coût/tours + contrôles.
2. **KnowledgeGraphView.tsx** — `{ nodes:{id,type:'lesson'|'decision'|'fact'|'discovery',label,confidence?}[],
   edges:{from,to,kind}[] }` → liste groupée par type + petit résumé (compte par type, confiance moyenne). (Pas de rendu graphe
   physique — une vue tabulaire/cartes lisible ; c'est OK.)
3. **OsStatusBar.tsx** — `{ items:{label,value,tone?:'ok'|'warn'|'error'|'muted'}[] }` → barre horizontale compacte de statuts.
4. **MissionControlShell.tsx** — un layout de composition `{ header?:ReactNode, left?:ReactNode, main?:ReactNode,
   right?:ReactNode }` (grille responsive) — le cadre où on branche les vues fleet/council existantes.

## Conventions
Tokens sémantiques (`bg-surface`, `text-foreground`, `text-muted-foreground`, `border-border`, statuts vert/ambre/rouge
distincts de l'accent). Icônes lucide-react. Libellés FR OK.

## Manifeste (OBLIGATOIRE) `cowork/src/renderer/components/os-panels/os-panels-wiring.ts` (data-only) : `{ id, title,
componentFile, logicFile, testFile, mount, needsData }` par composant.

## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/os-panels/` verts. Ne pousse pas.
Compte-rendu FR : composants + tests + SHA. `feat(cowork): os-panels <composant>`.
