# CLI smoke

Ce smoke test sert a confirmer que Code Buddy est utilisable comme CLI agentique
principal, dans l'esprit Gemini CLI, Codex ou Claude Code.

## Preflight

Depuis la racine du repo:

```bash
npm install
npm run build
node dist/index.js --help
```

Configurer au moins un provider:

```bash
# Exemple OpenAI-compatible
set OPENAI_API_KEY=...
node dist/index.js --print "Reponds en une phrase: Code Buddy est pret ?"
```

Sous PowerShell, utiliser `$env:OPENAI_API_KEY="..."` au lieu de `set`.

## Session interactive

Lancer:

```bash
node dist/index.js
```

Puis executer cette sequence dans la meme session:

1. Demander une explication courte de l'architecture du repo.
2. Demander de lire `README.md`, puis `docs/fleet-guide.md`.
3. Demander une recherche repo: "trouve les fichiers qui gerent /fleet tool".
4. Demander une commande shell non destructive: `git status --short --branch`.
5. Demander une modification sur un fichier jetable dans `tmp/` ou dans une
   branche de test, puis verifier que la permission et le diff sont clairs.
6. Demander une correction volontairement petite avec tests cibles.
7. Continuer jusqu'a 50 prompts environ en alternant lecture, recherche,
   commandes, petits edits, questions d'architecture et resume.
8. Tester `/tools`, `/think status`, `/config`, `/fleet status` et un resume de
   session.

## Criteres de passage

- Le CLI ne plante pas et ne perd pas l'historique pendant la session longue.
- Les appels outils rendent des resultats lisibles et rattaches au bon tour.
- Les permissions restent comprehensibles; aucune modification silencieuse
  hors demande.
- Les sorties modele sont nettoyees des artefacts type `<think>` ou tokens
  provider.
- Les erreurs sont actionnables: fichier, commande, stack ou instruction de
  reprise.
- `npm run typecheck` passe apres la session.

## Artefacts a garder

- captures dans `docs/screenshots/`;
- extrait du `git diff` quand un edit est teste;
- logs ou sortie terminal pour les erreurs provider/outils;
- liste des prompts qui cassent encore le flux.

Si ce smoke passe, le CLI est dans une zone beta credible. S'il echoue, corriger
le CLI avant d'ajouter de nouvelles couches Cowork/Fleet.
