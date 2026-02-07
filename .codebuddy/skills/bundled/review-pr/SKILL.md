---
name: review-pr
version: 1.0.0
description: Review-only GitHub pull request analysis with the gh CLI. Use when asked to review a PR, provide structured feedback, or assess readiness to merge. Do not merge, push, or make code changes.
author: Code Buddy
tags: git, github, pr, review, code-review
---

# Review PR

## Overview

Perform a thorough review-only PR assessment and return a structured recommendation.

## Inputs

- Ask for PR number or URL if not provided.
- If ambiguous, ask for clarification.

## Safety

- **Never push to `main` or `origin/main`.**
- **Do not run `git push` at all during review.** Review is read-only.
- Do not modify code.

## Workflow

### 1. Identify PR metadata
```bash
gh pr view <number> --json title,body,author,baseRefName,headRefName,additions,deletions,files,reviews,state
```

### 2. Read the diff
```bash
gh pr diff <number>
```

### 3. Check CI status
```bash
gh pr checks <number>
```

### 4. Read changed files in context
For each changed file, read the full file to understand the surrounding code.

### 5. Produce structured review

Write the review with these sections:

**A) TL;DR** — One-line recommendation: APPROVE, REQUEST_CHANGES, or NEEDS_DISCUSSION

**B) What changed** — Concise summary of the changes

**C) What is good** — Positive aspects of the implementation

**D) Security findings** — Any security concerns (injection, secrets, auth issues)

**E) Concerns** — Categorized as:
- `BLOCKER` — Must fix before merge
- `IMPORTANT` — Should fix, but not a dealbreaker
- `NIT` — Style/preference, optional

**F) Tests** — Are changes tested? Are edge cases covered?

**G) Docs** — Are docs updated if needed?

**H) Suggested PR comment** — Ready-to-post review comment

## Output Format

```markdown
## PR Review: #<number> — <title>

### A) TL;DR
APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION

### B) What changed
...

### C) What is good
...

### D) Security
...

### E) Concerns
- BLOCKER: ...
- IMPORTANT: ...
- NIT: ...

### F) Tests
...

### G) Docs
...

### H) Suggested comment
...
```
