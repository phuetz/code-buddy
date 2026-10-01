# Computer Use Application Profiles

Code Buddy now separates general desktop control from application-specific profiles.
The goal is to choose the most reliable control path for each app while keeping
high-risk actions behind explicit confirmation.

## Profiles

Profiles live in `src/tools/application-profiles.ts`.

| Profile | Risk | Default policy | Primary path |
| --- | --- | --- | --- |
| `excel` | high | confirm | Windows COM for workbook/cell actions, UI fallback for visible controls |
| `powerpoint` | high | confirm | Windows COM for presentation actions, UI fallback for visible controls |
| `word` | high | confirm | Windows COM for document actions, UI fallback for visible controls |
| `notepad` | medium | allow | Desktop UI typing, UIAutomation text read, targeted document save |
| `calculator` | low | allow | Desktop UI buttons and keyboard input |
| `file_explorer` | high | confirm | Desktop UI navigation |
| `browser` | medium | allow | Prefer Browser Use for DOM-level work, desktop fallback when needed |
| `vscode` | high | confirm | Desktop UI workflows; file tools remain preferred for repo edits |
| `terminal` | critical | confirm | Shell tools remain preferred; live terminal control needs confirmation |

## Safety Model

Read-only actions can run autonomously. Mutating desktop actions create harness
metadata and proof artifacts. High-risk profile actions require either
`simulateOnly: true` or `confirmDangerous: true`.

Proof artifacts keep the structured evidence returned by each action, such as
`targetFocus`, `visualContext`, dialog text, button risk classification,
selected button, and failed workflow step. The artifact builder bounds nested
data, truncates long strings, and redacts secret-like keys before writing JSON.

Targeted keyboard and text actions fail closed. If a step names a window or
inherits one from an application profile, Code Buddy focuses the target and then
verifies the real foreground window before typing. If the target cannot be
confirmed as the foreground window, the action fails instead of sending keystrokes to the current app.
Set `visualContext: true` to attach a focused-window snapshot plus screenshot OCR
evidence to the action result.

Dialogs are handled as their own control surface:

- `inspect_dialog` reads the active or targeted dialog, extracts visible text,
  lists buttons, classifies each choice as `safe`, `caution`, or `destructive`,
  and suggests a safe choice when possible.
- `click_dialog_button` clicks a named button only after the dialog has been
  identified.
- `handle_dialog` chooses by intent, such as `cancel`, `save`, `dont_save`,
  `discard`, `retry`, `continue`, or `close`.

Safe exits like Cancel, No, Close, Dismiss, and their French equivalents can be
clicked directly. Affirmative or destructive choices like OK, Yes, Save,
Delete, Discard, Overwrite, Run, Install, and Allow require
`confirmDangerous: true`. This keeps pop-up handling useful without letting an
unexpected system prompt approve risky actions by accident.

Generic desktop controls now cover more than buttons and fields:

- `set_slider_value` uses Windows UIAutomation `RangeValuePattern` when
  available, with a bounded snapshot-coordinate fallback.
- `select_tree_item`, `expand_tree_item`, and `collapse_tree_item` use
  `TreeItem` semantics and prefer Windows `ExpandCollapsePattern` over blind
  clicks.

Notepad no longer relies on `Ctrl+S` for the proof test. `save_app_document`
reads the targeted Notepad editor through UIAutomation and writes the explicit
`filePath` only when `confirmDangerous: true` is present. This avoids sending a
global save hotkey into whichever app the user happens to be using.

Excel write/save operations are treated as high risk:

- `excel_set_cell`
- `excel_open_workbook`
- `excel_save_workbook`

PowerPoint write/save operations are treated as high risk:

- `powerpoint_set_text`
- `powerpoint_add_slide`
- `powerpoint_open_presentation`
- `powerpoint_save_presentation`

Word write/save operations are treated as high risk:

- `word_type_text`
- `word_open_document`
- `word_save_document`

Terminal, VS Code, and File Explorer launch actions are guarded by the profile
policy. This prevents prompt-injected page content from silently escalating into
system-level actions.

## Visual grounding — OmniParser (optional, self-hosted)

`computer_control` action `snapshot_with_screenshot` accepts `useOmniParser: true`
to route the screenshot through [Microsoft OmniParser
v2](https://github.com/microsoft/OmniParser) and get numbered, clickable UI
elements back. OmniParser is a GPU/Python model you **self-host** — Code Buddy
only ships the HTTP client (`src/desktop-automation/omniparser-runner.ts`), not
the model or server.

1. Run the OmniParser `omnitool/omniparserserver` (FastAPI, default port 8000).
2. Point Code Buddy at it: `OMNIPARSER_API_URL=http://<host>:8000` (base URL;
   the client calls `POST /parse/` and `GET /probe/`). Optional bearer:
   `OMNIPARSER_API_KEY`.
3. Call `computer_control` with `action: snapshot_with_screenshot`,
   `useOmniParser: true`.

The client speaks the OmniParser v2 contract (`{base64_image}` →
`{som_image_base64, parsed_content_list}`) and scales the normalized boxes to
pixels using the snapshot dimensions, so each element exposes a clickable
`center=(x,y)`. If the server is unreachable the call is a **no-op** — you get
the plain snapshot back, never a hard failure. Runtime behaviour requires a live
OmniParser server and is not covered by the repo test suite.

## Real Evidence

Real Windows tests are currently available under `scratch/`:

- `computer-use-real-test.ts` drives a Windows Forms fixture through text input,
  dropdown selection, checkbox, radio, tab, list item, slider value, tree item
  expand/select, button click, and final visible-text assertion.
- `computer-use-notepad-real-test.ts` drives the standard Desktop Notepad via the
  profile workflow, saves the targeted text document without global keyboard
  shortcuts, and verifies the file content.
- `computer-use-excel-real-test.ts` writes and reads cells in a temporary Excel
  workbook through COM, then saves the workbook.
- `computer-use-powerpoint-real-test.ts` adds a slide and sets shape text in a temporary PowerPoint presentation through COM, then saves it.
- `computer-use-word-real-test.ts` opens a temporary Word document, types text through COM, then saves it.
- `computer-use-dialog-real-test.ts` opens a real Windows Forms dialog,
  inspects the prompt, classifies Save/Delete/Cancel choices, and clicks the
  safe Cancel path.
- `computer-use-real-suite.ts` runs the four real Windows proofs in sequence
  and writes a single summary.

Latest evidence files:

- `scratch/computer-use-real-test-result.json`
- `scratch/computer-use-notepad-real-test-result.json`
- `scratch/computer-use-excel-real-test-result.json`
- `scratch/computer-use-powerpoint-real-test-result.json`
- `scratch/computer-use-word-real-test-result.json`
- `scratch/computer-use-dialog-real-test-result.json`
- `scratch/computer-use-real-suite-result.json`

The real suite is also available from Cowork's `Tests & executions` catalog as
`Computer Use / real desktop suite`. It is marked manual and requires
`CODEBUDDY_REAL_COMPUTER_USE`, because it really opens and controls desktop
applications.
