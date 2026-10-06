---
name: web-search
description: Search the web for information and return relevant results
version: 1.0.0
author: Code Buddy
tags:
  - search
  - web
  - research
requires:
  tools:
    - web_search
nativeEngine:
  category: research
  priority: 80
  triggers:
    - search for
    - look up
    - find information about
    - recherche sur le web
    - search the web
  examples:
    - "Search for TypeScript best practices"
    - "Look up the latest React news"
---

# Web Search

Use this skill when the user wants to search the web for information.

## When to Use

- User asks to search for something
- User wants to find information about a topic
- User asks "what is X" for current events or recent topics
- User wants to look something up online

## Examples

- Search for TypeScript best practices
  > Returns top results about TypeScript best practices with links
- Find information about the latest AI developments
  > Returns recent news and articles about AI
- Look up how to configure ESLint
  > Returns documentation and tutorials for ESLint configuration

## Steps

1. Parse the user's query to extract the search terms
2. Use `web_search` tool to search the web
3. Format the results with titles, snippets, and URLs
4. Summarize the key findings

## Tools

- `web_search`: Search the web and return results
