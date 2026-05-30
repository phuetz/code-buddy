# CLI smoke — reprise Code Buddy

Objectif: verifier que le CLI reste utilisable comme assistant de code
quotidien avant d'elargir Fleet, Cowork ou OpenClaw.

Ce guide ne suppose aucun secret en dur. Quand une cle est necessaire,
utilise une variable d'environnement locale.

## 0. Build local

```bash
npm install
npm run build
```

Resultat attendu:

- `npm run build` termine sans erreur TypeScript.
- `dist/index.js` existe.

## 1. Aide et diagnostic

```bash
node dist/index.js --help
node dist/index.js doctor
```

Resultat attendu:

- `--help` affiche les commandes principales (`doctor`, `onboard`,
  `server`, `research`, etc.).
- L'aide racine affiche le format canonique `--output-format <format>`
  sans doubler avec l'ancien alias compatible `--output <format>`.
- `doctor` liste les providers detectes et les problemes d'environnement
  lisiblement.

## 2. Auth ChatGPT subscription

```bash
node dist/index.js login chatgpt
node dist/index.js whoami
```

Resultat attendu:

- `login chatgpt` ouvre le flux OAuth et ecrit
  `~/.codebuddy/codex-auth.json`.
- `whoami` confirme l'etat de connexion.
- Les couts ChatGPT OAuth restent a cout marginal zero cote routeur
  Fleet.

## 3. Chat simple

```bash
node dist/index.js
```

Dans la session:

```text
bonjour, reponds en une phrase
/status
```

Resultat attendu:

- Le modele repond sans outil.
- `/status` affiche le modele actif, le cout et l'etat de session.

## 4. Lecture et recherche outillees

Dans la session:

```text
lis le README et resume le but du projet en 5 lignes
cherche les references a peer_delegate dans src et docs
```

Resultat attendu:

- Le CLI utilise des outils de lecture/recherche.
- Les chemins cites restent dans le workspace courant.
- Pas de demande de secret, pas d'action destructive.

## 5. Edition controlee

Choisir un petit fichier de test ou une note temporaire.

```text
cree une note docs/tmp-smoke-note.md avec une phrase, puis relis-la
```

Resultat attendu:

- En mode par defaut, Code Buddy demande confirmation si la politique
  d'ecriture l'exige.
- En `--permission-mode acceptEdits`, l'ecriture sure peut etre acceptee
  automatiquement.
- Supprimer la note apres le test si elle n'est pas utile.

## 6. Session resume

```text
/save cli-smoke
/exit
```

Puis relancer:

```bash
node dist/index.js
```

Dans la session:

```text
/sessions
```

Resultat attendu:

- La session sauvegardee est visible.
- La reprise ne duplique pas l'historique ni les messages d'outils.

## Verification developpeur

Avant de dire que le CLI est sain pour une reprise:

```bash
npm run typecheck
npm run build
npm test -- tests/agent/execution/agent-executor.test.ts tests/codebuddy/client.test.ts
```

Le lint global peut encore contenir de la dette historique. Pour une
modification ciblee, lancer au minimum ESLint sur les fichiers touches.
