# Intégration du patch Jules GPT-6.1 Sol — 30 septembre 2026

Patch unique reçu dans le partage ; `MESSAGE.md` indique « (aucun message) ». `git apply --3way` a réussi, avec repli automatique sur application directe pour les trois fichiers de production. L'intégration conserve le modèle dans le catalogue ChatGPT OAuth et son tarif API de base.

Corrections limitées aux erreurs constatées : fenêtre API officielle de 1 050 000 jetons au lieu du seuil tarifaire de 272 000 ; URL officielle et portée du tarif standard ; test déplacé de `src/` vers `tests/` et rendu portable ; repli OAuth mis à jour pour Responses Lite et les efforts de raisonnement. L'entrée du catalogue `openai` est écartée : son transport utilise Chat Completions avec outils, alors que la fiche OpenAI du modèle demande Responses pour les appels d'outils. L'assertion existante de la liste OAuth est étendue sans l'affaiblir.

Preuves : sans les trois ajouts de production, le test nouveau donne 3 échecs et 1 succès ; avec le correctif, 5/5 passent. Sans la correction du repli OAuth, son test échoue sur `modelUsesResponsesLite=false` ; avec elle, il passe. Sept fichiers de tests ciblés et voisins : 58/58. Typecheck, build, ESLint ciblé et `git diff --check` : réussis. Dépendances locales réutilisées sans réseau ; `npx` initial a échoué `EAI_AGAIN`. Aucun test annoncé par Jules dans `MESSAGE.md`.

Sources : https://developers.openai.com/api/docs/models/gpt-6.1-sol et https://developers.openai.com/api/docs/changelog . Le tarif enregistré s'applique aux prompts jusqu'à 272K jetons d'entrée ; au-delà, la tarification officielle augmente. Le calculateur actuel applique le tarif de base ; les estimations de demandes plus longues peuvent donc être trop faibles.

Verdict : **À REPRENDRE** pour annoncer une prise en charge API complète et pour valider le modèle sur un compte OAuth réel. Aucun appel réseau authentifié, aucun test Windows ou Docker n'a été exécuté.
