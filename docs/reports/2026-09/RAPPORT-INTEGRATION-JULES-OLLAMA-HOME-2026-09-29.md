# Intégration des patchs Jules Ollama et HOME mémoire

Deux commits thématiques sur `jules/lot`, issus de `be71d2dcf` : URL Ollama unifiée puis chemins de mémoire et de cache sous `CODEBUDDY_HOME`.

Les preuves rouge→vert, les corrections apportées aux patchs et les limites de validation sont détaillées dans le rapport de livraison du partage, sous `jules/LOT/integration/sol/RAPPORT.md`. Aucun push ni publication.

## Reprise après relecture indépendante

La relecture du 29 septembre a trouvé cinq tests existants rouges hors des dossiers initialement joués. Le commit `26e3f6ec4` adapte leurs attentes à `CODEBUDDY_HOME` sans changer leurs noms ni leurs assertions de contenu et de mode. Une correction séparée couvre les environnements ciblés de la caméra et les routes Ollama quand `OLLAMA_BASE_URL` et `OLLAMA_HOST` coexistent. Le rapport de reprise est sous `jules/LOT/integration/reprise-1/sol/RAPPORT.md` dans le partage. Les deux commits d'intégration d'origine restent inchangés.
