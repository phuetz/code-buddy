# LISA-COPINE-V1-GROK — chantiers C8, C2, C3, C6, C10

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-lisa-v1-2026-09-06`
Branche : `feat/lisa-copine-v1-2026-09-06`
HEAD au départ : `aa7b10b20` (`docs(audit): corrections de forme après neutralisation`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code (réservation `72c6211e6`).
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

- Accueil : `src/sensory/arrival-opener.ts` (pools historiques, anti-répétition, `recentSpoken` seulement voix/arrivée).
- Voix : `companion-voice-character.ts` spine xAI (Ani/Mika, palier 18+ dans l’intimité « vieil ami ») ; `spokenPrompt` lisa dans `persona-manager.ts`.
- Proactif : `proactive-engine.ts` cooldown 12 h, un gagnant, Telegram voix si absent ; inactivity « N jours sans te voir ».
- Humeur : `evolveTraits` + DECAY 0,08, pas de plafond de saut par tour.
- Limites : `relationship-safety.ts` claims de conscience ; pas de garde diagnostic/FOMO/déblocage.

### C8 — persona copine — `daa98260f`

Profil données `src/companion/personas/copine.ts`, sélection `CODEBUDDY_COMPANION_PERSONA=copine`. Défaut unset → pools historiques (premier template matin inchangé). Overlay `spokenPrompt`, spine, few-shots, intimité sans `/100` ni palier adulte. Journée dure / succès via `emotionGuidance`. Tests 6 rouges (câblage) → 13 verts.

Suites `companion`+`sensory`+`channels` :

| | Fichiers | Tests |
|---|---|---|
| Avant | 216 (212 verts, 1 rouge préexistant `telegram-inconnu-journey`, 3 skip) | 2877 (2863 verts, 1 rouge, 12 skip, 1 todo) |
| Après | 217 (214 verts, 3 skip) | 2890 (2877 verts, 12 skip, 1 todo) |

+1 fichier / +13 tests. Le rouge GK10 n’est pas de C8 (flaky, vert au rejeu).

Correctif tsc `f7325153f` : copie `[...pool]` quand le pool d’accueil est `readonly`.

### C2 — mode déplacement Telegram — `fc75d9aa3`

`src/companion/away-mode.ts`. `CODEBUDDY_COMPANION_AWAY=true` ou (persona copine + 24 h sans caméra). Plafond 3, fenêtre `08:30-22:00`, angles morning/thought/evening jamais répétés le même jour civil, pause 24 h sur « stop » / « pas maintenant », pas de honte d’inactivity. Livraison `sendTelegramAlert`. Chef d’orchestre MIN_GAP conservé. Hook inbound `channel-handlers.ts`. Tests 1 rouge (conducteur temps réel) → 19 verts.

| | Fichiers | Tests |
|---|---|---|
| Avant | 217 / 2890 | (C8 après) |
| Après | 218 (215 verts, 3 skip) | 2909 (2896 verts, 12 skip, 1 todo) |

+1 fichier / +19 tests.

### C3 — humeur cohérente — `537cbdb2b`

`evolveTraits` inchangé (défaut byte-identique). `evolveTraitsWithDayInertia` : inertie 0,55, saut max 3, reset doux au changement de jour civil. Câblé dans `evolveRelationshipFromUtterance` si persona copine. Test 20 tours affection/frustration : peak-to-peak plus petit que le brut, ≤ 2 bandes.

| | Fichiers | Tests |
|---|---|---|
| Avant | 218 / 2909 | |
| Après | 219 (216 verts, 3 skip) | 2913 (2900 verts, 12 skip, 1 todo) |

+1 fichier / +4 tests.

### C6 — recentSpoken partagé — `d695d1114`

`src/companion/recent-said.ts`, fichier `~/.codebuddy/companion/recent-said.json` (atomic-write, 0o600), fenêtre 7 jours. Persona copine seulement (sinon aucune écriture). Câblé voix (`voice-loop`), Telegram (`channel-handlers` + proactif). `pickAwayLine` / `pickProactiveLine` via `pickUnsaidLine`. Test : la même ouverture n’est pas rejouée sur l’autre canal.

| | Fichiers | Tests |
|---|---|---|
| Avant | 219 / 2913 | |
| Après | 220 (217 verts, 3 skip) | 2917 (2904 verts, 12 skip, 1 todo) |

+1 fichier / +4 tests.

### C10 — contrat de limites — `509304cba`

`applyLimitsContract` dans `reply-augment.ts`. Opt-in persona copine. Motifs FR : diagnostic, prescription, culpabilisation, FOMO, débloquer/farmer, « je suis une humaine » seulement si question franche. Idiome « ça me tue » non intercepté. Câblé voix, hybrid, canal. Corpus 12 cas.

| | Fichiers | Tests |
|---|---|---|
| Avant | 220 / 2917 | |
| Après | 221 (218 verts, 3 skip) | 2921 (2908 verts, 12 skip, 1 todo) |

+1 fichier / +4 tests.

## Preuves transverses

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | exit 0 (après `f7325153f`) |
| ESLint ciblé `--max-warnings=0` | 0 par chantier |
| `git diff --check` | 0 |
| `tests/security/donnees-personnelles.test.ts` | 1 fichier / 40 verts |

## Docs

- `CLAUDE.md` : 4 variables nouvelles (≤ 5) — `CODEBUDDY_COMPANION_PERSONA`, `CODEBUDDY_COMPANION_AWAY` / `_AWAY_MAX_PER_DAY` / `_AWAY_HOURS`. C3, C6, C10 gated par la persona.
- `docs/companion-guide.md` : persona copine, mode déplacement, inertie, anneau 7 j, garde de limites.

## Commits

- `72c6211e6` docs(companion): réserver Lisa petite copine v1
- `daa98260f` feat(companion): persona copine for greetings and spokenPrompt (C8)
- `fc75d9aa3` feat(companion): Telegram travel-mode initiatives with daily cap (C2)
- `537cbdb2b` feat(companion): damp companion mood with per-turn inertia (C3)
- `d695d1114` feat(companion): persist shared recent-said ring for voice and Telegram (C6)
- `509304cba` feat(companion): output limits contract for copine persona (C10)
- `f7325153f` fix(companion): copy arrival pool when falling back to the full set

## Bilan

C8–C2–C3–C6–C10 livrés opt-in, palier adulte intouché, anti-ratchet conservé. Suites `companion`+`sensory`+`channels` : 216/2877 → 221/2921. `tsc --noEmit` 0 ; ESLint ciblé 0 ; `git diff --check` 0 ; `donnees-personnelles` 40/40. Aucun push. HOME `_qa/lisa/home`. Reste : GK10 `telegram-inconnu-journey` flaky (préexistant) ; `revue-gemini-docs` exige `dist/index.js` (clone sans build).
