---
name: web-app-testing
description: Test a web app you built or changed — launch its dev server, browse it, verify with evidence (web_test), fix, re-run
version: 1.0.0
author: Code Buddy
tags:
  - testing
  - web
  - browser
requires:
  tools:
    - app_server
    - web_test
    - browser
nativeEngine:
  category: development
  priority: 85
  triggers:
    - test the app
    - teste l'application
    - tester l'appli
    - vérifie que ça marche
    - check it works
    - dev server
    - web app testing
    - test web ui
  examples:
    - "Build the login page and test that it works"
    - "Ajoute le formulaire et vérifie que ça marche dans le navigateur"
---

# Web App Testing

Use this skill whenever you have built or changed a web UI and need to prove
it actually works — never claim a UI works without having loaded it in the
browser.

This loop also tests **Code Buddy itself**: after changing server or UI code
in this repo, self-test with `app_server` start `npx tsx src/index.ts server
--port <free>` (readiness url `/api/health`) then `web_test` asserting
`"status":"ok"` — and that protected pages (e.g. the dashboard) still answer
UNAUTHORIZED without a token.

## The loop (develop → launch → browse → verify)

1. **Launch the server**: `app_server` action `start` with the dev command
   (e.g. `npm run dev`) and its loopback URL (e.g. `http://127.0.0.1:5173/`).
   The URL becomes browsable only while this server runs. If the port is
   already in use, pick another (configure the dev server) — the tool refuses
   to adopt pre-existing services.
2. **Test with evidence**: `web_test` with the URL and assertions for what
   the page MUST show (`text`, `selector`, `title`). The report contains the
   console/page errors (client face), the server logs (server face), an
   interactive-element snapshot, and a screenshot path.
3. **Read a FAILED report, don't retry blindly**: the console error and the
   server log usually point at the same bug from two sides. Fix the code,
   then re-run `web_test` with the SAME assertions until it passes.
4. **Interact when needed**: for flows (forms, navigation), use the `browser`
   tool — `snapshot` gives numbered refs, then `click`/`type`/`fill` by ref.
   Prefer refs over pixel coordinates.
5. **Tear down**: `app_server` action `stop` when testing is done.

## Rules

- Show the evidence (report lines, screenshot path) instead of asserting
  success.
- Server-side errors live in `app_server` action `logs`; client-side errors
  in `browser_console` — `web_test` aggregates both.
- Only loopback dev servers started by `app_server` (or origins the user
  declared in `CODEBUDDY_BROWSER_DEV_ORIGINS`) are browsable; everything
  else on localhost stays blocked by design.
