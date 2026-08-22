# Configuration

## Environment Variables

### Required

| Variable | Description |
|:---------|:------------|
| `GROK_API_KEY` | xAI API key (default provider) |

### Provider Keys

| Variable | Provider |
|:---------|:---------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT) |
| `GOOGLE_API_KEY` | Google (Gemini) |
| `MISTRAL_API_KEY` | Mistral AI |
| `GROQ_API_KEY` | Groq |
| `TOGETHER_API_KEY` | Together AI |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `OPENROUTER_API_KEY` | OpenRouter |
| `NOVITA_API_KEY` | NovitaAI |
| `GLM_API_KEY` / `ZAI_API_KEY` | z.ai / GLM |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Kimi / Moonshot |
| `MINIMAX_API_KEY` | MiniMax |
| `DASHSCOPE_API_KEY` | Alibaba / DashScope |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `HF_TOKEN` | Hugging Face router |
| `NVIDIA_API_KEY` | NVIDIA NIM |
| `STEPFUN_API_KEY` | StepFun |
| `GITHUB_COPILOT_TOKEN` / `COPILOT_GITHUB_TOKEN` | GitHub Copilot |
| `OLLAMA_HOST` | Ollama (default: localhost:11434) |
| `VLLM_BASE_URL` | vLLM server URL |
| `AWS_BEDROCK_REGION` / `AWS_REGION` | AWS Bedrock region |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS Bedrock credentials |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_AD_TOKEN` | Azure OpenAI credentials |

### Search and Tools

| Variable | Description |
|:---------|:------------|
| `BRAVE_API_KEY` | Brave Search API |
| `EXA_API_KEY` | Exa neural search |
| `PERPLEXITY_API_KEY` | Perplexity AI search |
| `SERPER_API_KEY` | Google Search via Serper |
| `FIRECRAWL_API_KEY` | Firecrawl search/scrape tools |
| `MORPH_API_KEY` | Fast file editing |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word detection |
| `FAL_KEY` / `FAL_API_KEY` | fal.ai — vidéo/image FAL + train LoRA Krea 2 (`buddy lora train cloud`) |

### Media / ComfyUI / LoRA

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CODEBUDDY_IMAGE_PROVIDER` | Backend `image_generate` (`comfyui`, `openai`, `xai`, `fal`, …) | provider-dependent |
| `COMFYUI_URL` | Endpoint ComfyUI pour génération | `http://127.0.0.1:8188` |
| `COMFYUI_ROOT` | Racine ComfyUI (install LoRA `models/loras`) | auto-detect |
| `CODEBUDDY_LORA_TRAIN` | Opt-in train cloud LoRA Krea 2 (upload + coût fal) | unset (off) |
| `CODEBUDDY_LORA_INFER_CHECKPOINT` | Checkpoint Comfy prioritaire pour selfies/image (monostack vs train) | unset → `CODEBUDDY_IMAGE_MODEL` / `sd_turbo` |
| `CODEBUDDY_LISA_FEWSHOT_EVERY` | Injecter les exemplars xAI anti-dilution tous les N tours voix (0=off) | `4` |
| `AI_TOOLKIT_DIR` | Chemin AI-Toolkit pour `buddy lora train local` / `train-local.sh` | unset |
| `CODEBUDDY_LISA_SELFIE` | Interception vocale + Telegram inbound « photo de toi » (`false` pour off) | on |
| `CODEBUDDY_LISA_LORA_TRIGGER` | Trigger LoRA Lisa si pas de `.codebuddy/lora/lisa/project.json` | `ohwx lisa` |
| `CODEBUDDY_COMFYUI_LORA` | LoRA Comfy : `lisa`, `lisa.safetensors`, `auto` (scan models/loras), `none` | unset ; selfie → `auto` |
| `CODEBUDDY_COMFYUI_LORA_STRENGTH` | Intensité LoRA modèle+CLIP | `0.85` |
| `CODEBUDDY_LISA_SELFIE_COOLDOWN_MS` | Cooldown entre selfies (ms) | `45000` |
| `CODEBUDDY_SENSORY_ALERT_TOKEN` / `_CHAT` | Bot Telegram pour alertes, notes vocales **et selfies** Lisa | unset |

