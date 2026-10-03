// Keep the SVG as the single source of truth. Re-run after changing the mark:
// npm run icons:generate
// Bump the v1 asset names and index/manifest links when shipping a new design.
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicFile = name => new URL(`../public/${name}`, import.meta.url);
const svg = await readFile(publicFile('leafspace-icon-v1.svg'), 'utf8');
const faviconImages = [];

for (const size of [16, 32, 48, 180, 192, 512]) {
  // Home-screen icons have an opaque square background; the OS applies its own mask.
  let image = sharp(Buffer.from(svg), { density: 576 }).resize(size, size);
  if (size >= 180) image = image.flatten({ background: '#292524' });
  const png = await image.png().toBuffer();
  if (size <= 48) faviconImages.push({ size, png });
  if (size === 32 || size >= 180) {
    const name = size === 180 ? 'apple-touch-icon-v1.png' : `leafspace-icon-${size}-v1.png`;
    await writeFile(publicFile(name), png);
  }
}

// ICO directory followed by its three PNG payloads. Keep the conventional
// /favicon.ico route for clients that discover it without reading HTML.
const header = Buffer.alloc(6 + 16 * faviconImages.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(faviconImages.length, 4);
let offset = header.length;
faviconImages.forEach(({ size, png }, index) => {
  const entry = 6 + 16 * index;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(publicFile('favicon.ico'), Buffer.concat([header, ...faviconImages.map(({ png }) => png)]));
console.log(`Generated LeafSpace browser and home-screen icons in ${fileURLToPath(new URL('../public/', import.meta.url))}`);
