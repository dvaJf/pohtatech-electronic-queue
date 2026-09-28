import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('compact nearby card displays proximity and sends the same branch ID to ticket, details, and dismissal', async () => {
  let source = await readFile(new URL('../src/features/client/arrival/NearbyBranchCard.tsx', import.meta.url), 'utf8').catch(() => '');
  assert.ok(source, 'compact nearby card is required');
  globalThis.__nearbyReact = React;
  source = source.replace(/import React from 'react';/, 'const React = globalThis.__nearbyReact;');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const { NearbyBranchCard } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const actions = [];
  const element = NearbyBranchCard({ branch: { id: 'B', name: 'Отделение B' }, distanceMeters: 25,
    onTakeTicket: id => actions.push(['ticket', id]), onDetails: id => actions.push(['details', id]),
    onDismiss: id => actions.push(['dismiss', id]) });
  const html = renderToStaticMarkup(element);
  assert.match(html, /Отделение B/);
  assert.match(html, /25 м/);
  assert.doesNotMatch(html, /role="dialog"/);
  const buttons = [];
  const visit = node => {
    if (!React.isValidElement(node)) return;
    if (node.type === 'button') buttons.push(node);
    React.Children.forEach(node.props.children, visit);
  };
  visit(element);
  const find = label => buttons.find(button => button.props['aria-label'] === label || renderToStaticMarkup(button).includes(label));
  find('Взять талон').props.onClick();
  find('Подробнее').props.onClick();
  find('Закрыть предложение отделения рядом').props.onClick();
  assert.deepEqual(actions, [['ticket', 'B'], ['details', 'B'], ['dismiss', 'B']]);
  delete globalThis.__nearbyReact;
});

