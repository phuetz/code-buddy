# Pilotage d'un formulaire par phrases

Exécuter depuis la racine du dépôt :

```bash
./scripts/demo/pilotage-langage-naturel.sh
```

Le script isole `HOME` sous `_qa/preuve-pilotage/home`, conserve l'accès au cache Chromium de Playwright, lance deux pages locales dans un navigateur réel et écrit la sortie sous `_qa/preuve-pilotage/demonstration.log`. Aucun service ne reste actif après le test.

Les deux passages emploient exactement « remplis le champ E-mail avec preuve@example.test » puis « clique sur Valider ». La seconde page déplace le bouton et renomme les identifiants et classes. Le test vérifie le texte de confirmation affiché. Un petit analyseur dans le test extrait la valeur de la première phrase ; l'identification de la cible et l'action sont assurées par `BrowserOperatorExecutor` sans modèle distant. Cette démonstration couvre donc le chemin déterministe de `browser_operator`, pas la génération autonome du journal d'actions à partir d'une conversation libre.

Si Chromium de Playwright manque, le test est ignoré avec sa raison dans `tests/e2e/pilotage-langage-naturel.test.ts`. Installer le navigateur avec `npx playwright install chromium`, puis relancer le script.
