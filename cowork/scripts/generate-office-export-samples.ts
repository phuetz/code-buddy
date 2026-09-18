/**
 * Write the comparison-folder sample .docx / .pptx (local, no network).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeOfficeExport } from '../src/main/office-export/export-office';

const here = dirname(fileURLToPath(import.meta.url));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const markdown = `# Export bureautique Cowork

Cowork peut maintenant produire un **document Word** et une **présentation PowerPoint** depuis un artefact ou une conversation, **sans réseau**.

## Ce que le document conserve

- Titres et paragraphes
- Listes à puces et listes numérotées
- Code en police à chasse fixe
- Tableaux simples
- Images locales intégrées

1. Ouvrir le panneau d'artefacts
2. Choisir Word ou Slides
3. Enregistrer dans \`exports/\` de la session

\`\`\`ts
const path = 'exports/rapport.docx';
console.log(path);
\`\`\`

| Format | Extension | Usage |
| --- | --- | --- |
| Document | .docx | Compte rendu, spec |
| Présentation | .pptx | Brief, revue |

![Point de contrôle](dot.png)

> Cette citation devient une note du présentateur sur la première diapositive.

---

# Limites assumées

- Pas de fetch HTTP des images
- HTML réduit en texte
- Une diapositive par titre de niveau 1 ou séparateur \`---\`

![Image absente](./fichier-inexistant.png)
`;

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) {
    throw new Error('Usage: generate-office-export-samples.ts <output-dir>');
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'dot.png'), png);
  const baseDir = outDir;
  const docx = await writeOfficeExport({
    markdown,
    title: 'Export bureautique Cowork',
    format: 'docx',
    outputPath: join(outDir, 'cowork-export-bureautique.docx'),
    baseDir,
  });
  const pptx = await writeOfficeExport({
    markdown,
    title: 'Export bureautique Cowork',
    format: 'pptx',
    outputPath: join(outDir, 'cowork-export-bureautique.pptx'),
    baseDir,
  });
  writeFileSync(join(outDir, 'source.md'), markdown, 'utf8');
  console.log(JSON.stringify({ docx, pptx, here }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
