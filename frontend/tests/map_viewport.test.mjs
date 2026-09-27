import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { browserEnabled, mountMap } from './mapBrowserHarness.mjs';

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

test('explicit center sequence is consumed only with coordinates and only once', async () => {
  const policy = await load('../src/features/client/map/mapViewportPolicy.ts');
  assert.equal(typeof policy.decideLocationCenterRequest, 'function');
  assert.deepEqual(policy.decideLocationCenterRequest(2, 3, false), { shouldCenter: false, consumedSequence: 2 });
  assert.deepEqual(policy.decideLocationCenterRequest(2, 3, true), { shouldCenter: true, consumedSequence: 3 });
  assert.deepEqual(policy.decideLocationCenterRequest(3, 3, true), { shouldCenter: false, consumedSequence: 3 });
});

test('manual viewport survives walking GPS and resize while Geo intent centers only once', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountMap(t);
  await open({ userCoordinates: [55.761, 37.638], selectedBranchId: 'A' });
  await page.evaluate(() => { const map = window.__maps.at(-1); map.center = [55.7, 37.5]; map.zoom = 11; map.handlers.actionbegin?.({ get: () => ({ originalEvent: {} }) }); map.pans = []; });
  await render({ userCoordinates: [55.762, 37.639] });
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => ({ center: window.__maps.at(-1).center, zoom: window.__maps.at(-1).zoom })), { center: [55.7, 37.5], zoom: 11 });
  await render({ locationCenterRequest: 1 });
  assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).center), [55.762, 37.639]);
  assert.equal(await page.evaluate(() => window.__maps.at(-1).pans.length), 1);
  await render({ userCoordinates: [55.763, 37.64] });
  assert.equal(await page.evaluate(() => window.__maps.at(-1).pans.length), 1);
  assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).geoObjects.items.find(item => item.coords).coords), [55.763, 37.64]);
});

test('manual pan cancels delayed branch zoom completion and resize cannot revive it', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t);
  await open();
  await page.evaluate(() => { const map = window.__maps.at(-1); map.zoom = 11; map.deferZoom = true; });
  await page.getByText('Первое отделение', { exact: true }).first().click();
  await page.waitForFunction(() => !!window.__maps.at(-1).resolveZoom);
  await page.evaluate(() => { const map = window.__maps.at(-1); map.center = [55.7, 37.5]; map.handlers.actionbegin?.({ get: () => ({ originalEvent: {} }) }); map.resolveZoom(); });
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).center), [55.7, 37.5]);
});

test('close and new focus discard delayed map operations', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountMap(t);
  await open();
  await page.evaluate(() => { const map = window.__maps.at(-1); map.zoom = 11; map.deferZoom = true; });
  await page.getByText('Первое отделение', { exact: true }).first().click();
  await page.waitForFunction(() => !!window.__maps.at(-1).resolveZoom);
  await render({ isOpen: false });
  await page.evaluate(() => window.__maps[0].resolveZoom());
  await open({ selectedBranchId: 'B' });
  assert.equal(await page.evaluate(() => window.__maps[0].pans.length), 0);
  assert(await page.getByTestId('desktop-branch-card-overlay').getByText('Второе отделение', { exact: true }).isVisible());
});

test('map pointer interaction cancels a pending Geo pan completion', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountMap(t);
  await open({ userCoordinates: [55.761, 37.638] });
  await page.evaluate(() => { window.__maps.at(-1).deferPan = true; });
  await render({ locationCenterRequest: 1 });
  await page.getByTestId('branch-map-canvas').dispatchEvent('pointerdown');
  await page.evaluate(() => { const map = window.__maps.at(-1); map.zoom = 11; map.resolvePan(); });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__maps.at(-1).zoom), 11, 'manual map interaction cancels pending GPS zoom');
});

test('new branch focus supersedes a Geo request still waiting for coordinates', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountMap(t);
  await open();
  await render({ locationCenterRequest: 1 });
  await page.getByText('Второе отделение', { exact: true }).first().click();
  await page.waitForTimeout(80);
  const branchCenter = await page.evaluate(() => window.__maps.at(-1).center);
  await render({ userCoordinates: [55.8, 37.7] });
  assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).center), branchCenter, 'a late GPS fix cannot overwrite the newer branch focus');
});

test('new focus invalidates the previous branch zoom promise', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t);
  await open();
  await page.evaluate(() => { const map = window.__maps.at(-1); map.zoom = 11; map.deferZoom = true; });
  await page.getByText('Первое отделение', { exact: true }).first().click();
  await page.waitForFunction(() => !!window.__maps.at(-1).resolveZoom);
  await page.getByText('Второе отделение', { exact: true }).first().click();
  await page.evaluate(() => window.__maps.at(-1).resolveZoom());
  await page.waitForTimeout(80);
  assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).pans.map(pan => pan.coords)), [[55.76148, 37.62512]], 'only the latest focused branch receives a pan');
});

test('manual movement cancels an opening target that becomes available later', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountMap(t);
  await open({ selectedBranchId: 'A', branches: [] });
  await page.getByTestId('branch-map-canvas').dispatchEvent('pointerdown');
  await page.evaluate(() => { window.__maps.at(-1).center = [55.7, 37.5]; });
  await render({ branches: [{ id: 'A', name: 'Первое отделение', address: 'г. Москва, ул. Мясницкая, д. 26', workHours: '08:00–22:00' }] });
  assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).center), [55.7, 37.5], 'late branch data cannot restore cancelled opening focus');
});

test('explicit Geo supersedes an opening target that becomes available later', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountMap(t);
  await open({ selectedBranchId: 'A', branches: [] });
  await render({ locationCenterRequest: 1, userCoordinates: [55.8, 37.7] });
  await render({ branches: [{ id: 'A', name: 'Первое отделение', address: 'г. Москва, ул. Мясницкая, д. 26', workHours: '08:00–22:00' }] });
  assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).center), [55.8, 37.7], 'late opening data cannot overwrite newer Geo intent');
});

test('deselecting a branch cancels its delayed zoom completion', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t);
  await open();
  await page.evaluate(() => { const map = window.__maps.at(-1); map.zoom = 11; map.deferZoom = true; });
  await page.getByText('Первое отделение', { exact: true }).first().click();
  await page.waitForFunction(() => !!window.__maps.at(-1).resolveZoom);
  await page.getByRole('button', { name: 'Снять выбор отделения' }).click();
  await page.evaluate(() => window.__maps.at(-1).resolveZoom());
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.__maps.at(-1).pans.length), 0, 'dismissed branch focus cannot pan later');
});
