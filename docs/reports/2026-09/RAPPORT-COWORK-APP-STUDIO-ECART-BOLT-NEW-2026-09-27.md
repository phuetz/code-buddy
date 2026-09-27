# Rapport de mission — App Studio de Cowork : combler l'écart avec bolt.new (27/09/2026)

Branche `opus/cowork-app-builder-bolt-2026-09-27` (suite), départ `b8d4f2160`.
bolt.new : idées seulement (produit commercial ; WebContainer non intégré).

## Écarts comblés

| Écart | Avant | Après | Où |
|---|---|---|---|
| Correction automatique | sonde + 3 corrections après la 1re génération seulement ; pile statique jamais sondée | sonde après chaque tour de construction (statique compris), budget remis à zéro à chaque message ; « Aperçu cassé : … » + bouton « Corriger » quand le budget est épuisé | `NewShell.tsx`, `studio/BuildStatusStrip.tsx`, `studio/use-app-studio.ts` (`ensurePreview`) |
| Versions / retour arrière | l'onglet lisait la chronologie globale du moteur (autre instance, vide hors dépôt git) | dépôt git séparé par projet (`.codebuddy/studio-versions.git`), une version par tour qui change quelque chose, restauration réversible | `main/studio/studio-versions-service.ts`, `studio-versions-ipc.ts`, `studio/StudioVersionsPane.tsx` |
| Édition ciblée | les messages d'itération partaient bruts | consigne `str_replace`, pas de réécriture de fichier entier ; la bulle n'affiche que la demande | `studio/iteration-prompt.ts`, `studio/studio-chat-adapter.ts` |
| Verrous de fichiers | absent | cadenas dans l'arbre, persisté ; rappelé au modèle ET appliqué (remise en l'état en fin de tour) | `studio/StudioFileTree.tsx`, `NewShell.tsx` |
| Mode discussion | absent | bascule Construire/Discuter ; toute écriture annulée ; « Implémenter ce plan » | `studio-iterate/StudioChatPanel.tsx`, `NewShell.tsx` |
| Export du site | zip des sources seulement | bouton « Site » : `npm run build` puis copie de `dist/` (ou du site statique) dans un dossier choisi | `main/studio/site-export-service.ts`, `studio/AppStudioView.tsx` |
| Boutons inertes | Stop du chat et « ouvrir dans le navigateur » sans effet | branchés | `NewShell.tsx` |

Restauration, remise en l'état, verrous et export refusent un dossier hors des espaces de
travail de confiance (même règle que l'export zip) ; l'instantané et la lecture l'acceptent
(l'état de départ d'une génération se prend avant que la session n'existe).

## Vérifications

- Vitest cowork ciblé : 36 fichiers / 147 tests (studio) + 7 fichiers / 32 tests (preload, IPC), verts.
- Test de câblage `tests/studio-iterate/studio-view-turn-wiring.test.tsx` : StudioView réel,
  vrai dossier, vrai git ; seuls le moteur d'agent et le serveur d'aperçu sont simulés.
  Cinq mutations rejouant l'ancienne logique le font échouer (pas de re-sonde, pas de sonde
  statique, verrou non appliqué, ancien volet Versions, pas de bouton « Corriger ») ; témoin vert.
  Il a trouvé une course réelle (le chargement initial des verrous écrasait un verrou posé entre-temps).
- Tests réels : `studio-versions-service` (git), `studio-site-export` (vrai `npm run build`).
- `tsc --noEmit` cowork et racine : 0 erreur. ESLint des fichiers touchés : 0.
- Vraie fenêtre Electron (Xvfb, HOME isolé, fournisseur volontairement injoignable : aucun
  agent n'agit) : vue scindée, cadenas, bascule, onglet Versions (état de départ,
  modifications manuelles, restauration effective sur disque) ; une app cassée sur disque est
  détectée par la vraie sonde après un tour d'itération → 3 corrections → « Aperçu cassé :
  runtime, blank » + « Corriger ». Trois défauts trouvés ainsi et corrigés (version de départ
  refusée, étiquette du tour de génération effacée, boutons actifs peu visibles).

## Mesure (banc hors Electron : modules purs de Cowork + `buddy -p` en `acceptEdits`)

- Mistral medium 3.5, 3 apps (todo, tableau de bord, morpion), génération puis un tour
  d'itération : toutes les variantes s'affichent (15/15), 0 correction nécessaire.
- Tour d'itération, 6 exécutions par variante : jetons d'entrée médians 70,9 k (b8d4) → 48,4 k
  (après), sortie 1,1 k → 0,7 k, durée médiane 32 s → 20,5 s. Morpion : indicateur de tour
  dupliqué 2/2 avant, 0/2 après.
- Mistral small (1 exécution par app) : rendu final 1/3 (origin/main), 2/3 (b8d4), 3/3 (après).
- Échantillons petits : tendances, pas des preuves.

## Restant (priorisé)

1. Sélection d'un élément dans l'aperçu (inspecteur) — forte valeur, effort élevé.
2. Journaux du serveur de dev diffusés (`studio.dev.log` jamais émis) et console de l'aperçu visible.
3. Maquette ou capture donnée au modèle comme référence visuelle.
4. Sélection de contexte / résumé pour les longues itérations.
5. Secrets `.env.local`, import GitHub, base de données locale.
