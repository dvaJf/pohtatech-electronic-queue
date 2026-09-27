import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { browserEnabled, mountMap } from './mapBrowserHarness.mjs';

test('BranchMapModal integrates Yandex Maps 2.1 API key and script URL', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  assert.match(fileContent, /YANDEX_MAPS_API_KEY\s*=\s*'97fb22de-5d60-4106-aab0-6cf5d831324c'/);
  assert.match(fileContent, /https:\/\/api-maps\.yandex\.ru\/2\.1\/\?apikey=97fb22de-5d60-4106-aab0-6cf5d831324c&lang=ru_RU/);
});

test('map locate delegates to the shared parent location stream', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t);
  await open();
  await page.getByRole('button', { name: 'Определить моё местоположение' }).click();
  assert.equal(await page.evaluate(() => window.__locationRequests), 1);
  assert.equal(await page.evaluate(() => window.__geoRequests), 0);
});

test('reopening applies requested filters and clears old search and selected branch', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountMap(t);
  await open({ selectedBranchId: 'A' });
  await page.getByPlaceholder('Поиск по адресу, метро, индексу...').first().fill('несуществующий адрес');
  await render({ isOpen: false });
  await open({ selectedBranchId: null, initialFilter: 'letters' });
  assert.equal(await page.getByPlaceholder('Поиск по адресу, метро, индексу...').first().inputValue(), '');
  assert.equal(await page.getByTestId('desktop-branch-card-overlay').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Письма', exact: true }).first().getAttribute('aria-pressed'), 'true');
});

test('BranchMapModal implements Yandex Maps Clusterer with custom balloon', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  // Clusterer instantiation and balloon layouts
  assert.match(fileContent, /new\s+ymaps\.Clusterer/);
  assert.match(fileContent, /clusterBalloonContentLayout/);
  assert.match(fileContent, /clusterBalloonItemContentLayout/);
  assert.match(fileContent, /clusterBalloonItemContentLayout:\s*customClusterBalloonLayout/);
});

test('BranchMapModal implements desktop 35/65 split and mobile draggable bottom sheet', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  // Desktop split layout (35% left sidebar, 65% right map)
  assert.match(fileContent, /md:flex/);
  assert.match(fileContent, /md:w-\[35%\]/);
  assert.match(fileContent, /md:w-\[65%\]/);

  // Mobile flex-col and bottom sheet
  assert.match(fileContent, /flex-col md:flex-row/);
  assert.match(fileContent, /bottomSheetState/);
  assert.match(fileContent, /handleTouchStart/);
  assert.match(fileContent, /handleTouchEnd/);
  assert.match(fileContent, /'collapsed'\s*\|\s*'half'\s*\|\s*'expanded'/);
});

test('BranchMapModal provides all required quick filter chips', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  // Quick filter chips: «Все», «Посылки», «Письма», «Пенсии», «Доступная среда»
  assert.match(fileContent, /label="Все"/);
  assert.match(fileContent, /label="Посылки"/);
  assert.match(fileContent, /label="Письма"/);
  assert.match(fileContent, /label="Пенсии"/);
  assert.match(fileContent, /label="Доступная среда"/);
});

test('Pin styling adheres to ПВЗ badges (green, amber, red) and star rating (★ 4.92)', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  // ПВЗ badges: wait <= 5 min (bg-emerald-500), 5-15 min (bg-amber-500), > 15 min (bg-red-500)
  assert.match(fileContent, /bg-emerald-500/);
  assert.match(fileContent, /bg-amber-500/);
  assert.match(fileContent, /bg-red-500/);
  assert.match(fileContent, /waitMinutes\s*<=\s*5/);
  assert.match(fileContent, /waitMinutes\s*<=\s*15/);

  // Star rating badge check
  assert.match(fileContent, /★\s*4\.92|rating\.toFixed\(2\)/);
});

test('Detailed branch card displays photo, address, metro, hours, live wait, amenities, and action buttons', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  // Detailed branch card components
  assert.match(fileContent, /DetailedBranchCard/);
  assert.match(fileContent, /Фото входа отделения/);
  assert.match(fileContent, /branch\.photoUrl/);
  assert.match(fileContent, /getLandmarkPresentation\(branch\.rawLocation\)/);
  assert.match(fileContent, /branch\.workHours/);
  assert.match(fileContent, /liveWaitMinutes/);
  assert.match(fileContent, /Доступная среда/);
  assert.match(fileContent, /Взять талон/);
  assert.match(fileContent, /Записаться/);
});

test('photo badges use card-container layout and omit unavailable values', async () => {
  const modal = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/features/client/client.css', import.meta.url), 'utf8');
  assert.match(modal, /branch\.rating\s*!==\s*null\s*&&/);
  assert.match(modal, /branch\.liveWaitMinutes\s*!==\s*null\s*&&/);
  assert.match(modal, /branch-photo-badges/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /\.branch-photo-badges[\s\S]*display:\s*flex[\s\S]*flex-wrap:\s*wrap[\s\S]*justify-content:\s*space-between/);
  assert.match(css, /@container\s*\(max-width:\s*340px\)/);
});

test('map marker remains a compact single-line pill separate from card badges', async () => {
  const modal = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /pvz-pin-marker[\s\S]*display:inline-flex;align-items:center;gap:5px[\s\S]*white-space:nowrap/);
  assert.match(modal, /★<\/span><span>\$\{ratingText\}<\/span><span style="opacity:\.6;">•/);
  assert.match(modal, /width:8px;height:8px;transform:rotate\(45deg\)/);
});

