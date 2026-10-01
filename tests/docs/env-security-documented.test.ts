import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Documentation des variables d\'environnement de sécurité', () => {
  it('docs/configuration.md devrait contenir une section sur les variables réduisant la sécurité', () => {
    const docPath = path.join(__dirname, '../../docs/configuration.md');
    const content = fs.readFileSync(docPath, 'utf-8');

    // Vérifie la présence de la sous-section
    expect(content).toContain('Variables qui réduisent une protection');

    // Vérifie la présence des 3 variables avec leurs caractéristiques attendues
    const variables = [
      'CODEBUDDY_AUTO_CONFIRM',
      'CODEBUDDY_MCP_ALLOW_WRITE',
      'CODEBUDDY_BROWSER_USE_NO_SANDBOX'
    ];

    for (const variable of variables) {
      expect(content).toContain(variable);
    }
  });
});
