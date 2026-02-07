---
name: weather
version: 1.0.0
description: Get current weather and forecasts using wttr.in (no API key required)
author: Code Buddy
tags: weather, forecast, wttr
---

# Weather

## Overview

Get weather data using wttr.in — free, no API key, works from the terminal.

## Commands

### Current weather (one-line)
```bash
curl -s "wttr.in/Paris?format=3"
# Paris: ⛅️ +12°C
```

### Detailed format
```bash
curl -s "wttr.in/Paris?format=%l:+%c+%t+%h+%w"
# Paris: ⛅️ +12°C 65% →10km/h
```

### Full forecast (3 days)
```bash
curl -s "wttr.in/Paris?T"
```

### Today only
```bash
curl -s "wttr.in/Paris?1"
```

### Current conditions only
```bash
curl -s "wttr.in/Paris?0"
```

## Format Codes

| Code | Meaning |
|------|---------|
| `%c` | Condition icon |
| `%t` | Temperature |
| `%h` | Humidity |
| `%w` | Wind |
| `%l` | Location |
| `%m` | Moon phase |
| `%p` | Precipitation |
| `%P` | Pressure |

## Tips

- URL-encode spaces: `wttr.in/New+York` or `wttr.in/New%20York`
- Use airport codes: `wttr.in/CDG`
- Metric: `?m`, Imperial: `?u`
- JSON output: `wttr.in/Paris?format=j1`
- PNG image: `curl -s "wttr.in/Paris.png" -o /tmp/weather.png`

## Fallback: Open-Meteo

If wttr.in is down, use Open-Meteo (free, JSON, no key):
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current_weather=true"
```

Docs: https://open-meteo.com/en/docs
