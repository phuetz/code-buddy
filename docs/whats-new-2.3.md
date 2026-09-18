# Code Buddy 2.3 — What landed, and what it does not do

These release notes document the features and fixes integrated for the upcoming **2.3.0** release on top of published **2.2.0**.
`package.json` remains untouched in this documentation cycle, and no package has been published.

| Feature / Topic | Area | Documentation |
|:----------------|:-----|:--------------|
| One-click web publish | CLI & Engine | [one-click-deploy.md](one-click-deploy.md) |
| Database & Auth overlay | CLI & Templates | [provision-db-auth.md](provision-db-auth.md) |
| Unified recents (CLI / Cowork / mobile) | CLI & Persistence | [unified-history.md](unified-history.md) |
| Figma import to React screens | CLI & Tool | [figma.md](figma.md) |
| Expo / React Native starter | App Studio & Scaffolding | [expo-mobile-template.md](expo-mobile-template.md) |
| Cowork folder instructions | Cowork UI & Context | [cowork.md](cowork.md#folder-instructions) |
| Authored skills discovery | Self-improvement engine | [self-improvement-engine.md](self-improvement-engine.md#authored-skill-discovery) |
| Kernel watcher limit resilience | Skills registry & inotify | [skills.md](skills.md#watcher-health) |
| Sub-millisecond CLI startup | CLI boot | [performance.md](performance.md#startup-time) |

---

## Key Features and Real Behaviors

### 1. One-click web publish (`buddy deploy run`)
- **What it does:** Builds a web application and publishes its output directory to Cloudflare Pages or Netlify using their official CLIs.
- **Simulation by default:** Runs in dry-run mode unless `--apply` is passed. If both `--dry-run` and `--apply` are passed, `--dry-run` takes precedence.
- **Tokens:** Passed strictly through child process environment variables, never on the command line.

### 2. Database and authentication overlay (`buddy provision db-auth`)
- **What it does:** Overlays versioned SQL migrations, a typed client, and auth pages (`SignIn`, `SignUp`, `SignOut`) onto a web project.
- **Supported targets:** `--target local` (Postgres container setup) or `--target supabase` (Supabase configuration).
- **Simulation by default:** Prints the 14-file generation plan without modifying disk. Requires `--apply` to write files.

### 3. Unified recents (`buddy session list`, `buddy session resume`)
- **What it does:** Aggregates CLI session files, Cowork SQLite threads, and mobile conversations into a unified local metadata cache (`recents-index.json`).
- **Resuming:** Resuming a Cowork session from the CLI creates an automatic bridge file without manual export.
- **Isolation:** Preserves strict isolation when `CODEBUDDY_PROFILE` or `CODEBUDDY_OWNER_USER_ID` is defined.

### 4. Figma REST export import (`buddy figma import`)
- **What it does:** Parses Figma REST JSON exports (or fetches live via file key and personal token) to generate React components and CSS tokens.
- **Offline support:** Runs fully offline when `--json <file>` is provided.
- **Security:** Tokens are never stored on disk; the voice companion is forbidden from invoking Figma import.

### 5. Expo mobile template (`expo-rn`)
- **What it does:** Provides an Expo SDK 52 / React Native project starter with file-based routing (`expo-router`), tabs, theming, Vitest tests, and EAS configuration.
- **Invocation:** Accessed via the `scaffold_app` agent tool or through Cowork App Studio keywords (`expo`, `mobile`, `react native`, `android`, `ios`, `apk`).

### 6. Cowork folder instructions
- **What it does:** Adds a dedicated "Folder Instructions" tab in Cowork Settings (`SettingsFolderInstructions`).
- **Context:** Inspects and edits hierarchical instruction files (`AGENTS.md`, `CODEBUDDY.md`) resolved between project root and current working directory.

### 7. Authored skill triggers discovery
- **What it does:** Automatically derives natural search triggers at write time when the agent authoring loop writes a new skill to disk.
- **Searchability:** Ensures newly created skills can be discovered by `SkillRegistry.search` in subsequent agent turns.

### 8. Kernel inotify watcher resilience
- **What it does:** Prevents crashes when the kernel inotify watch table is exhausted (`ENOSPC` / `EMFILE` / `ENFILE`).
- **Degraded mode:** Switches to synchronous on-demand file reading and periodically attempts to restore filesystem watches once quotas become available.

### 9. Fast CLI startup (`cli-boot.js`)
- **What it does:** Replaces the heavy monolithic process entry with a thin bootstrap loader (`dist/cli-boot.js`).
- **Performance:** Bypasses Commander and large dependency trees for lightweight commands (`--version` down to ~25 ms, `--help` down to ~52 ms).

---

## Critical Limits — What Each Feature Does NOT Do

Reading these boundaries prevents runtime surprises:

1. **`buddy deploy run` does NOT install tools or deploy without `--apply`:**
   - It will never download or install `wrangler` or `netlify-cli`.
   - It never uploads unless `--apply` is specified.
   - It does not create cloud accounts, manage DNS, or perform automated rollbacks.
   - Targets like `fly`, `railway`, `render`, `hetzner`, `northflank`, `gcp`, and `nix` remain config generators under `buddy deploy init` and cannot be published via `buddy deploy run`.

2. **`buddy provision db-auth` does NOT provision remote cloud infrastructure:**
   - `--target supabase` does not create remote Supabase projects, databases, or organizations. The token is used solely as a prerequisite presence check.
   - `--target local` writes a `docker-compose.yml` file, but never starts Docker containers or services.
   - It does not run SQL migrations against live databases.

3. **Unified recents do NOT synchronize transcripts across machines or merge profiles:**
   - The unified index only contains metadata. Full message bodies remain in their original stores.
   - Sessions belonging to different profiles (`CODEBUDDY_PROFILE`) are never merged or visible to each other.
   - It does not modify Cowork SQLite databases and operates fail-open if SQLite is unavailable.

4. **Figma import does NOT store access tokens or support vector shapes:**
   - Personal access tokens must be provided on every run and are never persisted to disk.
   - Arbitrary vector paths and unhandled node types are skipped rather than converted to custom SVG geometries.
   - The voice companion is explicitly blocked from invoking the Figma import tool.

5. **The Expo template does NOT build native binaries or provide a `buddy expo` command:**
   - There is no standalone `buddy expo` command in the CLI.
   - It does not create EAS cloud accounts or submit builds to Apple App Store / Google Play.
   - Compiling native APK/IPA binaries requires local SDKs or manual cloud builds.

6. **Cowork folder instructions do NOT inject non-standard files at startup:**
   - At startup, the prompt builder injects `AGENTS.md` and `CODEBUDDY.md` only (unless `CODEBUDDY_INCLUDE_INTEROP_CONTEXT=true` is set).
   - JIT context loading for child paths occurs only when files in those directories are touched by tools.

7. **Authored skills triggers do NOT auto-execute skills:**
   - Deriving triggers only makes skills discoverable via keyword and similarity searches. It does not execute skills automatically.
