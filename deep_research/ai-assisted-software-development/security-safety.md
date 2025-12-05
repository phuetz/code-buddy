# Security and Safety in AI-Assisted Development (2023-2025)

Research findings on sandboxing, permission systems, code validation, and defense mechanisms.

---

## 1. Code Execution Sandboxing

### Why Sandboxing is Essential

When an AI system produces code, strict controls are necessary on execution. Without boundaries, attackers can craft inputs that trick AI into generating malicious code.

**Key Principle:**
> Sanitization is insufficient for agentic workflows. Containment is the only scalable solution.

### Sandboxing Approaches

#### Container-Based Sandboxing (Docker)
**Most widely adopted approach:**
- Lightweight barrier between AI operations and host system
- Isolated filesystem, network, and process space
- Easy to implement with existing infrastructure

```typescript
// Docker-based sandbox
interface SandboxConfig {
  image: string;
  memoryLimit: string;
  cpuLimit: string;
  networkMode: 'none' | 'bridge';
  readOnlyRoot: boolean;
  timeout: number;
}

async function executeInSandbox(
  code: string,
  config: SandboxConfig
): Promise<ExecutionResult> {
  const container = await docker.createContainer({
    Image: config.image,
    Memory: parseMemory(config.memoryLimit),
    NetworkDisabled: config.networkMode === 'none',
    ReadonlyRootfs: config.readOnlyRoot,
  });

  try {
    await container.start();
    const result = await container.exec(['python', '-c', code]);
    return { success: true, output: result.stdout };
  } finally {
    await container.kill();
    await container.remove();
  }
}
```

#### WebAssembly (WASM) Sandboxing
**Emerging approach with browser-level security:**
- Instruction-level isolation (vs OS-level for containers)
- Consistent performance across platforms
- Inherently limited system resource access
- Prevents cross-user contamination

**Pyodide for Python:**
- Port of CPython into WASM
- Runs Python in browser sandbox
- Client-side execution

### LLM Sandbox Tools

**LLM Sandbox (Open Source):**
- GitHub: https://github.com/vndee/llm-sandbox
- Lightweight and portable
- Multiple container backend support
- Comprehensive language support

**SandboxEval:**
- 51 security test properties
- Tests: sensitive info exposure, filesystem manipulation, external communication
- Real-world safety scenarios

### Best Practices

1. **Restrict Operations** - Parse AST to identify dangerous patterns
2. **Memory Isolation** - Dedicated memory space and namespace
3. **Custom Interpreters** - Remove risky builtins (eval, exec, import)
4. **Network Restrictions** - No external communication by default
5. **Timeouts** - Prevent infinite loops and resource exhaustion

---

## 2. Permission Systems

### Current Vulnerabilities

**Statistics (2024):**
- 322% more privilege escalation paths in AI-generated code
- 153% more design flaws vs human code
- 40% increase in secrets exposure
- AI commits merged 4x faster (bypassing reviews)

**Real Incidents:**
- **Amazon Q (August 2024):** Poisoned update deleted files, shut down EC2 instances
- **CamoLeak (GitHub Copilot):** CVSS 9.6 - leaked secrets from private repos
- **Google Bard, Slack AI:** Susceptible to prompt injection attacks

### Permission Model Design

```typescript
enum Permission {
  READ_FILE = 'read_file',
  WRITE_FILE = 'write_file',
  DELETE_FILE = 'delete_file',
  EXECUTE_CODE = 'execute_code',
  NETWORK_ACCESS = 'network_access',
  INSTALL_PACKAGE = 'install_package',
  GIT_OPERATIONS = 'git_operations',
}

interface PermissionPolicy {
  allowed: Permission[];
  denied: Permission[];
  requireConfirmation: Permission[];
  pathRestrictions: {
    allowedPaths: string[];
    deniedPaths: string[];
  };
}

// Example: Restrictive default policy
const defaultPolicy: PermissionPolicy = {
  allowed: [Permission.READ_FILE],
  denied: [Permission.DELETE_FILE, Permission.NETWORK_ACCESS],
  requireConfirmation: [
    Permission.WRITE_FILE,
    Permission.EXECUTE_CODE,
    Permission.GIT_OPERATIONS,
  ],
  pathRestrictions: {
    allowedPaths: ['/workspace/**'],
    deniedPaths: ['**/.env', '**/secrets/**', '~/.ssh/**'],
  },
};
```

### Least Privilege Principle

