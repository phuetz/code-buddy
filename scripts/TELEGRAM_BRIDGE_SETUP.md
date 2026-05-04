# Telegram A2A bridge -- setup notes

`scripts/telegram_a2a_spoke.py` is a one-way bridge that lets you talk
to the Code Buddy hub from your phone via a Telegram bot. It polls
Telegram for messages, forwards them to the hub at
`100.98.18.76:3000`, and sends the hub's reply back to the chat.

The bridge is *not* a registered A2A spoke -- it's a client. Other
spokes / Claudes cannot push notifications to the bot via the hub
yet. (V1 work.)

## Requirements

- Python 3.10+ in a venv
- `pip install python-telegram-bot httpx` (already in
  `C:\Users\patri\venv` on DARKSTAR)
- A bot token from `@BotFather` on Telegram
- Your Telegram user id (for the allow-list)

## Step 1 -- Create the bot

1. On Telegram, open `@BotFather` and send `/newbot`.
2. Pick a display name and a username (must end in `bot`).
3. Copy the token. It looks like `1234567890:ABC-DEF1234ghIkl...`.
4. (Optional but recommended) `/setprivacy` -> `Disable` so the bot can
   read all messages in groups, *or* keep it default and only DM the
   bot. Default is safer.

## Step 2 -- Find your user id

The bridge will reject anyone not in `--allowed-user-ids`. To find your
id, set the token, then start the bridge with a placeholder allow-list,
DM `/start` to your bot, and the rejection log line will print your id:

```powershell
$env:TELEGRAM_BOT_TOKEN = "<token>"
python scripts\telegram_a2a_spoke.py --allowed-user-ids 0
# In Telegram, DM /start to your bot. Watch the console:
# WARNING: rejected message from unauthorized user_id=12345 username=...
```

Stop the bridge with Ctrl+C and note the id.

## Step 3 -- Run for real

```powershell
$env:TELEGRAM_BOT_TOKEN = "<token>"
python scripts\telegram_a2a_spoke.py --allowed-user-ids 12345
```

DM any message to your bot. It should be forwarded to `ollama-qwen3-4b`
on the hub and the reply comes back.

## Step 4 -- Auto-start (optional, recommended)

Persist the env vars in User scope:

```powershell
[Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN','<token>','User')
[Environment]::SetEnvironmentVariable('TELEGRAM_ALLOWED_USER_IDS','12345','User')
```

Re-run `setup_a2a_autostart_darkstar.ps1` from the desktop. It detects
the env vars and registers a `TelegramA2ASpoke` task that auto-starts
at logon (with battery + WakeToRun resilience).

## CLI flags

```
--hub              Hub base URL (default http://100.98.18.76:3000)
--token-env        Env var with the bot token (default TELEGRAM_BOT_TOKEN)
--allowed-user-ids CSV of Telegram user ids; empty = reject all (required)
--default-skill    Skill ID for plain-text messages (default ollama-qwen3-4b)
--default-model    metadata.model on tasks (default qwen3:4b)
--default-agent    Override skill routing with an explicit agent name
--log-level        DEBUG/INFO/WARNING (default INFO)
```

## Bot commands

- `/start` -- show capabilities and your user id
- `/help` -- alias for /start
- `/skill <skill-id> <text>` -- route by an explicit skill
- `/agent <agent-name> <text>` -- route by an explicit agent (e.g. `/agent ollama-darkstar Salut`)
- Plain text -- routes via the default skill (POC Niveau 3 picks a spoke)

## Known limits (V0)

- One-way: hub -> bot only on user-initiated requests. Other Claudes
  can't push notifications yet.
- Reply chunking is naive (4000-char split) -- code-block formatting
  may break across chunks.
- Long-poll is single-process; if you Ctrl+C with a hot poll, restart
  takes a second to settle.
- No persistence: if the hub or the bridge restarts, in-flight messages
  are lost.

## Security

The allow-list is the only authorization. Treat the bot token as a
secret -- anyone with it can impersonate the bot. The hub side accepts
the bridge's requests because they come from a tailnet client (CGNAT
restricted).
