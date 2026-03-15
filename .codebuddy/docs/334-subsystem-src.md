# Subsystems (continued)

This section documents the voice processing and input handling subsystems located within the `src` directory. These modules are essential for enabling hands-free interaction and real-time audio stream management, serving as the primary interface for voice-driven commands.

```mermaid
graph LR
    A[Voice Input] --> B[Wake Word]
    B --> C[Voice Activity]
    C --> D[System Processing]
```

> **Key concept:** The voice subsystem architecture prioritizes low-latency processing by decoupling wake-word detection from general voice activity analysis, ensuring that system resources are only fully engaged when a valid trigger is identified.

The following modules manage the lifecycle of audio capture and processing, ensuring that input is correctly routed to the appropriate handlers.

## src (3 modules)

- **src/voice/voice-activity** (rank: 0.003, 13 functions)
- **src/voice/wake-word** (rank: 0.003, 18 functions)
- **src/input/voice-input** (rank: 0.002, 17 functions)

These components interface directly with the hardware abstraction layer to ensure consistent audio capture across different operating environments. Developers working on these modules should ensure that audio buffers are properly managed to prevent memory leaks during extended sessions.

---

**See also:** [Subsystems](./3-subsystems.md)

--- END ---