# AI Providers

Code Buddy supports multiple LLM providers with automatic failover and per-provider circuit breakers.

## Provider Table

| Provider | Env Variable | Models (examples) | Context |
|:---------|:-------------|:-------------------|:--------|
| **Grok** (xAI) | `GROK_API_KEY` | grok-4, grok-code-fast-1 | 128K |
| **Claude** (Anthropic) | `ANTHROPIC_API_KEY` | claude-sonnet-4, opus | 200K |
| **ChatGPT subscription** | `buddy login chatgpt` / Codex OAuth | gpt-5.5, gpt-5.1-codex | Varies |
| **OpenAI API** | `OPENAI_API_KEY` | gpt-4o, gpt-4-turbo | 128K |
| **Gemini** (Google) | `GOOGLE_API_KEY` | gemini-2.0-flash (+ vision) | 2M |
| **Mistral** | `MISTRAL_API_KEY` | mistral-large, codestral | 128K |
| **Ollama** | `OLLAMA_HOST` | llama3, codellama, etc. | Varies |
| **LM Studio** | `--base-url` flag | Any local model | Varies |
| **vLLM** | `VLLM_BASE_URL` | Self-hosted models | Varies |
| **AWS Bedrock** | `AWS_BEDROCK_REGION` | Claude, Titan, etc. | Varies |
| **Azure OpenAI** | `AZURE_OPENAI_ENDPOINT` | GPT-4o, etc. | Varies |
| **Groq** | `GROQ_API_KEY` | LLaMA, Mixtral | Varies |
| **Together AI** | `TOGETHER_API_KEY` | Open models | Varies |
| **Fireworks AI** | `FIREWORKS_API_KEY` | Open models | Varies |
| **OpenRouter** | `OPENROUTER_API_KEY` | 100+ models | Varies |
| **GitHub Copilot** | `GITHUB_COPILOT_TOKEN` | Copilot models | Varies |

Additional providers (MiniMax, Moonshot, Venice AI, Deepgram) are available via `src/providers/additional-providers.ts`.

## ChatGPT Subscription Auth

The ChatGPT subscription rail is separate from the OpenAI API rail. It uses the Codex OAuth login stored in `~/.codebuddy/codex-auth.json`, or the shared Codex CLI login in `~/.codex/auth.json`, and routes to the ChatGPT Codex backend with the `oauth-chatgpt` sentinel. It does not require `OPENAI_API_KEY` or API credits.

```bash
buddy login chatgpt
buddy whoami
CODEBUDDY_PROVIDER=chatgpt buddy --model gpt-5.5
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

## Auth Profile Manager

Manage multiple API keys per provider with rotation strategies:

```bash
buddy auth-profile list                   # List profiles
buddy auth-profile add <id> <provider>    # Add a profile
buddy auth-profile remove <id>            # Remove a profile
buddy auth-profile reset                  # Reset all cooldowns
```

Supports round-robin, priority, and random rotation strategies with session stickiness and exponential backoff on failures.

## Provider Onboarding

New providers go through a 5-phase lifecycle: auth validation, wizard onboarding, model discovery, model picker, and configuration. Bundled providers (OpenRouter, GitHub Copilot, Ollama, vLLM) are loaded automatically via `loadBundledProviders()`.
