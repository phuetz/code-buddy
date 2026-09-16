/** Offline behavioral objective for code evolution. Protected from candidate edits. */
import { ToolHarness } from '../dist/harness/tool-harness.js';
const definitions = [
  ['view_file', 'Read the contents of a text file'],
  ['search', 'Search for a string or regular expression in workspace files'],
  ['list_directory', 'List files and directories in a folder'],
  ['git_status', 'Show changes staged and unstaged in the git repository'],
  ['run_tests', 'Run the tests for a specified file'],
].map(([name, description]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: {}, required: [] } } }));
const results = {};
const harness = new ToolHarness({ cwd: process.cwd(), tools: definitions, dispatch: async (name, args) => ({ success: true, output: name, data: args }) });
try {
  for (const [query, expected] of [
    ['read file', 'view_file'], ['lire fichier', 'view_file'],
    ['view_file', 'view_file'], ['voir le contenu', 'view_file'],
    ['rechercher une expression', 'search'], ['find string', 'search'],
    ['list directory', 'list_directory'], ['afficher les dossiers', 'list_directory'],
    ['git status', 'git_status'], ['changements git', 'git_status'],
    ['run tests', 'run_tests'], ['exécuter les tests', 'run_tests'],
  ]) results[`search:${query}`] = harness.search(query, 1)[0]?.name === expected;
  for (const [id, code, expected] of [
    ['structured-result', 'text((await tools.view_file({value:42})).data.value);', '42'],
    ['discovery-call', "const r=await tools.tool_search({query:'view_file',max_results:1}); text((await tools.call(r.data.names[0])).output);", 'view_file'],
    ['persistent-state', "store('value', 7); text(load('value'));", '7'],
    ['state-next-cell', "text(load('value'));", '7'],
  ]) {
    const result = await harness.exec(code);
    results[id] = result.success && result.output?.replace(/^Script completed in [^\n]+\n\n/, '').trim() === expected;
  }
  results['unavailable-tool'] = !(await harness.exec("await tools.call('not_authorized');")).success;
} finally { await harness.dispose(); }
console.log(JSON.stringify({ kind: 'harness_benchmark', results }));
