---
name: skill-creator
version: 1.0.0
description: Create or update Code Buddy skills. Use when designing, structuring, or packaging new SKILL.md files.
author: Code Buddy
tags: skill, create, meta, template
---

# Skill Creator

## Overview

Guide for creating well-structured Code Buddy skills.

## Anatomy of a Skill

```
skill-name/
├── SKILL.md          # Required — instructions for the agent
├── scripts/          # Optional — executable helpers
├── references/       # Optional — detailed docs loaded on demand
└── assets/           # Optional — templates, icons, config files
```

## SKILL.md Structure

### Frontmatter (required)
```yaml
---
name: my-skill           # lowercase, hyphens, <64 chars
version: 1.0.0
description: One-line description used for skill matching and activation
author: Your Name
tags: keyword1, keyword2
env:                      # Optional env overrides
  MY_VAR: default_value
---
```

### Body (required)
```markdown
# Skill Name

## Overview
What this skill does in 1-2 sentences.

## When to Use
Trigger conditions — when should the agent activate this skill?

## Workflow / Commands
Step-by-step instructions or command reference.

## Output Format
Expected output structure.

## Tips / Gotchas
Common pitfalls and workarounds.
```

## Design Principles

### 1. Concise is Key
Context window is a shared resource. Only include what the LLM doesn't already know.

**Bad**: Explaining what `git commit` does.
**Good**: Documenting a specific workflow with safety rules.

### 2. Set Appropriate Degrees of Freedom

| Freedom | Use When | Format |
|---------|----------|--------|
| High | Multiple approaches valid | Natural language description |
| Medium | Preferred pattern exists | Pseudocode or examples |
| Low | Operation is fragile | Exact commands with safety checks |

### 3. Progressive Disclosure

- **Frontmatter**: Always loaded (name + description for matching)
- **SKILL.md body**: Loaded when skill is triggered
- **References**: Loaded on demand for detailed sub-topics

### 4. Avoid Duplication

Information should live in ONE place:
- General knowledge → Don't include (LLM already knows)
- Skill-specific workflow → SKILL.md body
- Detailed reference → `references/` directory

## Skill Locations

| Location | Source | Purpose |
|----------|--------|---------|
| `.codebuddy/skills/bundled/` | Ships with Code Buddy | Core skills |
| `.codebuddy/skills/managed/` | Installed by user | Community skills |
| `.codebuddy/skills/workspace/` | Project-specific | Per-project skills |

## Creation Checklist

1. [ ] Name is lowercase with hyphens, descriptive
2. [ ] Description clearly states when to activate
3. [ ] Tags cover likely search terms
4. [ ] Body has Overview, When to Use, Workflow sections
5. [ ] Safety rules included if skill modifies state
6. [ ] Commands are copy-pasteable
7. [ ] No redundant information the LLM already knows
8. [ ] Tested with a real conversation