Doc LoRA : [krea-lora.md](./krea-lora.md).

### Channels

| Variable | Description |
|:---------|:------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_TOKEN` | Discord bot token |
| `SLACK_BOT_TOKEN` | Slack bot token |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu/Lark app credentials |
| `CODEBUDDY_CONVERSATION_BRIDGE` | Share one companion thread between resident voice and a configured channel |
| `CODEBUDDY_CONVERSATION_CHANNEL` / `_CHANNEL_ID` | Target transport and chat/room ID for voice ↔ channel continuity |
| `CODEBUDDY_CONVERSATION_CHANNEL_THREAD` | Optional topic/thread inside the configured channel |
| `CODEBUDDY_CONVERSATION_THREAD_ID` | Stable logical companion thread name (default: robot name) |
| `CODEBUDDY_CONVERSATION_MIRROR_VOICE` | Publish recognized voice and companion speech to the target channel |
| `CODEBUDDY_CONVERSATION_COWORK` | Let explicitly linked Cowork sessions join the companion thread (default: true) |
| `CODEBUDDY_CONVERSATION_MIRROR_COWORK` | Publish linked Cowork turns to the configured channel (default: true) |
| `CODEBUDDY_CONVERSATION_COWORK_HISTORY` | Recent shared turns imported by a linked Cowork session, clamped to 4-80 (default: 24) |
| `CODEBUDDY_CONVERSATION_PERSIST` | Persist the bounded shared thread in a private local JSONL journal |
| `CODEBUDDY_CONVERSATION_MAX_HISTORY_BYTES` | Compact the private journal at this byte bound (32 KiB-64 MiB; default scales with the event cap) |
| `CODEBUDDY_EPISODE_JOURNAL` / `_EVERY` | Consolidate the complete thread into a deduplicated where-we-were memory (opt-in, default every 40 beats) |
| `CODEBUDDY_CONVERSATION_EVAL` | Evaluate complete user/Lisa exchanges locally and learn only from recurring weaknesses (default: true) |
| `CODEBUDDY_CONVERSATION_EVAL_EVERY` | Heartbeat interval for aggregate conversation evaluation (default: 30) |
| `CODEBUDDY_CONVERSATION_EVAL_MIN_STREAK` | Consecutive detections required before a reversible guidance change (default: 2) |
| `CODEBUDDY_CONVERSATION_EVAL_COOLDOWN_MS` | Minimum delay between learned guidance changes (default: 21600000 / 6 h) |
| `CODEBUDDY_AVATAR_BRIDGE` | Publish scoped `avatar:event` performance cues for Unreal/MetaHuman (default: true) |
| `CODEBUDDY_AVATAR_STREAM_AUDIO` | `auto` streams bounded WAV only while a compatible renderer is alive; `true`/`false` force the behavior (default: `auto`) |

### Voice Rendering

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CODEBUDDY_TTS_ENGINE` | Renderer selection: `pocket`, `voicebox`, or `piper` | `pocket` |
| `CODEBUDDY_POCKET_VOICE` / `_LANG` | Realtime Pocket voice and language | `estelle` / `french` |
| `CODEBUDDY_POCKET_URL` / `_SERVER` | Resident Pocket endpoint and auto-start toggle | `http://127.0.0.1:8766` / `true` |
| `CODEBUDDY_VOICEBOX_URL` | Trusted Voicebox REST endpoint; prefer Tailscale for Darkstar | `http://127.0.0.1:17493` |
| `CODEBUDDY_VOICEBOX_PROFILE` | Required Voicebox profile name or id | unset |
| `CODEBUDDY_VOICEBOX_ENGINE` | Voicebox backend (`qwen`, `qwen_custom_voice`, `luxtts`, `chatterbox`, `chatterbox_turbo`, `tada`, `kokoro`) | `qwen` |
| `CODEBUDDY_VOICEBOX_LANGUAGE` / `_MODEL_SIZE` | Voicebox language and model size | `fr` / `1.7B` |
| `CODEBUDDY_VOICEBOX_INSTRUCT` | Acoustic delivery only (tone/pace; never rewrites words). Default Lisa warmth FR | Lisa preset in `assistant-config` |
| `CODEBUDDY_VOICEBOX_AUDIO_STREAM` | Pipe returned WAV directly to speakers/avatar | `true` |
| `CODEBUDDY_TTS_VOLUME` | Assistant-only normalized output volume (0–100) | `100` |
| `COWORK_DICTATION_SHORTCUT` | Cowork global dictation accelerator; press once to record and again to transcribe/paste | `CommandOrControl+Shift+Space` |

