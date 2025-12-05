# Terminal UI/UX for AI Tools (2023-2025)

Research findings on streaming responses, handling long outputs, and progressive disclosure in terminal AI tools.

---

## 1. Terminal-Based AI Coding Assistants (2024-2025)

### OpenCode
**Source:** https://opencode.ai/
- **Framework:** Go-based CLI with Bubble Tea TUI
- **Features:**
  - Interactive TUI for smooth terminal experience
  - Multiple AI provider support (OpenAI, Claude, Gemini, AWS Bedrock, Groq)
  - Project context scanning without cloud upload
  - Local model support for privacy

### Claude Code (Anthropic)
**Source:** https://www.anthropic.com/news/claude-3-7-sonnet
- **Workflow:** Plan first, then act
- **Best Practice:** Review detailed plan before execution
- **Features:**
  - File searching and reading
  - Edit files, write and run tests
  - Commit and push to GitHub
  - Command line tool integration
- **Planned:** Long-running command support, improved in-app rendering

### Aider
**Source:** https://aider.chat/
- **Purpose:** AI pair programming in terminal
- **Best Models:** Claude 3.7 Sonnet, DeepSeek R1 & Chat V3, GPT-4o
- **Flexibility:** Connects to almost any LLM, including local models

### Warp Terminal
- **Technology:** Rust-based terminal
- **Innovation:** Block-based UI for commands and outputs
- **Features:**
  - AI-powered agent integration
  - Collaborative workflows (Warp Drive)
  - Structured command/output handling

### Gemini CLI (Google)
- **License:** Open-source (Apache-2.0)
- **Features:**
  - Google Search integration for real-time information
  - Model Context Protocol (MCP) support
  - Extensibility via system prompts
- **Advantage:** Grounding with up-to-date documentation

---

## 2. Ink (React) Terminal UI Best Practices

### Core Framework
**Source:** https://github.com/vadimdemedes/ink
- **Architecture:** React component-based UI for CLI apps
- **Layout:** Uses Yoga for Flexbox layouts
- **Features:** Most CSS-like properties available

### Streaming Text Implementation
**Best Practices:**
1. Use streaming for interactive user experience
2. Render content as it comes in
3. Update UI incrementally with streaming messages

### The `<Static>` Component for Large Outputs
**Purpose:** Permanently render output above everything else
**Use Cases:**
- Completed tasks or logs
- Content that won't change after rendering
**Examples:**
- Tap: Displays completed tests
- Gatsby: Shows generated pages with live progress bar

### Performance Optimization
```javascript
// Memoize expensive operations
const result = useMemo(() => expensiveCalculation(data), [data]);
```

### Text Transformation
```jsx
// Transform component for text effects
<Transform transform={gradient}>
  <Text>Your text here</Text>
</Transform>
```
**Note:** Only apply to `<Text>` children; don't change dimensions

### Console Management
- Ink 3 intercepts console methods
- Logs display correctly above app UI
- No interference between logs and UI

### Render Configuration
```javascript
// Preserve prior commands
render(<App />, {
  patchConsole: false,
  exitOnCtrlC: false
});
```

### Key Hooks
| Hook | Purpose |
|------|---------|
| `useInput` | Handle user input character by character |
| `useApp` | Access app methods (e.g., manual exit) |
| `useStdin` | Direct stdin stream access |
| `useStdout` | Direct stdout stream access |
| `useStderr` | Direct stderr stream access |

---

## 3. Bubble Tea (Go) TUI Framework

### Overview
**Source:** https://github.com/charmbracelet/bubbletea
- **Architecture:** Based on The Elm Architecture
- **Use:** Production-ready with performance optimizations
- **Support:** Inline, full-window, or mixed UIs

### Rendering Features
- Framerate-based renderer (standard)
- High-performance scrollable regions
- Mouse support
- Focus reporting

### Event Loop Pattern
```go
for {
    select {
    case msg := <-p.msgs:
        model, cmd = model.Update(msg)
        cmds <- cmd
        p.renderer.write(model.View())
    }
}
```

### Streaming and Concurrency
- Commands run in goroutines
- Thread-safe communication to main loop
- Leverages Go's concurrency model

