# Skills and watcher health

Use `buddy skills --help` for the installed skill manager and
`buddy improve skills-list` to inspect locally authored skills. Authored trigger
derivation makes a skill discoverable; it does not execute the skill.

## Watcher health

The skill registry can lose filesystem observers when the operating system
refuses a watch (`ENOSPC`, `EMFILE`, or `ENFILE`). It logs a diagnostic, reads the
files on demand and attempts to restore watches. An exhausted watch quota is
not proof that skill contents are missing or that a skill can execute.

Inspect the registry warnings and the operating system's limits before changing
quotas. Linux has `fs.inotify.max_user_watches` and `fs.inotify.max_user_instances`;
raising them changes the host configuration and is not done by the registry.

The focused regression suite is `tests/skills/skill-registry.test.ts` in a source
checkout. Its simulated failures exercise the fallback; they do not establish
that every host can recover from resource exhaustion.
