import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('online booking previews five branches and exposes every search match', async () => {
  const { getBookingBranchOptions } = await load('../src/features/client/branchOptions.ts');
  const branches = Array.from({ length: 11 }, (_, index) => ({ id: `b${index}`, name: `Отделение ${index}` }));
  assert.deepEqual(getBookingBranchOptions(branches, '').map(branch => branch.id), ['b0', 'b1', 'b2', 'b3', 'b4']);
  assert.equal(getBookingBranchOptions(branches, ' отделение ').length, 11);
  assert.equal(getBookingBranchOptions([], 'запрос').length, 0);
});
