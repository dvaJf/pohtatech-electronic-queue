import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadClientApi() {
  const source = await readFile(new URL('../src/api/client/clientApi.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('listBranches treats omitted rating fields as an unrated branch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    items: [{ id: 'ryazan-1', name: 'Главпочтамт г. Рязань', address: 'ул. Почтовая, д. 49' }],
  }), { headers: { 'Content-Type': 'application/json' } });

  try {
    const { listBranches } = await loadClientApi();
    const branches = await listBranches();
    assert.deepEqual(branches, [{
      id: 'ryazan-1',
      name: 'Главпочтамт г. Рязань',
      address: 'ул. Почтовая, д. 49',
      latitude: undefined,
      longitude: undefined,
      isDemo: false,
      workHours: undefined,
      ratingAverage: null,
      ratingCount: 0,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('listBranches still rejects an invalid rating value', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    items: [{ id: 'ryazan-1', name: 'Главпочтамт г. Рязань', ratingAverage: 'five', ratingCount: 1 }],
  }), { headers: { 'Content-Type': 'application/json' } });

  try {
    const { listBranches } = await loadClientApi();
    await assert.rejects(listBranches(), /Некорректный рейтинг отделения/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
