---
name: prepare-pr
version: 1.0.0
description: Prepare a GitHub PR for merge by fixing review findings, running checks, and pushing updates. Use after review-pr. Never merge or push to main.
author: Code Buddy
tags: git, github, pr, prepare, fix
---

# Prepare PR

## Overview

Prepare a PR branch for merge with review fixes, green CI, and an updated head branch.

## Inputs

- Ask for PR number or URL if not provided.
- If review findings exist, use them to guide fixes.

## Safety

- **Never push to `main` or `origin/main`.** Push only to the PR head branch.
- **Never run bare `git push`.** Always specify remote and branch explicitly.
- **Do not run `git add -A` or `git add .`.** Stage only specific changed files.
- Do not run `git clean -fdx`.

## Workflow

### 1. Checkout the PR branch
```bash
gh pr checkout <number>
```

### 2. Rebase onto latest main
```bash
git fetch origin main
git rebase origin/main
```

### 3. Fix review findings
Address BLOCKER and IMPORTANT issues from the review. For each fix:
- Make the minimal change needed
- Stage only the specific files changed
- Commit with a descriptive message: `fix: address review — <description>`

### 4. Run validation
```bash
npm run validate  # or the project's equivalent: lint + typecheck + test
```

### 5. Fix any validation errors
If lint/typecheck/test fails, fix and commit.

### 6. Push to PR branch
```bash
git push origin HEAD:<head-branch> --force-with-lease
```

### 7. Verify PR is up to date
```bash
gh pr checks <number>
gh pr view <number> --json mergeable
```

## Output

Confirm: "PR #<number> is prepared and ready for merge."
