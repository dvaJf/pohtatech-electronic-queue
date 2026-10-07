import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import * as esbuild from 'esbuild';

async function loadTS(relativePath) {
  const filePath = resolve(import.meta.dirname, relativePath);
  const result = esbuild.buildSync({
    entryPoints: [filePath],
    bundle: true,
    format: 'esm',
    write: false,
    external: ['react', 'react-dom'],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('every catalog branch keeps a real local photo and a full postal address', async () => {
  const { MOSCOW_BRANCHES } = await loadTS('../src/features/client/map/branchLocations.ts');
  assert.equal(MOSCOW_BRANCHES.length, 53);

  for (const branch of MOSCOW_BRANCHES) {
    assert.match(branch.address, /^г\.\s|^г\s/i, `${branch.code} must keep its city in the address`);
    assert.match(branch.address, /(?:ул\.|пер\.|просп\.|проспект|пр-т|шоссе|пл\.|площадь|проезд|бульвар|наб\.|тракт|аллея|Кремлёвская)/i,
      `${branch.code} must keep a street-level address`);
    assert.ok(branch.photos?.[0]?.startsWith('/images/branches/'), `${branch.code} must prefer a local real photo`);
    assert.ok(!branch.photos[0].startsWith('data:image'), `${branch.code} must not fall back to a generated SVG`);
    await access(resolve(import.meta.dirname, '../public', branch.photos[0].slice(1)));
  }
});

test('special force-confirm is hidden in production and requires an explicit non-production flag', async () => {
  const { isForceConfirmVisible } = await loadTS('../src/features/client/appointmentConfirmationPolicy.ts');
  assert.equal(isForceConfirmVisible({ explicitFlag: undefined, mode: 'production', isDev: false }), false);
  assert.equal(isForceConfirmVisible({ explicitFlag: 'true', mode: 'production', isDev: false }), false);
  assert.equal(isForceConfirmVisible({ explicitFlag: 'true', mode: 'development', isDev: true }), true);
  assert.equal(isForceConfirmVisible({ explicitFlag: 'false', mode: 'production', isDev: false }), false);
});
