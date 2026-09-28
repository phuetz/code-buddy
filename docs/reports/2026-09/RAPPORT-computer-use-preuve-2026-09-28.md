# RAPPORT — preuve du computer use bureau (Avalonia sous Xvfb) — 28/09/2026

Base `origin/main` a675d1d13, branche `opus/computer-use-preuve-2026-09-28` (non poussée).
Rapport détaillé, captures, vidéos et harnais : dossier de partage local
`20260928-computer-use-preuve/` (hors dépôt).

## Résultat

Sous Xvfb, Code Buddy reçoit « clique sur le bouton Valider », clique une fois, et le compteur
d'une appli Avalonia passe de 0 à 1 (captures avant/après), par deux chemins :
arbre AT-SPI (Avalonia 12) et ancrage visuel par LLM (Avalonia 11.3, sans arbre).
Sur `origin/main`, les deux chemins échouaient.

## Correctifs (chaque test échoue sur l'ancien code)

- f0db802cd — snapshot AT-SPI Linux limité à la profondeur 5 : les contrôles Avalonia 12 (profondeur 6) manquaient.
- 97e41774b — fournisseur ChatGPT : les images étaient sérialisées en texte, le modèle ne les voyait pas.
- 3296f185c — ancrage visuel : la cible expirait avec le snapshot (pas de clic) ; `assert_text_visible` acceptait un texte absent.
- bc9aad99b — `get_active_window` tuait le processus (erreur X) sans gestionnaire de fenêtres.

## Limites relevées, non corrigées

OCR trop faible sur petit texte sans agrandissement ; `bash` en bac à sable ne voit pas un SDK
installé dans le home (Code Buddy ne peut pas compiler l'appli qu'il écrit) ; libnut rend `null`
pour la fenêtre active même avec un gestionnaire de fenêtres ; OmniParser non branché sur l'ancrage.
