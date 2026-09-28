// Reproducible inventory of renderer color classes that Tailwind cannot generate.
// Usage: node scripts/audit-tailwind-colors.cjs [--json] [--check] [--config=path]
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const resolveConfig = require('tailwindcss/resolveConfig');
const { createContext } = require('tailwindcss/lib/lib/setupContextUtils');
const { generateRules } = require('tailwindcss/lib/lib/generateRules');

const coworkRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(coworkRoot, 'src', 'renderer');
const configArg = process.argv.find((argument) => argument.startsWith('--config='));
const configPath = configArg ? path.resolve(configArg.slice('--config='.length)) : path.join(coworkRoot, 'tailwind.config.js');
const context = createContext(resolveConfig(require(configPath)));
const colorUtility = /^(?:!?-)?(?:bg|text|border|ring|ring-offset|from|via|to|fill|stroke|placeholder|decoration|divide|outline|caret|accent)-/;
const seen = new Map();

function addClassTokens(value, file) {
  for (let token of value.match(/\S+/g) || []) {
    token = token.replace(/^["'`{(]+|["'`})]+$/g, '');
    const utility = token.split(/:(?![^\[]*\])/).at(-1) || '';
    if (!colorUtility.test(utility) || utility.endsWith('-') || utility.includes('${')) continue;
    if (!seen.has(token)) seen.set(token, new Set());
    seen.get(token).add(path.relative(coworkRoot, file));
  }
}

function addExpression(node, file) {
  function visit(child) {
    if (ts.isStringLiteralLike(child)) addClassTokens(child.text, file);
    else if (ts.isTemplateHead(child) || ts.isTemplateMiddle(child) || ts.isTemplateTail(child)) {
      addClassTokens(child.text, file);
    } else ts.forEachChild(child, visit);
  }
  visit(node);
}

function scan(file) {
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.css')) {
    for (const match of source.matchAll(/@apply\s+([^;]+);/g)) addClassTokens(match[1], file);
    return;
  }
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    // Shared helpers can return complete class lists without a local className.
    if (ts.isStringLiteralLike(node)) {
      const tokens = node.text.trim().split(/\s+/);
      if (tokens.length > 1 && tokens.every((token) => {
        const utility = token.split(':').at(-1);
        return colorUtility.test(utility) || generateRules(new Set([token]), context).length > 0;
      })) addClassTokens(node.text, file);
    }
    if (ts.isJsxAttribute(node) && ['className', 'class'].includes(node.name.text)) {
      if (node.initializer) addExpression(node.initializer, file);
    } else if (ts.isPropertyAssignment(node) &&
      (node.name.getText(tree) === 'className' || node.name.getText(tree) === 'class')) {
      addExpression(node.initializer, file);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      ['cn', 'clsx', 'classNames'].includes(node.expression.text)) {
      node.arguments.forEach((argument) => addExpression(argument, file));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx|js|jsx|css)$/.test(entry.name)) scan(file);
  }
}
walk(rendererRoot);
scan(path.join(coworkRoot, 'index.html'));

const missing = [...seen].filter(([name]) => generateRules(new Set([name]), context).length === 0)
  .map(([name, files]) => ({ className: name, files: [...files].sort() }))
  .sort((a, b) => a.className.localeCompare(b.className));
const result = { scannedClasses: seen.size, missingClasses: missing.length, missing };
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  process.stdout.write(`Classes couleur: ${seen.size}; non générées: ${missing.length}\n`);
  for (const item of missing) process.stdout.write(`${item.className} (${item.files.length} fichiers)\n`);
}
if (process.argv.includes('--check') && missing.length) process.exitCode = 1;
