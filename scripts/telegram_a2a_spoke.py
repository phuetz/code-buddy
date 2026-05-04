#!/usr/bin/env python3
"""
Telegram A2A Bridge -- let Patrice talk to the fleet from his phone.

Polls Telegram for inbound messages, forwards them as A2A tasks to the
Code Buddy hub at 100.98.18.76:3000, and sends the hub's reply back to
the Telegram chat. Only authorized Telegram user IDs can use the bot
(--allowed-user-ids).

Architecture (V0, one-way):

  Phone (Telegram client)
    -> python-telegram-bot polls long-poll
    -> handler forwards to hub /api/a2a/tasks/send
    -> hub routes via smart skill selection (POC Niveau 3)
    -> Ollama spoke (ministar or darkstar) generates reply
    -> reply text sent back to Telegram chat

The bridge does not register at the hub for now -- it is a *client* of
the hub, not a service. Registration would require exposing an HTTP
endpoint for the hub to call back; future V1 if we want other Claudes
to push notifications to Patrice via Telegram.

Setup:
  1. @BotFather on Telegram -> /newbot -> get token
  2. set $env:TELEGRAM_BOT_TOKEN = "..." (or pass --token-env)
  3. find your user id: send /start to your bot, watch the logs
  4. python scripts/telegram_a2a_spoke.py --allowed-user-ids 12345
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Optional

import httpx

try:
    from telegram import Update
    from telegram.constants import ChatAction
    from telegram.ext import (
        Application,
        CommandHandler,
        ContextTypes,
        MessageHandler,
        filters,
    )
except ImportError:
    print(
        "python-telegram-bot required. Install with:"
        "\n  pip install python-telegram-bot",
        file=sys.stderr,
    )
    sys.exit(1)


HUB_TIMEOUT_S = 60          # generation can take up to a minute on small models
TELEGRAM_TYPING_INTERVAL = 4  # send "typing..." every N seconds while waiting
MAX_TELEGRAM_REPLY = 4000     # Telegram caps individual messages at 4096 chars

logger = logging.getLogger("telegram-bridge")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

class BridgeConfig:
    """Container for the runtime config; passed via Application.bot_data."""

    def __init__(
        self,
        hub_url: str,
        allowed_user_ids: set[int],
        default_skill: str,
        default_model: str,
        default_agent: Optional[str],
    ):
        self.hub_url = hub_url.rstrip("/")
        self.allowed_user_ids = allowed_user_ids
        self.default_skill = default_skill
        self.default_model = default_model
        self.default_agent = default_agent


# ---------------------------------------------------------------------------
# Hub client
# ---------------------------------------------------------------------------

async def call_hub_task(
    cfg: BridgeConfig,
    text: str,
    skill: Optional[str] = None,
    agent: Optional[str] = None,
    model: Optional[str] = None,
) -> str:
    """POST a task to the hub and return the result text.

    Layout matches the hub's /api/a2a/tasks/send route handler. Either
    `skill` or `agent` is provided (skill wins if both). The hub picks
    a spoke via smart skill selection (POC Niveau 3) when only skill
    is given.
    """
    payload: dict = {
        "message": {
            "role": "user",
            "parts": [{"type": "text", "text": text}],
        },
        "metadata": {"model": model or cfg.default_model},
    }
    if skill:
        payload["skill"] = skill
    elif agent:
        payload["agent"] = agent

    url = f"{cfg.hub_url}/api/a2a/tasks/send"
    async with httpx.AsyncClient(timeout=HUB_TIMEOUT_S) as client:
        resp = await client.post(url, json=payload)
    resp.raise_for_status()
    data = resp.json()
    # Hub may return {result: "..."} (string) or a fuller A2A envelope.
    result = data.get("result", "")
    if isinstance(result, dict):
        # Try to extract text from a nested message
        parts = result.get("parts", [])
        if parts and isinstance(parts, list):
            return "\n".join(p.get("text", "") for p in parts if isinstance(p, dict))
        return json.dumps(result)
    if isinstance(result, str):
        return result
    return json.dumps(data)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _is_authorized(update: Update, cfg: BridgeConfig) -> bool:
    if not update.effective_user:
        return False
    uid = update.effective_user.id
    if uid not in cfg.allowed_user_ids:
        logger.warning("rejected message from unauthorized user_id=%s username=%s",
                       uid, update.effective_user.username)
        return False
    return True


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: BridgeConfig = context.application.bot_data["config"]
    user = update.effective_user
    logger.info("/start from user_id=%s username=%s", user.id, user.username)
    if not _is_authorized(update, cfg):
        await update.message.reply_text(
            f"Unauthorized. Your user id is {user.id}. Ask the bridge owner to allow it."
        )
        return
    await update.message.reply_text(
        "Bridge ready. Send any text to forward it to the fleet.\n"
        f"Default skill: {cfg.default_skill}\n"
        f"Default model: {cfg.default_model}\n"
        "Commands:\n"
        "  /skill <skill-id> <text>  -- route by skill\n"
        "  /agent <agent-name> <text> -- route by explicit agent\n"
        "  /help                      -- this message\n"
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await cmd_start(update, context)


async def cmd_skill(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: BridgeConfig = context.application.bot_data["config"]
    if not _is_authorized(update, cfg):
        return
    if not context.args or len(context.args) < 2:
        await update.message.reply_text("Usage: /skill <skill-id> <text>")
        return
    skill, *rest = context.args
    text = " ".join(rest)
    await _forward_and_reply(update, context, text, skill=skill)


async def cmd_agent(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: BridgeConfig = context.application.bot_data["config"]
    if not _is_authorized(update, cfg):
        return
    if not context.args or len(context.args) < 2:
        await update.message.reply_text("Usage: /agent <agent-name> <text>")
        return
    agent, *rest = context.args
    text = " ".join(rest)
    await _forward_and_reply(update, context, text, agent=agent)


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg: BridgeConfig = context.application.bot_data["config"]
    if not _is_authorized(update, cfg):
        return
    text = update.message.text or ""
    if not text.strip():
        return
    await _forward_and_reply(update, context, text)


async def _forward_and_reply(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
    skill: Optional[str] = None,
    agent: Optional[str] = None,
) -> None:
    cfg: BridgeConfig = context.application.bot_data["config"]
    chat = update.effective_chat
    user = update.effective_user
    logger.info("forwarding from user_id=%s len=%d skill=%s agent=%s",
                user.id, len(text), skill, agent)

    # Show "typing..." periodically while we wait on the hub.
    typing_task = asyncio.create_task(_typing_loop(context.bot, chat.id))
    try:
        try:
            reply = await call_hub_task(
                cfg, text,
                skill=skill or cfg.default_skill,
                agent=agent or cfg.default_agent,
            )
        except httpx.HTTPStatusError as e:
            reply = f"Hub error: HTTP {e.response.status_code} -- {e.response.text[:200]}"
            logger.error("hub HTTP error: %s", e)
        except httpx.RequestError as e:
            reply = f"Hub unreachable: {e}"
            logger.error("hub unreachable: %s", e)
        except Exception as e:  # pragma: no cover
            reply = f"Bridge error: {type(e).__name__}: {e}"
            logger.exception("bridge unexpected error")
    finally:
        typing_task.cancel()
        try:
            await typing_task
        except asyncio.CancelledError:
            pass

    # Telegram caps message length; chunk if needed.
    if not reply:
        reply = "(empty reply from fleet)"
    for chunk in _split_for_telegram(reply, MAX_TELEGRAM_REPLY):
        await update.message.reply_text(chunk)


async def _typing_loop(bot, chat_id: int) -> None:
    """Send `typing` action every TELEGRAM_TYPING_INTERVAL seconds until cancelled."""
    try:
        while True:
            try:
                await bot.send_chat_action(chat_id, ChatAction.TYPING)
            except Exception:
                pass  # best effort
            await asyncio.sleep(TELEGRAM_TYPING_INTERVAL)
    except asyncio.CancelledError:
        return


def _split_for_telegram(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    out = []
    while text:
        out.append(text[:limit])
        text = text[limit:]
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram A2A bridge")
    parser.add_argument("--hub", default="http://100.98.18.76:3000",
                        help="Hub base URL (default: %(default)s)")
    parser.add_argument("--token-env", default="TELEGRAM_BOT_TOKEN",
                        help="Env var holding the bot token (default: %(default)s)")
    parser.add_argument("--allowed-user-ids", default="",
                        help="CSV of Telegram user IDs allowed to use the bot. "
                             "Required: empty list rejects everyone (safe default).")
    parser.add_argument("--default-skill", default="ollama-qwen3-4b",
                        help="Skill ID used when the user sends a plain message")
    parser.add_argument("--default-model", default="qwen3:4b",
                        help="metadata.model field on tasks (default: %(default)s)")
    parser.add_argument("--default-agent", default=None,
                        help="If set, route to this explicit agent instead of using skill routing")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    token = os.environ.get(args.token_env)
    if not token:
        print(f"FATAL: {args.token_env} env var not set. "
              f"Get a bot token from @BotFather on Telegram, then:\n"
              f"  set {args.token_env}=...   # cmd\n"
              f"  $env:{args.token_env} = '...'   # PowerShell",
              file=sys.stderr)
        sys.exit(2)

    if not args.allowed_user_ids.strip():
        print("FATAL: --allowed-user-ids is empty. Refusing to run a wide-open bot. "
              "Send /start to your bot first to find out your user id "
              "(it'll be logged here), then restart with --allowed-user-ids <id>.",
              file=sys.stderr)
        sys.exit(2)
    try:
        allowed = {int(x.strip()) for x in args.allowed_user_ids.split(",") if x.strip()}
    except ValueError as e:
        print(f"FATAL: --allowed-user-ids must be CSV of integers ({e})", file=sys.stderr)
        sys.exit(2)

    cfg = BridgeConfig(
        hub_url=args.hub,
        allowed_user_ids=allowed,
        default_skill=args.default_skill,
        default_model=args.default_model,
        default_agent=args.default_agent,
    )

    logger.info("Starting Telegram A2A bridge")
    logger.info("  hub          : %s", cfg.hub_url)
    logger.info("  allowed users: %s", sorted(cfg.allowed_user_ids))
    logger.info("  default skill: %s", cfg.default_skill)
    logger.info("  default model: %s", cfg.default_model)
    if cfg.default_agent:
        logger.info("  default agent: %s", cfg.default_agent)

    app = Application.builder().token(token).build()
    app.bot_data["config"] = cfg

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("skill", cmd_skill))
    app.add_handler(CommandHandler("agent", cmd_agent))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))

    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
