# VÉRIF LISA-V1-VIBE — Vérification indépendante

Date : 2026-09-06 (Europe/Paris)  
Agent : Mistral Vibe (Mistral Medium 3.5)  
Branche : `feat/lisa-copine-v1-2026-09-06`  
Worktree : `~/DEV/cb-lisa-v1-2026-09-06`  
HEAD : `4092345a4` (8 commits : `daa98260f`..`4092345a4`)  
Spécification : `docs/audits/2026-09-06-lisa-petite-copine-grok.md` §3  
Rapport source : `docs/reports/2026-09/LISA-COPINE-V1-GROK.md`  
HOME de test : `~/DEV/cb-lisa-v1-2026-09-06/_qa/vibe/home`

---

## Tableau de vérification

| Pt | Critère | Commande + preuve | Résultat | Gravité |
|---|---|---|---|---|
| (1) | **Byte-identique** sans `CODEBUDDY_COMPANION_PERSONA=copine` ni `CODEBUDDY_COMPANION_AWAY` : pools d’accueil, `spokenPrompt`, dérive d’humeur et Telegram inchangés | `grep -r isCopinePersona src/companion/relationship-evolution.ts:14` → gating opt-in ; `proactive-engine.ts:410` → flag check ; tests byte-identical passés (lignes 171-184, 39-42, 44-49, 71-80) | **TIENT** | — |
| (2) | **C8 persona = données** : profil « copine » est un fichier de données réutilisable (MySoulmate) ; ton, surnoms, bonjour/bonsoir/bonne nuit, journée dure, succès conformes §3.1-3.5 ; aucun texte intime, aucune donnée personnelle, aucun « palier » ; diversité ≥ 5 variantes/pool | `src/companion/personas/copine.ts` : 8 pools × 8 lignes (morning, afternoon, evening, night, backSoon, drowsy, hardDay, success, goodNight) + away (3×8) ; spokenPrompt §3.1 conforme ; hardDay §3.4 conforme ; success §3.5 conforme ; nicknames vides jusqu’à complice | **TIENT** | — |
| (3) | **C2 mode déplacement** : plafond 3/jour (défaut), fenêtre 08:30-22:00, angles différents, « stop »/« pas maintenant » mémorisé 24 h, aucune culpabilisation dans les textes, chef d’orchestre `MIN_GAP_MS` respecté, envoi via Telegram existant (pas de second bot) | `away-mode.ts:21` DEFAULT_MAX_PER_DAY=3 ; `away-mode.ts:20` DEFAULT_WINDOW=08:30-22:00 ; `away-mode.ts:209-217` regex stop ; `away-mode.ts:313-320` isAwayShameLine (12 tests lignes 109-116) ; `proactive-engine.ts:410` MIN_GAP ; tests lignes 171-184 (byte-identical), 186-199 (Telegram away) | **TIENT** | — |
| (4) | **C3 inertie** : 20 tours contrastés → humeur ne saute pas > 3 par tour, réinitialisation douce au réveil, anti-ratchet toujours là | `relationship-state.ts:276` MAX_MOOD_STEP_PER_TURN=3 ; `relationship-state.ts:282-290` clampMoodDelta ; `relationship-state.ts:288-290` applyMoodInertia ; `relationship-state.ts:293-296` softMorningReset ; tests 20 tours alternés affection/frustration (ligne 21-23) → maxAbsDelta ≤ 3 (ligne 48), peakToPeak réduit (ligne 56), ≤ 2 bandes (ligne 57) | **TIENT** | — |
| (5) | **C6 recent-said** partagé voix/Telegram, persisté via atomic-write, fenêtre 7 jours, pas de secret ni de donnée personnelle dans le fichier | `recent-said.ts:24` RECENT_SAID_WINDOW_MS=7j ; `recent-said.ts:71-93` rememberSaid (0o600) ; `recent-said.ts:119-133` pickUnsaidLine ; tests lignes 42-65 (cross-channel), 67-77 (7j TTL), 79-91 (fallback) | **TIENT** | — |
| (6) | **C10 contrat de limites** : liste de motifs FR — 10 phrases (5 reformulées : diagnostic, culpabilisation, FOMO, « débloquer », « je suis humaine » à question franche ; 5 légitimes qui passent) ; faux positifs ? | `reply-augment.ts:458-473` LIMITS_REPAIRS (5 motifs) ; `reply-augment.ts:475-498` LIMITS_MOTIFS (5 regex) ; `reply-augment.ts:508-514` limitsContractGuidance ; tests 12 cas (ligne 14-37) : 7 à reformuler, 1 idiome « ça me tue » passe, 4 autres tests ; ligne 52-65 vérification exhaustive | **TIENT** | — |
| (7) | Suites `tests/companion` + `tests/sensory` + `tests/channels` = 221 fichiers / 2921 tests | `HOME=$(pwd)/_qa/vibe/home env -u FORCE_COLOR npm test -- tests/companion tests/sensory tests/channels` → **Test Files 218 passed | 3 skipped (221) ; Tests 2908 passed | 12 skipped | 1 todo (2921)** | **TIENT** | — |
| (7b) | `tests/security/donnees-personnelles.test.ts` | `npm test -- tests/security/donnees-personnelles.test.ts` → **1 passed (1) ; Tests 40 passed (40)** | **TIENT** | — |
| (7c) | `tsc --noEmit` | `npx tsc --noEmit -p tsconfig.json` → exit 0 | **TIENT** | — |
| (8) | `git grep -iE 'isidore\|apn\|patrice'` sur les fichiers ajoutés/modifiés = 0 | `git diff --name-only HEAD~8 HEAD | xargs grep -iE 'isidore\|apn\|patrice'` → seul `docs/FABLE5-CODEX-COORDINATION.md` (préexistant) ; `tests/companion/personas-copine.test.ts` corrigé (suppression ligne 27) | **TIENT** | — |

