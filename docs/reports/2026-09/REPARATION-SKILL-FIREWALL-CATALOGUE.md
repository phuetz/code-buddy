# Réparation Skill Firewall Catalogue (Mission AGY-FW-CATALOGUE)

Date : 2026-09-06
Branche : `fix/skill-firewall-catalogue-2026-09-06`
Worktree : `~/DEV/cb-fw-catalogue-2026-09-06`

## Contexte
Rapport précédent : `docs/reports/2026-09/VERIF-SKILL-FIREWALL-OPUS.md` §C-3.
Lacunes identifiées dans `DANGEROUS_PATTERNS` (`src/security/skill-scanner.ts`) restant à l'état `allow` :
1. Droppers encodés : `base64 -d | sh`, `printf '\xNN…' | sh`, `echo … | base64 --decode | bash`.
2. Lecture/exfiltration d'identifiants sensibles : `~/.ssh/*`, `.env`, `~/.aws/credentials`, `~/.codebuddy/*.env` (notamment combinés à `curl -d @`, `nc`, `scp`).
3. Imports dynamiques Python : `__import__('os')`, `importlib.import_module(`.
4. Injection de prompt dans commentaires : commentaire HTML mono-ligne `<!-- ignore previous instructions -->`.

## Plan d'action
1. Mesure AVANT : exécution de `scripts/skill-firewall-campaign.ts` sur le corpus réel (bundled + externes sous `_qa/`), résultats consignés dans `_qa/cat/avant.json`.
2. Ajout des motifs (≤ 12 motifs) dans `src/security/skill-scanner.ts` avec justification, sévérité, capacité, description.
3. Création des tests de non-régression et de détection dans `tests/security/skill-firewall-catalogue.test.ts` (≥ 2 cas positifs et ≥ 2 cas négatifs par motif).
4. Mesure APRÈS : recalcul de la campagne, analyse des flips (0 faux positif attendu, qualification des vrais positifs), vérification des performances.
5. Validation complète des suites de tests, types, lint, hygiène git et absence de données personnelles.

## 1. Corpus et Mesure AVANT

Corpus réel élargi constitué sous `_qa/cat/corpus` (191 skills réels) :
- `src/skills/bundled` (7 skills)
- `~/.hermes/skills` (75 skills)
- `~/hermes-agent/skills` (75 skills)
- `~/code-buddy/.codebuddy/skills` (5 skills)
- `~/mem0/openclaw/skills` (2 skills)
- `~/mem0/skills` (5 skills)
- `~/mem0/mem0-plugin/skills` (16 skills)
- `~/.claude/skills` (5 skills)
- `~/.codex/skills` (6 skills)

Commande exécutée :
```bash
npx tsx scripts/skill-firewall-campaign.ts --corpus _qa/cat/corpus --out _qa/cat/avant.json
```

Résultats consignés dans `_qa/cat/avant.json` :
- Total skills scannés : **191**
- Allow : **128**
- Review : **24**
- Quarantine : **39**

## 2. Motifs ajoutés au catalogue (Trou C-3)

Dix motifs spécialisés (≤ 12) ont été ajoutés à `DANGEROUS_PATTERNS` dans `src/security/skill-scanner.ts`. L'interface `DangerousPattern` a été enrichie d'une propriété `justification?: string` afin d'intégrer la raison de sécurité de chaque motif.

| Nom du motif | Capacité | Sévérité | Description | Justification |
| --- | --- | --- | --- | --- |
| `base64-decode-pipe-shell` | `shell` | `critical` | Base64 decoding piped directly to shell | Décodage à la volée vers un interpréteur shell pour exécuter des scripts dissimulés |
| `hex-printf-pipe-shell` | `shell` | `critical` | Hex/octal encoded payload piped directly to shell | Reconstruction furtive de commandes binaires ou shell via séquences d'échappement hexadécimales |
| `py-dunder-import` | `dynamic-code` | `high` | Dynamic Python module import via `__import__()` | Chargement dynamique de modules sensibles (os, subprocess) contournant les imports statiques |
| `py-importlib-import` | `dynamic-code` | `high` | Dynamic Python module import via `importlib.import_module()` | Résolution et exécution dynamique de bibliothèques arbitraires à l'exécution |
| `ssh-private-key-access` | `secrets` | `high` | Access or reading of private SSH keys | Accès non autorisé aux clés privées SSH (`~/.ssh/id_*`) pour usurpation d'accès |
| `dotenv-file-access` | `secrets` | `high` | Access or extraction of sensitive .env environment file | Lecture directe de fichiers `.env` contenant secrets d'application et clés d'API |
| `cloud-credential-access` | `secrets` | `high` | Access to cloud provider credentials or CodeBuddy environment files | Ciblage de `~/.aws/credentials` ou `~/.codebuddy/*.env` exposant l'infrastructure |
| `credential-network-exfiltration` | `network` | `critical` | Exfiltration of credentials or sensitive environment files via network | Envoi actif de secrets locaux via curl, nc, scp ou wget vers des serveurs distants |
| `html-comment-prompt-injection` | `prompt-injection` | `critical` | Prompt injection or instruction override hidden inside HTML comment | Injection furtive dissimulée dans des commentaires HTML non affichés mais analysés par le LLM |
| `html-comment-hidden-command` | `prompt-injection` | `critical` | Dangerous shell command or dropper hidden inside HTML comment | Dissimulation de droppers ou commandes destructrices dans les commentaires HTML (trou E01) |

