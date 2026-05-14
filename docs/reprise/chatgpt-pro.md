# ChatGPT Pro via Codex login

Ce rail verifie que Code Buddy peut utiliser un abonnement ChatGPT Pro deja
connecte localement, sans cle API OpenAI et sans credit API.

## Sources d'authentification

Code Buddy cherche les identifiants dans cet ordre:

1. `~/.codebuddy/codex-auth.json` - login cree par `buddy login chatgpt`.
2. `~/.codex/auth.json` - login partage du Codex CLI / abonnement ChatGPT.

Le premier fichier valide gagne. `/logout chatgpt` supprime seulement le fichier
Code Buddy; il ne supprime jamais le login partage de Codex CLI.

## Verification

Depuis la racine du repo:

```bash
npm run build
node dist/index.js whoami
```

La sortie doit indiquer:

- `ChatGPT: connected`;
- le plan ChatGPT, par exemple `pro`;
- la source active (`~/.codebuddy/codex-auth.json` ou `~/.codex/auth.json`).

Tester ensuite un appel non interactif:

```bash
$env:CODEBUDDY_PROVIDER="chatgpt"
node dist/index.js --print "Reponds exactement: Code Buddy utilise ChatGPT Pro." --output-format text --no-color --no-emoji
```

Le resultat attendu est la phrase demandee, avec un cout `0` cote API.

## Variables utiles

```bash
$env:CODEBUDDY_PROVIDER="chatgpt"
$env:CHATGPT_MODEL="gpt-5.5"
```

`CODEBUDDY_PROVIDER=chatgpt` force le provider ChatGPT meme si d'autres variables
comme `GROK_API_KEY` ou `OLLAMA_HOST` existent dans le shell. Sans override, la
presence d'un login ChatGPT valide reste prioritaire sur les providers ambiants.

## Reconnexion

Si les tokens sont absents, expires ou revoques:

```bash
node dist/index.js login chatgpt
```

Puis relancer `whoami`. Si tu veux deconnecter Code Buddy tout en gardant Codex
CLI connecte, utiliser:

```bash
node dist/index.js logout chatgpt
```