Code Buddy always sends `personality: false` to Voicebox: the renderer cannot rewrite Lisa's
answer. Voicebox falls back to Pocket and then Piper. Diagnose without changing configuration with
`buddy assistant voicebox`; create an authorized profile with
`buddy assistant voicebox-clone <name> <audio> --text <transcript> --consent`, or remove one with
`buddy assistant voicebox-delete <profile-id> --yes`. A non-cloned local preset can be created with
`buddy assistant voicebox-preset <name> --engine kokoro --voice ff_siwis`; `voicebox-model` administers downloads and VRAM. Add `--benchmark` to compare the cold/warm
Voicebox and Pocket latency.
Use `buddy assistant latency --engine both` to measure the real prefetched-answer path to first PCM
without opening speakers or publishing to Telegram/MetaHuman.
For a remote desktop install, Voicebox is loopback-only by default. Prefer a private Tailscale TCP
forwarder (`tailscale serve --bg --tcp=17493 tcp://127.0.0.1:17493`) over binding the unauthenticated
API to a public interface.

### Explicit One-Shot Vision

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CODEBUDDY_VISION_MODEL` | Multimodal model used only after an explicit spoken look/see request | unset (vision answers fail honestly) |
| `CODEBUDDY_VISION_BASE_URL` | OpenAI-compatible visual endpoint; remote endpoints require HTTPS unless explicitly allowed below | `http://127.0.0.1:11434/v1` |
| `CODEBUDDY_VISION_API_KEY` | Dedicated key for a custom/authenticated visual endpoint; ambient OpenAI credentials are never sent to custom hosts | unset |
| `CODEBUDDY_VISION_ALLOW_INSECURE_REMOTE` | Permit remote plaintext HTTP only on a trusted private transport such as an explicitly accepted Tailscale path | `false` |
| `CODEBUDDY_VISION_TIMEOUT_MS` | Deadline for the multimodal analysis request (clamped to 10–120000 ms) | `30000` |
| `CODEBUDDY_VISION_CAMERA_DEVICE` | Explicit ffmpeg camera device; otherwise uses `BUDDY_SENSE_CAMERA_INDEX` on Linux/macOS | platform default |

The voice path captures one temporary frame only after an explicit visual request. The frame is
private (`0600` inside a `0700` directory), omitted from conversation/percept journals, deleted as
soon as it is loaded and retried in a `finally` block, and never sent through provider fallback.
A redacted audit event records camera use without image, path, device command, or utterance. Only
bounded textual evidence continues; `localDeletionVerified` describes local cleanup only, never a
remote endpoint's retention policy.

### Runtime

