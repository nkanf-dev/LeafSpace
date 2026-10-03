/**
 * Self-contained, dependency-free, synthetic PDF fixture generator.
 * No external files, network requests, third-party PDFs, or personal data.
 * Usage: node generate-jpx-fixtures.mjs [output-directory]
 *
 * Embedded JP2 source: 256x256 RGB, white background, inclusive rectangles:
 * red (20,20)-(235,120), RGB(210,40,40)
 * green (20,136)-(235,235), RGB(20,130,40)
 * Encoded losslessly with Python 3.12.14, Pillow 12.3.0, OpenJPEG 2.5.4:
 * image.save(stream, format='JPEG2000', irreversible=False)
 * Optional source-regeneration recipe is in reencode-jpx.py.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
const JP2_BASE64 = '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';
const jp2 = Buffer.from(JP2_BASE64, 'base64');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha256(jp2) !== '446deb4eac95aea6de376b1bbe073ad0b84611d0b88631c77c3c21f528292bf5') throw new Error('JP2 payload integrity failed');
const pixels = Buffer.alloc(256 * 256 * 3, 255);
for (let y = 20; y <= 235; y++) {
  const color = y <= 120 ? [210,40,40] : y >= 136 ? [20,130,40] : null;
  if (color) for (let x = 20; x <= 235; x++) {
    const offset = (y * 256 + x) * 3;
    for (let channel=0; channel<3; channel++) pixels[offset+channel]=color[channel];
  }
}
function makePdf(imageBytes, filter) {
  const content = Buffer.from('q 256 0 0 256 0 0 cm /Scan Do Q');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 256 256] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`),content,Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 256 /Height 256 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${imageBytes.length} >>\nstream\n`),imageBytes,Buffer.from('\nendstream')]),
  ];
  const chunks=[Buffer.from('%PDF-1.5\n')], offsets=[0]; let length=chunks[0].length;
  for (let index=0; index<objects.length; index++) {
    offsets.push(length);
    const chunk=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),objects[index],Buffer.from('\nendobj\n')]);
    chunks.push(chunk); length+=chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
const directory = resolve(process.argv[2] ?? dirname(fileURLToPath(import.meta.url)));
mkdirSync(directory,{recursive:true});
const entries=[['jpx-scan.pdf',makePdf(jp2,'JPXDecode')],['rgb-control.pdf',makePdf(deflateSync(pixels,{level:9}),'FlateDecode')]];
for (const [name,data] of entries) writeFileSync(join(directory,name),data);
const manifest={
  fixtureOrigin:'Original synthetic colored rectangles; no external documents or images',
  encoder:{python:'3.12.14',pillow:'12.3.0',openjpeg:'2.5.4',format:'JPEG2000',irreversible:false},
  generationRuntime:{node:process.version,zlib:process.versions.zlib},
  jp2:{bytes:jp2.length,sha256:sha256(jp2)},
  decodedRGB:{width:256,height:256,channels:3,sha256:sha256(pixels)},
  files:entries.map(([name,data])=>({name,bytes:data.length,sha256:sha256(data)})),
  samples:[{label:'red',xFraction:.5,yFraction:.25,expectedRGBA:[210,40,40,255]},{label:'green',xFraction:.5,yFraction:.75,expectedRGBA:[20,130,40,255]},{label:'white gap',xFraction:.5,yFraction:.5,expectedRGBA:[255,255,255,255]}],
};
writeFileSync(join(directory,'jpx-fixture-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
console.log(JSON.stringify(manifest,null,2));
