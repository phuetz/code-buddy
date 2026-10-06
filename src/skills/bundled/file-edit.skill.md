---
name: file-edit
description: Edit files with precise changes
version: 1.0.0
author: Code Buddy
tags:
  - file
  - edit
  - code
requires:
  tools:
    - read_file
    - edit_file
nativeEngine:
  category: development
  priority: 90
  triggers:
    - edit file
    - change file
    - modify file
    - update file
    - fix in file
  examples:
    - "Edit the config file to add a new setting"
    - "Fix the typo in README.md"
---

# File Edit

Make precise edits to files in the codebase.

## When to Use

- User wants to modify an existing file
- User asks to fix something in a file
- User wants to add or remove code from a file

## Examples

- Edit src/config.ts to add a new setting
  > Reads the file, identifies the location, makes the change
- Fix the typo in README.md line 5
  > Reads the file, finds line 5, corrects the typo

## Steps

1. Use `read_file` to read the current content
2. Identify the exact location that needs to change
3. Use `edit_file` with old_string and new_string for precise edits
4. Verify the change was applied correctly

## Tools

- `read_file(path)`: Read the file content first
- `edit_file(path, old_string, new_string)`: Make the edit

## Best Practices

- Always read the file first to understand context
- Use unique strings for old_string to avoid ambiguity
- Make minimal changes - don't rewrite entire files
- Preserve existing formatting and style