| Variable | Description | Default |
|:---------|:------------|:--------|
| `GROK_BASE_URL` | Custom API endpoint | - |
| `GROK_MODEL` | Default model | - |
| `CODEBUDDY_MAX_TOKENS` | Override response token limit | model's maxOutputTokens |
| `MAX_COST` | Session cost limit ($) | $10 (YOLO: $100) |
| `YOLO_MODE` | Full autonomy mode | false |
| `JWT_SECRET` | API server auth | Required in production |
| `CODEBUDDY_AUTOCOMPACT_PCT` | Auto-compact threshold (% of context window) | - |
| `CODEBUDDY_RTK` | Enable RTK shell command rewriting | false |
| `CODEBUDDY_RTK_REWRITE` | Alias flag for RTK shell command rewriting | false |
| `CODEBUDDY_RTK_TIMEOUT_MS` | Timeout for `rtk rewrite` before fallback | 1000 |
| `CODEBUDDY_LM_RESIZER` | Enable recoverable post-execution compression of large tool outputs | false (Cowork: auto) |
| `CODEBUDDY_LM_RESIZER_BIN` | Override path to the `lm-resizer` binary | local release build, then PATH |
| `CODEBUDDY_LM_RESIZER_STORE` | Override the CCR SQLite store used by Code Buddy | `~/.codebuddy/lm-resizer.db` |
| `CODEBUDDY_LM_RESIZER_URL` / `LM_RESIZER_URL` | HTTP sidecar URL (preferred low-latency transport; CLI is the fallback) | `http://127.0.0.1:8787` |
| `CODEBUDDY_LM_RESIZER_TOKEN_FILE` | Private sidecar-token file; rejected when group/world-readable on Unix | `~/.codebuddy/lm-resizer/server-token` |
| `CODEBUDDY_LM_RESIZER_SERVER_TOKEN` / `CODEBUDDY_LM_RESIZER_TOKEN` | Direct sidecar-token override (sensitive; prefer the token file) | unset |
| `CODEBUDDY_FALLBACK_PROVIDERS` | Comma-separated provider/model fallbacks, for example `openai:gpt-4o,glm:glm-5-code` | unset |
| `CODEBUDDY_FALLBACK_PROVIDER` / `CODEBUDDY_FALLBACK_MODEL` | Single provider/model fallback pair | unset |
| `CODEBUDDY_VOICE_RESPONSE_STYLE` | Adaptive spoken response depth: `natural`, `concise`, or `developed` | natural |
| `CODEBUDDY_PREFETCH` | Preload structured news, market, agenda, date, and configured weather evidence | true |
| `CODEBUDDY_PREFETCH_INTERVAL_MS` | Wall-clock fresh-context refresh interval | 900000 |
| `CODEBUDDY_MARKET_SYMBOLS` | Additional comma-separated market watchlist; deduplicated and capped at 10 total symbols after `^FCHI,^GSPC,^IXIC` | unset |
| `CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS` | Watchdog for a serialized channel turn; releases Telegram/Discord/Slack FIFO after bounded cleanup (1000–900000 ms) | 180000 |
| `CODEBUDDY_SEMANTIC_GATE` | Semantic audit + at most one independently re-audited revision for developed/deliberative companion answers (`auto`, `true`, `false`) | auto |
| `CODEBUDDY_NEWS_QUERY` | Preferred news topics; the default is balanced into general and technology lanes | France/world/technology/AI |
| `CODEBUDDY_NEWS_LOCALE` | Search language and country used for the grounded bulletin | fr-FR |
| `CODEBUDDY_NEWS_SEARCH_PACE_MS` | Delay between free-provider news lanes to respect request-rate limits | 1100 |
| `OPENROUTER_PROVIDER_*` | OpenRouter provider routing options | unset |
| `CODEBUDDY_AUXILIARY_<TASK>_*` | Hermes-style auxiliary provider/model/base URL/API key/timeout overrides | unset |
| `AUXILIARY_VISION_MODEL` | Hermes-compatible vision model override | unset |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | HTTP proxy support | - |

### Persistent Memory

