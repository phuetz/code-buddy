# Réparation — `buddy security audit --fix` inopérant sur macOS, et fuites de tests dans le dépôt

> Ouvert avant correction, selon la règle du dépôt. Suite de `REPARATION-CI-ROUGE-MAIN-2026-09-24.md`.
> Branche `fix/audit-macos-et-fuites-tests-2026-09-24`.

## Donnée qui tranche (CI de `main`, exécution 36001853267)

Le diagnostic ajouté par #225 a nommé la cause : les deux corrections ont été refusées avec
`open file is outside the audited roots`.

## Cause

`fdInside()` vérifiait qu'un descripteur ouvert est bien dans les racines auditées en lisant
`/proc/self/fd/N`. **macOS n'a pas de `/proc`** : `realpathSync` lève une erreur, la fonction
renvoie `false`, et **`buddy security audit --fix` ne pouvait jamais rien corriger sur un Mac**. Sous
Linux, une racine atteinte par un lien symbolique (comme l'alias macOS `/var` → `/private/var`)
était comparée sous sa forme déclarée au chemin réel du descripteur, ce qui produisait le même refus.

## Correction

- Les racines sont comparées à la fois sous leur forme déclarée et sous leur forme réelle.
- Sans `/proc`, le descripteur doit être **le fichier même** que nomme le chemin attendu (même
  périphérique, même inode que son chemin réel), et ce chemin réel doit être dans les racines.
- Test `consolidated-audit-fd-inside.test.ts` : il reproduit sur n'importe quel POSIX les deux
  conditions de macOS (répertoire proc absent, racine derrière un lien). Il vérifie qu'un fichier
  attendu est accepté, qu'un descripteur ouvert sur un autre fichier est refusé, et qu'un fichier
  hors des racines est refusé.

## Fuites de tests dans le dépôt

Après #225, un autre test a laissé `.r16-import-cli-*` dans le dépôt, et le contrôle `git status`
du catalogue a échoué sous Windows. **Balayage** : les tests qui créaient leurs dossiers
temporaires dans le dépôt (`mkdtempSync(path.join(repoRoot | process.cwd(), '.…'))`) les créent
désormais sous `os.tmpdir()`, soit 11 fichiers.

**Laissés tels quels, volontairement** :
- `tests/cli/headless-output-flags.test.ts` et `tests/commands/dev/dev-lifecycle.test.ts` :
  déplacés, leurs sous-processus expirent au bout de 20 s. Ils dépendent d'un dossier situé dans
  le dépôt, pour une raison qui reste à établir.
- `tests/unit/workspace-isolation.test.ts` : il teste ce qui est à l'intérieur ou à l'extérieur de
  l'espace de travail. Déplacer ses dossiers risquait de vider ses assertions de leur sens sans le
  faire échouer.

Ces trois fichiers peuvent encore, par intermittence, laisser un dossier visible dans le dépôt.
