---
name: github
version: 1.0.0
description: Interact with GitHub using the gh CLI for issues, PRs, CI runs, releases, and API queries
author: Code Buddy
tags: git, github, gh, issues, pr, ci
---

# GitHub CLI

## Overview

Use the `gh` CLI for all GitHub operations. Prefer `gh` over raw git commands for GitHub-specific features.

## Quick Reference

### Pull Requests
```bash
# List open PRs
gh pr list

# View PR details
gh pr view <number>

# View PR diff
gh pr diff <number>

# Check CI status
gh pr checks <number>

# Create PR
gh pr create --title "title" --body "description"

# Checkout PR locally
gh pr checkout <number>

# Review PR
gh pr review <number> --approve
gh pr review <number> --request-changes --body "feedback"

# Merge PR
gh pr merge <number> --squash --delete-branch
```

### Issues
```bash
# List issues
gh issue list
gh issue list --label "bug" --state open

# Create issue
gh issue create --title "Bug: ..." --body "description" --label "bug"

# View issue
gh issue view <number>

# Close issue
gh issue close <number>

# Add comment
gh issue comment <number> --body "comment"
```

### CI / Actions
```bash
# List recent workflow runs
gh run list --limit 10

# View run details
gh run view <run-id>

# View failed logs
gh run view <run-id> --log-failed

# Re-run failed jobs
gh run rerun <run-id> --failed

# Watch a running workflow
gh run watch <run-id>
```

### Releases
```bash
# List releases
gh release list

# Create release
gh release create v1.0.0 --title "v1.0.0" --notes "Release notes"

# Download release assets
gh release download v1.0.0
```

### API (advanced queries)
```bash
# Raw API call
gh api repos/{owner}/{repo}/pulls/<number> --jq '.title, .state'

# List PR comments
gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[].body'

# Get repo info
gh api repos/{owner}/{repo} --jq '{stars: .stargazers_count, forks: .forks_count}'

# Search issues
gh api search/issues --method GET -f q="repo:{owner}/{repo} is:issue is:open label:bug" --jq '.items[].title'
```

## Tips

- Use `--json` flag with `--jq` for structured output
- Use `--web` to open in browser: `gh pr view <number> --web`
- Set default repo: `gh repo set-default owner/repo`
- Use `--repo owner/repo` to target a specific repo without cd