### Performance Notes
- Bubble Tea: Fast enough for most TUIs
- Ratatui (Rust): 30-40% less memory, 15% lower CPU
- Bubble Tea advantage: Faster development, easier prototyping

---

## 4. Handling Long Outputs

### Pagination Strategies

#### Automatic Paging with `less -F`
```bash
# Function to paginate only if needed
my_command() {
    command "$@" 2>&1 | less -F
}
```
- `-F`: Exits immediately if content fits on screen
- `-R`: Preserves colors
- `-S`: Truncates long lines (use arrows to scroll)

#### Environment Variables
| Variable | Purpose |
|----------|---------|
| `$PAGER` | Default pager program |
| `$SYSTEMD_PAGER` | Override for systemd tools |
| `$SYSTEMD_LESS` | Options for less (default: "FRSXMK") |

#### AWS CLI Approach
- Server-side pagination (limit per request)
- Client-side paging via OS default pager
- Configurable per command

### Progressive Disclosure in CLI

#### Principles
- Reduce cognitive load
- Reveal information as needed
- Group content into manageable sections

#### Implementation Patterns
1. **Dropdowns/Accordions:**
   - Clear headers describing content
   - Easy scanning of options
   - Expand on demand

2. **Hover/Click Actions:**
   - Dialog boxes for details
   - Popups for additional content
   - Keep initial view clean

3. **Summary + Details:**
   - Show summary first
   - Offer `--verbose` or `-v` flag
   - Expandable sections in TUI

---

## 5. Streaming Response Best Practices

### Real-time Rendering
1. Stream without tool calls for immediate feedback
2. Update UI incrementally as content arrives
3. Show generation progress indicator

### Handling Interruption
- Support Ctrl+C to stop generation
- Preserve partial output
- Allow continuation or retry

### Visual Feedback
- Typing indicator during generation
- Token/character count (optional)
- Elapsed time display

### Error Handling in Streams
- Graceful degradation
- Clear error messages
- Retry mechanisms

---

## 6. UX Recommendations for AI CLI Tools

### Planning and Transparency
1. **Show the Plan:** Display detailed plan before execution
2. **Allow Adjustment:** Let users modify plan before proceeding
3. **Progress Tracking:** Show current step in multi-step tasks

### Context Visibility
1. **Show Context:** Display what files/code are being used
2. **Manage Attachments:** UI for viewing/removing context
3. **Token Usage:** Indicate context window usage

### Output Management
1. **Streaming:** Show output as it generates
2. **Static Sections:** Use `<Static>` for completed items
3. **Pagination:** Auto-page long outputs
4. **Truncation:** Configurable line limits

### Interaction Patterns
1. **Block-Based:** Treat commands/outputs as structured units
2. **Keyboard Navigation:** Vim-style or arrow key navigation
3. **Search:** Allow searching through output history
4. **Copy/Paste:** Easy extraction of code/content

### Performance Considerations
1. **Memoization:** Cache expensive UI computations
2. **Diffing:** Only re-render changed portions
3. **Goroutines/Workers:** Handle concurrent operations
4. **Framerate Limiting:** Prevent excessive re-renders

---

## Applications to CLI Tools

### Recommendations for Grok CLI

1. **Implement Plan Review Mode:**
   - Show detailed plan before execution
   - Allow user to modify/approve
   - Track progress through steps

2. **Use Ink's `<Static>` for History:**
   - Completed tool calls go to Static
   - Current generation stays in dynamic area
   - Prevents re-rendering of old content

3. **Smart Pagination:**
   - Auto-detect when output exceeds terminal height
   - Offer `less -F` style paging
   - Support `--no-pager` flag

4. **Progressive Disclosure:**
   - Summary view by default
   - Expandable details on demand
   - `--verbose` flag for full output

5. **Streaming Best Practices:**
   - Real-time character rendering
   - Typing indicator
   - Interruptible with partial output preservation

6. **Context Management UI:**
   - Visual display of included context
   - Token usage indicator
   - Easy add/remove of context items

7. **Block-Based Output:**
   - Group related output as blocks
   - Allow collapsing/expanding
   - Easy navigation between blocks
