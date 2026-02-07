---
name: model-usage
version: 1.0.0
description: Track and analyze AI model usage, costs, and token consumption across sessions
author: Code Buddy
tags: usage, cost, tokens, model, analytics
---

# Model Usage

## Overview

Track per-model usage, costs, and token consumption to understand spending and optimize model selection.

## Quick Queries

### Total cost across all sessions
```bash
total=0; for f in .codebuddy/sessions/*.json; do
  cost=$(jq -r '.usage.totalCost // 0' "$f" 2>/dev/null)
  total=$(echo "$total + $cost" | bc 2>/dev/null || echo "$total")
done; echo "Total: \$$total"
```

### Cost per model
```bash
for f in .codebuddy/sessions/*.json; do
  jq -r '"\(.model // "unknown") \(.usage.totalCost // 0)"' "$f" 2>/dev/null
done | awk '{a[$1]+=$2} END {for(m in a) printf "%-30s $%.4f\n", m, a[m]}' | sort -t'$' -k2 -rn
```

### Token usage per session
```bash
for f in .codebuddy/sessions/*.json; do
  jq -r '{file: input_filename, tokens: .usage.totalTokens, cost: .usage.totalCost} | "\(.file)\t\(.tokens)\t$\(.cost)"' "$f" 2>/dev/null
done | column -t -s$'\t'
```

### Daily cost summary
```bash
for f in .codebuddy/sessions/*.json; do
  date=$(jq -r '.createdAt // ""' "$f" 2>/dev/null | cut -dT -f1)
  cost=$(jq -r '.usage.totalCost // 0' "$f" 2>/dev/null)
  [ -n "$date" ] && echo "$date $cost"
done | awk '{a[$1]+=$2} END {for(d in a) printf "%s $%.4f\n", d, a[d]}' | sort -r
```

## Optimization Tips

- Use cheaper models (Gemini Flash, Haiku) for simple tasks
- Reserve expensive models (Opus, GPT-4) for complex reasoning
- Monitor token counts — large context windows cost more
- Use `MAX_COST` env var to set session spending limits
- Check `buddy doctor` for current model and provider status

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MAX_COST` | Session cost limit (default: $10, YOLO: $100) |
| `GROK_MODEL` | Override default model |

## Model Cost Reference

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| grok-3 | ~$3.00 | ~$15.00 |
| claude-sonnet-4 | ~$3.00 | ~$15.00 |
| gpt-4o | ~$2.50 | ~$10.00 |
| gemini-2.0-flash | ~$0.10 | ~$0.40 |
| ollama (local) | Free | Free |

Prices are approximate — check provider dashboards for current rates.
