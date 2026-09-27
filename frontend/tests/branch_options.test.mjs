import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('branch pagination supports every allowed page size and clamps invalid pages', async () => {
  const { BRANCH_PAGE_SIZES, paginateBranches } = await load('../src/features/client/branchOptions.ts');
  const branches = Array.from({ length: 11 }, (_, index) => ({ id: `b${index}`, name: `Отделение ${index}` }));
  assert.deepEqual(BRANCH_PAGE_SIZES, [5, 10, 20, 50]);
  assert.deepEqual(paginateBranches(branches, 1, 5), {
    items: branches.slice(0, 5), page: 1, pageSize: 5, totalItems: 11, totalPages: 3, from: 1, to: 5,
  });
  assert.deepEqual(paginateBranches(branches, 3, 5), {
    items: branches.slice(10), page: 3, pageSize: 5, totalItems: 11, totalPages: 3, from: 11, to: 11,
  });
  assert.equal(paginateBranches(branches, 99, 10).page, 2);
  assert.equal(paginateBranches(branches, 1, 50).items.length, 11);
  assert.deepEqual(paginateBranches([], 2, 5), {
    items: [], page: 1, pageSize: 5, totalItems: 0, totalPages: 1, from: 0, to: 0,
  });
});

test('landmark presentation uses structured type and metro line color', async () => {
  const { getLandmarkPresentation } = await load('../src/features/client/branchOptions.ts');
  assert.deepEqual(getLandmarkPresentation({ metro: 'Чистые пруды', metroColor: '#EF161E', landmarkType: 'metro' }), {
    label: 'Чистые пруды', isMetro: true, color: '#EF161E',
  });
  assert.deepEqual(getLandmarkPresentation({ metro: 'пл. Ленина', metroColor: '#0055A5', landmarkType: 'landmark' }), {
    label: 'пл. Ленина', isMetro: false, color: undefined,
  });
  assert.equal(getLandmarkPresentation(undefined), null);
});
