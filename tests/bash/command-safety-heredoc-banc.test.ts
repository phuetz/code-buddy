import { beforeAll, expect, it } from 'vitest';
import { parseBashCommand } from '../../src/security/bash-parser.js';
import { validateShellCommandSafety } from '../../src/tools/bash/command-safety.js';

beforeAll(async () => {
  parseBashCommand(':');
  await new Promise(resolve => setTimeout(resolve, 100));
});

it('keeps a pipeline attached to the heredoc header out of the literal-file exception', context => {
  if (!parseBashCommand(':').usedTreeSitter) context.skip();
  const parsed = parseBashCommand("cat > README.md <<'EOF' | bash\nrm -rf /\nEOF\n");
  expect(parsed.credentialPolicyInput).toBeUndefined();
});

it.each([
  "cat > README.md <<'EOF'\n```bash\nprintf example\n```\nEOF\n",
  "cd /tmp && mkdir -p docs && cat > docs/README.md <<'EOF'\n```sh\nprintf example\n```\nEOF\n",
  "cat > example.md <<'EOF'\nAn example: $API_KEY and `rm -rf /` are literal text.\nEOF\n",
])('allows proven literal file data through the additional safety check: %s', (command, context) => {
  if (!parseBashCommand(':').usedTreeSitter) context.skip();
  expect(validateShellCommandSafety(command)).toMatchObject({ valid: true, value: command });
});

it.each([
  "cat > README.md <<EOF\n$(rm -rf /)\nEOF\n",
  "cat > README.md <<'EOF'\n`rm -rf /`\n",
  "bash <<'EOF'\nrm -rf /\nEOF\n",
  "cat <<'EOF' | bash\nrm -rf /\nEOF\n",
  "cat > README.md <<'EOF' | bash\nrm -rf /\nEOF\n",
  "cat > README.md <<'EOF' && rm -rf /\nliteral\nEOF\n",
  "cat > README.md <<'EOF'\nliteral\nEOF\nrm -rf /",
  "cat() { bash; }\ncat > README.md <<'EOF'\nrm -rf /\nEOF\n",
  "alias cat=bash\ncat > README.md <<'EOF'\nrm -rf /\nEOF\n",
  "PATH=/tmp/custom\ncat > README.md <<'EOF'\nrm -rf /\nEOF\n",
  ". ./custom-shell.sh\ncat > README.md <<'EOF'\nrm -rf /\nEOF\n",
])('retains rejection for executable or uncertain content: %s', command => {
  expect(validateShellCommandSafety(command).valid).toBe(false);
});
