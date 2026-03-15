# Plugin System

To manage the complexity of over 14,000 functions across 1,083 modules, Code Buddy relies on a decoupled plugin [architecture](./architecture.md). We chose this approach because hard-coding integrations into the core agent logic would create a maintenance nightmare, making it impossible to scale the system without introducing regression bugs. By isolating functionality into hooks and integrations, we ensure that the core engine remains lightweight while allowing developers to extend capabilities independently.

> **Developer Tip:** Keep your plugin logic pure; avoid side effects outside of the provided hook context to ensure your module remains testable in isolation.

### How It Works

Imagine a user triggers a command to fetch repository statistics. When this action occurs, the system does not call the integration directly because that would tightly couple the command to the external service. Instead, the system broadcasts an event to the `HookManager` (located in `src/hooks/index.ts`). The manager identifies the registered plugin for that specific event, executes the integration logic (found in `src/integrations/index.ts`), and returns the result to the UI layer. This indirection allows us to swap or update integrations without touching the core agent code.

> **Developer Tip:** Always use `async/await` patterns within your hooks to prevent blocking the main event loop during long-running integration tasks.

### Architecture Diagram

The following diagram illustrates the relationship between the core layers and the plugin system.

```mermaid
graph TD
    User --> Command
    Command --> HookManager
    HookManager --> Plugin
    Plugin --> Integration
    Integration --> Agent
    Agent --> [Security](./security.md)
    Agent --> Context
    Agent --> UI
    Agent --> Tools
```

> **Developer Tip:** Keep your dependency graph flat; if your plugin requires more than three layers of imports, consider refactoring it into a standalone utility.

### Core Execution Flow

The execution lifecycle follows a strict sequence to ensure system stability and security. We enforce this order because the system must validate the user's intent before allowing any external code to execute.

1.  **Registration:** Upon startup, the system scans `src/integrations/index.ts` and registers available plugins into the `HookManager`.
2.  **Invocation:** A user triggers a command, which the `Command` layer intercepts.
3.  **Validation:** The `Security` layer checks if the user has permission to execute the requested hook.
4.  **Execution:** The `HookManager` invokes the registered plugin, passing the `Context` object.
5.  **Response:** The plugin returns data, which is processed by the `Agent` and rendered by the `UI` layer.

> **Developer Tip:** Implement comprehensive error boundaries within your `execute()` method to prevent a single failing plugin from crashing the entire agent process.

### [Design Decisions and Trade-offs](./[subsystems](./subsystems.md).md#design-decisions-and-trade-offs)

Architectural choices are rarely free of trade-offs, and our reliance on the Singleton pattern is a deliberate design decision. We use Singletons for critical services like `Agent`, `Auth-Monitoring`, and `Send-Policy` because these services maintain global state that must be consistent across the entire application lifecycle. While Singletons can make unit testing difficult, the trade-off is a significant reduction in memory overhead and a guarantee that we do not have conflicting auth or policy states running simultaneously.

> **Developer Tip:** If you must use a Singleton, provide a `reset()` method for your test suite to clear the state between unit tests.

### [Data Flow](./subsystems.md#data-flow)

Data integrity is maintained through a strict "Security-First" pipeline. We process data this way because raw input from integrations is inherently untrusted and could potentially compromise the agent's context.

When an integration returns data, it is passed through the `Security` layer, which sanitizes the payload against the current `Context`. Only after validation is the data passed to the `Agent` layer (the largest layer with 127 modules). This ensures that even if an integration is compromised, the core agent remains protected from malicious payloads or malformed data structures.

> **Developer Tip:** Use TypeScript interfaces to strictly define the shape of the data returned by your integrations; this acts as a first line of defense against unexpected API changes.

---

**See also:** [Agent Orchestration](./agent-orchestration.md) · [Tools & Integrations](./tools-integrations.md)