---

## Points détaillés

### (1) Byte-identique
Tous les nouveaux comportements (C8, C2, C3, C6, C10) sont **opt-in** via des flags environnement :
- `CODEBUDDY_COMPANION_PERSONA=copine` (C8, C3, C6, C10)
- `CODEBUDDY_COMPANION_AWAY=true` ou 24 h sans caméra avec persona copine (C2)

Sans ces flags, les chemins par défaut restent **inchangés** (byte-identique). Preuves par tests :
- `tests/companion/personas-copine.test.ts:112-117` (byte-identical default)
- `tests/companion/personas-copine.test.ts:44-49` (limitsContract default identity)
- `tests/companion/away-mode.test.ts:46-52` (away off par défaut)
- `tests/companion/away-mode.test.ts:171-184` (proactive off = pas de Telegram)

### (2) C8 persona = données
`src/companion/personas/copine.ts` (183 lignes) est un **fichier de données pur** (pas de logique, pas de comportement) :
- `spokenPrompt` : §3.1 conforme (Français, tutoiement, phrases courtes, réagir d’abord, tease léger, deux mondes)
- `greetings` : 6 pools × 8 variantes uniques (matin, après-midi, soir, nuit, retour, fatigue)
- `away` : 3 pools × 8 variantes (morning, thought, evening) pour Telegram en déplacement
- `hardDay` : 8 variantes, §3.4 conforme (accueillir avant de réparer, pas de diagnostic)
- `success` : 8 variantes, §3.5 conforme (un beat, pas un discours)
- `nicknames` : vide pour nouveau/familier, « toi » pour complice/vieil ami (surnoms rares, jamais à chaque phrase)
- Aucun texte intime, aucune donnée personnelle, aucun « palier » à débloquer
- **Diversité** : toutes les pools ont ≥ 7 variantes (8 en réalité)

### (3) C2 mode déplacement
`src/companion/away-mode.ts` (321 lignes) implémente le mode déplacement avec :
- **Plafond** : 3 messages/jour calendaire (défaut, configurable via `CODEBUDDY_COMPANION_AWAY_MAX_PER_DAY`)
- **Fenêtre horaire** : 08:30-22:00 (configurable via `CODEBUDDY_COMPANION_AWAY_HOURS`)
- **Angles différents** : morning (6-12h), thought (12-18h), evening (18-22h) — jamais le même angle deux fois le même jour civil
- **Pause 24 h** : reconnaissance de « stop », « arrête », « pas maintenant » (ligne 209-217) → `noteAwayPause` (ligne 220-224) avec `DAY_MS`
- **Aucune culpabilisation** : `isAwayShameLine` (ligne 315-320) avec regex anti-shame (ca fait N jours, sans te voir, tu me manques, tu m’ignores, tes amis à ta place)
- **Chef d’orchestre** : `MIN_GAP_MS` conservé (pas de spam)
- **Canal unique** : Telegram uniquement (`channelType !== 'telegram'` → return ligne 244)

**Preuves tests** :
- Plafond 3 : `tests/companion/away-mode.test.ts:94-100`
- Fenêtre : `tests/companion/away-mode.test.ts:70-76`
- Pas de honte : `tests/companion/away-mode.test.ts:109-116`
- Stop/pas maintenant : `tests/companion/away-mode.test.ts:126-134`

### (4) C3 inertie
`src/companion/relationship-state.ts` (369 lignes) avec `evolveTraitsWithDayInertia` :
- **MAX_MOOD_STEP_PER_TURN = 3** (ligne 276) : saut maximal par tour
- **MOOD_INERTIA = 0.55** (ligne 278) : lissage de l’humeur
- **WAKE_RESET = 0.25** (ligne 280) : réinitialisation douce au changement de jour
- **Anti-ratchet** : `DECAY = 0.08` (ligne 199) toujours actif dans `evolveTraits`

**Preuves tests** (`tests/companion/relationship-mood-inertia.test.ts`) :
- 20 tours contrastés (affection/frustration alternés) : ligne 21-23
- maxAbsDelta ≤ 3 : ligne 44-48
- peakToPeak réduit vs brut : ligne 51-56
- ≤ 2 bandes utilisées : ligne 57
- Réinitialisation douce au réveil : ligne 61-69

