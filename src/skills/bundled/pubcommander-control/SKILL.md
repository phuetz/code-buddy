---
name: pubcommander-control
description: Pilot PubCommander editorial and social campaigns through its MCP tools. Use for listing, drafting, revising, submitting, scheduling, or publishing posts while preserving human approval and dry-run safety.
---

# PubCommander Control

Use the PubCommander MCP server as the system of record for social posts. Keep creation reversible and require an explicit human decision before any external publication.

## Safe workflow

1. Inspect existing work with `list_posts`, then use `get_post` before changing a specific post.
2. Create with `create_draft_post` or revise an eligible post with `update_draft_post`.
3. Show the final content, platform variants, hashtags, and targets to the user.
4. Call `submit_post_for_approval`; do not interpret submission as approval.
5. After PubCommander reports the post as `approved`, validate scheduling or publication with `dryRun: true`.
6. Call `schedule_post` or `publish_post` with `dryRun: false` only after the user explicitly confirms that exact action and targets.
7. Report the returned status and proof. Never claim publication succeeded without a successful tool result.

## Guardrails

- Never invent a `postId`; obtain it from PubCommander.
- Never pass or request a user identity through tool arguments. The MCP server binds operations to its configured service user.
- Treat `schedule_post` and `publish_post` as external side effects even if content was already approved.
- Approval is state held by PubCommander, not a phrase inferred from conversation.
- If a live action fails, preserve the draft and report the platform-level error; do not retry repeatedly without diagnosis.
- Prefer platform-specific variants when the audience or format differs. Keep the shared draft as the canonical intent.

## Common requests

- “Prépare trois variantes LinkedIn et Instagram” → create or update a draft, then present it for review.
- “Envoie-le en validation” → call `submit_post_for_approval`; stop before scheduling or publishing.
- “Publie maintenant” → inspect status, run a dry run, request explicit confirmation if not already given for this exact live action, then publish and return the proof.
