# Réparation TAUTFIX1 — trois tests tautologiques (revue AGYTAUT1)

Clone : `~/DEV/cb-tautfix1-2026-09-03`
Branche : `fix/tautfix1-tests-tautologiques-2026-09-03`
HEAD de départ : `7309ea66f`
Agent : Grok 4.6
Date : 2026-09-03
HOME temporaire : `_qa/tautfix1/home` (dans le clone uniquement)
Original `~/code-buddy` : interdit en écriture

Ce rapport a été créé **avant toute inspection du code**. Les sections ci-dessous ont été remplies après lecture.

Source de la revue : `~/DEV/cb-agytaut1-2026-09-03/RAPPORT-AGYTAUT1.md` (lecture seule).

Aucun `it.skip`, aucun test supprimé. Production inchangée (les mutations de preuve ont été restaurées).

## Mission

Rendre rougissables les trois tests signalés :

1. `tests/companion/proactive-engine.test.ts:168` — nom de garde-fou vs corps qui valide la diffusion d'un énoncé toxique.
2. `tests/commands/gk34-batch.test.ts:138` — le test exerce son bouchon `spawnFn` (`success:false`) et non la garde de production.
3. `tests/unit/config-command.test.ts:208` — assertion d'un appel de mock, pas du rendu du thème actif.

## Décisions

### Trouvaille 1 — filtre relationnel

Le filtre **existe** et est câblé. `runProactiveTick` appelle `guardRelationshipReply(line)` après le raffinement LLM, journalise une intervention, puis livre `guardedLine.response` (local ou Telegram).

`DEPENDENCY_PRESSURE` (et les listes de dénigrement / coercition) sont **vides par demande opérateur** (`src/conversation/relationship-safety.ts` : « Anti-dependency gate: disabled by operator request »). La phrase « Tu n'as besoin que de moi. » passe donc volontairement. Restaurer ces motifs serait un changement de politique produit, hors mission.

Le nom du test ne mentait pas sur l'existence de la garde ; le **corps** testait l'inverse (livraison brute) sur un motif désactivé. Choix : garder le nom, changer le payload pour un énoncé que `SUBJECTIVE_CLAIMS` attrape encore (`J'ai une conscience.`), et assertionner la réparation `SAFE_RELATIONSHIP_REPAIR` côté `say()` (présent) sans Telegram.

Mute de `line = guardedLine.response` → rouge. Les tests de `relationship-safety` documentent déjà le pass-through des motifs de dépendance.

### Trouvaille 2 — garde « pas de done sans fichier modifié »

La garde de production est `executeBatchPlan` (`batch-handlers.ts`) :

```
if (value.success && value.filesChanged && value.filesChanged.length === 0) {
  results.push({ ...value, success: false, summary: value.summary?.trim() ? value.summary : 'No files changed' });
}
```

Le bouchon renvoyait déjà `success: false` + `summary: 'No files changed'` : la garde n'était jamais sollicitée. Réécriture : `success: true` + `filesChanged: []` + `summary: ''` ⇒ la garde refuse et substitue le résumé. Mute `if (false && …)` → `success` reste `true` → rouge.

### Trouvaille 3 — marqueur de thème courant

`handleTheme` marque le thème actif avec `▶` (`ui-handlers.ts`, ligne du `marker`, pas la ligne 36 du rapport de lecture). Le test n'assertionnait que `mockGetCurrentTheme`. Il assertionne maintenant le texte imprimé (`▶ Dark`, pas `▶ Default` / `▶ Neon`). Mute `const marker = " "` → rouge.

Trois `result` inutilisés préexistants dans le même fichier (hors thème) ont été retirés pour `eslint --max-warnings=0`.

## Preuves

Témoin vert commun, avant mutations (HOME `_qa/tautfix1/home`) :

```
npx vitest run tests/companion/proactive-engine.test.ts tests/commands/gk34-batch.test.ts tests/unit/config-command.test.ts
 Test Files  3 passed (3)
      Tests  113 passed (113)
```

### Trouvaille 1 — mute du filtre

Diff exact (restauré ensuite) :

