import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('location lookup retries a timeout with a cached low-accuracy fix', async () => {
  const { getPositionWithFallback } = await load('../src/features/client/map/geolocation.ts');
  const options = [];
  const geolocation = { getCurrentPosition(success, error, config) {
    options.push(config);
    if (options.length === 1) error({ code: 3, message: 'timeout' });
    else success({ coords: { latitude: 55.7, longitude: 37.6 }, timestamp: 123 });
  } };
  const position = await getPositionWithFallback(geolocation);
  assert.equal(position.coords.latitude, 55.7);
  assert.equal(options.length, 2);
  assert.equal(options[0].enableHighAccuracy, true);
  assert.equal(options[1].enableHighAccuracy, false);
  assert.ok(options[1].maximumAge >= 30000);
});

test('location lookup does not retry when the user denied permission', async () => {
  const { getPositionWithFallback } = await load('../src/features/client/map/geolocation.ts');
  let attempts = 0;
  const geolocation = { getCurrentPosition(_success, error) { attempts++; error({ code: 1, message: 'denied' }); } };
  await assert.rejects(getPositionWithFallback(geolocation), error => error.code === 1);
  assert.equal(attempts, 1);
});
