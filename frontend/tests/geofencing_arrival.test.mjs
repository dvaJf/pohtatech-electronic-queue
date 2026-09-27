import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTS(path) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  source = source.replace(/import\s+.*?\s+from\s+['"]react['"];?/g, 'const useState = () => [null, () => {}], useEffect = () => {}, useMemo = (f) => f(), useCallback = (f) => f();');
  source = source.replace(/import\s+.*?\s+from\s+['"].*?branchLocations['"];?/g, 'const MOSCOW_BRANCHES = [];');
  source = source.replace(/import\s+\{\s*getCurrentPositionFast\s*\}\s+from\s+['"]..\/map\/geolocation['"];?/, 'const getCurrentPositionFast = () => Promise.reject(new Error("unused in unit test"));');
  const policy = await readFile(new URL('../src/features/client/arrival/arrivalPolicy.ts', import.meta.url), 'utf8');
  const policyJs = ts.transpileModule(policy, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  source = source.replace("'./arrivalPolicy'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(policyJs).toString('base64')));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

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

test('ClientWorkspace integrates Geofencing, ArrivalSheet, and BranchMapModal seamlessly', async () => {
  const content = await readFile(
    new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url),
    'utf8'
  );

  assert.match(content, /useGeofencing/);
  assert.match(content, /ArrivalSheet/);
  assert.match(content, /BranchMapModal/);
  assert.match(content, /calculateSmartRouting/);
  assert.match(content, /smartRouting\.recommendation/);
  assert.match(content, /Умный маршрут/);
  assert.match(content, /Карта отделений/);
  assert.match(content, /handleArrivalGetTicket/);
});
