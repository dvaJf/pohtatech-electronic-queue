import { readFileSync, writeFileSync } from 'fs';

const regPath = 'frontend/src/features/client/map/branchPhotosRegistry.json';
const registry = JSON.parse(readFileSync(regPath, 'utf8'));

const lines = readFileSync('frontend/src/features/client/map/branchLocations.ts', 'utf8').split('\n');

const newLines = [];
let currentCode = null;
let skipUntilNextField = false;
let updatedCount = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const codeMatch = line.match(/code:\s*'([^']+)'/);
  if (codeMatch) {
    currentCode = codeMatch[1];
  }

  // If previous replacement requested skipping old photoSource / photoSourceUrl lines
  if (skipUntilNextField) {
    if (line.trim().startsWith('photoSource:') || line.trim().startsWith('photoSourceUrl:')) {
      continue;
    } else {
      skipUntilNextField = false;
    }
  }

  if (line.trim().startsWith('photos:') && currentCode && registry[currentCode]) {
    const reg = registry[currentCode];
    updatedCount++;
    const indent = line.match(/^(\s*)/)[1];
    newLines.push(`${indent}photos: ['${reg.localPath}', '${reg.yandexPhotoUrl}'],`);
    newLines.push(`${indent}photoSource: 'Яндекс Карты (Официальное фото отделения)',`);
    newLines.push(`${indent}photoSourceUrl: '${reg.yandexOrgUrl}',`);
    skipUntilNextField = true;
    continue;
  }

  newLines.push(line);
}

console.log(`Processed ${lines.length} lines. Updated ${updatedCount} branches.`);
writeFileSync('frontend/src/features/client/map/branchLocations.ts', newLines.join('\n'), 'utf8');
