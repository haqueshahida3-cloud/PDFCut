// Renders public/icon.svg into the PNG sizes used by the Linux package and the tray.
//   build/icons/<size>x<size>.png  → electron-builder (desktop entry, hicolor theme)
//   electron/assets/icon.png       → window icon
//   electron/assets/tray.png       → tray icon
import { mkdirSync, readFileSync } from 'node:fs';
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
