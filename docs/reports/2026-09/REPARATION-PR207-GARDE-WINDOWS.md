# Reprise PR 207 — garde Windows des essais POSIX

État source au départ : branche `feat/reset-sessions-messagerie-2026-09-23`, commit `0e3384e62`.
Rien n'est déployé. Rien n'est poussé. Le profil réel n'est pas lu.

Défaut : trois essais ajoutés appellent `mkfifo` ou `chmod` `0o500` sur un dossier sans
`it.runIf(process.platform !== 'win32')`. La CI des pull requests exécute aussi
`windows-latest`. Sous Windows, `mkfifo` est absent et `chmod` ne rend pas un dossier
impossible à écrire. Les preuves Linux (tube refusé sans attente, échec de vidage signalé)
doivent rester exécutées sur les autres plateformes.

Ce document est complété à la fin du correctif. Les sorties brutes restent hors du dépôt.
