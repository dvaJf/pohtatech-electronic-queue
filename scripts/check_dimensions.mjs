import { readdirSync, readFileSync } from 'fs';
import path from 'path';

function getJpgDimensions(buf) {
  let offset = 2;
  while (offset < buf.length) {
    if (buf[offset] !== 0xFF) break;
    const marker = buf[offset + 1];
    if (marker === 0xC0 || marker === 0xC2) { // SOF0 or SOF2
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    const len = buf.readUInt16BE(offset + 2);
    offset += 2 + len;
  }
  return null;
}

const dir = 'frontend/public/images/branches';
const files = readdirSync(dir).filter(f => f.endsWith('.jpg'));

const stats = [];
for (const f of files) {
  const buf = readFileSync(path.join(dir, f));
  const dim = getJpgDimensions(buf);
  stats.push({ file: f, ...dim, size: buf.length });
}

console.log('Sample image dimensions:');
stats.slice(0, 25).forEach(s => {
  console.log(`${s.file.padEnd(14)}: ${s.width}x${s.height} (ratio: ${(s.width / s.height).toFixed(2)})`);
});

const ratios = new Set(stats.map(s => (s.width / s.height).toFixed(2)));
console.log('Unique aspect ratios:', Array.from(ratios));
