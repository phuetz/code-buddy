# LISA-COPINE-V1-GROK — chantiers C8, C2, C3, C6, C10

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-lisa-v1-2026-09-06`
Branche : `feat/lisa-copine-v1-2026-09-06`
HEAD au départ : `aa7b10b20` (`docs(audit): corrections de forme après neutralisation`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code.
HOME temporaire : `_qa/lisa/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Cahier des charges : `docs/audits/2026-09-06-lisa-petite-copine-grok.md` §3 spécification et §4 chantiers.

## Mission

Dans cet ordre, chacun avec tests rouge→vert et le comptage exact des suites `tests/companion` + `tests/sensory` + `tests/channels` avant/après :

1. **C8** — accueil et `spokenPrompt` = petite copine, sans palier. Persona `CODEBUDDY_COMPANION_PERSONA=copine` (défaut = persona actuelle ⇒ inchangé).
2. **C2** — initiative Telegram « mode déplacement » (`CODEBUDDY_COMPANION_AWAY=true` ou 24 h sans présence caméra).
3. **C3** — humeur cohérente sur la journée (inertie + reset doux au réveil).
4. **C6** — `recentSpoken` partagé voix + Telegram, persisté 7 jours.
5. **C10** — contrat de limites en sortie (`reply-augment`).

## Invariants

- Tout opt-in (`CODEBUDDY_COMPANION_RELATIONAL=true` + flags existants ; nouveaux flags défaut OFF ⇒ byte-identique, assert par test).
- Never-throws.
- Anti-ratchet et zéro gamification conservés (aucun compteur qui « débloque »).
- Palier adulte intouché.
- Jamais `/home/<user>`, prénom, nom d'animal, donnée de santé dans le code, les tests ou les docs (fixtures génériques).
- Code public.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-lisa-v1-2026-09-06/_qa/lisa/home` et `env -u FORCE_COLOR`.
- ComfyUI 8188/8189 non touché.
- `git add` nommément fichier par fichier ; commit par chantier (Conventional Commits).

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `aa7b10b20`. Branche déjà extraite, contient l'étude. Working tree propre.

### Inspection (après réservation)

*(à remplir)*

### C8 — persona copine

*(à remplir : comptes avant/après, fichiers, preuves)*

### C2 — mode déplacement Telegram

*(à remplir)*

### C3 — humeur cohérente

*(à remplir)*

### C6 — recentSpoken partagé

*(à remplir)*

### C10 — contrat de limites

*(à remplir)*

## Preuves transverses

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | *(à remplir)* |
| ESLint ciblé | *(à remplir)* |
| `git diff --check` | *(à remplir)* |
| `tests/security/donnees-personnelles.test.ts` | *(à remplir)* |

## Docs

- `CLAUDE.md` : tableau env, 5 variables max.
- Docs produit : *(à remplir)*

## Bilan

*(dix lignes max, pas de verdict — à remplir en clôture)*
