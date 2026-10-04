/** Original two-page raster/text/link control for real render-error recovery. */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const pixels = Buffer.alloc(256 * 256 * 3, 255);
for (let y = 20; y <= 235; y++) {
  const color = y <= 120 ? [210, 40, 40] : y >= 136 ? [20, 130, 40] : null;
  if (color) for (let x = 20; x <= 235; x++) pixels.set(color, (y * 256 + x) * 3);
}
const objects = [];
const add = value => objects.push(typeof value === 'string' ? Buffer.from(value) : value);
add('<< /Type /Catalog /Pages 2 0 R >>');
add('<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>');
for (let page = 0; page < 2; page++) add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 256 256] /Resources << /Font << /F1 8 0 R >> /XObject << /Scan 7 0 R >> >> /Contents ${5 + page} 0 R /Annots [${9 + page} 0 R] >>`);
for (let page = 1; page <= 2; page++) {
  const content = `q 256 0 0 256 0 0 cm /Scan Do Q BT /F1 8 Tf 0 g 20 244 Td (Page ${page}) Tj ET`;
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
}
const image = deflateSync(pixels);
add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 256 /Height 256 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')]));
add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
for (let page = 0; page < 2; page++) add(`<< /Type /Annot /Subtype /Link /Rect [0 0 256 256] /Border [0 0 0] /Contents (Stay on this test page) /Dest [${3 + page} 0 R /Fit] >>`);
const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = chunks[0].length;
for (const [index, object] of objects.entries()) {
  offsets.push(length);
  const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
  chunks.push(chunk); length += chunk.length;
}
chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
writeFileSync(new URL('./leafspace-render-recovery.pdf', import.meta.url), Buffer.concat(chunks));
