# Named profiles

Code Buddy has many advanced settings, most of them environment variables. A
named profile groups the useful ones so a single flag is enough:

```bash
buddy --profile local    # local Ollama only, $0, nothing leaves the machine
buddy --profile cloud    # signed-in cloud providers, with automatic failover
buddy --profile fleet    # settings for a `buddy server` taking part in a fleet
buddy --profile max      # every opt-in quality feature that costs no extra LLM call
```

Profiles are built on the existing TOML profile system
(`[profiles.<name>]` in `~/.codebuddy/config.toml` or `.codebuddy/config.toml`,
see `src/config/toml-config.ts`). The built-in ones live next to `core` and `all`.

## Priority rule — nothing you configured is overridden

A profile only **fills variables that are not already set**. Anything you
exported in your shell, or put in a `.env` file, keeps priority. Explicit flags
(`--api-key`, `--base-url`, `--model`) and `CODEBUDDY_PROVIDER` also win.

## What each profile sets

| Profile | Settings | Effect |
|---|---|---|
| `local` | `CODEBUDDY_PREFER_LOCAL=true`, `CODEBUDDY_LOCAL_ONLY=true` | Uses the local Ollama and its best installed tool-capable model, even when a ChatGPT login exists; failover never walks a cloud provider. Exits with the exact install commands when no usable local model is found. |
| `cloud` | `CODEBUDDY_ZERO_CONFIG=false`, `CODEBUDDY_PROVIDER_FALLBACK=true` | Never falls back silently to a local model; switches to the next signed-in provider on quota, overload or outage. |
| `fleet` | `CODEBUDDY_PROVIDER_FALLBACK=true`, `CODEBUDDY_FLEET_MAX_CONCURRENCY=2` | Failover plus live utilization in heartbeats and saturation backpressure. Remote tools stay closed until you set `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` yourself (a security choice, deliberately not in the profile). |
| `max` | `CODEBUDDY_PROVIDER_FALLBACK=true`, `CODEBUDDY_COLLECTIVE_MEMORY=true`, `CODEBUDDY_CONTEXT_ZOOM=true`, `CODEBUDDY_DIFF_REVIEW=static`, full command surface | Collective memory, lossless-recoverable compaction, deterministic diff review before writes. |

## Writing or adjusting a profile

A profile can carry an `env` table. It is deep-merged with the built-in profile
of the same name, so you can add or change one value:

```toml
[profiles.local.env]
OLLAMA_MODEL = "qwen3:14b"     # pin the local model
```

Or define your own:

```toml
[profiles.review]
model = "gpt-5.5"
[profiles.review.env]
CODEBUDDY_DIFF_REVIEW = "full"
```

`buddy --profile` without a name lists the available profiles.

## Zero configuration

Without any profile or configuration, `buddy` detects a usable provider on its
own: a local Ollama already serving a tool-capable model is used directly (no
variable to export), otherwise it offers `buddy login`, otherwise it prints the
commands to install Ollama and `qwen3:8b`. It always says what it chose and why.
`CODEBUDDY_ZERO_CONFIG=false` turns this off.
