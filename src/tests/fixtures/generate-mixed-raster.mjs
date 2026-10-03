/** Deterministic raster-only geometry fixture; no third-party document data. */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const cases = [
 { name: 'portrait', width: 420, height: 594, expected: [420, 594], corners: ['R','G','B','Y'] },
 { name: 'landscape', width: 792, height: 612, expected: [792, 612], corners: ['R','G','B','Y'] },
 { name: 'rotate90', width: 420, height: 594, rotate: 90, expected: [594, 420], corners: ['B','R','Y','G'] },
 { name: 'rotate180', width: 420, height: 594, rotate: 180, expected: [420, 594], corners: ['Y','B','G','R'] },
 { name: 'rotate270', width: 420, height: 594, rotate: 270, expected: [594, 420], corners: ['G','Y','R','B'] },
 { name: 'offset-crop', width: 612, height: 792, crop: [72, 96, 540, 720], expected: [468,624], corners: ['R','G','B','Y'] },
 { name: 'offset-crop-rotate90', width: 612, height: 792, crop: [72,96,540,720], rotate:90, expected:[624,468], corners:['B','R','Y','G'] },
 { name: 'square', width: 500, height: 500, expected:[500,500], corners:['R','G','B','Y'] },
 { name: 'tall-six-to-one', width: 200, height: 1200, expected:[200,1200], corners:['R','G','B','Y'] },
 { name: 'wide-six-to-one', width: 1200, height: 200, expected:[1200,200], corners:['R','G','B','Y'] }
];
const objects=[];
const add = value => objects.push(typeof value === 'string' ? Buffer.from(value) : value);
add('<< /Type /Catalog /Pages 2 0 R >>');
add(`<< /Type /Pages /Count ${cases.length} /Kids [${cases.map((_, i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
const colors={R:[220,25,35], G:[25,180,45], B:[30,60,220], Y:[230,205,25]};
for (const [i,p] of cases.entries()) {
 const id=3+i*3;
 add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] ${p.crop?`/CropBox [${p.crop.join(' ')}]`:''} ${p.rotate?`/Rotate ${p.rotate}`:''} /Resources << /XObject << /Scan ${id+2} 0 R >> >> /Contents ${id+1} 0 R >>`);
 const content=`q ${p.width} 0 0 ${p.height} 0 0 cm /Scan Do Q`;
 add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
 const pixels=Buffer.alloc(64*64*3);
 for(let y=0;y<64;y++) for(let x=0;x<64;x++) pixels.set(colors[y<32?(x<32?'R':'G'):(x<32?'B':'Y')],(y*64+x)*3);
 const image=deflateSync(pixels);
 add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')]));
}
const chunks=[Buffer.from('%PDF-1.4\n')], offsets=[0]; let length=chunks[0].length;
for(const [i,object] of objects.entries()) { offsets.push(length); const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]); chunks.push(chunk); length+=chunk.length; }
chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(x=>`${String(x).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
const bytes=Buffer.concat(chunks); writeFileSync(new URL('./leafspace-mixed-raster.pdf',import.meta.url),bytes);
