---
name: merge-pr
version: 1.0.0
description: Merge a GitHub PR via squash after review and preparation. Ensure the PR ends in MERGED state. Do not push to main or modify code.
author: Code Buddy
tags: git, github, pr, merge, squash
---

# Merge PR

## Overview

Merge a prepared PR via `gh pr merge --squash` and clean up.

## Inputs

- Ask for PR number or URL if not provided.

## Safety

- **Use `gh pr merge --squash` as the only path to `main`.**
- **Do not run `git push` at all during merge.**
- Do not modify code.

## Pre-merge Checks

### 1. Verify PR is ready
```bash
gh pr view <number> --json state,mergeable,mergeStateStatus,statusCheckRollup
```

- State must be `OPEN`
- Must not be draft
- All required checks must pass
- Branch must not be behind main

### 2. Verify CI is green
```bash
gh pr checks <number>
```

## Merge

```bash
gh pr merge <number> --squash --delete-branch
```

## Post-merge Verification

### 3. Confirm merged state
```bash
gh pr view <number> --json state,mergeCommit
```

- State must be `MERGED`
- Record merge commit SHA

### 4. Clean up local branch
```bash
git checkout main
git pull origin main
git branch -d <head-branch> 2>/dev/null || true
```

## Output

```
PR #<number> merged successfully.
Merge commit: <sha>
Branch <head-branch> deleted.
```
