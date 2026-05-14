# Reprise Code Buddy

Ce dossier transforme l'audit de mai 2026 en rails de reprise courts et
verifiables. L'objectif n'est pas de redocumenter toutes les phases Claude,
mais de separer ce qui doit etre stable maintenant de ce qui reste en
laboratoire.

## Objectifs produit

1. **CLI operationnel** - une experience proche de Gemini CLI, Codex et Claude
   Code: chat interactif, mode `--print`, outils fiables, historique,
   permissions, reprise de session et diagnostics.
2. **Cowork** - un cockpit desktop/web qui pilote le meme moteur Code Buddy et
   permet aussi d'utiliser d'autres LLMs.
3. **Fleet / collaboration** - plusieurs Code Buddy et plusieurs LLMs peuvent se
   connecter, se decrire, echanger des messages et invoquer des outils
   strictement controles.
4. **OpenClaw** - integration utile comme gateway de canaux externes, a garder
   separee du noyau CLI/Fleet tant que le socle n'est pas stable.

## Rails de validation

- [CLI smoke](cli-smoke.md) - prouve que le CLI tient une vraie session de
  travail, y compris une longue serie de prompts avec outils.
- [Fleet minimal](fleet-minimal.md) - prouve la boucle Code Buddy vers Code
  Buddy: `listen`, `ping`, `describe`, `peer.chat` et outils read-only.
- [Build status](build-status.md) - garde la preuve des validations locales et
  des blocages restants.

## Definition de "proche du but"

Le projet est proche du but seulement quand ces deux rails passent sur une
machine propre et sur au moins une machine distante:

- le CLI tourne sans crash sur une session longue;
- les outils critiques fonctionnent avec permissions et logs lisibles;
- Cowork ne contourne pas le moteur CLI;
- Fleet peut relier deux instances sans passer par des phases manuelles
  obscures;
- les integrations OpenClaw restent optionnelles.

Tout le reste peut exister, mais reste en laboratoire tant que ces criteres ne
sont pas reproductibles.