async function loadTS(path) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  source = source.replace(/import\s+.*?\s+from\s+['"]react['"];?/g, 'const useState = () => [null, () => {}], useEffect = () => {}, useMemo = (f) => f(), useCallback = (f) => f();');
  source = source.replace(/import\s+.*?\s+from\s+['"].*?branchLocations['"];?/g, 'const MOSCOW_BRANCHES = [];');
  const geolocation = await readFile(new URL('../src/features/client/map/geolocation.ts', import.meta.url), 'utf8');
  const geolocationJs = ts.transpileModule(geolocation, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
  source = source.replace("'../map/geolocation'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(geolocationJs).toString('base64')));
  const policy = await readFile(new URL('../src/features/client/arrival/arrivalPolicy.ts', import.meta.url), 'utf8');
  const policyJs = ts.transpileModule(policy, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  source = source.replace("'./arrivalPolicy'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(policyJs).toString('base64')));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

async function loadPolicy() {
  const source = await readFile(new URL('../src/features/client/arrival/arrivalPolicy.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}

test('nearby visit opens on the initial inside fix and on outside-to-inside movement', async () => {
  const { updateNearbyVisits } = await loadPolicy();
  assert.equal(typeof updateNearbyVisits, 'function', 'branch visit policy is required');
  const empty = { visits: {}, activeBranchId: null };
  assert.equal(updateNearbyVisits(empty, [{ id: 'A', distanceMeters: 15 }]).activeBranchId, 'A');
  const outside = updateNearbyVisits(empty, [{ id: 'A', distanceMeters: 150 }]);
  assert.equal(outside.activeBranchId, null);
  assert.equal(updateNearbyVisits(outside, [{ id: 'A', distanceMeters: 75 }]).activeBranchId, 'A');
});

test('dismissal survives the current A visit and hysteresis, then resets after exit', async () => {
  const { updateNearbyVisits, dismissNearbyVisit } = await loadPolicy();
  assert.equal(typeof updateNearbyVisits, 'function', 'branch visit policy is required');
  const inside = updateNearbyVisits({ visits: {}, activeBranchId: null }, [{ id: 'A', distanceMeters: 20 }]);
  assert.equal(updateNearbyVisits(inside, [{ id: 'A', distanceMeters: 100 }]).activeBranchId, 'A');
  const dismissed = dismissNearbyVisit(inside, 'A');
  assert.equal(updateNearbyVisits(dismissed, [{ id: 'A', distanceMeters: 25 }]).activeBranchId, null);
  assert.equal(updateNearbyVisits(dismissed, [{ id: 'A', distanceMeters: 120 }]).activeBranchId, null);
  const exited = updateNearbyVisits(dismissed, [{ id: 'A', distanceMeters: 121 }]);
  assert.equal(updateNearbyVisits(exited, [{ id: 'A', distanceMeters: 25 }]).activeBranchId, 'A');
});

test('A dismissal cannot suppress entry into B, and unreliable fixes hide without resetting a visit', async () => {
  const { updateNearbyVisits, dismissNearbyVisit } = await loadPolicy();
  assert.equal(typeof updateNearbyVisits, 'function', 'branch visit policy is required');
  const entered = updateNearbyVisits({ visits: {}, activeBranchId: null }, [{ id: 'A', distanceMeters: 20 }]);
  const dismissed = dismissNearbyVisit(entered, 'A');
  const b = updateNearbyVisits(dismissed, [{ id: 'A', distanceMeters: 100 }, { id: 'B', distanceMeters: 10 }]);
  assert.equal(b.activeBranchId, 'B');
  const stale = updateNearbyVisits(dismissed, [{ id: 'A', distanceMeters: 200 }], false);
  assert.equal(stale.activeBranchId, null);
  assert.equal(updateNearbyVisits(stale, [{ id: 'A', distanceMeters: 15 }]).activeBranchId, null);
});

test('nearby card gate opens only after ticket loading confirms there is no active ticket', async () => {
  const { canShowNearbyBranchCard } = await loadPolicy();
  assert.equal(canShowNearbyBranchCard(true, false), false);
  assert.equal(canShowNearbyBranchCard(true, true), false);
  assert.equal(canShowNearbyBranchCard(false, true), false);
  assert.equal(canShowNearbyBranchCard(false, false), true);
});

test('useGeofencing exports presets, 75m threshold and calculates accurate meters', async () => {
  const {
    calculateHaversineDistanceMeters,
    DEFAULT_GEOFENCE_THRESHOLD_METERS,
    GEOFENCE_PRESETS,
  } = await loadTS('../src/features/client/arrival/useGeofencing.ts');

  assert.equal(DEFAULT_GEOFENCE_THRESHOLD_METERS, 75);
  assert.ok(GEOFENCE_PRESETS.near_101000);
  assert.ok(GEOFENCE_PRESETS.home_1500m);

  // Myasnitskaya 26: 55.761845, 37.638521
  // near_101000: 55.76194, 37.63869 -> distance should be ~14-16m (<= 75m threshold)
  const dNear = calculateHaversineDistanceMeters(
    55.761845,
    37.638521,
    GEOFENCE_PRESETS.near_101000.lat,
    GEOFENCE_PRESETS.near_101000.lng
  );
  assert.ok(dNear <= 75, `Expected distance <= 75m, got ${dNear}m`);
  assert.ok(dNear >= 10 && dNear <= 25, `Expected distance ~15m, got ${dNear}m`);

  // home_1500m: 55.77139, 37.65548 -> distance should be ~1500m (> 75m threshold)
  const dHome = calculateHaversineDistanceMeters(
    55.761845,
    37.638521,
    GEOFENCE_PRESETS.home_1500m.lat,
    GEOFENCE_PRESETS.home_1500m.lng
  );
  assert.ok(dHome > 75, `Expected home distance > 75m, got ${dHome}m`);
  assert.ok(dHome >= 1400 && dHome <= 1650, `Expected ~1500m, got ${dHome}m`);
});

test('ArrivalSheet implements Yandex Refuel style, 1-click button, radar badge, and chips', async () => {
  const content = await readFile(
    new URL('../src/features/client/arrival/ArrivalSheet.tsx', import.meta.url),
    'utf8'
  );

  // Branch badge text requirement
  assert.match(content, /Вы находитесь в отделении/);
  assert.match(content, /Почта России · \{branchName\}/);
  assert.match(content, /Оценка Яндекс Карт/);
  assert.match(content, /currentWaiting/);
  assert.match(content, /reviewCount/);
  assert.match(content, /Взять талон без терминала/);

  // Radar distance badge requirement
  assert.match(content, /радар|Вы на месте/);

  // Service chips requirement
  assert.match(content, /Посылки/);
  assert.match(content, /Письма/);
  assert.match(content, /Платежи/);
  assert.match(content, /Отправка писем и посылок/);
  assert.match(content, /getServiceIcon\(service\)/);
  assert.match(content, /React\.createElement\(getServiceIcon\(service\)/);
  assert.match(content, /платеж\|оплат\|штраф\|перевод\|payment/);
  assert.match(content, /почтов\(\?:ый\|ые\|ых\) товар/);
  assert.match(content, /отправ\|send\|исходящ/);
  assert.match(content, /письм\|конверт\|mail/);
  assert.match(content, /посыл\|бандерол\|parcel/);

  // 1-click button requirement
  assert.match(content, /Получить талон в 1 клик/);
  assert.match(content, /#052F85|#0055A5/);

  // Debug Geo-switch toggle for jury demo
  assert.match(content, /near_101000/);
  assert.match(content, /home_1500m/);
  assert.match(content, /real_gps/);
});

test('ClientWorkspace integrates shared geolocation, nearby card and branch map', async () => {
  const content = await readFile(
    new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url),
    'utf8'
  );

  assert.match(content, /useGeofencing/);
  assert.match(content, /NearbyBranchCard/);
  assert.match(content, /BranchMapModal/);
  assert.match(content, /calculatePersonalRouting/);
  assert.match(content, /smartRouting\.recommendation/);
  assert.match(content, /Умный маршрут/);
  assert.match(content, /Карта отделений/);
  assert.match(content, /handleRepeatTicket/);
});
