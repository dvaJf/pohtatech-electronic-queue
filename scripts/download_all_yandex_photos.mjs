import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const outDir = 'frontend/public/images/branches';
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// 1. Parse all branches from branchLocations.ts
const content = readFileSync('frontend/src/features/client/map/branchLocations.ts', 'utf8');
const branchRegex = /\{\s*id:\s*'([^']+)',\s*code:\s*'([^']+)',[\s\S]*?name:\s*'([^']+)',[\s\S]*?address:\s*'([^']+)',/g;
let m;
const branches = [];
const seenCodes = new Set();
while ((m = branchRegex.exec(content)) !== null) {
  const [_, id, code, name, address] = m;
  if (!seenCodes.has(code)) {
    seenCodes.add(code);
    branches.push({ id, code, name, address });
  }
}

console.log(`Parsed ${branches.length} branches from branchLocations.ts`);

async function fetchBranchFromYandex(branch) {
  // Clean address for search
  const cleanAddress = branch.address.replace(/^г\.\s*/, '');
  const searchCode = branch.code.split('-')[0];
  const query = `Почта России ${searchCode} ${cleanAddress}`;
  const url = 'https://yandex.ru/maps/?text=' + encodeURIComponent(query);
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      }
    });
    const html = await res.text();
    const scriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      if (match[1].includes('avatars.mds.yandex.net')) {
        const d = JSON.parse(match[1]);
        const items = d.search?.results?.items || d.stack?.[0]?.results?.items || [];
        for (const item of items) {
          if (item && item.photos?.items?.length) {
            const firstPhoto = item.photos.items[0];
            const template = firstPhoto.urlTemplate || item.photos.urlTemplate;
            if (template) {
              const photoUrl = template.replace('%s', 'L');
              const highResUrl = template.replace('%s', 'XXXL');
              const oid = item.uri?.match(/oid=(\d+)/)?.[1] || '';
              const yandexUrl = oid ? `https://yandex.ru/maps/org/${oid}/` : url;
              return {
                photoUrl,
                highResUrl,
                yandexUrl,
                title: item.title,
                address: item.address,
              };
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`Error searching ${branch.code}:`, err.message);
  }
  return null;
}

// Fallback search by only clean address if not found
async function fallbackSearch(branch) {
  const cleanAddress = branch.address.replace(/^г\.\s*/, '');
  const query = `Почта России ${cleanAddress}`;
  const url = 'https://yandex.ru/maps/?text=' + encodeURIComponent(query);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      }
    });
    const html = await res.text();
    const scriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      if (match[1].includes('avatars.mds.yandex.net')) {
        const d = JSON.parse(match[1]);
        const items = d.search?.results?.items || d.stack?.[0]?.results?.items || [];
        for (const item of items) {
          if (item && item.photos?.items?.length) {
            const firstPhoto = item.photos.items[0];
            const template = firstPhoto.urlTemplate || item.photos.urlTemplate;
            if (template) {
              return {
                photoUrl: template.replace('%s', 'L'),
                highResUrl: template.replace('%s', 'XXXL'),
                yandexUrl: item.uri ? `https://yandex.ru/maps/org/${item.uri.match(/oid=(\d+)/)?.[1] || ''}/` : url,
                title: item.title,
                address: item.address,
              };
            }
          }
        }
      }
    }
  } catch (e) {}
  return null;
}

async function main() {
  const results = {};
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    process.stdout.write(`[${i + 1}/${branches.length}] Processing ${b.code} (${b.name})... `);

    let res = await fetchBranchFromYandex(b);
    if (!res) {
      res = await fallbackSearch(b);
    }

    if (res && res.photoUrl) {
      try {
        const imgRes = await fetch(res.photoUrl);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const targetFile = path.join(outDir, `${b.code}.jpg`);
          writeFileSync(targetFile, buf);
          results[b.code] = {
            code: b.code,
            name: b.name,
            address: b.address,
            localPath: `/images/branches/${b.code}.jpg`,
            yandexPhotoUrl: res.photoUrl,
            yandexOrgUrl: res.yandexUrl,
            title: res.title,
            verifiedAddress: res.address,
            sizeBytes: buf.length,
          };
          successCount++;
          console.log(`OK (${(buf.length / 1024).toFixed(1)} KB) - ${res.title}`);
        } else {
          console.log(`IMG FAIL: HTTP ${imgRes.status}`);
          failCount++;
        }
      } catch (err) {
        console.log(`DOWNLOAD ERROR: ${err.message}`);
        failCount++;
      }
    } else {
      console.log(`NOT FOUND ON YANDEX`);
      failCount++;
    }

    // Gentle delay to respect rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone! Success: ${successCount}, Failed: ${failCount}`);
  writeFileSync('frontend/src/features/client/map/branchPhotosRegistry.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Saved frontend/src/features/client/map/branchPhotosRegistry.json');
}

main().catch(console.error);
