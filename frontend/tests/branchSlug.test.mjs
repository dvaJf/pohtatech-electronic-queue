import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadTS(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

const {
  resolveBranchIdFromPostalCode,
  getBranchPostalCode,
  getBranchDisplayName,
} = await loadTS('../src/utils/branchSlug.ts');

test('resolveBranchIdFromPostalCode resolves official Russian Post 6-digit postal indexes', () => {
  // 101000 — Москва, Главпочтамт, Мясницкая 26
  assert.equal(resolveBranchIdFromPostalCode('101000'), '11111111-1111-1111-1111-111111111111');
  // 390000 — Рязань, ул. Ленина 20 (демо в БД)
  assert.equal(resolveBranchIdFromPostalCode('390000'), '11111111-1111-1111-1111-111111111111');

  // 107031 — Москва, Рождественка 10/2
  assert.equal(resolveBranchIdFromPostalCode('107031'), '22222222-2222-2222-2222-222222222222');

  // 105062 — Москва, Покровка 16
  assert.equal(resolveBranchIdFromPostalCode('105062'), '33333333-3333-3333-3333-333333333333');

  // 109012 — Москва, Никольская 8/1
  assert.equal(resolveBranchIdFromPostalCode('109012'), '44444444-4444-4444-4444-444444444444');

  // 125009 — Москва, Тверская 9
  assert.equal(resolveBranchIdFromPostalCode('125009'), '55555555-5555-5555-5555-555555555555');

  // 119019 — Москва, Новый Арбат 2
  assert.equal(resolveBranchIdFromPostalCode('119019'), '66666666-6666-6666-6666-666666666666');

  // 105064 — Москва, Земляной Вал 33
  assert.equal(resolveBranchIdFromPostalCode('105064'), '88888888-8888-8888-8888-888888888888');

  // 115184 — Москва, Большая Татарская 20
  assert.equal(resolveBranchIdFromPostalCode('115184'), '99999999-9999-9999-9999-999999999999');
});

test('resolveBranchIdFromPostalCode supports text aliases for backward compatibility', () => {
  assert.equal(resolveBranchIdFromPostalCode('demo'), '11111111-1111-1111-1111-111111111111');
  assert.equal(resolveBranchIdFromPostalCode('демо'), '11111111-1111-1111-1111-111111111111');
  assert.equal(resolveBranchIdFromPostalCode('мясницкая'), '11111111-1111-1111-1111-111111111111');
  assert.equal(resolveBranchIdFromPostalCode('рождественка'), '22222222-2222-2222-2222-222222222222');
  assert.equal(resolveBranchIdFromPostalCode('покровка'), '33333333-3333-3333-3333-333333333333');
  assert.equal(resolveBranchIdFromPostalCode('тверская'), '55555555-5555-5555-5555-555555555555');
});

test('resolveBranchIdFromPostalCode preserves existing valid UUIDs', () => {
  const customUuid = '99999999-9999-9999-9999-999999999999';
  assert.equal(resolveBranchIdFromPostalCode(customUuid), customUuid);
});

test('getBranchPostalCode returns official 6-digit postal codes', () => {
  assert.equal(getBranchPostalCode('11111111-1111-1111-1111-111111111111'), '101000');
  assert.equal(getBranchPostalCode('22222222-2222-2222-2222-222222222222'), '107031');
  assert.equal(getBranchPostalCode('33333333-3333-3333-3333-333333333333'), '105062');
  assert.equal(getBranchPostalCode('44444444-4444-4444-4444-444444444444'), '109012');
  assert.equal(getBranchPostalCode('55555555-5555-5555-5555-555555555555'), '125009');
  assert.equal(getBranchPostalCode('66666666-6666-6666-6666-666666666666'), '119019');
  assert.equal(getBranchPostalCode('88888888-8888-8888-8888-888888888888'), '105064');
});

test('getBranchDisplayName formats header title with official Russian Post index', () => {
  assert.equal(getBranchDisplayName('101000'), 'ОПС 101000 · Главпочтамт Мясницкая');
  assert.equal(getBranchDisplayName('107031'), 'ОПС 107031 · Отделение Рождественка');
  assert.equal(getBranchDisplayName('105062'), 'ОПС 105062 · Отделение Покровка');
  assert.equal(getBranchDisplayName('119019'), 'ОПС 119019 · Отделение Новый Арбат');
});