Couverture des tests dans `tests/security/skill-firewall-catalogue.test.ts` (49 tests unitaires) :
- Chaque motif dispose de ≥ 2 cas positifs et ≥ 2 cas négatifs réalistes.
- Cas négatifs critiques vérifiés : documentation expliquant `base64` sans l'exécuter, `.env.example`, `ssh-keygen` en documentation, `import importlib` statique.
- Les 7 vecteurs adverses exacts relevés par Opus (§C-3 : B03, B04, C01, C02, D03, D04, E01) passent tous de `allow` à `quarantine`.

## 3. Mesure APRÈS et analyse des basculements

Campagne rejouée sur le corpus réel de 191 skills :
```bash
npx tsx scripts/skill-firewall-campaign.ts --corpus _qa/cat/corpus --out _qa/cat/apres.json
```

### Synthèse des comptes

| Métrique | AVANT (`_qa/cat/avant.json`) | APRÈS (`_qa/cat/apres.json`) | Delta |
| --- | --- | --- | --- |
| Total skills | 191 | 191 | 0 |
| Allow | 128 | 128 | 0 |
| Review | 24 | 24 | 0 |
| Quarantine | 39 | 39 | 0 |

### Tableau des basculements de verdict (flips)

- **Basculements de verdict (flips) : 0**
- **Faux positifs : 0**

### Vrais positifs documentés

Deux skills du corpus voient un nouveau motif détecté, sans basculement de verdict car ils étaient déjà classés en `quarantine` en raison d'autres motifs préexistants :

1. `hermes-agent/github/github-repo-management`
   - Motif détecté : `ssh-private-key-access` (high)
   - Fichier : `SKILL.md:308`
   - Extrait : `gh secret set SSH_KEY < ~/.ssh/id_rsa`
   - Qualification : **Vrai positif**. Le skill lit la clé privée SSH locale pour l'injecter dans les secrets GitHub du dépôt.

2. `hermes/github/github-repo-management`
   - Motif détecté : `ssh-private-key-access` (high)
   - Fichier : `SKILL.md:308`
   - Extrait : `gh secret set SSH_KEY < ~/.ssh/id_rsa`
   - Qualification : **Vrai positif**. Lecture directe de la clé privée locale.

### Performance

Mesurée sur les 191 skills réels (3 passes après échauffement) :
- Passe 1 : 1 193,7 ms
- Passe 2 : 1 540,6 ms
- Passe 3 : 1 364,9 ms
- **Médiane : 1 364,9 ms** (environ 7,15 ms par skill).
- Critère respecté : médiane ≤ 1 500 ms (1,5 s).

## 4. Preuves et Validation

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Suites ciblées | `env -u FORCE_COLOR HOME=~/DEV/cb-fw-catalogue-2026-09-06/_qa/cat/home npx vitest run tests/security tests/skills` | **79 fichiers passés, 1 ignoré ; 1 424 tests passés, 3 ignorés, 0 échec** |
| Suite dédiée C-3 | `env -u FORCE_COLOR HOME=~/DEV/cb-fw-catalogue-2026-09-06/_qa/cat/home npx vitest run tests/security/skill-firewall-catalogue.test.ts` | **49/49 passés (0 échec)** |
| Typage TypeScript | `npx tsc --noEmit -p tsconfig.json` | **Code 0 (0 erreur)** |
| Lint global | `npm run lint` | **Code 0 (0 erreur, 2 484 avertissements préexistants)** |
| Lint ciblée | `npx eslint src/security/skill-scanner.ts tests/security/skill-firewall-catalogue.test.ts` | **Code 0 (0 erreur, 0 avertissement)** |
| Espaces blancs | `git diff --check 06036279e` | **Code 0 (aucune anomalie)** |
| Données personnelles | `env -u FORCE_COLOR HOME=~/DEV/cb-fw-catalogue-2026-09-06/_qa/cat/home npx vitest run tests/security/donnees-personnelles.test.ts` | **40/40 passés (0 fuite)** |
| Ligne CHANGELOG | `CHANGELOG.md` (section 6 septembre 2026) | Entrée insérée avec hash vérifiable `597a89729` |

## Bilan (10 lignes)

1. Le trou C-3 du rapport Opus est entièrement fermé : les 7 vecteurs adverses mesurés passent de `allow` à `quarantine`.
2. Dix motifs spécialisés (≤ 12) ont été intégrés dans `DANGEROUS_PATTERNS` avec une propriété `justification`.
3. Droppers couverts : décodage Base64 pipé vers shell (`base64-decode-pipe-shell`) et payloads hex/octal (`hex-printf-pipe-shell`).
4. Secrets protégés : clés privées SSH (`ssh-private-key-access`), fichiers `.env` (`dotenv-file-access`), credentials AWS/CodeBuddy (`cloud-credential-access`).
5. Exfiltration réseau active (`credential-network-exfiltration`) bloquant l'envoi de secrets via `curl -d @`, `nc`, `scp` et `wget`.
6. Imports dynamiques Python neutralisés : `__import__` (`py-dunder-import`) et `importlib.import_module` (`py-importlib-import`).
7. Commentaires HTML surveillés : prompt injections cachées (`html-comment-prompt-injection`) et commandes shell masquées (cas E01).
8. Validation sur corpus réel élargi (191 skills) : 0 basculement de verdict, 0 faux positif et 2 vrais positifs documentés.
9. Performance confirmée : médiane de 1 364,9 ms sur les 191 skills, strictement inférieure au plafond de 1,5 s.
10. Toutes les vérifications sont au vert : 1 424 tests passés, tsc code 0, lint 0 erreur, git diff --check propre et 40/40 données personnelles.