1. **Narrow Permissions** - Only grant what's necessary
2. **Confirmation for Destructive Ops** - Delete, overwrite, execute
3. **Path Restrictions** - Confine to project directory
4. **Time-Limited Access** - Revoke after task completion
5. **Audit Logging** - Track all operations

---

## 3. Code Validation and Security Testing

### Vulnerability Statistics

**AI-Generated Code Issues:**
- 62% contain design flaws or vulnerabilities
- 40%+ contain security flaws (academic studies)
- GitHub Copilot: 32.8% Python, 24.5% JavaScript vulnerabilities
- 60% of repository AI code has security flaws

**Common Vulnerability Types (CWE Top 25):**
1. Input validation failures
2. Buffer overflows
3. SQL injection
4. Command injection
5. Insecure random number generation
6. Memory leaks
7. Unsafe file handling

### Validation Framework

```typescript
interface CodeValidator {
  staticAnalysis(code: string): Promise<SecurityIssue[]>;
  astAnalysis(code: string): Promise<PatternMatch[]>;
  dependencyCheck(code: string): Promise<VulnerablePackage[]>;
  secretScan(code: string): Promise<SecretLeak[]>;
}

class SecurityValidator implements CodeValidator {
  private analyzers: StaticAnalyzer[];

  async validate(code: string): Promise<ValidationResult> {
    const results = await Promise.all([
      this.staticAnalysis(code),
      this.astAnalysis(code),
      this.dependencyCheck(code),
      this.secretScan(code),
    ]);

    return {
      passed: results.every(r => r.length === 0),
      issues: results.flat(),
      severity: this.calculateSeverity(results),
    };
  }

  async staticAnalysis(code: string): Promise<SecurityIssue[]> {
    // Run CodeQL, Semgrep, or similar
    const issues: SecurityIssue[] = [];

    for (const analyzer of this.analyzers) {
      const found = await analyzer.analyze(code);
      issues.push(...found);
    }

    return issues;
  }
}
```

### Security-Focused Prompting

**Research Finding:**
Security-focused prompt prefixes can reduce vulnerabilities by up to 56% (GPT-4o).

```typescript
const securityPromptPrefix = `
You are a secure coding expert. When generating code:
1. Always validate and sanitize user input
2. Use parameterized queries for database operations
3. Never hardcode secrets or credentials
4. Use secure random number generators (secrets module)
5. Implement proper error handling without leaking info
6. Follow the principle of least privilege
7. Use HTTPS for all external communications
`;
```

### LLMSecGuard Framework
**EASE 2024 Paper:**
- Combines static analyzers with LLMs
- Enhanced security through synergy
- Produces more secure code than initial generation

---

## 4. Prompt Injection Defense

### Attack Types

**1. Direct Injection:**
User input directly alters model behavior.

**2. Indirect Injection:**
Malicious content in external sources (websites, files, documents).

**3. Multimodal Attacks:**
Hidden instructions in images accompanying benign text.

### Real-World Impact

- 31 of 36 tested LLM-integrated apps susceptible (HouYi research)
- Validated by vendors including Notion
- Affects millions of users

### Defense Strategies

#### Multi-Agent Defense Pipeline (2024)
**Results:** 0% Attack Success Rate across 55 adversarial cases

**Architecture:**
```
Input → Screening Agent → Main Agent → Validation Agent → Output
              ↓                              ↓
         Reject if                    Sanitize/Reject
          malicious                    if compromised
```

#### Defensive Tokens
- 0.24% ASR (averaged across four models)
- Comparable to training-time defenses
- Test-time implementation

#### Spotlighting
- "Marks" data using special delimiters
- Encodes data (e.g., base64)
- Marks each token with preceding token

#### Input/Output Sanitization

```typescript
interface InjectionDefense {
  detectInjection(input: string): Promise<DetectionResult>;
  sanitizeInput(input: string): string;
  validateOutput(output: string): boolean;
}

class PromptInjectionDefense implements InjectionDefense {
  private detector: InjectionClassifier;
  private patterns: RegExp[];

  async detectInjection(input: string): Promise<DetectionResult> {
    // Check against known patterns
    for (const pattern of this.patterns) {
      if (pattern.test(input)) {
        return { detected: true, type: 'pattern_match' };
      }
    }

    // ML-based detection
    const score = await this.detector.classify(input);
    return {
      detected: score > 0.7,
      confidence: score,
      type: 'ml_classifier',
    };
  }

  sanitizeInput(input: string): string {
    return input
      .replace(/ignore previous instructions/gi, '')
      .replace(/system:/gi, '')
      .replace(/assistant:/gi, '')
      // ... more patterns
  }
}
```

