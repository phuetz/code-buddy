# Code Quality Metrics

This section provides a quantitative analysis of the codebase, focusing on dead code identification, module coupling, and high-impact refactoring targets. These metrics are intended for lead developers and architects to prioritize technical debt reduction and improve system maintainability.

```mermaid
graph TD
    A[Codebase Analysis] --> B[Dead Code Detection]
    A --> C[Coupling Analysis]
    A --> D[Refactoring Candidates]
    B --> E[Static Analysis Report]
    C --> F[Dependency Graph]
    D --> G[PageRank Prioritization]
```

## Dead Code Analysis

The dead code analysis identifies unreachable or unused code paths within the repository. By filtering out exported API methods and dynamic dispatch targets, we ensure that the following list represents genuine candidates for removal, thereby reducing the binary size and cognitive load for maintainers.

| Confidence | Count |
|---|---|
| High | 3097 |
| Medium | 0 |
| Low | 1910 |
| **Total** | **5241** |

### Top Dead Code Candidates

*Note: Exported API methods and dynamic dispatch targets are excluded.*

- `A2UIManager.cb` (high confidence)
- `A2UIManager.handleUserAction` (high confidence)
- `A2UIManager.renderToHTML` (high confidence)
- `A2UIManager.renderToTerminal` (high confidence)
- `A2UIManager.sendCanvasEvent` (high confidence)
- `A2UIManager.shutdown` (high confidence)
- `A2UITool.getManager` (high confidence)
- `ACPRouter.clearLog` (high confidence)
- `ACPRouter.findByCapability` (high confidence)
- `ACPRouter.getAgent` (high confidence)
- `ACPRouter.getAgents` (high confidence)
- `ACPRouter.getLog` (high confidence)
- `ACPRouter.register` (high confidence)
- `ACPRouter.reject` (high confidence)
- `ACPRouter.request` (high confidence)

Following the removal of dead code, developers should examine the structural integrity of the remaining modules to ensure that inter-module dependencies remain within acceptable limits.

## Module Coupling

Module coupling metrics highlight the degree of interdependence between different parts of the system. High coupling often indicates a violation of the Single Responsibility Principle and can lead to fragile code where changes in one module trigger unexpected regressions in others.

| Module A | Module B | Calls | Imports | Total |
|---|---|---|---|---|
| src/browser-automation/browser-tool | src/tools/browser-tool | 29 | 0 | 29 |
| src/tools/browser-tool | src/tools/browser/playwright-tool | 20 | 0 | 20 |
| src/middleware/middlewares | src/middleware/types | 19 | 0 | 19 |
| src/agent/repo-profiling/infrastructure/index | src/agent/repo-profiling/infrastructure/project-meta | 15 | 0 | 15 |
| src/errors/index | src/tools/git-tool | 13 | 0 | 13 |
| src/docs/docs-generator | src/tools/doc-generator | 12 | 0 | 12 |
| src/cache/cache-manager | src/utils/cache | 10 | 0 | 10 |
| src/tools/docker-tool | src/utils/confirmation-service | 10 | 0 | 10 |
| src/tools/kubernetes-tool | src/utils/confirmation-service | 10 | 0 | 10 |
| src/commands/handlers/debug-handlers | src/utils/debug-logger | 9 | 0 | 9 |
| src/themes/theme-manager | src/ui/context/theme-context | 9 | 0 | 9 |
| src/agent/parallel/parallel-executor | src/optimization/parallel-executor | 8 | 0 | 8 |
| src/commands/handlers/branch-handlers | src/persistence/conversation-branches | 8 | 0 | 8 |
| src/commands/handlers/core-handlers | src/utils/autonomy-manager | 8 | 0 | 8 |
| src/context/pruning/index | src/context/pruning/ttl-manager | 8 | 0 | 8 |

Most dependent module: `src/utils/validators`
Most depended-upon: `src/utils/validators`

> **Key concept:** The `src/utils/validators` module acts as a central dependency hub. Because it is the most depended-upon component, any breaking change here will have a system-wide impact, necessitating strict adherence to backward compatibility.

## Refactoring Suggestions

To mitigate the risks associated with high coupling, we utilize PageRank analysis to identify "hotspots"—methods that are frequently invoked across the codebase. Refactoring these into interfaces or dedicated services can significantly improve testability and modularity.

- **getErrorMessage**: Called by 155 functions — high coupling, consider interface extraction (PageRank: 1.000, 155 callers)
- **isExpired**: Called by 10 functions — high coupling, consider interface extraction (PageRank: 0.630, 10 callers)
- **send**: Called by 41 functions — high coupling, consider interface extraction (PageRank: 0.547, 41 callers)
- **SubagentManager.spawn**: Called by 96 functions — high coupling, consider interface extraction (PageRank: 0.444, 96 callers)
- **generateId**: Called by 17 functions — high coupling, consider interface extraction (PageRank: 0.429, 17 callers)
- **createId**: Called by 27 functions — high coupling, consider interface extraction (PageRank: 0.427, 27 callers)
- **DesktopAutomationManager.ensureProvider**: Called by 30 functions — high coupling, consider interface extraction (PageRank: 0.363, 30 callers)
- **tokenize**: Called by 20 functions — high coupling, consider interface extraction (PageRank: 0.345, 20 callers)
- **BrowserManager.getCurrentPage**: Called by 35 functions — high coupling, consider interface extraction (PageRank: 0.336, 35 callers)
- **formatSize**: Called by 20 functions — high coupling, consider interface extraction (PageRank: 0.301, 20 callers)

When refactoring, developers should prioritize methods with high PageRank scores, such as `SubagentManager.spawn()`, to maximize the architectural benefit of their efforts.

---

**See also:** [Overview](./1-overview.md) · [Architecture](./2-architecture.md) · [Subsystems](./3-subsystems.md) · [Tool System](./5-tools.md)

**Key source files:** `src/utils/validators.ts`