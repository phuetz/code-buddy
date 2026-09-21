# Third-party notices

## OpenClaw

Code Buddy does **not** vendor the OpenClaw runtime.

It interoperates with an OpenClaw install when present:

- gateway discovery / attach (`src/openclaw/gateway-bridge.ts`)
- workspace file contract (`src/openclaw/workspace-files.ts`) — reads
  `SOUL.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md` from
  `~/.openclaw/workspace` when `CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT=true`

OpenClaw is MIT licensed:

```
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

Source: https://github.com/openclaw/openclaw
