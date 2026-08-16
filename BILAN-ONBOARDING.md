# Bilan — onboarding « 60 secondes »

Date : 2026-08-16

Branche : `feat/onboarding-core-2026-08-16`

Base de départ : `667f9e39`

## Résultat livré

1. Profil `core` additif
   - `core` masque les surfaces companion, film, sensory, robot et vision-train dans l'aide CLI, les commandes slash, les schémas remis au modèle, l'index `tool_search` et les contrôles d'exécution.
   - Sans profil, `surface.hidden_capabilities` reste vide : le comportement historique est conservé.
   - `--profile all` restaure explicitement toute la surface. Une variable d'environnement propre à une faculté masquée la réactive aussi sous `core`.

2. Démonstration `buddy try`
   - Priorité à un login ChatGPT OAuth existant, puis sonde d'Ollama local sur `/api/tags`; aucune clé API payante ambiante n'est choisie implicitement.
   - Le modèle travaille dans un répertoire temporaire isolé, crée `fizzbuzz.js` et `fizzbuzz.test.js`, puis lance le test.
   - Le CLI relance ensuite `node --test fizzbuzz.test.js` indépendamment de l'agent avant d'afficher le succès.
   - Sans route gratuite prête, le diagnostic propose `buddy login` en premier et Ollama en second.

3. Premier lancement sans provider
   - Dans un terminal interactif, le CLI propose directement le login ChatGPT OAuth et recharge le provider dans le même processus après authentification.
   - En non-interactif, après refus ou après échec OAuth, le diagnostic est ordonné ainsi : `buddy login`, Ollama, wizard/API keys.
   - L'onboarding présente ChatGPT en choix recommandé et Ollama en deuxième choix; son premier smoke test devient `buddy try` pour ces deux routes.

4. Première page d'aide
   - `buddy --help` commence par « Pour commencer — 6 démos », avant la référence exhaustive.
   - Les six entrées sont `buddy try`, `/loop`, `buddy research`, `buddy dev pr`, `/think` et `/share`.
   - `buddy dev` utilise désormais le résolveur provider partagé et fonctionne donc avec ChatGPT OAuth ou Ollama, pas uniquement avec une clé API.

## Commits fonctionnels

- `e09d3d63` — `feat(onboarding): add focused core profile`
- `7bc262d5` — `feat(cli): add zero-config coding demo`
- `d829b7c8` — `feat(onboarding): recommend ChatGPT login first`
- `6bb5e2f1` — `feat(cli): lead help with coding demos`

Aucun push n'a été effectué.

## Vérifications finales

Commande ciblée :

```text
npm test -- tests/config/feature-surface.test.ts tests/cli/help-output.test.ts tests/cli/first-run.test.ts tests/commands/try.test.ts tests/wizard/onboarding.test.ts tests/utils/provider-detector.test.ts tests/agent/tool-handler-filter.test.ts tests/commands/slash-commands.test.ts tests/unit/slash-commands.test.ts tests/tool-manager.test.ts tests/toml-config.test.ts tests/commands/research-flow-provider.test.ts

Test Files  12 passed (12)
Tests       289 passed (289)
```

TypeScript :

```text
npm run typecheck
tsc --noEmit
tsc --project tsconfig.darkstar-identity.json
exit 0
```

Contrôles complémentaires : `git diff --check` propre; ESLint ciblé sans erreur (un avertissement `no-explicit-any` préexistant dans `src/index.ts`).

## Limites connues

- Le profil `core` reste volontairement opt-in, conformément à la contrainte de compatibilité; le lancement sans `--profile core` conserve toute la surface historique.
- Les tests automatisés de `buddy try` simulent le provider et la boucle agent : aucun appel OAuth/Ollama réel n'a été facturé ou lancé pendant cette livraison. Le chemin de vérification de production exécute bien le vrai binaire Node dans le bac à sable.
- La démo est conçue pour environ une minute, mais sa durée réelle dépend de la latence ChatGPT ou du modèle et du matériel Ollama; elle n'impose pas une coupure destructive à 60 secondes.
