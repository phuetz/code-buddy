# Overview

When a developer context-switches between a chat interface and their IDE, they lose the "flow state" required for deep work. Code Buddy solves this friction by acting as an autonomous, plugin-based agent that lives directly within your development lifecycle. Because the system is designed to handle complex automation, it abstracts away the repetitive boilerplate of managing agent-to-tool communication, allowing you to focus on building the logic that actually writes code.

> **Developer Tip:** When defining new agent behaviors, keep your prompt context minimal to reduce token usage and improve response latency.

### Who is it for?
Engineers who need to build custom AI-driven workflows often find themselves fighting against rigid, monolithic frameworks. This project is built for platform engineers and automation enthusiasts who require a modular, extensible foundation. By providing a decoupled [architecture](./architecture.md), it empowers teams to create specialized agents that integrate seamlessly into existing CI/CD pipelines or chat platforms without rewriting the core orchestration logic.

> **Developer Tip:** Leverage TypeScript interfaces for your plugins to ensure type safety across the agent-tool boundary.

### 5 Key Capabilities
To ensure the system remains maintainable despite its scale (1083 modules and 14,351 functions), the framework prioritizes modularity and strict separation of concerns:

1.  **Plugin-Based Orchestration:** Because the system uses a decoupled plugin architecture, you can swap out tools or integrations without modifying the core agent logic.
2.  **Multi-Channel Communication:** The framework abstracts the transport layer, allowing your agent to operate across CLI, Slack, or custom webhooks via a unified channel interface.
3.  **Context-Aware Reasoning:** By utilizing a dedicated `context` layer, the agent maintains state across long-running sessions, ensuring it remembers previous decisions.
4.  **[Security](./security.md)-First Execution:** Since agents often interact with sensitive codebases, the security layer enforces strict policies on tool execution and data access.
5.  **Extensible Knowledge Base:** The system allows for dynamic injection of documentation and project-specific knowledge, enabling the agent to learn your codebase's unique patterns.

> **Developer Tip:** Modularize your tools into separate packages to keep your dependency graph clean and your build times fast.

### High-Level Architecture
When a user sends a command, the system routes the request through the Agent, which acts as the central orchestrator. It queries the Knowledge layer for context, validates the request via Security, and executes the necessary Tools to fulfill the user's intent.

```mermaid
graph TD
    Client --> Agent
    Agent --> Tools
    Agent --> [Channels](./channels.md)
    Agent --> Knowledge
    Agent --> Security
    Agent --> Integrations
```

> **Developer Tip:** Use the Singleton pattern for your core services (like `auth-monitoring` or `send-policy`) to ensure consistent state management across the application lifecycle.

### Tech Stack
Because performance and type safety are critical for large-scale agent frameworks, the project is built on a robust TypeScript and Express foundation. This stack provides the necessary structure to handle complex asynchronous operations while maintaining the strict typing required to manage over 14,000 functions without runtime errors.

> **Developer Tip:** Use `ts-node` or `tsx` during local development to iterate quickly without waiting for full compilation cycles.

### [Getting Started](./getting-started.md)
To begin building your own agent, you need to initialize the environment and register your first plugin.

1.  **Install the core:** Run `npm install @phuetz/code-buddy` to pull in the base framework and its core dependencies.
2.  **Configure the Agent:** Create a `config.ts` file to define your active plugins and security policies.
3.  **Launch the Server:** Execute `npm run start` to spin up the Express server and begin listening for incoming commands.

> **Developer Tip:** Always check the logs in `src/server/index.ts` immediately after launch to verify that all singleton services have initialized correctly.