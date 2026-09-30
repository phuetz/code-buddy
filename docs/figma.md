# Import a Figma REST JSON export

`buddy figma import` converts a Figma REST file export into React screens and CSS.
A local JSON file needs no account or network connection. This expects the REST
file response, not a binary `.fig` file.

```bash
buddy figma import --help
buddy figma import --json design.json --dry-run
buddy figma import --json design.json --out ./generated-design
```

Without `--out`, the command only parses and reports. With `--out`, it writes the
generated files; `--dry-run` keeps writes disabled. Supply your own REST export
as `design.json`. In a source checkout, the fixture
`tests/figma/fixtures/simple-screen.json` provides a small offline example.

Live fetches use `--file-key <id>` and a caller-supplied `FIGMA_TOKEN` or
`CODEBUDDY_FIGMA_TOKEN`. Tokens are not persisted. Live account access is a
separate prerequisite; a successful offline import does not verify it.

Unsupported nodes, including arbitrary vector paths, are listed as skipped.
Review `IMPORT-REPORT.md` and the generated components before using the result.
This import does not promise a pixel-perfect conversion or install dependencies.
