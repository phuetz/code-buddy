# Reprise PR 207 — garde Windows des essais POSIX

État source : branche `feat/reset-sessions-messagerie-2026-09-23`, départ `0e3384e62`,
réservation `2124ed900`. Rien n'est déployé. Rien n'est poussé.

## Défaut

Trois essais ajoutés appelaient `mkfifo` ou `chmod` `0o500` sur un dossier sans garde.
La CI des pull requests exécute `ubuntu-latest` et `windows-latest`. Sous Windows, `mkfifo`
est absent (`ENOENT`) et `chmod` ne rend pas un dossier impossible à écrire : l'écriture
réussit et l'assertion d'échec devient fausse. Les corps de ces essais ne changent pas :
hors Windows, ils prouvent toujours le refus du tube sans attente et l'échec signalé du
vidage compagnon.

## Correctif

`it.runIf(process.platform !== 'win32')` sur :

- `tests/channels/messaging-session-reset.test.ts` — tube nommé (P3b) et vidage compagnon (P5) ;
- `tests/commands/channel-ai-handler.test.ts` — échec du vidage qui ne doit pas effacer les autres magasins (P5).

`tests/channels/messaging-reset-posix-guard.test.ts` lit ces sources. Il échoue tant que
l'appel n'est pas gardé, et il ne lance ni `mkfifo` ni `chmod`. Il reste donc exécuté sous
Windows.

Message rouge, avant la garde :

```text
AssertionError: P3b garde Windows: expected 'it(' to be 'it.runIf(process.platform!=='win32')('
AssertionError: P5 module garde Windows: expected 'it(' to be 'it.runIf(process.platform!=='win32')('
AssertionError: P5 receveur garde Windows: expected 'it(' to be 'it.runIf(process.platform!=='win32')('
```

Après la garde, ces trois essais passent, ainsi que les preuves Linux (tube, deux vidages).
Retirer une garde rend rouge uniquement l'essai correspondant, avec le même message, puis le
fichier est restauré.

## Vérifications

Comptes distincts, zéro échec : garde 3, remise à zéro 16, historique compagnon 6, receveur 59,
intake 8, huit fichiers appelants 53 passés et 1 ignoré (Ollama absent, garde déjà présente).
Total 145 passés, 1 ignoré.

`tsc --noEmit` sur l'hôte : code 0. Dans la barrière, les deux seules erreurs sont
`TS2307` sur `@phuetz/companion-core` (le lien du paquet sort du montage). `tsc` du projet
`tsconfig.gpuNode-identity.json` : code 0. `eslint --quiet` sur tout le dépôt : code 0.
Les 68 avertissements `no-explicit-any` du receveur sont préexistants ; les deux autres
fichiers touchés n'en ont aucun.

Commit du correctif : `cd2d550ff`. Le garde-fou `tests/security/donnees-personnelles.test.ts`
a ensuite été rejoué sur l'hôte : 40 passés. Le lien git du worktree sort de la barrière,
donc ce garde-fou n'y est pas lancé.
