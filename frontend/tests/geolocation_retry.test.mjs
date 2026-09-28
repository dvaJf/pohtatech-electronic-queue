import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { mountGeofencing } from './geofencingHarness.mjs';

test('initial prompt request starts one shared watcher, publishes walking fixes, and cleans up on simulation and unmount', async () => {
  let watchers = 0;
  let lookups = 0;
  let walkingFix;
  const cleared = [];
  const geo = {
    getCurrentPosition(success) { lookups++; success({ coords: { latitude: 55.71, longitude: 37.6, accuracy: 5 }, timestamp: Date.now() }); },
    watchPosition(success) { walkingFix = success; return ++watchers; },
    clearWatch(id) { cleared.push(id); },
  };
  const hook = await mountGeofencing(geo);
  try {
    let state = hook.render();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(watchers, 1, 'prompt permission starts the browser geolocation request automatically');
    assert.equal(lookups, 1, 'the initial position is requested without a Geo-button click');
    state.requestGpsPermission({ centerMap: true });
    state.requestGpsPermission();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(watchers, 1, 'one authoritative watcher is required');
    assert.equal(lookups, 1, 'rerenders and explicit actions reuse the fresh shared fix');
    state = hook.render();
    assert.equal(state.isInsideGeofence, false);
    assert.equal(state.locationCenterRequest, 1);
    walkingFix({ coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: Date.now() });
    state = hook.render();
    assert.equal(state.activeBranchInsideGeofence?.id, 'A');
    state.setSimulationMode('real_gps');
    hook.render();
    assert.deepEqual(cleared, [], 'selecting the current mode preserves its active watcher');
    state.setSimulationMode('near_101000');
    hook.render();
    assert.deepEqual(cleared, [1]);
    state.setSimulationMode('real_gps'); hook.render();
    hook.render().requestGpsPermission();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(watchers, 2);
  } finally { hook.unmount(); }
  assert.deepEqual(cleared, [1, 2]);
});

test('automatic GPS lookup does not depend on the Permissions API', async () => {
  let lookups = 0;
  let watchers = 0;
  const geo = {
    getCurrentPosition(success) {
      lookups++;
      success({ coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: Date.now() });
    },
    watchPosition() { return ++watchers; },
    clearWatch() {},
  };
  const hook = await mountGeofencing(geo, 'unavailable');
  try {
    hook.render();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lookups, 1, 'a normal geolocation lookup is still attempted');
    assert.equal(watchers, 1, 'the shared watcher starts after the initial lookup');
    assert.equal(hook.render().hasReliableGpsFix, true);
  } finally { hook.unmount(); }
});

test('denied permission never starts a retry loop on rerender', async () => {
  let lookups = 0;
  const geo = {
    getCurrentPosition() { lookups++; },
    watchPosition() { throw new Error('watch must not start after denial'); },
    clearWatch() {},
  };
  const hook = await mountGeofencing(geo, 'denied');
  try {
    hook.render();
    await new Promise(resolve => setImmediate(resolve));
    hook.render();
    hook.render();
    assert.equal(lookups, 0);
    assert.equal(hook.render().gpsPermissionStatus, 'denied');
  } finally { hook.unmount(); }
});

