// Deterministic minimal multi-page PDF generator.
// Builds a valid PDF-1.4 with 3 pages whose text content is known and whose
// lengths are DELIBERATELY unequal, so a uniform-division page split would be
// provably wrong. Byte offsets for the xref table are computed programmatically.
import { writeFileSync } from 'node:fs';

const PAGES = [
  // page 1 — short
  ['ALPHA PAGE ONE', 'Introduction', 'The alpha marker lives here.'],
  // page 2 — long
  [
    'BETA PAGE TWO',
    'Methods',
    'The beta marker lives here on the second page.',
    'This page is intentionally much longer than the others.',
    'It contains several extra sentences of prose.',
    'Uniform division would never land the boundary here.',
    'More filler text to grow the page well beyond page one.',
    'Even more filler so the length gap is unmistakable.',
  ],
  // page 3 — medium
  ['GAMMA PAGE THREE', 'Conclusion', 'The gamma marker lives here.', 'Final remarks close the document.'],
];

function contentStream(lines) {
  let body = 'BT /F1 12 Tf 72 720 Td\n';
  for (let i = 0; i < lines.length; i++) {
    const escaped = lines[i].replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    if (i > 0) body += '0 -16 Td\n';
    body += `(${escaped}) Tj\n`;
  }
  body += 'ET\n';
  return body;
}

const objects = [];
objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
const kids = [3, 5, 7].map((n) => `${n} 0 R`).join(' ');
objects.push(`<< /Type /Pages /Kids [${kids}] /Count 3 >>`); // 2
for (let p = 0; p < 3; p++) {
  const pageObj = 3 + p * 2;
  const contentObj = pageObj + 1;
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 9 0 R >> >> >>`,
  ); // page
  const stream = contentStream(PAGES[p]);
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`); // content
}
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 9

let pdf = '%PDF-1.4\n%\xff\xff\xff\xff\n';
const offsets = [];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefStart = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (const off of offsets) {
  pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = process.argv[2];
writeFileSync(out, Buffer.from(pdf, 'latin1'));
console.log('wrote', out, Buffer.byteLength(pdf, 'latin1'), 'bytes');
