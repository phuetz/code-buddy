# Réparation CONV1 — conversation vocale

## Périmètre et contraintes

- Branche attendue : `feat/conversation-sol-2026-09-03`
- Base annoncée : `facea9864`
- Exécution déterministe uniquement : aucune lecture audio réelle, aucun rappel parlé, aucune API payante, aucun service système.
- Toutes les nouvelles fonctions restent opt-in par variable d’environnement ; le comportement sans opt-in doit rester inchangé.

## Journal des lectures

- `docs/FABLE5-CODEX-COORDINATION.md:1-274` — protocole et tableau de réservation ; aucune réservation concurrente CONV1 trouvée.
- `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/CONTEXTE-LISA.md:1-13` — chaîne et latences de référence.
- `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/recherche-conversation/RECH1-LITTERATURE-GEMINI.md:412-493` — section 8 et cinq mécanismes : projection de fin de tour, barge-in/AEC-VAD, backchannels, réparation communicative, TTS basse latence.

État initial vérifié : branche `feat/conversation-sol-2026-09-03`, HEAD `facea9864`. Seuls `REPARATION-CONV1.md` et le `node_modules` non suivi préexistant apparaissaient avant la réservation ; ce dernier reste hors périmètre.

## Brique 1 — Fin de tour plus courte

- Variable(s) : à confirmer.
- ROUGE : à consigner.
- VERT : à consigner.
- Commit : à consigner.
- Mesure déployée restante : à consigner.

## Brique 2 — Transcription en flux

- Variable(s) : à confirmer.
- ROUGE : à consigner.
- VERT : à consigner.
- Commit : à consigner.
- Mesure déployée restante : à consigner.

## Brique 3 — Backchannel

- Variable(s) : à confirmer.
- ROUGE : à consigner.
- VERT : à consigner.
- Commit : à consigner.
- Mesure déployée restante : à consigner.

## Brique 4 — Réflexe de réparation

- Variable(s) : à confirmer.
- ROUGE : à consigner.
- VERT : à consigner.
- Commit : à consigner.
- Mesure déployée restante : à consigner.

## Vérifications finales

- Tests ciblés : à consigner.
- `npx tsc --noEmit -p .` : à consigner.
- ESLint : à consigner.
