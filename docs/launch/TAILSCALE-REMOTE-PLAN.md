# #3 — Remote access to Code Buddy over Tailscale (plan, not executed)

> Drafted autonomously 2026-06-24. No system/network changes made. Execute when
> back (some steps touch the network + the running services — do them awake).

## Goal
Reach Code Buddy beyond Telegram — from any tailnet device (PC, another phone) —
via its HTTP/WebSocket server (web chat UI + JSON-RPC/MCP), using the Tailscale
IP `100.98.18.76` (`ministar-linux`).

## Current state (observed, read-only)
- `buddy server` already LISTENs on **`0.0.0.0:3000`** (pid of the system
  `codebuddy-a2a.service` per CLAUDE.md) and something on `0.0.0.0:8080`.
- Because it's bound to `0.0.0.0`, it's **already reachable at `100.98.18.76:3000`**
  from the tailnet — but also on the LAN/any interface (see Security).
- Auth: the server logs showed `Auth: Enabled` + a `cb_sk_` API key requirement on
  the A2A intake (the 401 we hit earlier). So the API is auth-gated already.

## Decisions to confirm (ask Patrice)
1. **Which surface?** (a) the **web chat UI** (`chat-ui`, talks to `serve --http 8080`
   via JSON-RPC+SSE) for a browser experience from any device, or (b) the **API**
   for programmatic/agent access, or both.
2. **From which device(s)?** His PC (G7 PT) / another phone — they must be on the
   tailnet (G7 PT + DARKSTAR still need `tailscale up`, per CLAUDE.md).

## Steps (once decided)
1. **Confirm tailnet reachability**: from another tailnet device, `curl http://100.98.18.76:3000/api/health` (or `:8080`). If it answers, transport is done.
2. **Bind tighter (security)**: prefer binding the server to the Tailscale interface
   instead of `0.0.0.0` — set `HOST=100.98.18.76` (or `tailscale0`) for the buddy
   server, so it is NOT exposed on the LAN/public NIC. Update the systemd unit's
   env (`codebuddy-a2a.service`) — **needs sudo + a service restart, do awake**.
3. **Web chat from anywhere**: run `chat-ui` pointed at `http://100.98.18.76:8080`
   (or serve it statically) — gives a phone/desktop browser chat against the same
   engine. (`chat-ui` dev server proxies /api /mcp to `code-explorer serve`.)
4. **Auth**: keep `Auth: Enabled`; mint a `cb_sk_` key for the remote client. Store
   it in `Acces_Centralises.md` (private) — do not expose in the URL.
5. **Tailscale ACL** (per `propositions/SECURISATION-RESEAU-MINISTAR-*.md`): scope
   who on the tailnet can reach :3000/:8080 (e.g. only Patrice's devices, not
   Sébastien's) via the Tailscale admin ACL.

## Security notes (important)
- The server is on **`0.0.0.0`** → reachable beyond the tailnet (LAN/public NIC).
  Phase-2 hardening exists but is pending (`ai-stack/secure_network.sh` enables UFW
  with `tailscale0` + `lo` rules; `propositions/SECURISATION-RESEAU-MINISTAR-2026-05-01.md`).
  Either run that (Tailscale-only ingress) or bind the server to the tailscale IP.
- Telegram (Lisa) already gives secure remote access (DM-paired + `/approve`); the
  Tailscale server is the *richer* surface (web UI / API) for trusted devices.

## Why not done autonomously
Binding/firewall changes touch the network + require restarting the system A2A
service (and the daemon is mid-demo). Network changes unattended are risky — left
for an awake session.