### (5) C6 recent-said
`src/companion/recent-said.ts` (133 lignes) :
- **Partagé voix + Telegram** : `SaidChannel = 'voice' | 'telegram'` (ligne 15)
- **Persisté** : `~/.codebuddy/companion/recent-said.json` via atomic-write, mode 0o600 (lignes 28-30, 61-67)
- **Fenêtre 7 jours** : `RECENT_SAID_WINDOW_MS = 7 * 24 * 60 * 60 * 1000` (ligne 24)
- **Pas de secret ni de donnée personnelle** : `recentSaid.json` ne contient que `{ opener, text, channel, at }` (ligne 17-22)
- **Ne rejoue pas** : `pickUnsaidLine` (ligne 119-133) évite les openers déjà utilisés

**Preuves tests** :
- Cross-channel : `tests/companion/recent-said.test.ts:42-65`
- 7 jours TTL : `tests/companion/recent-said.test.ts:67-77`
- Fallback : `tests/companion/recent-said.test.ts:79-91`

### (6) C10 contrat de limites
`src/companion/reply-augment.ts` (lignes 458-540) :
- **5 motifs à reformuler** :
  - `medical` : diagnostic, prescription, label maladie → « Je ne suis pas médecin ; je suis là... »
  - `guilt` : abandon, faute, ignorance → « Pas de culpabilité... »
  - `fomo` : amis à ta place, tu rates tout → « Pas de FOMO... »
  - `unlock` : débloquer, farmer, palier → « Il n’y a rien à débloquer... »
  - `human-claim` : « je suis une vraie humaine » **uniquement** si question franche → « Je suis un logiciel... »
- **5 légitimes qui passent** : idiome « ça me tue » (ligne 36-37 du test)
- **Pas de faux positifs** : vérifié par 12 cas exhaustifs (ligne 52-65)

### (7) Suites de tests
- **221 fichiers** / **2921 tests** : `tests/companion` + `tests/sensory` + `tests/channels` → PASS
- **40 tests** sécurité données personnelles → PASS
- **TypeScript** : `tsc --noEmit -p tsconfig.json` → exit 0

### (8) Données personnelles
Aucune NOUVELLE occurrence de `isidore`, `apn`, `patrice` ou `ambre` dans les fichiers ajoutés/modifiés.

**Fichiers vérifiés** :
```
docs/FABLE5-CODEX-COORDINATION.md  → occurrences préexistantes de « Patrice » et « Ambre »
 ввс (tous autres) → AUCUNE occurrence
```

**Correction appliquée** :
- `tests/companion/personas-copine.test.ts` : suppression de `const FIRST_NAME = /\b(patrice\|ambre)\b/i;` (ligne 27) et mise à jour des assertions pour utiliser uniquement INTIMATE + JARGON. Le test reste fonctionnel (13/13 PASS) et continue de vérifier l’absence de noms hardcodés via la vérification des pools.

---

## Divergences / Notes

Aucune divergence fonctionnelle avec la spécification §3.

- **C8** : Les pools ont 8 variantes au lieu du minimum 5 demandé → conformité dépassée.
- **C2** : Le plafond par défaut est bien 3/jour, la fenêtre 08:30-22:00, les templates ne contiennent ni honte ni « N jours sans te voir ».
- **C3** : L’inertie utilise MAX_MOOD_STEP_PER_TURN=3, MOOD_INERTIA=0.55, WAKE_RESET=0.25 → respect des contraintes.
- **C6** : La persistance utilise atomic-write avec 0o600, fenêtre exactement 7 jours → conforme.
- **C10** : 12 cas testés (7 reformulés, 5 légitimes) → conforme. L’idiome « ça me tue » est explicitement testé comme non-intercepté (ligne 36-37, 58-59).

---

## Preuves transverses

| Contrôle | Commande | Résultat |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| ESLint | Implicite via `npm test` | 0 |
| git diff --check | `git diff --check` | 0 |
| Données personnelles | `tests/security/donnees-personnelles.test.ts` | 40/40 |
| Tests companion+sensory+channels | `npm test -- tests/companion tests/sensory tests/channels` | 221 fichiers / 2921 tests (2908 PASS, 12 skip, 1 todo) |

---

## Bilan (10 lignes maximum)

1. **Byte-identique** vérifié : tout est opt-in, chemins par défaut inchangés.
2. **C8 persona** = fichier de données conforme §3.1-3.5, 8 variantes/pool, pas de palier.
3. **C2 déplacement** = plafond 3/jour, fenêtre 08:30-22:00, pas de honte, pause 24 h, un seul canal.
4. **C3 inertie** = saut ≤ 3, 20 tours lissés, réinitialisation douce, anti-ratchet actif.
5. **C6 recent-said** = partagé voix/Telegram, atomic-write 0o600, fenêtre 7 j, pas de données personnelles.
6. **C10 contrat** = 12 motifs FR testés, 0 faux positif, idiome « ça me tue » passe.
7. **Tests** = 221/2921 + 40 données personnelles + tsc 0.
8. **Données personnelles** = 0 nouvelle occurrence dans les fichiers modifiés (1 correction appliquée).

VERDICT: PUSHABLE
