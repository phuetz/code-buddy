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

it.each([
  "cat > example.ts <<EOF\n`rm -rf /`\nEOF\n",
  "cat > example.ts <<'EOF'\n`rm -rf /`\n",
  "cat > example.ts <<'EOF'\n`rm -rf /`\nEOF\nrm -rf /",
  "cat > example.ts <<'EOF'\nliteral\nEOF\necho `rm -rf /`",
])('garde les refus pour expansion, syntaxe incomplète et commande extérieure : %s', command => {
  expect(validateCommand(command).valid).toBe(false);
});
