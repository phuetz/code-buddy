# AI Providers

Code Buddy resolves providers through a shared runtime catalog in
`src/providers/provider-catalog.ts`. The catalog mirrors the Hermes-style
runtime split: provider id, API mode, base URL, credential source, and default
model are resolved before the agent loop builds a client.

The main `CodeBuddyClient` path directly supports ChatGPT OAuth,
OpenAI-compatible endpoints, and Gemini native. Azure OpenAI, AWS Bedrock, and
GitHub Copilot remain plugin-native providers because they need non-standard
auth headers or request transports.

## Provider Table

| Provider | Runtime path | Env / credential | Models (examples) |
|:---------|:-------------|:-----------------|:------------------|
| **ChatGPT OAuth** | direct Responses Lite | `buddy login chatgpt` | gpt-5.6-sol (default), gpt-5.6-terra, gpt-5.6-luna |
| **Ollama** | direct OpenAI-compatible | `OLLAMA_HOST` | qwen2.5-coder, llama3, devstral |
| **LM Studio** | direct OpenAI-compatible | `LMSTUDIO_HOST` / `LM_STUDIO_HOST` | Any local served model |
| **Grok** (xAI) | direct OpenAI-compatible | `GROK_API_KEY` / `XAI_API_KEY` | grok-4, grok-code-fast-1 |
| **Gemini** (Google) | direct Gemini native | `GOOGLE_API_KEY` / `GEMINI_API_KEY` | gemini-2.5-flash, gemini-2.5-pro |
| **OpenAI** | direct OpenAI-compatible | `OPENAI_API_KEY` | gpt-4o, o-series |
| **Claude** (Anthropic) | direct OpenAI-compatible | `ANTHROPIC_API_KEY` | claude-sonnet-4, opus |
| **Mistral** | direct OpenAI-compatible | `MISTRAL_API_KEY` | mistral-large, codestral |
| **Groq** | direct OpenAI-compatible | `GROQ_API_KEY` | Llama, Mixtral |
| **Together AI** | direct OpenAI-compatible | `TOGETHER_API_KEY` | Open models |
| **Fireworks AI** | direct OpenAI-compatible | `FIREWORKS_API_KEY` | Open models |
| **OpenRouter** | direct OpenAI-compatible | `OPENROUTER_API_KEY` | 100+ routed models |
| **NovitaAI** | direct OpenAI-compatible | `NOVITA_API_KEY` | Kimi, DeepSeek, Qwen |
| **z.ai / GLM** | direct OpenAI-compatible | `GLM_API_KEY` / `ZAI_API_KEY` | glm-5, glm-5-code |
| **Kimi / Moonshot** | direct OpenAI-compatible | `KIMI_API_KEY` / `MOONSHOT_API_KEY` | kimi-k2.5, kimi-latest |
| **Kimi / Moonshot China** | direct OpenAI-compatible | `KIMI_CN_API_KEY` | kimi-k2.5, moonshot-v1 |
| **Arcee AI** | direct OpenAI-compatible | `ARCEEAI_API_KEY` | Trinity, AFM |
| **GMI Cloud** | direct OpenAI-compatible | `GMI_API_KEY` | DeepSeek, GLM, Gemini-routed models |
| **MiniMax** | direct OpenAI-compatible | `MINIMAX_API_KEY` | MiniMax-M2.x |
| **MiniMax China** | direct OpenAI-compatible | `MINIMAX_CN_API_KEY` | MiniMax-M2.x |
| **Alibaba / DashScope** | direct OpenAI-compatible | `DASHSCOPE_API_KEY` | Qwen |
| **Alibaba Coding Plan** | direct OpenAI-compatible | `ALIBABA_CODING_PLAN_API_KEY` | Qwen Coder |
| **Kilo Code Gateway** | direct OpenAI-compatible | `KILOCODE_API_KEY` | Gateway-routed models |
| **Xiaomi MiMo** | direct OpenAI-compatible | `XIAOMI_API_KEY` | MiMo |
| **Tencent TokenHub** | direct OpenAI-compatible | `TOKENHUB_API_KEY` | TokenHub-routed models |
| **OpenCode Zen / Go** | direct OpenAI-compatible | `OPENCODE_ZEN_API_KEY` / `OPENCODE_GO_API_KEY` | OpenCode-routed models |
| **DeepSeek** | direct OpenAI-compatible | `DEEPSEEK_API_KEY` | deepseek-chat, deepseek-reasoner |
| **Hugging Face** | direct OpenAI-compatible | `HF_TOKEN` / `HUGGINGFACE_API_KEY` | Router-served open models |
| **NVIDIA NIM** | direct OpenAI-compatible | `NVIDIA_API_KEY` | Nemotron, NIM catalog |
| **Ollama Cloud** | direct OpenAI-compatible | `OLLAMA_API_KEY` | Cloud-served Ollama models |
| **StepFun** | direct OpenAI-compatible | `STEPFUN_API_KEY` | Step models |
| **vLLM** | direct OpenAI-compatible | `VLLM_BASE_URL` | Self-hosted models |
| **Custom** | direct OpenAI-compatible | `CODEBUDDY_BASE_URL` + `CODEBUDDY_API_KEY` | Any compatible model |
| **Azure OpenAI** | plugin-native | `AZURE_OPENAI_ENDPOINT` | Azure deployments |
| **AWS Bedrock** | plugin-native | `AWS_BEDROCK_REGION` | Bedrock models |
| **GitHub Copilot** | plugin-native | `GITHUB_COPILOT_TOKEN` | Copilot models |
| **Antigravity CLI** | subscription subprocess | `AGY_CLI_PATH` | Dynamically discovered with `agy models` |
| **Lemonade** | local OpenAI-compatible | `LEMONADE_HOST` | Downloaded Ryzen NPU/GPU/CPU models |

