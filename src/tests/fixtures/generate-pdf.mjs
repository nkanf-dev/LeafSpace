/** Deterministic, dependency-free, synthetic PDFs. No third-party document data. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function createPdf(title, count, outline = false) {
  const objects = [];
  const add = (value) => objects.push(Buffer.from(value, 'ascii'));
  const outlineRoot = 4 + count * 2;
  add(outline ? `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineRoot} 0 R >>` : '<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let page = 1; page <= count; page++) {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 594] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (page - 1) * 2} 0 R >>`);
    const stream = `0.94 0.93 0.88 rg 0 0 420 594 re f\n0.1 0.2 0.15 rg BT /F1 28 Tf 40 520 Td (${title}) Tj 0 -55 Td (Page ${page} of ${count}) Tj /F1 12 Tf 0 -45 Td (Synthetic PDF: navigation, comparison, persistence) Tj ET\n0.2 0.5 0.3 rg 40 100 ${page * 25} 200 re f\n`;
    add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  if (outline) {
    add(`<< /Type /Outlines /First ${outlineRoot + 1} 0 R /Last ${outlineRoot + 3} 0 R /Count 3 >>`);
    add(`<< /Title (Opening chapter) /Parent ${outlineRoot} 0 R /Next ${outlineRoot + 3} 0 R /First ${outlineRoot + 2} 0 R /Last ${outlineRoot + 2} 0 R /Count 1 /Dest [4 0 R /Fit] >>`);
    add(`<< /Title (Nested methods) /Parent ${outlineRoot + 1} 0 R /Dest [18 0 R /Fit] >>`);
    add(`<< /Title (Final chapter) /Parent ${outlineRoot} 0 R /Prev ${outlineRoot + 1} 0 R /Dest [${4 + (count - 1) * 2} 0 R /Fit] >>`);
  }
  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([...chunks, Buffer.from(xref)]);
}

writeFileSync(fileURLToPath(new URL('./leafspace-12-pages.pdf', import.meta.url)), createPdf('LeafSpace test book', 12));
writeFileSync(fileURLToPath(new URL('./leafspace-other-book.pdf', import.meta.url)), createPdf('Another test book', 4));

writeFileSync(fileURLToPath(new URL('./leafspace-120-pages.pdf', import.meta.url)), createPdf('Long outline book', 120, true));
