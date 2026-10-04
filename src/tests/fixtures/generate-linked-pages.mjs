// Self-contained, reproducible link-navigation PDF. No third-party content.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const objects = [];
const add = value => objects.push(Buffer.from(value));
add('<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(chapter) [7 0 R /Fit]] >> >> >>');
add('<< /Type /Pages /Count 3 /Kids [3 0 R 5 0 R 7 0 R] >>');
const colors = [[0.2, 0.5, 0.3], [0.1, 0.35, 0.7], [0.7, 0.25, 0.1]];
for (let page = 1; page <= 3; page++) {
  const labels = page === 1 ? ['Numeric link to page 2', 'Named link to page 3', 'Indirect link to page 3', 'Same page link', 'External URL (attribute check only)'] : ['Back to page 1'];
  const stream = `${colors[page - 1].join(' ')} rg 20 560 380 14 re f\n0 0 0 rg\nBT /F1 18 Tf 30 537 Td (LeafSpace links - Page ${page}) Tj ET\n`
    + labels.map((label, index) => `BT /F1 12 Tf 35 ${510 - index * 45} Td (${label.replaceAll('(', '\\(').replaceAll(')', '\\)')}) Tj ET`).join('\n') + '\n';
  const annotations = page === 1 ? '10 0 R 11 0 R 12 0 R 13 0 R 14 0 R' : `${page + 13} 0 R`;
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 594] /Resources << /Font << /F1 9 0 R >> >> /Contents ${page * 2 + 2} 0 R /Annots [${annotations}] >>`);
  add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
}
add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
const actions = ['/Dest [1 /Fit]', '/Dest (chapter)', '/Dest [7 0 R /Fit]', '/Dest [0 /Fit]', '/A << /S /URI /URI (https://example.com/paper) >>', '/Dest [0 /Fit]', '/Dest [0 /Fit]'];
actions.forEach((action, index) => {
  const row = index < 5 ? index : 0;
  add(`<< /Type /Annot /Subtype /Link /Rect [30 ${505 - row * 45} 370 ${526 - row * 45}] /Border [0 0 1] ${action} >>`);
});
const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = chunks[0].length;
objects.forEach((object, index) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); chunks.push(chunk); length += chunk.length; });
chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
writeFileSync(fileURLToPath(new URL('./leafspace-links.pdf', import.meta.url)), Buffer.concat(chunks));
