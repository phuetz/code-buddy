---
name: weather
description: Get current weather and forecasts using the weather tool (Open-Meteo, no API key)
version: 1.0.0
author: Code Buddy
tags:
  - weather
  - meteo
  - forecast
requires:
  tools:
    - weather
nativeEngine:
  category: assistant
  priority: 85
  triggers:
    - météo
    - prévisions météo
    - previsions meteo
    - quel temps
    - weather forecast
    - forecast
    - température demain
    - il va pleuvoir
  examples:
    - "Quelle est la météo à Paris demain"
    - "What's the weather in Berlin this week"
---

# Weather

Use this skill when the user asks about the weather, the forecast, or the
temperature somewhere.

## How to answer

- ALWAYS call the `weather` tool — never `web_search` — for weather questions.
  It returns real Open-Meteo data (no API key) plus a ready French summary.
- Pass the city exactly as the user said it; the tool echoes the resolved
  "name, country" — mention it if the name was ambiguous (e.g. several
  cities share it).
- Ask for `days: 2..7` only when the user asks about tomorrow or the week.
- Answer in French by default.

## Voice replies

When answering ALOUD (the companion/voice path), keep it to **1–2 spoken
sentences**: current temperature + sky, add tomorrow only if asked. Skip
humidity and wind unless the user explicitly requested them.
