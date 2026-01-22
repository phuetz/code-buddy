/**
 * Semantic Map Language Patterns
 *
 * Language-specific regex patterns for extracting code elements.
 */

/**
 * Language-specific patterns for element extraction
 */
export const LANGUAGE_PATTERNS: Record<string, {
  fileExtensions: string[];
  classPattern: RegExp;
  functionPattern: RegExp;
  interfacePattern: RegExp;
  importPattern: RegExp;
  exportPattern: RegExp;
  variablePattern: RegExp;
  typePattern: RegExp;
}> = {
  typescript: {
    fileExtensions: [".ts", ".tsx"],
    classPattern: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g,
    functionPattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/g,
    interfacePattern: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?/g,
    importPattern: /import\s+(?:(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+)?['"]([^'"]+)['"]/g,
    exportPattern: /export\s+(?:(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+)?(\w+)/g,
    variablePattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*([^=]+))?\s*=/g,
    typePattern: /(?:export\s+)?type\s+(\w+)(?:\s*<[^>]*>)?\s*=/g,
  },
  javascript: {
    fileExtensions: [".js", ".jsx", ".mjs", ".cjs"],
    classPattern: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g,
    functionPattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    interfacePattern: /$/g, // No interfaces in JS
    importPattern: /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
    exportPattern: /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g,
    variablePattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g,
    typePattern: /$/g, // No types in JS
  },
  python: {
    fileExtensions: [".py"],
    classPattern: /class\s+(\w+)(?:\(([^)]*)\))?:/g,
    functionPattern: /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/g,
    interfacePattern: /$/g, // No interfaces in Python
    importPattern: /(?:from\s+(\S+)\s+)?import\s+([^#\n]+)/g,
    exportPattern: /$/g, // Python uses __all__
    variablePattern: /^(\w+)\s*(?::\s*([^=]+))?\s*=/gm,
    typePattern: /$/g,
  },
  go: {
    fileExtensions: [".go"],
    classPattern: /type\s+(\w+)\s+struct\s*\{/g,
    functionPattern: /func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(?([^{)]+)\)?)?/g,
    interfacePattern: /type\s+(\w+)\s+interface\s*\{/g,
    importPattern: /import\s+(?:\(\s*)?"([^"]+)"(?:\s*\))?/g,
    exportPattern: /$/g, // Go uses capitalization
    variablePattern: /(?:var|const)\s+(\w+)(?:\s+(\w+))?\s*=/g,
    typePattern: /type\s+(\w+)\s+/g,
  },
};
