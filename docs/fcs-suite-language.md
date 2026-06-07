# FCS Suite Language

FCS is the shared automation language for the suite. NexusFile and Code Buddy
must keep a common portable subset so scripts can move between desktop tools and
agent workflows without being rewritten.

## Portable Subset

Code Buddy accepts the historical brace form:

```fcs
func add(a, b) {
  return a + b
}
```

It also accepts the NexusFile Python-style form:

```fcs
def add(a, b):
  return a + b

test "math works":
  assert add(20, 22) == 42
```

The portable subset includes:

- Functions with local variables: `def name(arg):` or `func name(arg) { ... }`
- Test blocks: `test "name":` or `test "name" { ... }`
- Assignments and local function/test scope
- Bounded loops: `for i in range(n):`, `for i in items { ... }`, and `repeat n:`
- Assertions: `assert condition` and `assert condition, "message"`
- `defined("name")` for scope checks
- Builtins for files, strings, arrays, JSON, shell, AI, context, git, MCP, and sessions

## Test Semantics

`test` blocks run by default. Variables created inside a test block are local to
that test. A failed test is recorded in `testResults` and makes the script result
fail, which lets FCS drive automated checks.

Loop expansion and execution are bounded by `maxLoopIterations` (default
`10000`) so generated tests cannot accidentally hang Code Buddy or a suite host.

## Code Buddy Role

Code Buddy is the main authoring and debugging host for suite scripts:

- `/fcs validate <file.fcs>` checks syntax.
- `/fcs parse <code-or-file>` shows tokens and AST.
- `/fcs run <file.fcs>` executes a script with Code Buddy bindings.
- `executeFCS(source, config)` runs scripts from tests and tools.

Keep app-specific bindings outside the core language. Shared syntax and runtime
semantics live in `src/scripting`; host objects are injected through config
variables or app-specific bindings.
