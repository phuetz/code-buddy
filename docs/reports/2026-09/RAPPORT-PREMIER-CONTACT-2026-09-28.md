# Rapport de mission — pièges du premier contact (2026-09-28)

- Branche : `fix/premier-contact-2026-09-28`, départ `origin/main` `92f25d62b`.
- Source : étude « premier contact » d'un testeur inconnu (révision `300496c31`), relue constat par constat sur le code actuel.
- Périmètre : documentation d'entrée (`docs/getting-started.md`, `docs/install.md`, `docs/fleet-guide.md`), textes `--help`, messages d'erreur du premier lancement, petits correctifs sûrs. `README.md` n'est pas touché (réécrit ailleurs).
- Zones gelées respectées : aucune refonte de l'installation.

## Journal

- Rapport créé avant inspection ; réservation ajoutée au tableau de coordination.
- Constats de l'étude revérifiés sur `92f25d62b` : tous vrais sauf le n° 11 (partiellement faux : `buddy doctor --fix` tire bien un modèle quand Ollama n'en a aucun — mais c'était `qwen2.5-coder:7b`).
- Trois pièges supplémentaires trouvés en exécutant : bandeau `--help` en français, sortie de `buddy token` en français, et `buddy fleet token` sans `--scopes` ne porte ni `fleet:listen` ni `peer:invoke` (le guide flotte affirmait le contraire).
- Commits : `175dd0b84` (modèle Ollama outillé), `959dd8e75` (aide, messages, reprise de session stricte), `aa434d58a` (guides).

## Preuves

- `npx tsc --noEmit` : 0 ; ESLint sur les fichiers touchés : 0.
- Vitest `tests/cli tests/wizard tests/commands tests/persistence` + `doctor-fix` + `fleet-listener` : 197 fichiers, 2 078 tests, 1 échec corrigé ensuite (`session-commands.test.ts`, mock sans `listSessions`), puis vert. Garde `tests/security/donnees-personnelles.test.ts` : verte.
- Le test d'ambiguïté de session échoue contre l'ancienne logique reconstituée (1 échec sur 6), passe avec la nouvelle.
- HOME vierge sous `_qa/premier-contact/home`, `npm run build` puis binaire réel : `--help`, `doctor`, `login --no-browser`, `fleet status`, `fleet token`, `session resume` / `--resume` ambigus, `try` (Ollama local), serveur réel + `FleetListener` (URL sans `/ws` → 400 + indice ; clé `cb_sk_xxx` → `Invalid credentials` + indice ; JWT à portées fleet → connecté).

## Ce qui reste

- `buddy try` avec `qwen3:4b-instruct` (seul petit modèle outillé présent) : 0/3 au vert — deux refus « I detected an attempt to override my instructions » (la règle anti-injection du prompt système), un appel d'outil écrit en texte. Une reformulation de la consigne de démo n'a rien prouvé en 2 essais : retirée.
- `buddy fleet token` pourrait porter les portées flotte par défaut : décision de sécurité, non prise ici.
- `peer-chat-client-factory.ts` garde `qwen2.5-coder:7b` par défaut pour `peer.chat` (chat seul, acceptable) ; `provider-onboarding.ts` cite encore `ollama.ai` (redirige, non mort).
- `README.md` non touché (PR #261) : voir le fichier CORRECTIONS du partage.
