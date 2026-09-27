import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('automatic GPS centers once while an explicit locate request always centers', async () => {
  const { decideUserLocationUpdate } = await load('../src/features/client/map/mapViewportPolicy.ts');
  assert.deepEqual(decideUserLocationUpdate(false, 'automatic'), { shouldCenter: true, hasAutoCentered: true });
  assert.deepEqual(decideUserLocationUpdate(true, 'automatic'), { shouldCenter: false, hasAutoCentered: true });
  assert.deepEqual(decideUserLocationUpdate(true, 'explicit'), { shouldCenter: true, hasAutoCentered: true });
});
