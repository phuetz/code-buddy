# Channels

In a distributed system like Code-Buddy, messages do not simply appear; they must be routed, sanitized, and delivered according to specific business rules. Without a centralized channel management system, every integration would be forced to reinvent the wheel for message delivery, leading to inconsistent user experiences and significant maintenance overhead.

When a user triggers an action in an external integration, the system needs to decide *how* to communicate back to them. The Channels subsystem acts as the traffic controller, ensuring that messages are preprocessed for safety, paired with the correct direct message (DM) context, and dispatched according to strict delivery policies.

> **Developer Tip:** Treat the Channels subsystem as an immutable pipeline. Never modify the message payload after it has passed the `message-preprocessing` stage, as this can lead to downstream side effects in the delivery logic.

## [Architecture](./architecture.md)

To visualize the lifecycle of a message, we must understand the sequential dependency of the components. The system is designed as a linear pipeline where each module acts as a gatekeeper, ensuring that only valid, authorized, and correctly formatted messages reach the final output channel.

```mermaid
graph LR
    A[Incoming Message] --> B[Message Preprocessing]
    B --> C[Send Policy]
    C --> D[DM Pairing]
    D --> E[Output Channel]
```

> **Developer Tip:** If you need to add a new integration type (e.g., Slack vs. Discord), do not modify the core pipeline; instead, extend the `SendPolicy` interface to handle platform-specific constraints.

## Module Breakdown

The following table outlines the core modules responsible for maintaining the integrity of our communication layer.

| Module | Responsibility |
| :--- | :--- |
| `src/channels/message-preprocessing.ts` | Sanitizes raw payloads and enforces schema validation before any routing occurs. |
| `src/channels/send-policy.ts` | Evaluates rate limits, user preferences, and delivery windows to determine if a message should be sent. |
| `src/channels/dm-pairing.ts` | Resolves the mapping between internal user IDs and external DM channel identifiers. |

> **Developer Tip:** Use `src/channels/message-preprocessing.ts` for logging raw input errors; it is the only place where the original, unformatted payload is guaranteed to exist in its entirety.

## [Data Flow](./subsystems.md#data-flow)

When an event triggers a notification, the system initiates a specific sequence of operations to ensure delivery. First, the raw data enters `message-preprocessing`, where it is stripped of malicious characters and normalized into a standard internal format. Once normalized, the message is passed to `send-policy`, which checks if the user has blocked notifications or if the system is currently rate-limited. Finally, if the policy allows, `dm-pairing` retrieves the necessary destination metadata to route the message to the correct endpoint.

> **Developer Tip:** If you encounter "Message Dropped" errors, always check the `send-policy` logs first; 90% of delivery failures are due to policy violations rather than connection issues.

## Entry Points

For developers looking to integrate new features, the primary entry point is the `ChannelDispatcher` interface (exported via the index file in the `channels` directory). This interface abstracts the complexity of the pipeline, allowing you to simply call `dispatch(message)` without worrying about the underlying preprocessing or pairing logic.

> **Developer Tip:** Avoid importing individual modules from `src/channels/` directly in your feature code. Always use the barrel export to ensure you are utilizing the latest version of the pipeline logic.

---

**See also:** [Agent Orchestration](./agent-orchestration.md) · [Memory & Context](./memory-context.md)
