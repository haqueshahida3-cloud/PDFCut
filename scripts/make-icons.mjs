// Renders public/icon.svg into the PNG sizes used by the Linux package and the tray.
//   build/icons/<size>x<size>.png  → electron-builder (desktop entry, hicolor theme)
//   electron/assets/icon.png       → window icon
//   electron/assets/tray.png       → tray icon
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync('public/icon.svg');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

mkdirSync('build/icons', { recursive: true });
mkdirSync('electron/assets', { recursive: true });

for (const size of SIZES) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(`build/icons/${size}x${size}.png`);
}
await sharp(svg, { density: 384 }).resize(512, 512).png().toFile('electron/assets/icon.png');
await sharp(svg, { density: 384 }).resize(64, 64).png().toFile('electron/assets/tray.png');

console.log(`Icons written: ${SIZES.join(', ')} px`);

// Windows ICO generation
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const buffers = [];

for (const size of icoSizes) {
  buffers.push(
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toBuffer()
  );
}

const header = Buffer.alloc(6 + buffers.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(buffers.length, 4);

let offset = header.length;

buffers.forEach((buffer, index) => {
  const size = icoSizes[index];
  const entry = 6 + index * 16;

  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(buffer.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);

  offset += buffer.length;
});

writeFileSync('build/icon.ico', Buffer.concat([header, ...buffers]));
console.log('Windows ICO generated.');
