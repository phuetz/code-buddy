/** Architectural regression: model choices belong to configuration, not callers. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogues = new Set([
  'src/providers/provider-catalog.ts',
  'src/providers/additional-providers.ts',
  'src/auth/oauth/model-profiles.ts',
]);
const modelName = /^(?:[\w.-]+[/.])?(?:grok-(?:\d|code|imagine|embedding)|gpt-(?:\d|image)|claude-(?:\d|sonnet|opus|haiku)|gemini-\d|gemma-\d|openrouter\/free|mistral-(?:small|large)|(?:llama|qwen|gemma|phi)[-\d]|whisper-\d|tts-\d|text-embedding-|nomic-embed|pixverse-v|deepseek-(?:chat|coder|reasoner|v\d)|devstral-|o[134](?:-|$))/i;
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []);
}
function hardcodedChoices(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) && modelName.test(node.text)) {
      const parent = node.parent;
      const isChoice = ts.isConditionalExpression(parent) || (ts.isBinaryExpression(parent) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.EqualsToken].includes(parent.operatorToken.kind))
        || ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && /^(model|defaultModel|preferredModel|fallbackModel|draftModel|targetModel|localLLMModel|architectModel|editorModel|currentModel)$/.test(parent.name.getText(source)))
        || (ts.isVariableDeclaration(parent) && /model/i.test(parent.name.getText(source)))
        || ts.isReturnStatement(parent)
        || (ts.isParameter(parent) && parent.name.getText(source) === 'model')
        || (ts.isCallExpression(parent) && (parent.expression.getText(source) === 'createContextManager' || (parent.expression.getText(source).endsWith('.append') && ts.isStringLiteral(parent.arguments[0]!) && parent.arguments[0]!.text === 'model')));
      if (isChoice) found.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}
for (const file of files(join(root, 'src'))) {
  const name = relative(root, file).replaceAll('\\', '/');
  if (name.startsWith('src/config/') || name.includes('/config-validation/') || catalogues.has(name)) continue;
  // One assertion per consumer makes the pre-fix failures attributable to each file.
  it(`${name} choisit les modèles par configuration`, () => {
    expect(hardcodedChoices(file)).toEqual([]);
  });
}
