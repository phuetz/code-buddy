/** Read the returned graph, never a matching word in the input or a status message. */
export function codeExplorerDefinitionsMatch(context, symbol) {
  try {
    const graph = JSON.parse(context.notes);
    return Array.isArray(graph.definitions) && graph.definitions.length === 2 &&
      ['sample.js', 'sample.ts'].every(file => graph.definitions.some(definition =>
        definition.filePath === file && definition.name === symbol &&
        definition.label === 'Function' && definition.startLine === 1 && definition.endLine === 1));
  } catch { return false; }
}

/** This measurement is derived; the caller must retain stdout unchanged separately. */
export function measureCatalogStdout(stdout) {
  const catalog = JSON.parse(stdout);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.features) ||
      !Array.isArray(catalog.warnings) || catalog.warnings.length ||
      typeof catalog.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(catalog.sourceRevision)) {
    throw new Error('Expected the complete production catalogue JSON');
  }
  const ids = new Set();
  const counts = { vrai: 0, faux: 0, inconnu: 0 };
  for (const feature of catalog.features) {
    if (typeof feature.id !== 'string' || ids.has(feature.id) ||
        !Object.hasOwn(counts, feature.states?.testedInSituation)) throw new Error('Invalid or duplicate catalogue entry');
    ids.add(feature.id);
    counts[feature.states.testedInSituation]++;
  }
  return { sourceRevision: catalog.sourceRevision, featureCount: ids.size, counts, warnings: catalog.warnings };
}
