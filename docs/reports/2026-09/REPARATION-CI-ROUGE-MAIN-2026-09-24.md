# Réparation — `main` rouge depuis le 24/09 6 h 30

> Ouvert avant inspection, selon la règle du dépôt. Branche `fix/ci-rouge-main-2026-09-24`.

## Constat (mesuré)

La CI de `main` échoue à chaque exécution depuis le commit `3224d089c` (fusion #221, qui suit
#209). Deux défauts distincts, lus dans les messages d'assertion :

1. **macOS seulement, `tests/security/consolidated-audit.test.ts:151`**
   (`tightens only loose modes…`) : `expected false to be true` sur `fixed.passed`. Les deux jobs
   macOS échouent à chaque exécution. La CI des PR ne lance pas macOS, et le défaut est entré
   sans être vu.
2. **Windows, par intermittence, `tests/server/catalogue-routes-http-b.test.ts`**
   (`ne laisse dans git que les fichiers du catalogue`) : `git status` du dépôt contient
   `?? .gk18-pr-*/…`. Ce dossier vient de `tests/commands/dev/pr-fail-closed.test.ts`, qui crée
   ses dépôts git temporaires **dans le dépôt** (`mkdtempSync(path.join(repoRoot, '.gk18-pr-'))`).
   Quand les deux fichiers de test tournent en même temps, le second voit le premier.

## Correctifs

- `pr-fail-closed.test.ts` : dépôts temporaires sous `os.tmpdir()`.
- `consolidated-audit.test.ts` : les assertions de réussite affichent les constats et les
  correctifs réels quand elles échouent. **Ce n'est pas encore la réparation du défaut macOS** :
  aucune machine macOS n'est disponible localement, et la cause ne peut pas être déduite du seul
  message `false ≠ true`. La prochaine exécution sur `main` nommera le constat en cause.
- `ci.yml` (`workflow_dispatch`, pour lancer macOS sur une branche avant de fusionner) : **retiré
  de cette PR**. Le jeton `gh` n'a pas la portée `workflow`, et GitHub refuse le push. Le
  changement est conservé sur la branche locale `fix/ci-dispatch-macos-2026-09-24`, à pousser
  après `gh auth refresh -s workflow`.
