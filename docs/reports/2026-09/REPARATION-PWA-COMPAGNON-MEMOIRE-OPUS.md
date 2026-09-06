# Réparation PWA compagnon — mémoire, chemin unique, relances selfie, identité

- **Agent** : Claude Opus (ingénieur senior)
- **Worktree** : `cb-pwa-memoire-2026-09-06`, branche `fix/pwa-companion-memory-2026-09-06`
- **HEAD au départ** : `04920e95c`
- **Date d'ouverture** : 2026-09-06

## Mission

Trois symptômes observés par l'utilisateur sur la PWA mobile (assistant `companion`) :

1. Selfie servi depuis le cache — OK.
2. Relance « Encore une ? » → réponse d'assistant générique, aucune mémoire du tour précédent.
3. « Coucou 💕 » → « Ah, Lisa! Comment ça va? » — le modèle croit que l'utilisateur s'appelle Lisa.

Quatre points à livrer, chacun avec un test rouge AVANT / vert APRÈS :

1. Un seul chemin compagnon (PWA = Telegram).
2. Mémoire de conversation par connexion WS.
3. Relances de selfie contextuelles.
4. Identité explicite dans le prompt système + historique typé.

## Journal

### Phase 0 — ouverture (avant toute inspection)

Rapport créé. Inspection en cours.

