# Reprise — déduplication du contexte en ajout seul

Date : 2026-10-04. Agent : Grok 4.7. Worktree `<dev>/cb-cache-prefixe-2026-10-04`, branche `perf/cache-prefixe-2026-10-04`.
Revue : `<partage>/20261004-grok-contexte-ajout-seul/revue/RAPPORT.md` (À REPRENDRE, un bloquant).
Départ relu : `b5e6a5f2e27a5951710d641c151dbc4c3891dc1e`. Aucun push.
HOME isolé : `_qa/contexte-ajout-seul/home`.

## Bloquant

`dedupeContextMessages` gardait la première occurrence. Un état revenu en arrière (todo `A` → `A,B` → `A`, leçon, JIT) était jeté : le modèle continuait de voir l'état intermédiaire. `appendMemoryIfChanged` avait la même comparaison contre tout l'historique, donc une mémoire revenue à un texte déjà vu n'était jamais ré-émise.

## Cause

Un `Set` de tous les textes déjà vus. Le bloc courant, identique à un bloc ancien mais différent du dernier, était retiré de la copie envoyée au fournisseur. La mémoire refusait le même texte dès qu'il apparaissait dans n'importe quel message system, y compris le prompt scellé du premier tour.

## Correction

On ne retire un bloc que s'il répète le dernier texte déjà retenu pour le même marqueur (todo, leçon, JIT, environnement, réglages). Un voisin différent ne fait pas répéter un bloc inchangé. La mémoire compare le dernier bloc seulement. L'ajout reste en fin : le préfixe déjà envoyé n'est pas réécrit. Le sceau, le repère Anthropic et le texte des consignes ne sont pas retouchés.

Correctif : `b506e637f40c49e08628a5afeddc45da6e80a9a9`.

## Preuve

Avant le correctif, `tests/prompts/append-only-context.test.ts` : 3 échecs / 8.

- `A` → `A,B` → `A` : le préfixe du tour 2 tenait, mais la liste de todos s'arrêtait à `A,B` (le troisième `A` était absent).
- JIT `v1` → `v2` → `v1` : `v1` final absent. La leçon inchangée n'était pas répétée (cette assertion passait déjà).
- Mémoire revenue à `memoire-stable` : `appendMemoryIfChanged` renvoyait `false`.

Après : le même fichier 8/8. `tests/agent/execution/append-only-prefix.test.ts` 1/1 (cinq tours, préfixe strict). `tests/codebuddy/providers/provider-openai-compat-hooks.test.ts` 11/11.

Barrière : `npm test -- tests/services tests/agent tests/context tests/prompts` — 326 fichiers, 3855 tests, verts. Lint : 0 erreur, 2601 avertissements. Typecheck et build : code 2, seulement les deux `TS2307` `@phuetz/companion-core` déjà présents à la base. `tsc` s'arrête avant la copie d'assets.

## Tête

Correctif, 40 caractères : `b506e637f40c49e08628a5afeddc45da6e80a9a9`.
Le commit documentaire (ce fichier et la ligne de coordination) est le successeur immédiat sur `perf/cache-prefixe-2026-10-04`.

## Ce que je n'ai pas pu vérifier

- Le taux de cache réel chez le fournisseur après ce correctif : pas de nouvel appel payant. Le test de préfixe strict couvre l'ajout en fin ; il ne mesure pas le cache réseau.
- Anthropic (placement du repère seulement), Windows, Ollama / LM Studio / vLLM (fusion des messages system), `--continue` d'un processus à l'autre.
- `detachVolatileContext` reste sans appelant de production. Non bloquant, non modifié.
