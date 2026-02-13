# .grok Directory

This directory contains configuration and customization files for [Grok CLI](https://github.com/phuetz/code-buddy).

## Files

- **GROK.md** - Custom instructions that Grok follows when working in this project
- **settings.json** - Project-specific settings
- **hooks.json** - Automated hooks (pre-commit, post-edit, etc.)
- **mcp.json** - MCP server configurations (committable, shared with team)
- **security.json** - Security mode configuration
- **commands/** - Custom slash commands

## Custom Commands

Create `.md` files in the `commands/` directory to add custom slash commands.

Example `commands/my-command.md`:
```markdown
---
description: My custom command
---

# My Command

Your prompt template here. Use $1, $2 for arguments.
```

Then use it with: `/my-command arg1 arg2`

## Hooks

Configure automated actions in `hooks.json`:
- `pre-commit` - Run before git commit
- `post-edit` - Run after file edit
- `on-file-change` - Run when files change

## MCP Servers

Configure MCP servers in `mcp.json` to extend Grok's capabilities.
This file can be committed to share servers with your team.

## Security

Configure security modes in `security.json`:
- `suggest` - All changes require approval (safest)
- `auto-edit` - File edits auto-apply, bash requires approval
- `full-auto` - Fully autonomous but sandboxed

## More Information

See the [Grok CLI documentation](https://github.com/phuetz/code-buddy) for more details.
