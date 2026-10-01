# FAQ

The [current evidence catalogue](PROVEN-FEATURES.md) gives each showcase feature one status, a reason and any recorded scenario limit. Architecture descriptions and historical demos do not establish a fresh installation.

### What is Code Buddy?

A local-first terminal coding agent: a model proposes actions and repository tools execute them under the configured permissions. Provider routing, tool selection, memory and optional integrations surround that loop. No fixed provider or tool count is claimed here.

### Does a small local model complete a coding task?

That is the October 8 release criterion: a fresh installation, a small local model, a first coding task and inspection of the result. It is **not proven here**. Ollama needs a model that supports tool calls; historical demos do not validate this candidate's first-run experience.

### Is my code sent to the cloud?
With **local Ollama**, model inference stays on the configured Ollama host; no cloud model API or telemetry is required. Web research, network tools and configured integrations can still contact external services. If you choose a cloud provider or the ChatGPT login, model requests go to that provider. Secrets are redacted before fleet routing (`privacy-lint`), and peer tools are fail-closed behind a workspace root.

The intended local path uses Ollama. Cloud providers and network integrations are optional; the data sent depends on the provider, tools and peers you enable. Choosing a local model alone does not establish that every enabled tool stays offline. Consult the [security guide](security.md) and your configuration.

### What does local execution cost?

Local inference uses your hardware and electricity. Cloud requests depend on your provider and subscription. This page makes no measured cost or automatic paid-escalation claim.

### What about Cowork, the fleet and voice?

They are optional integrations. Their current showcase entries are **not proven here**, with reasons in the [catalogue](PROVEN-FEATURES.md). The [Cowork guide](cowork.md) and [fleet guide](fleet-guide.md) describe configuration and separate historical accounts from current evidence.

### Which runtime and platforms?

The root CLI declares Node.js ≥ 20; Cowork declares Node.js ≥ 22. Windows, macOS and the desktop UI have not been executed in this documentation audit. See [installation](install.md) for platform-specific instructions; those instructions do not certify all platforms.

### Is this release ready?

This checkout is a 2.3.0 candidate. Historical release validation does not settle the fresh-installation criterion for this candidate. Check the installed version and the [current limits](../README.md#not-ready).

### How do I try it?

Follow the [installation guide](install.md), configure a tool-capable local model and give it a small task in a disposable project. Inspect generated files and run the project's checks. A successful process exit alone does not prove the coding result.

### Can I extend it?

The repository contains tool, skill and MCP integration interfaces. See the [tool reference](tools-reference.md). Their presence in the source does not establish successful execution of every integration.