```
--- a/src/companion/proactive-engine.ts
+++ b/src/companion/proactive-engine.ts
@@
-    line = guardedLine.response;
+    // TAUTFIX1 mute: skip applying the relationship-safety gate.
```

Rouge :

```
 FAIL  tests/companion/proactive-engine.test.ts > runProactiveTick — end to end (injected delivery seams, no model) > gates an unsafe LLM refinement before local or Telegram delivery
AssertionError: expected 'J\'ai une conscience.' to be 'Je veux rester honnête : je peux t\'a…' // Object.is equality

Expected: "Je veux rester honnête : je peux t'accompagner dans cet échange et soutenir tes liens, sans remplacer les personnes qui comptent pour toi."
Received: "J'ai une conscience."

 Test Files  1 failed (1)
      Tests  1 failed | 23 skipped (24)
```

Restauration → `1 passed | 23 skipped (24)`.

### Trouvaille 2 — mute de la garde empty-diff

Diff exact (restauré ensuite) :

```
--- a/src/commands/handlers/batch-handlers.ts
+++ b/src/commands/handlers/batch-handlers.ts
@@
-        if (value.success && value.filesChanged && value.filesChanged.length === 0) {
+        if (false && value.success && value.filesChanged && value.filesChanged.length === 0) {
```

Rouge :

```
 FAIL  tests/commands/gk34-batch.test.ts > GK34 /batch success contract > a spawn that changes no files is not reported as success
AssertionError: expected true to be false // Object.is equality
- false
+ true

 Test Files  1 failed (1)
      Tests  1 failed | 11 skipped (12)
```

Restauration → `1 passed | 11 skipped (12)`.

### Trouvaille 3 — mute du marqueur

Diff exact (restauré ensuite) :

```
--- a/src/commands/handlers/ui-handlers.ts
+++ b/src/commands/handlers/ui-handlers.ts
@@
-      const marker = isCurrent ? "▶" : " ";
+      const marker = " ";
```

Rouge :

```
 FAIL  tests/unit/config-command.test.ts > Theme Handler > handleTheme > should mark current theme
AssertionError: expected '🎨 Available Themes\n════════════════…' to contain '▶ Dark'

- ▶ Dark
+ 🎨 Available Themes
…

 Test Files  1 failed (1)
      Tests  1 failed | 76 skipped (77)
```

Restauration → `1 passed | 76 skipped (77)`. `git diff` production vide après restauration.

## Vérifications finales

```
npx vitest run tests/companion/proactive-engine.test.ts tests/commands/gk34-batch.test.ts tests/unit/config-command.test.ts
 Test Files  3 passed (3)
      Tests  113 passed (113)

npx vitest run tests/security/donnees-personnelles.test.ts
 Test Files  1 passed (1)
      Tests  1 passed (1)

npx tsc --noEmit -p .          → code 0
npx eslint tests/companion/proactive-engine.test.ts tests/commands/gk34-batch.test.ts tests/unit/config-command.test.ts --max-warnings=0
                               → code 0
git diff --check               → code 0
```

Aucun push, aucune API payante, aucun service systemd, ComfyUI 8188/8189 non touchés. Original `~/code-buddy` non écrit.

## Bilan (dix lignes max)

1. Trois tests tautologiques rendus sensibles ; production inchangée.
2. T1 : la garde `guardRelationshipReply` est câblée ; les motifs de dépendance restent vides (opérateur) ; le test exerce désormais une claim de conscience.
3. T1 mute `line = guardedLine.response` → rouge (`J'ai une conscience.` livré) ; restauration → vert.
4. T2 : bouchon `success:true` + `filesChanged:[]` ; la garde d'`executeBatchPlan` refuse.
5. T2 mute `if (false && …)` → rouge (`success` reste true) ; restauration → vert.
6. T3 : assertion du texte `▶ Dark` ; mute du marqueur → rouge ; restauration → vert.
7. Union ciblée 3 fichiers / 113 tests verts ; `donnees-personnelles` 1/1 ; `tsc` 0 ; eslint ciblé 0 ; `git diff --check` 0.
8. Un commit par trouvaille + un commit documentaire.
9. Ouvert : la politique « anti-dépendance désactivée » n'a pas été rouverte.
10. Ouvert : fusion humaine vers la cible canonique ; aucun push.