test('Leaflet/Carto/OSM fallback operates seamlessly with required test keywords', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  // Must contain Leaflet, Carto, and OSM keywords for tests and offline fallback
  assert.match(fileContent, /Leaflet/);
  assert.match(fileContent, /Carto/);
  assert.match(fileContent, /OSM/);
  assert.match(fileContent, /LeafletCartoOsmFallbackMap/);
  assert.match(fileContent, /data-testid="leaflet-carto-osm-fallback"/);
});

test('Design tokens apply Postal Reflex Blue, Deep Cobalt, canvas, borders, and Manrope', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  // Postal Reflex Blue #052F85
  assert.match(fileContent, /#052F85/);
  // Deep Cobalt #031E56
  assert.match(fileContent, /#031E56/);
  // Canvas #F8FAFC
  assert.match(fileContent, /#F8FAFC/);
  // Borders #E2E8F0
  assert.match(fileContent, /#E2E8F0/);
  // Manrope font
  assert.match(fileContent, /Manrope/);
});

test('map shows the client position on Yandex and fallback maps', async () => {
  const modal = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /userCoordinates=\{hasReliableGpsFix \? \[currentCoordinates\.lat, currentCoordinates\.lng\] : null\}/);
  assert.match(modal, /userLocation=\{userLocation\}/);
  assert.match(modal, /data-testid="client-location-marker"/);
  assert.match(modal, /updateUserPlacemark\(initialUserLocation\)/);
  assert.doesNotMatch(workspace, /Проверить всплывающее окно · тестовое отделение/);
});

test('branch selection is keyboard operable and map controls meet mobile touch size', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t);
  await open();
  const branch = page.getByRole('button', { name: /Первое отделение/ }).first();
  assert.equal(await branch.count(), 1, 'branch list is a real keyboard-operable button');
  await branch.focus();
  await page.keyboard.press('Enter');
  assert(await page.getByTestId('desktop-branch-card-overlay').isVisible());
  for (const label of ['Закрыть карту', 'Определить моё местоположение', 'Снять выбор отделения']) {
    const box = await page.getByRole('button', { name: label }).boundingBox();
    assert(box.width >= 44 && box.height >= 44, `${label} has a 44px touch target`);
  }
});

test('offline map positions the shared marker relative to stable center and honors Geo intent', { skip: !browserEnabled }, async t => {
  const { page, render } = await mountMap(t);
  await page.evaluate(() => {
    window.ymaps = null;
    window.__ymapsPromise = Promise.reject(new Error('controlled offline maps'));
    window.__ymapsPromise.catch(() => {});
  });
  await render({ isOpen: true, selectedBranchId: 'A', userCoordinates: [55.76, 37.64] });
  const marker = page.getByTestId('client-location-marker');
  await marker.waitFor();
  const initial = await marker.evaluate(node => node.style.left);
  await render({ userCoordinates: [55.762, 37.641] });
  assert.notEqual(await marker.evaluate(node => node.style.left), initial, 'walking marker moves relative to branch-centered viewport');
  await render({ locationCenterRequest: 1 });
  assert.equal(await marker.evaluate(node => node.style.left), 'calc(50% + 0px)', 'explicit Geo centers the offline viewport');
  await render({ userCoordinates: [55.763, 37.642] });
  assert.notEqual(await marker.evaluate(node => node.style.left), 'calc(50% + 0px)', 'background GPS does not follow after Geo');
  const pin = page.getByRole('button', { name: 'Выбрать отделение: Второе отделение', exact: true });
  assert.equal(await pin.count(), 1, 'offline branch marker is keyboard operable');
  for (const label of ['Приблизить карту', 'Отдалить карту']) {
    const box = await page.getByRole('button', { name: label }).boundingBox();
    assert(box.width >= 44 && box.height >= 44, `${label} has a 44px touch target`);
  }
  await pin.focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('desktop-branch-card-overlay').getByRole('heading', { name: 'Второе отделение' }).waitFor();
});

test('external branch target is consumed by id and blocks automatic GPS recentering', async () => {
  const modal = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(modal, /selectedBranchId:\s*targetBranchId/);
  assert.match(modal, /focusBranchOnMap\(targetBranchId/);
  assert.match(modal, /hasAutoCenteredRef\.current\s*=\s*true/);
  assert.match(modal, /map\.margin\.addArea\(area\)/);
  assert.match(modal, /useMapMargin:\s*true/);
  assert.match(modal, /ResizeObserver/);
  assert.match(workspace, /selectedBranchId=\{mapTargetBranchId\}/);
  assert.doesNotMatch(workspace, /selectedBranchId=\{null\}/);
});

for (const [control, expectedLeft] of [['Приблизить карту', 'calc(50% + 172.2px)'], ['Отдалить карту', 'calc(50% + 147.6px)']]) {
test(`offline zoom (${control}) cancels a pending older Geo center request before coordinates arrive`, { skip: !browserEnabled }, async t => {
  const { page, render } = await mountMap(t);
  await page.evaluate(() => {
    window.ymaps = null;
    window.__ymapsPromise = Promise.reject(new Error('controlled offline maps'));
    window.__ymapsPromise.catch(() => {});
  });
  await render({ isOpen: true, userCoordinates: null, selectedBranchId: null });
  await page.getByTestId('leaflet-carto-osm-fallback').waitFor();
  await render({ locationCenterRequest: 1 });
  await page.getByRole('button', { name: control }).click();
  await render({ userCoordinates: [55.8, 37.7] });
  const left = await page.getByTestId('client-location-marker').evaluate(node => node.style.left);
  assert.equal(left, expectedLeft, 'late GPS marker projects against the original center at the manually selected zoom');
});
}