### Instruction Hierarchy

**Implemented in GPT-4o, Gemini-2.5:**
- Multi-layer security policy
- Higher-priority instructions always obeyed
- System > User > Tool outputs

### Key Challenges

> All eight evaluated defense mechanisms can be bypassed through adaptive attack strategies, resulting in >50% ASR.

- Stochastic nature of LLMs makes fool-proof prevention unclear
- Power-law scaling: attackers with resources can eventually bypass
- Defense is layered, not absolute

---

## 5. Implementation Recommendations

### For CLI Coding Assistants

#### 1. Default-Deny Permission Model
```typescript
const securityConfig = {
  sandbox: {
    enabled: true,
    type: 'docker',
    networkAccess: false,
    timeout: 30000,
  },
  permissions: {
    defaultDeny: true,
    allowList: [
      { action: 'read', path: '/workspace/**' },
      { action: 'write', path: '/workspace/**', confirm: true },
    ],
    denyList: [
      { path: '**/.env' },
      { path: '**/secrets/**' },
      { path: '~/**', except: '~/workspace/**' },
    ],
  },
  validation: {
    runStaticAnalysis: true,
    secretScanning: true,
    checkDependencies: true,
  },
};
```

#### 2. Confirmation Flow for Destructive Operations
```typescript
const DESTRUCTIVE_OPS = [
  'delete_file',
  'delete_directory',
  'overwrite_file',
  'execute_shell',
  'install_package',
  'git_push',
  'git_force',
];

async function executeWithConfirmation(
  op: Operation,
  args: any[]
): Promise<Result> {
  if (DESTRUCTIVE_OPS.includes(op.type)) {
    const confirmed = await promptUser(
      `Allow ${op.type} on ${args[0]}?`,
      op.preview
    );

    if (!confirmed) {
      return { cancelled: true };
    }
  }

  return await executeInSandbox(op, args);
}
```

#### 3. Output Validation Pipeline
```typescript
async function validateGeneratedCode(code: string): Promise<ValidationResult> {
  const checks = [
    checkForHardcodedSecrets(code),
    runStaticAnalysis(code),
    checkDependencyVulnerabilities(code),
    validateAST(code),
  ];

  const results = await Promise.all(checks);
  const issues = results.flatMap(r => r.issues);

  return {
    safe: issues.filter(i => i.severity === 'critical').length === 0,
    issues,
    recommendations: generateRecommendations(issues),
  };
}
```

#### 4. Layered Defense Strategy
```
Layer 1: Input Sanitization
     ↓
Layer 2: Permission Checking
     ↓
Layer 3: Sandbox Execution
     ↓
Layer 4: Output Validation
     ↓
Layer 5: User Confirmation (if needed)
     ↓
Layer 6: Audit Logging
```

---

## Sources

- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [Prompt Injection Defenses - tldrsec](https://github.com/tldrsec/prompt-injection-defenses)
- [Multi-Agent Defense Pipeline](https://arxiv.org/html/2509.14285)
- [NVIDIA: Code Execution Risks in Agentic AI](https://developer.nvidia.com/blog/how-code-execution-drives-key-risks-in-agentic-ai-systems)
- [WebAssembly Sandboxing - NVIDIA](https://developer.nvidia.com/blog/sandboxing-agentic-ai-workflows-with-webassembly/)
- [LLM Sandbox](https://github.com/vndee/llm-sandbox)
- [SandboxEval](https://arxiv.org/html/2504.00018v1)
- [AI Code Security Vulnerabilities - CSA](https://cloudsecurityalliance.org/blog/2025/07/09/understanding-security-risks-in-ai-generated-code)
- [Cybersecurity Risks of AI-Generated Code - Georgetown CSET](https://cset.georgetown.edu/wp-content/uploads/CSET-Cybersecurity-Risks-of-AI-Generated-Code.pdf)
- [LLMSecGuard - EASE 2024](https://dl.acm.org/doi/10.1145/3661167.3661263)
- [Security in LLM-Generated Code](https://arxiv.org/html/2502.01853v1)
- [Hidden Risks of LLM-Generated Web Code](https://arxiv.org/html/2504.20612v1)
