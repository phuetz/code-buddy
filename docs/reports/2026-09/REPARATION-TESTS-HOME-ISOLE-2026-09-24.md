# Réparation — isolation globale du HOME des tests Vitest (24/09/2026)

Branche `fix/tests-home-isole-2026-09-24`, départ `origin/main` `c2d9d754d`.

## Contexte

Lancée sur un poste réel, une partie de la suite (`tests/commands/`) a effacé le jeton OAuth
de `~/.codebuddy` et y a créé des fichiers : des chemins dérivés de `os.homedir()` sont figés
au chargement des modules, et la configuration Vitest n'isolait que `CODEBUDDY_HOME`, pas `HOME`.

## Démarche

1. Sonde à leurres sur `origin/main` : HOME jetable garni de faux fichiers au bon format,
   suite complète, comparaison de l'arborescence avant/après.
2. Correctif global dans le setup Vitest : `HOME`/`USERPROFILE`/XDG jetables par fichier de test,
   garde qui échoue si `os.homedir()` vaut encore le HOME appelant.
3. Preuve : même sonde sur le commit final, et banc rejoué contre l'ancien setup.

## Résultats

Mesures dans un conteneur sans réseau, HOME appelant garni de faux fichiers (jeton OAuth,
historique, état companion), suite complète (2 319 fichiers, 39 791 tests), instantané avant/après
et trace de chaque appel `fs` visant ce HOME, attribuée au fichier de test.

| Révision | Créés | Modifiés | Supprimés | Lus | Fichiers de test écrivains |
|---|---|---|---|---|---|
| `c2d9d754d` (départ) | 203 | 5 | 0 | 7 | 69 (+1 CLI enfant) |
| correctif `1fb5325c6`, passe 1 | 0 | 0 | 0 | 0 | 0 |
| correctif `1fb5325c6`, passe 2 | 0 | 0 | 0 | 0 | 0 |
| mutant : correctif + ancienne configuration Vitest (69 écrivains) | 200 | 5 | 0 | 4 | 69 |
| `tests/commands/` sur main après la PR #206 | 27 | 4 | 0 | 5 | 9 |
| même lot, fusion à blanc main + correctif | 0 | 0 | 0 | 0 | 0 |

Les deux fichiers companion modifiés au départ viennent de `tests/commands/channel-ai-handler.test.ts`.
Après le correctif, seuls restent des accès en LECTURE voulus : l'empreinte du globalSetup d'hygiène
(`statSync`) et le test d'existence des navigateurs Playwright de l'appelant.

Mutants : l'ancienne configuration fait échouer `tests/hygiene/home-isolation.test.ts` (chemin figé
du jeton Codex) ; retirer la garde fait échouer le test de garde (le corps du test imbriqué s'exécute).

Échecs restants des passes complètes : dépassements du délai de 20 s et courses préexistantes
(par exemple, `render-native-fashion-clip` rejette sur le premier de trois gabarits manquants via
`Promise.all`), variables d'une passe à l'autre, sur un hôte à charge 45-124. Le départ en a aussi
(1 délai dépassé). Typecheck 0 ; lint 0 erreur.
