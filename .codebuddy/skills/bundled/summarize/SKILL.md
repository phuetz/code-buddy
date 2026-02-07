---
name: summarize
version: 1.0.0
description: Summarize or extract content from URLs, files, codebases, and conversations
author: Code Buddy
tags: summarize, extract, digest, tldr
---

# Summarize

## Overview

Produce concise, structured summaries of various content types.

## When to Use

- User asks to summarize a URL, article, or document
- User asks for a TL;DR of a file, conversation, or codebase
- User asks to extract key points from content

## URL / Web Content

1. Fetch the content using available tools (web fetch, curl)
2. Extract the main text, ignoring navigation, ads, and boilerplate
3. Produce a structured summary

## File / Document

1. Read the file
2. Identify the type (code, documentation, config, data)
3. Summarize accordingly:
   - **Code**: Purpose, key functions/classes, dependencies, patterns used
   - **Docs**: Main topics, key takeaways, action items
   - **Config**: What it configures, notable settings, potential issues
   - **Data**: Schema, row count, key fields, notable patterns

## Codebase

When asked to summarize a project or codebase:

1. Read `package.json`, `README.md`, and entry points
2. Scan directory structure
3. Identify tech stack, architecture patterns, key modules
4. Produce:

```markdown
## Project: <name>

**Tech Stack**: Node.js, TypeScript, Express, Prisma...
**Architecture**: <pattern> (MVC, hexagonal, microservices...)
**Entry Point**: src/index.ts

### Key Modules
- `src/auth/` — Authentication (JWT, OAuth)
- `src/api/` — REST endpoints
- ...

### Dependencies (notable)
- express, prisma, zod...

### Scripts
- `npm run dev` — Development
- `npm test` — Tests
- ...

### Notes
- <anything notable: missing tests, security concerns, TODOs>
```

## Conversation

When asked to summarize the current conversation:
1. Identify the main topics discussed
2. List decisions made
3. List action items / next steps
4. Note any unresolved questions

## Output Format

Always structure summaries with:
- **TL;DR** — One sentence
- **Key Points** — Bullet list (3-7 items)
- **Details** — Expanded sections as needed
- **Action Items** — If applicable
