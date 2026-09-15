# Deux Buddy, une correction vérifiée sur deux hôtes

Recette du 14 septembre 2026, candidat `299143c3eea5cc1ae7fda52fe648972662113b89`, descendant de `01fc0dbd3`. Source : rapport et oracles conservés dans le dossier Partage `20260914-code-buddy-flotte`. Ce relevé documentaire ne relance pas la recette.

Une fixture de facture tronquait des fractions de centime. L’oracle initial signalait le cas `[103,1,20]` : 123 obtenu, 124 attendu. Le Buddy Windows a exposé le fichier et une recherche par `peer.tool.invoke`; une session `peer.chat-session.start/continue` a identifié `Math.floor` et proposé deux cas. Le pilote appelait les outils et transmettait leurs résultats à la session.

Le pilote a relayé la revue au Buddy Linux, dont le CLI a corrigé `invoice.cjs` avec `str_replace_editor` : `Math.floor` remplacé par `Math.round`. L’oracle a rendu `ORACLE_PASS 5 cases` sur Linux puis sur Windows natif. Le pilote a copié le fichier corrigé et le Buddy Windows l’a relu dans la même session.

Il s’agit d’une coopération manuellement pilotée par Codex, sur deux hôtes physiques, avec des RPC WebSocket authentifiés et un tunnel SSH pour Windows. Ce scénario n’utilisait pas Council ; il ne démontre ni délégation autonome entre pairs ni synchronisation Git automatique. Le succès concerne les cinq cas de cette fixture, pas la correction universelle d’un logiciel de facturation.

## Traces consultées

| Fichier source | SHA-256 |
|---|---|
| `RAPPORT-FLOTTE.md` | `feb9a862a78d0709c34374821e735902d6da9f3903372ba1d8f08493a98cef06` |
| `oracle-before.txt` | `a09c8fd679b14dc6a30634d86daaa9c4020e0bde4eac68890b5354c0c8a5e917` |
| `oracle-after.txt` | `2b3531e3e3a901cbc3c78510c0cb877dc83273a55b29a3bdd2499317a849121c` |
| `oracle-windows.txt` | `2b3531e3e3a901cbc3c78510c0cb877dc83273a55b29a3bdd2499317a849121c` |
