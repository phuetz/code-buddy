# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |
| < 0.0.10| :x:                |

## Reporting a Vulnerability

We take the security of Code Buddy seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Please DO NOT

- **Do not** open a public GitHub issue for security vulnerabilities
- **Do not** publicly disclose the vulnerability until it has been addressed
- **Do not** attempt to exploit the vulnerability beyond what is necessary to demonstrate it

### Please DO

**Report security vulnerabilities privately** using GitHub's built-in private reporting:

1. **GitHub Security Advisories** (Preferred)
   - Go to the [Security tab](https://github.com/phuetz/code-buddy/security/advisories)
   - Click "Report a vulnerability"
   - Fill out the form with details

2. **Reach the maintainer**
   - If you cannot use the form, contact the maintainer via their [GitHub profile](https://github.com/phuetz)
   - Please do **not** open a public issue for security problems until they have been addressed

### What to Include

Please include the following information in your report:

- **Type of vulnerability** (e.g., XSS, command injection, etc.)
- **Full paths** of source file(s) related to the vulnerability
- **Location** of the affected source code (tag/branch/commit or direct URL)
- **Step-by-step instructions** to reproduce the issue
- **Proof-of-concept or exploit code** (if possible)
- **Impact** of the vulnerability
- **Suggested fix** (if you have one)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours
- **Communication**: We will keep you informed about our progress in addressing the vulnerability
- **Credit**: We will credit you in the security advisory unless you prefer to remain anonymous
- **Timeline**: We aim to address critical vulnerabilities within 7 days and other vulnerabilities within 30 days

## Security Measures

### Current Security Features

Code Buddy implements several security measures:

1. **Input Validation**
   - All user inputs are validated and sanitized
   - File paths are checked for directory traversal attacks
   - Command arguments are validated to prevent injection

2. **Command Validation**
   - Dangerous commands are flagged and require explicit confirmation
   - Blocked commands (like fork bombs) are prevented
   - Command whitelist/blacklist system

3. **API Key Protection**
   - API keys are never logged or displayed
   - Environment variables are recommended over hardcoded keys
   - Settings files use appropriate file permissions

4. **Dependency Security**
   - Regular dependency audits via `npm audit`
   - Automated security scanning in CI/CD
   - Prompt updates for vulnerable dependencies

### Security Best Practices for Users

1. **API Keys**
   ```bash
   # Good: Use environment variables
   export GROK_API_KEY=your_key_here

   # Bad: Don't hardcode in scripts
   grok --api-key "hardcoded_key"  # Avoid this
   ```

2. **File Permissions**
   ```bash
   # Ensure your settings file is not world-readable
   chmod 600 ~/.grok/user-settings.json
   ```

3. **Command Execution**
   - Review commands before confirming execution
   - Be cautious with bash tool usage
   - Don't blindly trust AI-generated commands

4. **Updates**
   - Keep Code Buddy updated to the latest version
   - Check CHANGELOG.md for security fixes
   - Subscribe to security advisories

## Known Security Considerations

### Bash Command Execution

Code Buddy can execute arbitrary bash commands. While we implement validation:

- ⚠️ **Always review** commands before execution
- ⚠️ **Be cautious** in production environments
- ⚠️ **Use confirmation prompts** (don't bypass them)

### AI-Generated Code

AI-generated code should be reviewed:

- ⚠️ **Review all code** before running or committing
- ⚠️ **Test in safe environments** first
- ⚠️ **Understand what code does** before execution

### API Key Storage

- ⚠️ Keys in `~/.grok/user-settings.json` are stored in **plaintext**
- ⚠️ Ensure proper file permissions
- ⚠️ Consider using environment variables for sensitive environments

### Known transitive dependency advisories (npm audit)

Last reviewed: **2026-05-29** (smoke-test finding F3). A clean `npm install` followed by
`npm audit --omit=dev` is run; non-breaking fixes are applied via `npm audit fix` (which
updated `package-lock.json`, reducing prod-tree HIGH advisories **12 → 5** and total **67 → 53**).
The remaining advisories require a **breaking** major upgrade or have **no upstream fix**, and are
all reached through transitive or optional dependencies. They are tracked here rather than forced,
to avoid destabilizing the dependency graph (a blanket override of e.g. `picomatch` would break the
`4.x` consumers while patching the `2.x` one):

| Advisory (pkg) | Severity | Reached via | Why deferred / mitigation |
|---|---|---|---|
| `@langchain/core`, `langsmith` | high | `@browserbasehq/stagehand` (browser automation) | Fix needs a **major** `stagehand` change; pending compatibility review of the Browser Operator path. |
| `@opentelemetry/sdk-node`, `@opentelemetry/exporter-prometheus` | high | OpenTelemetry observability | Fix needs a **major** OTel SDK bump (`0.218.x`); pending an observability dependency sweep. |
| `xlsx` (SheetJS) | high | **optional** dep (spreadsheet tool) | Prototype-pollution + ReDoS, **no upstream fix** on the community build. Only reachable when the user processes a spreadsheet; consider migrating off the SheetJS community build. |

Exploitability is low in a developer CLI context: ReDoS/prototype-pollution paths require
**attacker-controlled input** (globs, spreadsheets), whereas this tool primarily processes the
operator's own inputs. Re-run `npm audit --omit=dev` after any dependency bump.

## Security Audit History

| Date | Version | Auditor | Findings | Status |
|------|---------|---------|----------|--------|
| 2026-05-29 | 1.0.0-rc.8 | Fresh-clone smoke test (`SMOKE-TEST-2026-05-29.md`) | F1 npm-lag, F3 deps, F6 fs-extra runtime bug, F7 model routing, F8 cost display | F6/F7/F8 fixed; F3 non-breaking fixes applied + residuals tracked above; F1 README mitigated (publish pending) |

## Vulnerability Disclosure Timeline

When a security vulnerability is reported and confirmed:

1. **Day 0**: Vulnerability reported
2. **Day 1-2**: Acknowledgment sent
3. **Day 3-7**: Investigation and fix development
4. **Day 7-14**: Testing and verification
5. **Day 14-21**: Prepare security advisory and patch release
6. **Day 21-30**: Public disclosure with patch release

Critical vulnerabilities may have an accelerated timeline.

## Security Updates

Security updates will be:

- Released as patch versions (0.0.x)
- Documented in CHANGELOG.md with `[SECURITY]` tag
- Announced via GitHub Security Advisories
- Highlighted in release notes

## Contact

For security-related questions or concerns:

- **Report a vulnerability (private)**: https://github.com/phuetz/code-buddy/security/advisories/new
- **General Issues**: https://github.com/phuetz/code-buddy/issues
- **Discussions**: https://github.com/phuetz/code-buddy/discussions

## Attribution

We would like to thank the following individuals for responsibly disclosing security vulnerabilities:

<!-- List will be updated as vulnerabilities are reported and fixed -->

---

**Remember**: Security is everyone's responsibility. If you see something, say something.