Legacy/non-chat helper providers such as Deepgram remain in `src/providers/additional-providers.ts`.

## Subscription and free-capacity providers

Code Buddy keeps subscription authentication separate from metered API keys:

- `buddy login xai` stores and refreshes the Grok/xAI subscription OAuth token;
- ChatGPT OAuth discovers the account's live Codex model catalog and uses
  `gpt-5.6-sol` by default. The catalog is cached with its ETag, so newly
  available models do not require another hard-coded registry update;
- ChatGPT OAuth and Gemini CLI use their existing subscription transports;
- Antigravity is opt-in with `CODEBUDDY_PEER_PROVIDER=agy-cli`. The provider
  always launches `agy` with `--mode plan --sandbox`; Code Buddy remains the
  sole tool executor. Its model names are discovered dynamically through a
  pseudo-terminal because `agy models` requires a TTY;
- OpenRouter defaults to `openrouter/free` and advertises the curated `:free`
  pool from the runtime provider catalog. It remains cloud egress even when the
  selected model costs zero;
- Lemonade model discovery probes `http://127.0.0.1:13305/v1/models`. It is
  selected for chat only when `LEMONADE_HOST` is configured or when the operator
  explicitly sets `CODEBUDDY_PEER_PROVIDER=lemonade`.

Examples:

```bash
# Google Antigravity subscription, read-only advisor
AGY_CLI_PATH="$HOME/.local/bin/agy" \
CODEBUDDY_PEER_PROVIDER=agy-cli \
CODEBUDDY_PEER_MODEL='Gemini 3.1 Pro (High)' buddy server

# Local Lemonade Server
CODEBUDDY_PEER_PROVIDER=lemonade \
LEMONADE_HOST=http://127.0.0.1:13305 \
LEMONADE_MODEL=Qwen3.6-35B-A3B-MTP-GGUF buddy server

# OpenRouter zero-cost router
CODEBUDDY_PEER_PROVIDER=openrouter \
OPENROUTER_MODEL=openrouter/free buddy server
```

## Plugin-Native Transports

Azure OpenAI, AWS Bedrock, and GitHub Copilot are present in the same runtime
catalog as direct providers, but `resolveProviderFromCatalog()` intentionally
does not return them for the main OpenAI-compatible `CodeBuddyClient` path.
Use `resolvePluginRuntimeProvider()` when a feature needs to inspect readiness
for these bundled transports:

| Provider | Plugin | Configured when |
|:---------|:-------|:----------------|
| Azure OpenAI | `bundled-azure-openai` | `AZURE_OPENAI_ENDPOINT` plus `AZURE_OPENAI_API_KEY` or `AZURE_OPENAI_AD_TOKEN` |
| AWS Bedrock | `bundled-bedrock` | `AWS_BEDROCK_REGION` or `AWS_REGION`, plus `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |
| GitHub Copilot | `bundled-copilot` | `GITHUB_COPILOT_TOKEN`, `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` |

The CLI shows these in a separate `Plugin-native providers` section under
`buddy provider list`. `buddy provider set` remains limited to direct providers
until the active chat runtime can dispatch through these plugin transports.

## Runtime Detection

`detectProviderFromEnv()` now uses the runtime catalog. Detection order is:

1. `CODEBUDDY_PROVIDER` override, including aliases such as `claude`, `xai`,
   `google`, `lm-studio`, `glm`, `kimi`, `dashscope`, and `hf`.
2. ChatGPT OAuth credentials from `~/.codebuddy/codex-auth.json`.
3. Local providers configured by host URL: Ollama, LM Studio, then vLLM.
4. Cloud API-key providers in catalog priority order, including Hermes-style
   OpenAI-compatible provider IDs such as `novita`, `zai`, `kimi-coding`,
   `minimax`, `alibaba`, `deepseek`, `huggingface`, and `nvidia`.

For local providers the catalog normalizes host-only values to OpenAI-compatible
`/v1` base URLs. For example, `OLLAMA_HOST=localhost:11434` resolves to
`http://localhost:11434/v1`.

## Local Models (Ollama) — Agentic Loop Checklist

Three things decide whether a free local model can actually *drive the
agent* (edit files, call tools) instead of just chatting. All three were
validated end-to-end in the [1.0.0 QA campaign](qa/v1.0.0-validation.md):

1. **Force the provider.** Auto-detection prefers an active ChatGPT
   login over `OLLAMA_HOST` — set `CODEBUDDY_PROVIDER=ollama`
   explicitly:

   ```bash
   CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://localhost:11434 \
     GROK_MODEL=qwen3.5:35b buddy -p "..." --output-format json
   ```

2. **Pick a tool-capable family.** `src/config/model-tools.ts`
   deliberately gates `gemma*`, `llama3*`, `deepseek*` and `qwen2.5*` to
   **chat-only** (`supportsToolCalls: false` — they hallucinate tool
   JSON as text). **`qwen3*` is the supported local agentic family**: it
   reliably emits structured OpenAI tool calls through Ollama.

3. **Raise Ollama's context window.** Ollama's default `num_ctx` (4096)
   is silently fatal for agentic use: the system prompt + tools
   (~6k tokens) overflow it, generation is truncated at 0 tokens
   (`finish_reason: "length"`) and the agent degrades to a placeholder
   answer. Either start the service with `OLLAMA_CONTEXT_LENGTH=16384`
   (or higher), or derive a model with a bigger window:

   ```bash
   printf 'FROM qwen3.5:35b\nPARAMETER num_ctx 32768\n' > Modelfile
   ollama create qwen3.5-ctx32k -f Modelfile
   GROK_MODEL=qwen3.5-ctx32k ...
   ```

## Connection Profiles

Configure profiles in `~/.codebuddy/user-settings.json`:

```json
{
  "connection": {
    "activeProfileId": "grok",
    "profiles": [
      {
        "id": "grok",
        "name": "Grok API (xAI)",
        "provider": "grok",
        "baseURL": "https://api.x.ai/v1",
        "model": "grok-4-latest"
      },
      {
        "id": "lmstudio",
        "name": "LM Studio Local",
        "provider": "lmstudio",
        "baseURL": "http://localhost:1234/v1",
        "apiKey": "lm-studio"
      }
    ]
  }
}
```

Switch profiles at runtime:

```bash
buddy --model grok-code-fast-1
/profile lmstudio            # Switch in-session
/switch gemini-2.5-flash     # Mid-conversation model switch
/switch auto                 # Revert to default
```

## Model Pairs (Architect/Editor)

Split planning and editing across models via TOML config:

```toml
[model_pairs]
architect = "claude-sonnet-4"
editor = "grok-code-fast-1"
```

Planning tasks route to `architect`, code editing routes to `editor`.

## Circuit Breaker and Failover

Each provider has a 3-state circuit breaker (CLOSED/OPEN/HALF_OPEN):
- **Failure threshold:** 5 consecutive failures opens the circuit
- **Reset timeout:** 30 seconds before trying again
- Opt-in via `circuitBreaker: true` in ChatOptions

The model failover chain cascades across providers with health tracking and cooldown periods.

## Hermes-Style Fallback Providers

Code Buddy can try cross-provider fallbacks when the primary `chat()` call
throws, similar to Hermes' `fallback_providers` list. The fallback is scoped to
the failed turn: the next user message starts again with the primary provider.

Configure one or more fallbacks with provider IDs or aliases from the runtime
catalog:

```bash
CODEBUDDY_FALLBACK_PROVIDERS=openai:gpt-4o,openrouter:anthropic/claude-sonnet-4
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
```

For a single fallback, these are equivalent:

```bash
CODEBUDDY_FALLBACK_PROVIDER=kimi
CODEBUDDY_FALLBACK_MODEL=kimi-k2-thinking
KIMI_API_KEY=...
```

Each fallback is resolved through `src/providers/provider-catalog.ts`, so aliases
like `glm`, `kimi`, `dashscope`, and `hf` work the same way as `buddy provider`.
Unconfigured API-key providers are skipped. Requests can disable fallback for a
specific call with `ChatOptions.disableProviderFallback = true`.

If auth profiles are registered for the active provider, Code Buddy tries those
same-provider credential-pool candidates first. A failed auth profile is marked
with the existing cooldown/backoff logic before Code Buddy moves on to the next
credential or to the cross-provider fallback list.

## Hermes-Style Auxiliary Providers

Side tasks can resolve an independent provider/model pair without changing the
main chat model. The resolver lives in `src/providers/auxiliary-provider.ts` and
uses the same runtime catalog as the main provider path. Supported task slots:
`vision`, `browser_vision`, `web_extract`, `approval`, `compression`,
`skills_hub`, `mcp`, `triage_specifier`, and `session_title`.

Provider values follow Hermes semantics:

- `auto` uses the main provider when provided; vision/browser vision prefer
  OpenRouter when `OPENROUTER_API_KEY` is configured.
- `main` forces the active chat provider.
- Any runtime provider id or alias, such as `openrouter`, `glm`, `kimi`,
  `openai-codex`, `dashscope`, or `hf`, resolves through the catalog.

Examples:

```bash
CODEBUDDY_AUXILIARY_COMPRESSION_PROVIDER=openrouter
CODEBUDDY_AUXILIARY_COMPRESSION_MODEL=openrouter/pareto-code
CODEBUDDY_AUXILIARY_COMPRESSION_API_KEY=...
CODEBUDDY_AUXILIARY_COMPRESSION_EXTRA_BODY='{"provider":{"sort":"throughput"}}'

AUXILIARY_VISION_MODEL=openai/gpt-4o
CODEBUDDY_AUXILIARY_WEB_EXTRACT_PROVIDER=main
CODEBUDDY_AUXILIARY_WEB_EXTRACT_TIMEOUT_MS=360000
```

## Auth Profile Manager

Manage multiple API keys per provider with rotation strategies:

```bash
buddy auth-profile list                   # List profiles
buddy auth-profile add <id> <provider>    # Add a profile
buddy auth-profile remove <id>            # Remove a profile
buddy auth-profile reset                  # Reset all cooldowns
```

Supports round-robin, priority, and random rotation strategies with session stickiness and exponential backoff on failures.

## Hermes-Style Provider Notes

The runtime catalog stores the same pieces Hermes surfaces in provider config:
canonical provider id, aliases, auth mode, API mode, env key names, base URL,
default model, and runtime support. Direct providers all flow through the main
`CodeBuddyClient` path: ChatGPT OAuth Responses, Gemini native, or OpenAI-
compatible chat completions.

Providers that require non-standard request signing or account/OAuth flows are
kept out of the direct path until their transport exists. Azure OpenAI, AWS
Bedrock, and GitHub Copilot are therefore still marked plugin-native rather
than silently pretending to be OpenAI-compatible.

### OpenRouter Provider Routing

When `baseURL` resolves to OpenRouter, Code Buddy passes provider routing
preferences through the OpenRouter `provider` request field. Configure them with
environment variables:

```bash
OPENROUTER_PROVIDER_SORT=latency              # price | throughput | latency
OPENROUTER_PROVIDER_ONLY=Anthropic,Google     # allowlist
OPENROUTER_PROVIDER_IGNORE=Azure              # denylist
OPENROUTER_PROVIDER_ORDER=Anthropic,Google    # priority order
OPENROUTER_PROVIDER_REQUIRE_PARAMETERS=true
OPENROUTER_PROVIDER_DATA_COLLECTION=deny      # allow | deny
OPENROUTER_PROVIDER_ALLOW_FALLBACKS=false
```

`CODEBUDDY_OPENROUTER_PROVIDER_*` aliases are also accepted. These options only
affect OpenRouter; direct Anthropic, Gemini, OpenAI, local, and custom endpoints
ignore them.

## Provider Onboarding

New providers go through a 5-phase lifecycle: auth validation, wizard onboarding, model discovery, model picker, and configuration. Bundled providers (OpenRouter, GitHub Copilot, Ollama, vLLM) are loaded automatically via `loadBundledProviders()`.
