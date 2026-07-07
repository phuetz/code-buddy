/**
 * buddy curator — rapport d'entretien propose-only de la couche apprenante
 * (mémoire persistante, skills authored, CKG, leçons, coûts modèles).
 *
 * Le Curator PROPOSE, il n'applique rien : chaque patch pointe vers la
 * commande humaine existante (dreaming/`/memory restore`, `buddy improve
 * skills-*`, `buddy lessons`, …). Voir src/curator/curator.ts.
 *
 * Usage :
 *   buddy curator scan [--json]    # scanner et écrire .codebuddy/curator/
 *   buddy curator latest           # afficher le dernier rapport
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';

export function registerCuratorCommand(program: Command): void {
  const curator = program
    .command('curator')
    .description('Rapport d\'entretien propose-only (mémoire, skills, CKG, leçons, coûts)');

  curator
    .command('scan')
    .description('Scanner la couche apprenante et écrire le rapport (.codebuddy/curator/)')
    .option('--json', 'Imprimer le rapport JSON sur stdout')
    .action(async (options: { json?: boolean }) => {
      try {
        const { runCuratorScan, saveCuratorReport, renderCuratorMarkdown } = await import(
          '../curator/curator.js'
        );
        const report = await runCuratorScan();
        const { jsonPath, mdPath } = await saveCuratorReport(report);
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(renderCuratorMarkdown(report));
          console.log(`Rapport écrit : ${mdPath} (+ ${path.basename(jsonPath)})`);
        }
        process.exit(0);
      } catch (err) {
        console.error('Curator error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  curator
    .command('latest')
    .description('Afficher le dernier rapport généré')
    .action(async () => {
      try {
        const mdPath = path.join(process.cwd(), '.codebuddy', 'curator', 'latest.md');
        console.log(await fs.readFile(mdPath, 'utf-8'));
        process.exit(0);
      } catch {
        console.error('Aucun rapport — lance d\'abord `buddy curator scan`.');
        process.exit(1);
      }
    });
}