Code Buddy's markdown memory is bounded like Hermes: project memory defaults to
2,200 chars and user/profile memory defaults to 1,375 chars. Writes that would
overflow return an error so the agent can consolidate or remove entries before
retrying.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CODEBUDDY_MEMORY_ENFORCE_LIMITS` | Reject writes over the char budget | true |
| `CODEBUDDY_MEMORY_PROJECT_CHAR_LIMIT` | Project memory budget | 2200 |
| `CODEBUDDY_MEMORY_USER_CHAR_LIMIT` | User/profile memory budget | 1375 |
| `CODEBUDDY_MEMORY_SECURITY_SCAN` | Block prompt-injection, credential-exfiltration, private-key, and invisible-Unicode memory writes | true |
| `CODEBUDDY_MEMORY_REJECT_DUPLICATES` | Treat exact duplicate memory writes as successful no-ops | true |
| `CODEBUDDY_MEMORY_AUTO_PROPOSE` | Enqueue review-gated long-term memory candidates at session end | true |

Session-end auto-memory never writes accepted memory directly. It stores
pending candidates in `.codebuddy/memory-candidates.json`; approve them with
`/memory accept <id>` after review.

### Debugging

| Variable | Description | Default |
|:---------|:------------|:--------|
| `CACHE_TRACE` | Debug prompt construction | false |
| `PERF_TIMING` | Startup phase profiling | false |
| `VERBOSE` | Verbose output | false |
| `SENTRY_DSN` | Sentry error reporting | - |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry OTLP endpoint | - |
| `LOG_MAX_SIZE` | Max log file size | 10MB |
| `LOG_MAX_FILES` | Max rotated log files | 5 |

## TOML Config

Main config file: `.codebuddy/config.toml`

```toml
[model_pairs]
architect = "claude-sonnet-4"
editor = "grok-code-fast-1"

[agent_defaults]
imageGenerationModel = "dall-e-3"

[agent_defaults.agents.sql]
temperature = 0.2
maxTokens = 4096

[integrations]
# Legacy pre-execution command rewriting; explicit opt-in only.
rtk_enabled = false

[profiles.fast]
model = "grok-code-fast-1"
temperature = 0.3
```

### Config Profiles

Named profiles are deep-merged with base config. Use via `buddy --profile <name>`.

### Config Mutator

Set values at runtime:

```bash
/config set model_pairs.architect "claude-sonnet-4"
/config set agent_defaults.imageGenerationModel "dall-e-3"
```

Supports dot-notation, SecretRef resolution, dry-run mode, and batch JSON.

## Project Settings

`.codebuddy/settings.json`:

```json
{
  "systemPrompt": "You are working on a TypeScript project.",
  "tools": {
    "enabled": ["read_file", "search", "bash"],
    "disabled": ["web_search"]
  },
  "security": {
    "mode": "auto-edit",
    "bashAllowlist": ["npm *", "git *"]
  },
  "codebuddyMdExcludes": ["packages/legacy/**"],
  "channels": {
    "telegram": {
      "type": "telegram",
      "token": "...",
      "adminUsers": ["user_id"]
    }
  }
}
```

## Model-Aware Limits

`src/config/model-tools.ts` defines per-model capabilities with glob matching (e.g., `grok-3*`, `claude-*`):

- `contextWindow` -- total context window size
- `maxOutputTokens` -- maximum response tokens
- `patchFormat` -- preferred patch format for the model

Used by `client.ts` for response size and `context-manager-v2.ts` for context budget.

## Advanced Config (Effort Levels)

`src/config/advanced-config.ts` defines effort levels:

| Level | Temperature | Token Budget |
|:------|:------------|:-------------|
| `low` | Lower | Reduced |
| `medium` | Default | Standard |
| `high` | Higher | Increased |

## Identity Files

Identity system for customizing agent personality:
- `SOUL.md` -- agent personality and behavior
- `USER.md` -- user information and preferences
- `AGENTS.md` -- agent-specific instructions

Located in project root or `.codebuddy/`. Hot-reload supported.

```bash
buddy identity show          # List loaded identity files
buddy identity get <name>    # Show specific file
buddy identity set <name>    # Edit identity file
buddy identity prompt        # Show combined identity prompt
```

## Personas

Hot-reloadable personality presets:

```
/persona list                # List available personas
/persona use <name>          # Switch persona
/persona info <name>         # Show persona details
/persona reset               # Reset to default
```

## i18n

6 locales supported: English (complete), French (complete), German, Spanish, Japanese, Chinese (stubs). Use the `t()` function from `src/i18n/index.ts`.
