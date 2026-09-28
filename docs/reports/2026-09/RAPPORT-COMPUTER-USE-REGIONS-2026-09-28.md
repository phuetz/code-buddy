# Rapport de mission — computer use par régions numérotées (28/09/2026)

Agent : Opus (flotte). Branche `opus/computer-use-regions-2026-09-28`, base
`origin/opus/computer-use-preuve-2026-09-28` (33909b8d3).

Objectif : quand l'arbre AT-SPI est vide, découper la capture en régions numérotées (OCR ×3 +
contours), les injecter comme éléments virtuels et réutiliser le prompt de liste fermée.

Rapport complet et preuves : `~/Videos/Partage/20260928-computer-use-regions/RAPPORT.md`.

État : terminé (tête du code 78be4d9fb, non poussée).

- Banc d'ancrage, oracle = journal de l'appli : sur une grille de 24 boutons, gpt-6-sol fait 0/10 en
  coordonnées (il clique « Fermer ») et 10/10 en régions ; qwen3:4b texte seul fait 10/10 en régions.
- Bout en bout : appli Avalonia 11 sans arbre 6/6 ; grille 5/5 en régions contre 0/5 en coordonnées ;
  agent gpt-6-sol + ancreur local qwen3:4b 5/5.
- Défauts trouvés et corrigés en route : lecture trop crédule de la liste fermée (60df4c058,
  6f77c1af4), re-capture perdue par click_button (78be4d9fb).
- Incident : `buddy -p -k … -u …` a enregistré une clé « ollama » et une base URL locale dans la
  configuration utilisateur réelle (valeurs précédentes inconnues) ; détails dans le rapport complet.
