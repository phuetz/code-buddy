# REPARATION-CIFIX3 — macOS + Windows CI (2026-09-06)

- **Branche de travail** : `fix/cifix3-macos-windows-2026-09-06` (clone dédié `/home/patrice/DEV/cb-cifix3-2026-09-06`)
- **Branche cible** : `codex/audit-systeme-nerveux-2026-09-01` (PR brouillon #149)
- **Run de référence** : `33918143339`
- **Périmètre** : rendre verts les 4 jobs CI non bloquants encore rouges — macOS Node 20/22 (`Run tests`) et Windows Node 20/22 (`Run tests (shard 1/6)`).

## Règles de la mission
- Aucune désactivation en bloc. Une garde doit être adossée à une sonde d'environnement réelle
  (`process.platform`, présence d'un binaire, d'un `DISPLAY`…).
- Un vrai défaut de portabilité se corrige dans le code : `/private/var` ↔ `/var` via `fs.realpathSync`,
  `wc -l` BSD (espaces initiaux) → parseur tolérant, `posix_spawnp` → binaire absent → garde,
  séparateurs Windows, `\r\n`, quoting.
- `git add` nommément, un commit par point.
- `/home/patrice/code-buddy` et `~/.codebuddy` en lecture seule.

## Journal

### 1. Lecture des journaux CI
(en cours)

## Vérifications
(à remplir)

## Verdict CI
(à remplir)
