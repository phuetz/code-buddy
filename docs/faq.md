# FAQ

Straight answers to the things people ask first (and the ones skeptics raise on Hacker News / r/LocalLLaMA).

### Is this just an Ollama/LLM wrapper?
No. The LLM is one piece. Code Buddy is an **agentic loop**: it plans, calls ~110 tools (edit, shell, web, browser, PDFs/Office, code intel), repairs its own errors, manages context/memory, and can run a **multi-AI fleet** (peers call each other's models/tools) and a **24/7 autonomous service**. Swapping the model is one line; the agent around it is the product.

### Does local actually work, or is it a toy?
It works — with a caveat we're honest about: **not every local model can drive tools** (some emit tool calls as plain text). Code Buddy gates tool-calling per model (`getModelToolConfig`) and uses tool-capable local models (e.g. `qwen3.6`, `devstral`) for agentic work. The README demos (reasoning + a real file-creation task) are unedited captures on local Ollama at ~`$0.0001`. Chat-only models work for chat; agentic tasks want a tool-capable one.

### Is my code sent to the cloud?
In **local mode (Ollama), nothing leaves your machine** — no API, no telemetry required. If you choose a cloud provider or the ChatGPT login, requests go to that provider (your choice, your keys). Secrets are redacted before fleet routing (`privacy-lint`), and peer tools are fail-closed behind a workspace root.

### What does it cost?
- **Local (Ollama): `$0`** marginal.
- **ChatGPT Plus/Pro login:** flat-fee, no per-token metering (reported as `$0.0000`).
- **API key:** you pay your provider directly. A free-first ladder only escalates to paid when local genuinely can't do the job.

### How is it different from other coding agents?
Code Buddy's niche is **local-first + multi-surface**: the *same* engine runs in your terminal, an Electron desktop app (Cowork), an HTTP/WS server, on your phone, and as a 24/7 autonomous background service — plus a peer-to-peer **fleet** so machines share models/tools over your network. If you want a free, self-owned agent that's the same everywhere, that's the lane. Try it and see if it fits your workflow.

### Which OSes / models / providers?
Linux, macOS, Windows. **15 providers** (Claude, GPT, Grok, Gemini, Ollama, LM Studio, Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral) with auto-failover. Cowork desktop needs Node ≥ 22; the CLI needs ≥ 18.

### Is it production-ready?
It's a **1.0 release candidate** (rc.8): ~30k tests, builds clean from source (`npm run build`), and the core has been used heavily. Treat it as a capable RC — pin a version, and file issues for anything rough.

### How do I try it in 60 seconds?
```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install && npm run build && npm link
buddy            # then set a provider, or point it at local Ollama for $0
```

### Can I extend it?
Yes — add tools, **Agent Skills** (a marketplace + self-authoring), and **MCP** servers (Code Buddy is both an MCP client and server). See [`docs/`](.).
