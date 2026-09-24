# Réparation — la réinstallation de secours du garde échoue toujours sous Windows (23/09/2026)

Agent : Opus 5.5 (Claude Code).

## Symptôme

PR #203, job Windows / Node 20, étape « Ensure optional dependencies needed to compile are
present » :

```
[optional-deps] 1/22 optional package(s) imported from src/ are MISSING:
  - better-sqlite3
[optional-deps] Attempting one targeted reinstall…
[optional-deps] The reinstall command itself failed.
```

`better-sqlite3` s'installe normalement sur ce même job (vert sur la #204) : l'absence est
passagère. La réinstallation ciblée est faite pour absorber ce cas, mais elle échoue, et son
erreur est avalée (`catch {}`), donc personne ne voit pourquoi.

Même message sur la #195 plus tôt dans la journée (réinstallation de `usearch`).

## Cause

`execFileSync('npm', …)` sans shell. Sous Windows, `npm` est `npm.cmd`, un fichier de commandes
que `execFileSync` ne peut pas lancer sans shell (ENOENT, ou EINVAL depuis le correctif Node de la
CVE-2024-27980). La réparation échouait donc sur **chaque** runner Windows, quelle que soit la
dépendance manquante ; et le `catch {}` cachait l'erreur.

## Correctif

- sous Windows, `npm` est lancé par le shell, et chaque spécification est entre guillemets
  (`cmd.exe` prend le `^` de `pkg@^1.2.3` pour un caractère d'échappement) ;
- ailleurs, appel inchangé (`shell: false` devient seulement explicite) ;
- en cas d'échec, le message dit pourquoi (`… failed: <erreur>`).

## Vérifications

- Nouveau test : `npm` retiré du `PATH` (même mode d'échec que Windows : la commande ne peut pas
  démarrer) → la sortie doit contenir `failed: … ENOENT`. Vert avec le correctif, **tombe** sur
  l'ancien garde, qui n'affichait que « failed ». Fichier de test : 4/4.
- **Non prouvé ici : le lancement par le shell sous Windows.** Il ne s'exécute qu'au moment où
  une dépendance optionnelle manque sur un runner Windows. Le premier cas réel le confirmera ou
  non, et le message d'erreur désormais affiché dira pourquoi s'il échoue encore.

## Contexte

La PR #203 est tombée sur cette étape (`better-sqlite3` absent, passager). Le job a été relancé ;
ce correctif rend la réparation automatique possible pour la prochaine fois.
