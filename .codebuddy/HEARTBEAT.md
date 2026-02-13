# Heartbeat Checklist

This file is periodically reviewed by the Heartbeat Engine.
Add items below that should be checked on each heartbeat cycle.
The agent will review these items and surface anything that needs attention.

If the agent determines everything is fine, it responds with `HEARTBEAT_OK`.

## Project Health

- [ ] Are there any failing tests? Run `npm test` to verify.
- [ ] Is the build passing? Check `npm run build` output.
- [ ] Are there uncommitted changes that should be addressed?

## Dependencies

- [ ] Are there any outdated dependencies with known vulnerabilities?
- [ ] Is `package-lock.json` in sync with `package.json`?

## Daemon Status

- [ ] Is the daemon process healthy and responsive?
- [ ] Are cron jobs executing on schedule?
- [ ] Is memory usage within acceptable bounds?

## Code Quality

- [ ] Are there any TODO or FIXME comments that have been open too long?
- [ ] Are there any TypeScript errors or warnings?

## Custom Items

<!-- Add your own heartbeat checklist items below -->
