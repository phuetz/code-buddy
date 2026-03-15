# Configuration

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GROK_API_KEY` | Required API key from x.ai |
| `CODEBUDDY_MAX_TOKENS` | Override response token limit |
| `MORPH_API_KEY` | Enables fast file editing |
| `YOLO_MODE` | Full autonomy mode (requires `/yolo on`) |
| `MAX_COST` | Session cost limit in dollars |
| `GROK_BASE_URL` | Custom API endpoint |
| `GROK_MODEL` | Default model to use |
| `JWT_SECRET` | Secret for API server auth |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word (text-match fallback if absent) |
| `BRAVE_API_KEY` | Brave Search for MCP web search |
| `EXA_API_KEY` | Exa neural search for MCP |
| `PERPLEXITY_API_KEY` | Perplexity AI (or via OpenRouter) |
| `OPENROUTER_API_KEY` | OpenRouter key |
| `CACHE_TRACE` | Debug prompt construction |
| `PERF_TIMING` | Startup phase profiling |
| `VERBOSE` | Verbose output |
| `SENTRY_DSN` | Sentry error reporting DSN |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry OTLP endpoint for distributed tracing |

---

**See also:** [Getting Started](./1-1-getting-started.md)
