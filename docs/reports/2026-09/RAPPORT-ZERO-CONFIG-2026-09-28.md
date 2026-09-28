# Rapport — zéro configuration et profils nommés (2.4)

| | |
|---|---|
| Branche | `feat/zero-config-2026-09-28`, départ `origin/fix/premier-contact-2026-09-28` (`c727be659`) |
| Source | Avis de Grok (`docs/explication-code-buddy.txt`, pistes d'amélioration, point 1) |
| Commits | `2a0c48dd0` (zéro config), `d95ce9316` (profils), `71436acae` (docs) |
| Destination | 2.4 (pas 2.3.0) |

## Ce qui est livré

1. **`buddy` sans configuration** (`src/cli/zero-config.ts`, branché dans `src/index.ts`
   pour la commande principale et `git commit-and-push`). Ne s'exécute que si rien
   d'explicite n'a résolu de fournisseur. Ordre : Ollama local servant déjà un modèle
   capable d'outils (même sélection que `doctor --fix` : outils déclarés, taille connue
   inférieure à la RAM libre, famille instruct/coder) → proposition de `buddy login`
   (interactif) → commandes exactes d'installation adaptées à ce que la sonde a vu
   (Ollama absent : commande d'installation de la plateforme + `ollama pull qwen3:8b` ;
   Ollama présent sans modèle outillé : `ollama pull qwen3:8b` seul). Le choix et sa
   raison sont affichés. `CODEBUDDY_ZERO_CONFIG=false` rétablit l'ancien comportement.
2. **Profils nommés** `local`, `cloud`, `fleet`, `max` (profils intégrés de
   `src/config/toml-config.ts`, nouvelle table `env`, appliquée par
   `src/cli/profile-env.ts` après `.env`, uniquement aux variables non définies).
   Doc : `docs/profiles.md`.
3. **Priorité conservée** : clés, `buddy login`, `buddy onboard`, identifiants stockés,
   `CODEBUDDY_PROVIDER`, `OLLAMA_HOST`, `--base-url`, `baseURL` de profil passent avant ;
   une variable exportée gagne sur un profil (testé).

Écart assumé avec l'ordre littéral de la commande : les identifiants déjà présents
passent **avant** l'Ollama local, parce que c'est le comportement existant (la
contrainte 3 prime). Le zéro-config ne remplace que l'ancienne impasse.

## Vérifications

- `npx tsc --noEmit` : 0 erreur ; ESLint sur les fichiers touchés : 0.
- Vitest : `tests/cli/zero-config.test.ts` (11, vrai serveur HTTP loopback au format
  `/api/tags`), `tests/cli/profile-env.test.ts` (11, HOME isolé sous `_qa/zero-config/`),
  `tests/cli` + `tests/config` (65 fichiers : 1 échec **préexistant** sur la base,
  `headless-exit-code` « provider failure rendered as an assistant error », reproduit
  après `git stash`), `tests/doctor tests/wizard tests/config` (60 fichiers verts),
  garde `donnees-personnelles` verte.
- Mutations (après commit) : retirer la garde « variable déjà définie » fait tomber 3
  tests de profil ; retirer le filtre « capable d'outils » fait tomber 2 tests zéro-config.
- Binaire réel (`npm run build`, `node dist/index.js`) en HOME vierge, `env -i` :
  choix automatique de `qwen3:4b-instruct` et réponse « pong » (11 s) ;
  `--profile local --model qwen3.8-ctx32k:latest` crée réellement `hello.txt` ;
  Ollama absent (simulé par un préchargement qui refuse le port 11434) : consignes
  exactes, sortie 1 ; interactif : offre de login refusée puis consignes ;
  `OLLAMA_HOST` exporté : chemin historique inchangé.

## Ce qui reste

- `qwen3:4b-instruct` (seul petit modèle outillé présent ici) refuse la demande
  d'édition (« attempt to override my instructions ») : même défaut que celui noté
  pour `buddy try`, dans la règle anti-injection du prompt système — hors périmètre.
- La sélection préfère le plus petit modèle instruct/coder capable d'outils ; un
  critère « plus capable si la RAM le permet » reste à décider.
- Quand le profil `cloud` ou `CODEBUDDY_ZERO_CONFIG=false` coupe la sonde, les consignes
  sont génériques (pas de « vu : … »).
- `buddy try`, `buddy server` et les autres sous-commandes ne passent pas par la
  détection zéro-config (commande principale et `git commit-and-push` seulement).
- Non vérifié : Windows, macOS, `npm install -g` réel.
