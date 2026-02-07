---
name: healthcheck
version: 1.0.0
description: Security audit and environment hardening. Use when asked about security, system health, or deployment safety.
author: Code Buddy
tags: security, audit, health, hardening, deployment
---

# Health Check & Security Audit

## Overview

Audit the development environment and project for security issues, misconfigurations, and best practices compliance.

## Safety

- **Require explicit approval** before any state-changing action.
- **Prefer reversible changes** with a rollback plan.
- Never modify SSH, firewall, or auth configs without confirmation.

## Workflow

### 1. Environment Check
```bash
buddy doctor  # Run Code Buddy diagnostics
```

### 2. Project Security Scan

#### Dependencies
```bash
npm audit                          # Check for known vulnerabilities
npm outdated                       # Find outdated packages
npx license-checker --summary      # Check license compliance
```

#### Secrets Detection
```bash
# Check for hardcoded secrets
rg -i "(api_key|apikey|secret|password|token)\s*[:=]" src/ --type ts --type js
rg -i "-----BEGIN.*PRIVATE KEY" .
# Check .env is gitignored
git check-ignore .env
```

#### Code Quality
```bash
npm run lint                       # Linting issues
npx tsc --noEmit                   # Type errors
npm test                           # Test suite
```

### 3. Git Security
```bash
# Check for large files in history
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | sort -k3 -n -r | head -20

# Check for sensitive files tracked
git ls-files | rg -i '(\.env|\.pem|\.key|credentials|secret)'

# Verify .gitignore covers sensitive patterns
cat .gitignore | rg '(\.env|node_modules|dist|\.key|\.pem)'
```

### 4. Production Readiness
- [ ] Environment variables documented in `.env.example`
- [ ] No `console.log` debugging left in production code
- [ ] Error handling on all external API calls
- [ ] Rate limiting on public endpoints
- [ ] CORS configured explicitly (not `*`)
- [ ] Authentication on sensitive routes
- [ ] Input validation at system boundaries
- [ ] Dependencies pinned or lockfile committed

## Output Format

```markdown
## Security Audit Report

### Environment: OK / WARN / FAIL
- Node.js: v22.x ✅
- Dependencies: 2 vulnerabilities ⚠️
- ...

### Secrets: OK / WARN / FAIL
- No hardcoded secrets found ✅
- .env is gitignored ✅
- ...

### Code Quality: OK / WARN / FAIL
- Lint: 0 errors ✅
- Types: 0 errors ✅
- Tests: 45 passing ✅

### Recommendations
1. Fix 2 moderate npm vulnerabilities: `npm audit fix`
2. ...
```
