import { beforeAll, expect, it } from 'vitest';
import { parseBashCommand } from '../../src/security/bash-parser.js';
import { validateCommand } from '../../src/tools/bash/command-validator.js';

beforeAll(async () => {
  parseBashCommand(':');
  await new Promise(resolve => setTimeout(resolve, 100));
});

it('ne lit pas le commentaire TypeScript de C comme une substitution shell', context => {
  if (!parseBashCommand(':').usedTreeSitter) context.skip();
  const command = "cat > signature.test.ts <<'TESTEOF'\n/** Format `WF1.payload.signature`.\n * CHAQUE cas de refus échoue sur l'ancien code.\n */\nconst example = 'value';\nTESTEOF\n";
  expect(validateCommand(command)).toMatchObject({ valid: true });
});

it('permet de rédiger un test mentionnant une clé sans lire cette clé', context => {
  if (!parseBashCommand(':').usedTreeSitter) context.skip();
  const command = "cd /tmp && cat > key-test.ts <<'EOF'\nconst pem = fs.readFileSync('priv.key', 'utf8');\nEOF\nnpm run typecheck | head -5\n";
  expect(validateCommand(command)).toMatchObject({ valid: true });
});

it.each([
  "cat priv.key",
  "cat > priv.key <<'EOF'\nliteral\nEOF\n",
  "cat > test.ts <<EOF\n$(cat priv.key)\nEOF\n",
  "bash <<'EOF'\ncat priv.key\nEOF\n",
  "python3 <<'EOF'\nprint(open('priv.key').read())\nEOF\n",
  "cat <<'EOF' | bash\ncat priv.key\nEOF\n",
  "cat > test.ts <<'EOF' | bash\ncat priv.key\nEOF\n",
  "cat > test.ts <<'EOF'\nconst key = 'priv.key';\n",
  "cat > test.ts <<'EOF'\nliteral\nEOF\ncat priv.key",
  "cat() { bash; }\ncat > test.ts <<'EOF'\ncat priv.key\nEOF\n",
  "alias cat=bash\ncat > test.ts <<'EOF'\ncat priv.key\nEOF\n",
  ". ./custom-shell.sh\ncat > test.ts <<'EOF'\ncat priv.key\nEOF\n",
  "PATH=/tmp/custom\ncat > test.ts <<'EOF'\ncat priv.key\nEOF\n",
])('refuse toujours un accès réel ou une interprétation du contenu : %s', command => {
  expect(validateCommand(command).valid).toBe(false);
});

it.each([
  "cat > example.ts <<EOF\n`rm -rf /`\nEOF\n",
  "cat > example.ts <<'EOF'\n`rm -rf /`\n",
  "cat > example.ts <<'EOF'\n`rm -rf /`\nEOF\nrm -rf /",
  "cat > example.ts <<'EOF'\nliteral\nEOF\necho `rm -rf /`",
])('garde les refus pour expansion, syntaxe incomplète et commande extérieure : %s', command => {
  expect(validateCommand(command).valid).toBe(false);
});
