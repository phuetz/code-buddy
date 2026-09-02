# Cowork end-to-end tests

`chat-flow.spec.ts` is the non-paid chat acceptance gate. It starts an
OpenAI-compatible HTTP server on `127.0.0.1` using an ephemeral port above
3100, configures Cowork to use it, sends a message through the real Electron
and embedded-engine path, and checks the rendered assistant bubble and the
requests received by the server. It does not inject model messages into the
renderer.

The shared fixture no longer creates an empty `buffalo_s.onnx`. Presence is
opt-in and an invalid model file is not a valid first-run fixture. Set
`COWORK_E2E_TMP_ROOT` when the test data must stay under a particular workspace;
otherwise Playwright uses the operating system temporary directory.

`chat-real-gpt55.spec.ts` and the other `COWORK_REAL_GPT55=1` scenarios are
optional paid-provider diagnostics. They remain skipped by default and are not
evidence for the local chat acceptance gate.
