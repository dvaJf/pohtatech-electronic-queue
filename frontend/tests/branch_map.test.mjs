import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('BranchMapModal integrates Yandex Maps 2.1 API key and script URL', async () => {
  const fileContent = await readFile(
    new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url),
    'utf8'
  );

  assert.match(fileContent, /YANDEX_MAPS_API_KEY\s*=\s*'97fb22de-5d60-4106-aab0-6cf5d831324c'/);
  assert.match(fileContent, /https:\/\/api-maps\.yandex\.ru\/2\.1\/\?apikey=97fb22de-5d60-4106-aab0-6cf5d831324c&lang=ru_RU/);
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
  assert.match(fileContent, /branch\.metro/);
  assert.match(fileContent, /branch\.workHours/);
  assert.match(fileContent, /liveWaitMinutes/);
  assert.match(fileContent, /Доступная среда/);
  assert.match(fileContent, /Взять талон/);
  assert.match(fileContent, /Записаться/);
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
  assert.match(workspace, /userCoordinates=\{hasRealGpsFix \? \[currentCoordinates\.lat, currentCoordinates\.lng\] : null\}/);
  assert.match(modal, /userLocation=\{userLocation\}/);
  assert.match(modal, /data-testid="client-location-marker"/);
  assert.match(modal, /renderUserLocation\(userLocationRef\.current\)/);
  assert.doesNotMatch(workspace, /Проверить всплывающее окно · тестовое отделение/);
});

test('client requests GPS on entry and opens the arrival sheet from a live nearby fix', async () => {
  const workspace = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  const geofence = await readFile(new URL('../src/features/client/arrival/useGeofencing.ts', import.meta.url), 'utf8');
  assert.match(workspace, /initialMode:\s*'real_gps'/);
  assert.match(workspace, /if \(isInsideGeofence && activeBranchInsideGeofence\)[\s\S]*?setIsArrivalSheetOpen\(true\)/);
  assert.match(geofence, /if \(simulationMode === 'real_gps'\)[\s\S]*?requestGpsPermission\(\)[\s\S]*?watchPosition/);
});