test('granted permission restores one watcher and permission denial clears it', async () => {
  let watchers = 0;
  let denied;
  const cleared = [];
  const geo = {
    getCurrentPosition(success) { success({ coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: Date.now() }); },
    watchPosition(_success, error) { denied = error; return ++watchers; },
    clearWatch(id) { cleared.push(id); },
  };
  const hook = await mountGeofencing(geo, 'granted');
  try {
    hook.render(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(watchers, 1);
    assert.equal(hook.render().isInsideGeofence, true);
    denied({ code: 1, message: 'denied' });
    assert.equal(hook.render().gpsPermissionStatus, 'denied');
    assert.equal(hook.render().hasRealGpsFix, false);
    assert.deepEqual(cleared, [1]);
  } finally { hook.unmount(); }
});

for (const outcome of ['granted', 'rejected']) {
  test(`late permission query ${outcome} completion preserves watcher denial without restarting GPS`, async () => {
    let watchers = 0;
    let denyWatch;
    let resolvePermission;
    let rejectPermission;
    const pendingPermission = new Promise((resolve, reject) => { resolvePermission = resolve; rejectPermission = reject; });
    const cleared = [];
    const geo = {
      getCurrentPosition(success) { success({ coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: Date.now() }); },
      watchPosition(_success, error) { denyWatch = error; return ++watchers; },
      clearWatch(id) { cleared.push(id); },
    };
    const hook = await mountGeofencing(geo, () => pendingPermission);
    try {
      hook.render().requestGpsPermission();
      await new Promise(resolve => setImmediate(resolve));
      denyWatch({ code: 1, message: 'denied' });
      assert.equal(hook.render().gpsPermissionStatus, 'denied');
      if (outcome === 'granted') resolvePermission({ state: 'granted' });
      else rejectPermission(new Error('permission query failed'));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(watchers, 1, 'stale permission query cannot restart tracking after denial');
      assert.equal(hook.render().gpsPermissionStatus, 'denied', 'stale permission query cannot replace denial state');
      assert.deepEqual(cleared, [1]);
    } finally { hook.unmount(); }
  });
}

test('late permission query rejection cannot replace an explicit successful GPS grant', async () => {
  let rejectPermission;
  const pendingPermission = new Promise((_resolve, reject) => { rejectPermission = reject; });
  const geo = {
    getCurrentPosition(success) { success({ coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: Date.now() }); },
    watchPosition() { return 1; },
    clearWatch() {},
  };
  const hook = await mountGeofencing(geo, () => pendingPermission);
  try {
    hook.render().requestGpsPermission();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hook.render().gpsPermissionStatus, 'granted');
    rejectPermission(new Error('permission query failed'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hook.render().gpsPermissionStatus, 'granted');
  } finally { hook.unmount(); }
});

test('a delayed cached lookup cannot overwrite a newer walking fix or publish after simulation', async () => {
  let lookupFix;
  let walkingFix;
  const geo = {
    getCurrentPosition(success) { lookupFix = success; },
    watchPosition(success) { walkingFix = success; return 1; },
    clearWatch() {},
  };
  const hook = await mountGeofencing(geo);
  try {
    hook.render().requestGpsPermission();
    const now = Date.now();
    lookupFix({ coords: { latitude: 55.71, longitude: 37.6, accuracy: 5 }, timestamp: now - 1000 });
    await new Promise(resolve => setImmediate(resolve));
    walkingFix({ coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: now });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hook.render().currentCoordinates.lat, 55.7, 'newer position remains authoritative');
    hook.render().setSimulationMode('home_1500m'); hook.render();
    walkingFix({ coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: now + 1000 });
    assert.equal(hook.render().currentCoordinates.lat, 55.77139);
  } finally { hook.unmount(); }
});

test('shared position validation rejects invalid coordinates and measurements', async () => {
  const { isUsableGeoPosition } = await load('../src/features/client/map/geolocation.ts');
  assert.equal(typeof isUsableGeoPosition, 'function', 'shared position validation is required');
  const valid = { coords: { latitude: 55.7, longitude: 37.6, accuracy: 5 }, timestamp: 1000 };
  assert.equal(isUsableGeoPosition(valid), true);
  for (const coords of [
    { latitude: NaN, longitude: 37.6, accuracy: 5 },
    { latitude: 91, longitude: 37.6, accuracy: 5 },
    { latitude: 55.7, longitude: 181, accuracy: 5 },
    { latitude: 55.7, longitude: 37.6, accuracy: -1 },
  ]) assert.equal(isUsableGeoPosition({ ...valid, coords }), false);
  assert.equal(isUsableGeoPosition({ ...valid, timestamp: NaN }), false);
});

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('location lookup requests one fast cached-or-network fix', async () => {
  const { getCurrentPositionFast } = await load('../src/features/client/map/geolocation.ts');
  const options = [];
  const geolocation = { getCurrentPosition(success, _error, config) {
    options.push(config);
    success({ coords: { latitude: 55.7, longitude: 37.6 }, timestamp: 123 });
  } };
  const position = await getCurrentPositionFast(geolocation);
  assert.equal(position.coords.latitude, 55.7);
  assert.equal(options.length, 1);
  assert.equal(options[0].enableHighAccuracy, false);
  assert.ok(options[0].timeout <= 6000);
  assert.ok(options[0].maximumAge >= 30000);
});

test('location lookup does not retry when the user denied permission', async () => {
  const { getCurrentPositionFast } = await load('../src/features/client/map/geolocation.ts');
  let attempts = 0;
  const geolocation = { getCurrentPosition(_success, error) { attempts++; error({ code: 1, message: 'denied' }); } };
  await assert.rejects(getCurrentPositionFast(geolocation), error => error.code === 1);
  assert.equal(attempts, 1);
});

test('concurrent consumers share one browser geolocation request', async () => {
  const { getCurrentPositionFast } = await load('../src/features/client/map/geolocation.ts');
  let attempts = 0;
  let release;
  const geolocation = { getCurrentPosition(success) {
    attempts++;
    release = () => success({ coords: { latitude: 55.7, longitude: 37.6 }, timestamp: 123 });
  } };
  const first = getCurrentPositionFast(geolocation);
  const second = getCurrentPositionFast(geolocation);
  assert.equal(attempts, 1);
  release();
  assert.equal(await first, await second);
});
