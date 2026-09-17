# RAPPORT — Surveillance de dossiers skills (tests rouges sur main 2.2.0)

- Date : 2026-09-18
- Agent : Grok 4.6
- Worktree : `worktree cb-watchers-2026-09-18`
- Branche : `fix/watchers-2026-09-18`
- Base : `origin/main` `b5c50c189` (v2.2.0 publiée)
- Contraintes : pas de commit, pas de `rm -rf` dans le dépôt, pas de publication
- Livrable : `Partage/20260918-surveillance-dossiers/RAPPORT.md`

## Verdict

**(c) limite machine**, avec un **vrai trou produit** quand cette limite est atteinte.

Les quatre tests rouges n’étaient pas fragiles au temps. Ils échouaient parce que `fs.watch` lève `ENOSPC` (« System limit for number of file watchers reached ») lorsque le quota inotify de l’utilisateur est saturé. Le registre avalait l’erreur, ne posait aucun observateur, n’avertissait pas, et ne relisait pas le disque : les assertions voyaient `0` watchers ou un skill jamais chargé, sans expliquer pourquoi.

Ce n’est pas une excuse de CI. Un utilisateur qui a beaucoup d’agents, d’IDE ou d’indexeurs rencontre le même `ENOSPC`.

## Preuves de reproduction

Machine : `fs.inotify.max_user_watches=65536`, `max_user_instances=128`. Node partage **une** instance inotify par processus et consomme des *watches* (un par dossier).

| Condition | Instances | Watches | Les 4 tests |
|---|---|---|---|
| Quota libre (~7k watches) | 74 | 7155 | 8/8 verts (dont les 4) |
| Table occupée mais pas pleine | 76 | 47156 | 8/8 verts |
| Table saturée (filler `ENOSPC`) | 74 | 65430 | **4 rouges / 4 verts**, mêmes noms que la mesure initiale |

Sous saturation, avant correctif :

- `expected [] to have a length of 2 but got +0`
- `expected undefined to be defined`
- `expected 0 to be greater than 0` (deux variantes)

Après correctif, **mêmes 4 tests**, saturation : échec **nommé** :

`The kernel refused a filesystem observer (ENOSPC: inotify limit exhausted (fs.inotify.max_user_watches=65536, fs.inotify.max_user_instances=128)). This is an inotify machine limit`

Les tests de repli (mock `ENOSPC`/`EMFILE`) restent verts y compris table saturée.

## Correctifs (pas de commit)

1. `src/skills/registry.ts` — si `fs.watch` refuse (`ENOSPC`/`EMFILE`/`ENFILE`) : pas de throw, `logger.warn` une fois, `getWatchHealth().degraded`, relecture synchrone à la demande dans `get`/`list`/`search`/`count`/`getAllUnified`, et scan du `SKILL.md` déjà présent même si l’observateur enfant a échoué. Reprise automatique des observateurs dès que le quota se libère.
2. Tests réels : `tests/skills/watch-health.ts` échoue avec le diagnostic inotify au lieu de `expected 0 to be 2`.
3. `tests/skills/registry-watch-unavailable.test.ts` — comportement produit sans observateur.

## Vérifications

- eslint ciblé : 0
- 4 tests + repli, quota libre : 11/11
- 4 tests, ~47k watches : 8/8
- `tests/skills` complet, load ~8.5 : **404 verts / 3 skip / 0 rouge** (30 fichiers)
- HOME QA : `_qa/watchers/home`

Traces : `_qa/watchers/repro/`.
