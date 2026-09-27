import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('location lookup requests one fast cached-or-network fix', async () => {
  const { getCurrentPositionFast } = await load('../src/features/client/map/geolocation.ts');
  const options = [];
  const geolocation = { getCurrentPosition(success, _error, config) {
    options.push(config);
    success({ coords: { latitude: 55.7, longitude: 37.6 }, timestamp: 123 });
  } };
  const position = await getCurrentPositionFast(geolocation);
  assert.equal(position.coords.latitude, 55.7);
  assert.equal(options.length, 1);
  assert.equal(options[0].enableHighAccuracy, false);
  assert.ok(options[0].timeout <= 6000);
  assert.ok(options[0].maximumAge >= 30000);
});

test('location lookup does not retry when the user denied permission', async () => {
  const { getCurrentPositionFast } = await load('../src/features/client/map/geolocation.ts');
  let attempts = 0;
  const geolocation = { getCurrentPosition(_success, error) { attempts++; error({ code: 1, message: 'denied' }); } };
  await assert.rejects(getCurrentPositionFast(geolocation), error => error.code === 1);
  assert.equal(attempts, 1);
});

test('concurrent consumers share one browser geolocation request', async () => {
  const { getCurrentPositionFast } = await load('../src/features/client/map/geolocation.ts');
  let attempts = 0;
  let release;
  const geolocation = { getCurrentPosition(success) {
    attempts++;
    release = () => success({ coords: { latitude: 55.7, longitude: 37.6 }, timestamp: 123 });
  } };
  const first = getCurrentPositionFast(geolocation);
  const second = getCurrentPositionFast(geolocation);
  assert.equal(attempts, 1);
  release();
  assert.equal(await first, await second);
});
