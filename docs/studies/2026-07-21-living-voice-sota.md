# Étude — Voix compagnon « vivante » : état de l'art 2026 (2026-07-21)

Complément de l'audit de convergence. L'hypothèse directrice est que la présence ne vient pas du
TTS brut seul, mais de la prosodie contextuelle et du rythme du dialogue.

## Ingrédients de la présence, par impact

1. Prosodie contextuelle : le ton dépend de ce qui vient d'être dit.
2. Turn-taking : ne pas couper une pause de réflexion et réagir vite à la vraie fin du tour.
3. Adaptation émotionnelle : une émotion mesurée module différemment excuse, sympathie et joie.
4. Imperfections bien placées : interjections, pauses et suspensions.
5. Full duplex et backchannels, plus coûteux sur CPU.
6. Rappels mémoriels factuels et effet miroir.

## Faisabilité locale

| Brique | Option | CPU |
|---|---|---|
| Fin de tour sémantique | classifieur compact de type smart-turn | Oui |
| Émotion utilisateur | sidecar SER compact | Oui, sur fenêtre courte |
| Backchannels | heuristique VAD + segments pré-synthétisés | Oui |
| TTS émotionnel lourd | grands modèles génératifs | Difficile en temps réel |
| Pocket TTS actuel | texte, ponctuation et choix de voix | Oui |
| Full duplex neuronal | modèles de plusieurs milliards de paramètres | Non sur la cible CPU |

## Le texte comme canal de contrôle

- La ponctuation module les respirations, les suspensions et l'énergie.
- La longueur de phrase règle le rythme ; une interjection rare remplace un tag de style absent.
- L'émotion et l'humeur peuvent produire une instruction de rendu sans réécrire le contenu.

## Phase 2A portée depuis la PR #70

- L'entrainment humain reste la base ; émotion et bande d'humeur modulent débit, WPM borné et pauses
  lorsque `CODEBUDDY_COMPANION_RELATIONAL=true`.
- La prosodie textuelle est contrôlée par `CODEBUDDY_VOICE_EXPRESSIVE_TEXT`. Sans valeur explicite,
  elle suit l'opt-in relationnel ; le défaut nu reste inchangé.
- Les rappels viennent exclusivement de `episode:recent`, avec déduplication et fenêtre réglable par
  `CODEBUDDY_VOICE_CALLBACK_GAP_MS`.
- La dérive d'humeur est partagée entre les chemins hybride et vocal, sans double application.
- Le premier fragment TTS conserve un plafond de 96 caractères ; les segments suivants passent à
  160 et ne se coupent plus sur une virgule.
- Le sanitizer partagé normalise les nombres français, heures, pourcentages, ordinaux, acronymes,
  emojis, Markdown et ponctuation avant les haut-parleurs ou une note vocale Telegram.

## Suite possible, non portée

- Détection émotionnelle acoustique sur la fenêtre STT.
- Détection sémantique de fin de tour avant déclenchement.
- Backchannels pré-synthétisés et full duplex.
- Routage vers plusieurs presets émotionnels d'une même voix.

Ces améliorations restent non explicites : présence émotionnelle, mémoire factuelle et turn-taking.
Elles ne modifient ni les garde-fous relationnels ni le périmètre adulte.
