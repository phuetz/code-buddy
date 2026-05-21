/**
 * Workflow Orchestration Rules
 *
 * Concrete, measurable workflow rules injected into the system prompt once
 * per session. These improve on vague "non-trivial" guidance by specifying
 * exact triggers for planning, auto-correction, verification, and subagent use.
 *
 * Injected by PromptBuilder.buildSystemPrompt() after bootstrap context.
 */

export interface WorkflowRulesOptions {
  /**
   * Tool availability predicate for model-facing prompt guidance. Defaults
   * to all tools available to preserve legacy prompt behavior.
   */
  isToolAvailable?: (toolName: string) => boolean;
}

const DEFAULT_TOOL_AVAILABLE = (_toolName: string) => true;

function buildAutoCorrectionRule(isToolAvailable: (toolName: string) => boolean): string {
  if (isToolAvailable('lessons_add')) {
    return `After any user correction, call \`lessons_add\` with category=PATTERN.
Format: "[what went wrong] -> [correct behaviour]"`;
  }

  return `After any user correction, capture the reusable pattern in the final summary or an approved note.
Format: "[what went wrong] -> [correct behaviour]"`;
}

function buildVerificationRule(isToolAvailable: (toolName: string) => boolean): string {
  if (isToolAvailable('task_verify')) {
    return `1. **TypeScript**: \`npx tsc --noEmit\` must pass (or call \`task_verify\` with check=typescript)
2. **Tests**: the relevant test suite must pass (or call \`task_verify\` with check=tests)
3. **Diff**: confirm no unintended files changed beyond the task scope
4. **Behaviour**: demonstrate correctness via test output, log line, or explicit assertion

Use the \`task_verify\` tool to automate steps 1-2.`;
  }

  return `1. **TypeScript**: \`npx tsc --noEmit\` must pass when TypeScript is in scope
2. **Tests**: the relevant test suite must pass
3. **Diff**: confirm no unintended files changed beyond the task scope
4. **Behaviour**: demonstrate correctness via test output, log line, or explicit assertion`;
}

function buildInternetProofLoop(isToolAvailable: (toolName: string) => boolean): string {
  const hasWebSearch = isToolAvailable('web_search');
  const hasWebFetch = isToolAvailable('web_fetch');
  const hasBrowser = isToolAvailable('browser');
  const hasRemember = isToolAvailable('remember');
  const hasLessonsAdd = isToolAvailable('lessons_add');

  if (!hasWebSearch && !hasWebFetch && !hasBrowser) {
    return `For web tasks that require current information, browsing, UI automation,
prospecting, screenshots, or automated tests:
1. Use only the web or browser tools present in the model-facing schema.
2. If no web or browser tool is present, do not claim live verification.
3. Ask for source material, work from existing files, or state the limitation clearly.`;
  }

  const steps: string[] = [
    `For web tasks that require current information, browsing, UI automation,
prospecting, screenshots, or automated tests:`,
  ];

  let index = 1;
  if (hasWebSearch) {
    steps.push(`${index++}. Start with \`web_search\` for discovery when the source is not already known.`);
  }
  if (hasWebFetch) {
    steps.push(`${index++}. Use \`web_fetch\` for cheap static reading before opening a browser.`);
  }
  if (hasBrowser) {
    steps.push(`${index++}. Use \`browser\` with action=\`observe\` before any page interaction.`);
    steps.push(`${index++}. Use \`browser\` with action=\`extract\` to capture URL, title, headings,
   links, actions and query-focused text evidence.`);
    steps.push(`${index++}. Use \`browser\` with action=\`assert_text\` after a claim, login state,
   navigation, or UI test expectation. Treat a failed assertion as a failing test.`);
    steps.push(`${index++}. On the final \`extract\` or passing \`assert_text\`, set
   \`persistWhenProven=true\` with a short \`proofGoal\` when durable evidence
   should be saved${
     hasRemember || hasLessonsAdd
       ? `, then use returned \`persistenceSuggestions\` for
   ${[hasRemember ? '`remember`' : null, hasLessonsAdd ? '`lessons_add`' : null].filter(Boolean).join(' and ')}`
       : ''
   }.`);
  }

  steps.push(`${index}. Persist only proven durable facts or reusable patterns; do not store raw
   browsing noise.`);

  return steps.join('\n');
}

function buildLessonsIntegration(isToolAvailable: (toolName: string) => boolean): string {
  const hasLessonsSearch = isToolAvailable('lessons_search');
  const hasLessonsAdd = isToolAvailable('lessons_add');

  if (!hasLessonsSearch && !hasLessonsAdd) {
    return `Review active lessons (injected as <lessons_context>) at the start of each turn when present.`;
  }

  const lines: string[] = [];
  if (hasLessonsSearch) {
    lines.push('Before starting a task similar to a previous one, call `lessons_search` to find relevant lessons.');
  }
  if (hasLessonsAdd) {
    lines.push('After any user correction: call `lessons_add` (category=PATTERN) immediately.');
  }
  lines.push('Review active lessons (injected as <lessons_context>) at the start of each turn.');
  return lines.join('\n');
}

export function getWorkflowRulesBlock(options: WorkflowRulesOptions = {}): string {
  const isToolAvailable = options.isToolAvailable ?? DEFAULT_TOOL_AVAILABLE;
  return `## Workflow Orchestration

### When to Plan (concrete triggers — skip vague "non-trivial")

PLAN BEFORE ACTING when ANY of the following is true:
- Creating a new file or module
- Touching 3 or more existing files
- Changing a public API, type signature, or database schema
- The request contains 3+ distinct action verbs (create, fix, update, test, deploy, refactor, implement, migrate, add, remove…)
- An architectural decision with no single obvious solution

SKIP PLANNING for: single-file bugfixes, typo/comment fixes, adding one function with a clear spec, renaming an identifier.

When in doubt: plan. A short plan costs seconds; a wrong assumption costs hours.

### Auto-Correction Protocol

If 2+ consecutive tool calls fail or return unexpected results:
1. STOP — do not retry the same approach a third time.
2. Re-read the relevant source code to understand the actual state.
3. Diagnose the root cause (not the symptom).
4. Re-plan the approach from scratch before acting again.

${buildAutoCorrectionRule(isToolAvailable)}

### Verification Contract (mandatory before marking a task done)

Before claiming completion, verify:
${buildVerificationRule(isToolAvailable)}

### Internet Automation Proof Loop

${buildInternetProofLoop(isToolAvailable)}

### Uncertainty Protocol

When requirements are ambiguous:
- Make a reasonable decision, document it inline as "Assumption: <X>"
- Proceed with implementation based on that assumption
- State all assumptions explicitly in your completion summary

Do NOT block on clarification questions for implementation details.
Do NOT ask "should I use X or Y?" — choose, document, implement.

### Elegance Gate

For changes >50 LOC or touching 3+ files: pause and ask yourself "Is there a simpler approach?"
For changes ≤10 LOC or obvious bugfixes: skip the gate — avoid over-engineering.

One correct, simple solution beats three clever ones.

### Subagent Delegation Triggers

Use a subagent when:
- Exploration requires reading 5+ unknown files whose content you cannot predict
- The task has parallel independent research components (e.g. two unrelated APIs)
- Exploration would consume >20% of the remaining context budget

Assign one focused task per subagent. Do not duplicate work across subagents.

### Lessons Integration

${buildLessonsIntegration(isToolAvailable)}`;
}
