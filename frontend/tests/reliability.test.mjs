import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function load(path) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  if (path.endsWith('/liveBranches.ts')) {
    const branchSource = await readFile(new URL('../src/features/client/map/branchLocations.ts', import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(branchSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
    source = source.replace("'./branchLocations'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')));
  }
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
test('personal recommendation requires reliable real GPS and never uses neutral or simulated coordinates', async () => {
  const { calculatePersonalRouting } = await load('../src/features/client/map/liveBranches.ts');
  assert.equal(typeof calculatePersonalRouting, 'function');
  const branches = [{ id: 'A', name: 'A', lat: 55.7602, lng: 37.636, serverWaitMinutes: 4,
    activeQueueCount: 1, activeWindows: 1 }];
  const neutral = { lat: 55.7602, lng: 37.636 };
  assert.deepEqual(calculatePersonalRouting(neutral, branches, false, 'real_gps'), { rankedBranches: [] });
  assert.deepEqual(calculatePersonalRouting(neutral, branches, true, 'near_branch'), { rankedBranches: [] });
  assert.deepEqual(calculatePersonalRouting(neutral, branches, false, 'near_branch'), { rankedBranches: [] });
  const result = calculatePersonalRouting(neutral, branches, true, 'real_gps');
  assert.equal(result.recommendation.fastestBranch.id, 'A');
  assert.equal(result.recommendation.fastestBranch.totalMinutes, 4);
  assert.equal(result.recommendation.timeSavedMinutes, 0);
});
test('recommendation appointment action needs confirmed services from the exact branch', async () => {
  const { recommendationActions } = await load('../src/features/client/map/liveBranches.ts');
  assert.equal(typeof recommendationActions, 'function');
  const confirmed = { A: [{ id: 'parcel', code: 'PCL', name: 'Посылки' }], empty: [], failed: null };
  assert.deepEqual(recommendationActions('A', confirmed), ['ticket', 'route', 'appointment']);
  for (const branch of ['B', 'empty', 'failed']) {
    assert.deepEqual(recommendationActions(branch, confirmed), ['ticket', 'route']);
  }
});
test('live workload rejects nonfinite windows and wait durations expressed in the wrong unit', async () => {
  const { liveWaitMinutes } = await load('../src/features/client/map/liveBranches.ts');
  const now = Date.now();
  const workload = { activeWindows: 2, estimatedWaitSeconds: 420, calculatedAt: new Date(now).toISOString() };
  for (const activeWindows of [Number.NaN, Infinity, -1, 0]) {
    assert.equal(liveWaitMinutes({ ...workload, activeWindows }, now), undefined);
  }
  for (const estimatedWaitSeconds of [Number.NaN, Infinity, -1, 1728000]) {
    assert.equal(liveWaitMinutes({ ...workload, estimatedWaitSeconds }, now), undefined);
  }
  assert.equal(liveWaitMinutes({ ...workload, estimatedWaitSeconds: 28800 }, now), 480);
  assert.equal(liveWaitMinutes({ ...workload, estimatedWaitSeconds: 28801 }, now), undefined);
});

const homeBrowserEnabled = !!process.env.HOME_BROWSER_URL;
async function mountHome(t, { accuracy = 5, permission = 'granted', services = 'pending' } = {}) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/queue-browser/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  let serviceRequests = 0;
  let releaseServices;
  await page.route('**/__home_test', route => route.fulfill({ contentType: 'text/html', body: '<div id="fixture"></div>' }));
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const fulfill = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/branches') return fulfill({ items: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Тестовое отделение', address: 'Москва, Тестовая, 1', latitude: 55.76, longitude: 37.636 }] });
    if (path.endsWith('/workload')) return fulfill({ branchId: '11111111-1111-1111-1111-111111111111', currentWaiting: 2, activeWindows: 2, estimatedWaitSeconds: 420, calculatedAt: new Date().toISOString() });
    if (path.endsWith('/services')) {
      serviceRequests++;
      if (services === 'pending') await new Promise(resolve => { releaseServices = resolve; });
      if (services === 'failed') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return fulfill({ items: services === 'empty' ? [] : [{ id: 'parcel', code: 'PCL', name: 'Посылки' }] });
    }
    return fulfill({ items: [] });
  });
  await page.addInitScript(({ accuracy, permission }) => {
    navigator.permissions.query = async () => ({ state: permission });
    window.__publishHomeGps = nextAccuracy => window.__homeWatch?.({ coords: { latitude: 55.7558, longitude: 37.6173, accuracy: nextAccuracy }, timestamp: Date.now() });
    navigator.geolocation.watchPosition = publish => { window.__homeWatch = publish; return 1; };
    navigator.geolocation.clearWatch = () => {};
    navigator.geolocation.getCurrentPosition = publish => publish({ coords: { latitude: 55.7558, longitude: 37.6173, accuracy }, timestamp: Date.now() });
  }, { accuracy, permission });
  await page.goto(`${process.env.HOME_BROWSER_URL}/__home_test`);
  await page.evaluate(async () => {
    const [{ default: React }, { default: ReactDOM }, { ClientWorkspace }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'), import('/src/features/client/ClientWorkspace.tsx'),
      import('/src/tailwind.css'), import('/src/design-system.css'), import('/src/product.css'),
    ]);
    ReactDOM.createRoot(document.querySelector('#fixture')).render(React.createElement(ClientWorkspace));
  });
  await page.getByRole('heading', { name: 'Цифровая очередь', exact: true }).waitFor();
  await page.waitForFunction(() => !!window.__homeWatch || !window.__publishHomeGps);
  return { page, requestCount: () => serviceRequests, confirmServices: () => releaseServices?.() };
}

test('home hides personal recommendation for inaccurate GPS and simulated locations', { skip: !homeBrowserEnabled }, async t => {
  const { page } = await mountHome(t, { accuracy: 150, services: 'empty' });
  assert.equal(await page.getByText('Умный маршрут', { exact: true }).count(), 0);
  await page.evaluate(() => window.__publishHomeGps(5));
  const recommendation = page.getByRole('region', { name: 'Рекомендация отделения' });
  await recommendation.waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pochta:geo-preset', { detail: { mode: 'near_101000' } })));
  await recommendation.waitFor({ state: 'detached' });
  assert.equal(await page.getByText('Умный маршрут', { exact: true }).count(), 0);
});

test('home recommendation actions await confirmed services and reuse the selected branch request', { skip: !homeBrowserEnabled }, async t => {
  const home = await mountHome(t);
  const recommendation = home.page.getByText('Умный маршрут', { exact: true }).locator('xpath=ancestor::div[4]');
  await recommendation.waitFor();
  assert.equal(await recommendation.getByRole('button', { name: 'Записаться онлайн', exact: true }).count(), 0);
  assert.equal(await recommendation.getByRole('button', { name: 'Выбрать', exact: true }).count(), 0);
  assert.equal(await recommendation.getByRole('button', { name: 'Взять талон', exact: true }).count(), 1);
  assert.equal(await recommendation.getByRole('button', { name: 'Маршрут', exact: true }).count(), 1);
  assert.equal(home.requestCount(), 1);
  home.confirmServices();
  await recommendation.getByRole('button', { name: 'Записаться онлайн', exact: true }).waitFor();
  assert.equal(home.requestCount(), 1);
  if (process.env.HOME_SCREENSHOTS) {
    await home.page.screenshot({ path: '/tmp/task3-home-mobile.png', fullPage: true });
    await home.page.setViewportSize({ width: 1280, height: 900 });
    await home.page.screenshot({ path: '/tmp/task3-home-desktop.png', fullPage: true });
  }
  await recommendation.getByRole('button', { name: 'Записаться онлайн', exact: true }).click();
  await home.page.getByRole('heading', { name: 'Выберите услугу', exact: true }).waitFor();
  await home.page.getByRole('button', { name: /Посылки/ }).waitFor();
});

for (const services of ['empty', 'failed']) test(`home hides appointment when branch services are ${services}`, { skip: !homeBrowserEnabled }, async t => {
  const { page } = await mountHome(t, { services });
  const recommendation = page.getByRole('region', { name: 'Рекомендация отделения' });
  await recommendation.waitFor();
  assert.equal(await recommendation.getByRole('button', { name: 'Записаться онлайн', exact: true }).count(), 0);
});
test('catalog coordinates require matching server address', async () => {
  const { matchBranchLocation } = await load('../src/features/client/map/liveBranches.ts');
  const catalog = [{id:'same', address:'г. Москва, ул. Мясницкая, д. 26', lat:55, lng:37}];
  assert.equal(matchBranchLocation({id:'same',address:'г. Рязань, ул. Ленина, д. 20'}, catalog), undefined);
  assert.equal(matchBranchLocation({id:'same'}, catalog), undefined);
  assert.equal(matchBranchLocation({id:'same',address:catalog[0].address}, catalog), catalog[0]);
});
test('unknown, stale, closed and invalid workload never becomes zero wait', async () => {
  const { liveWaitMinutes } = await load('../src/features/client/map/liveBranches.ts');
  const now = Date.now();
  const w = {activeWindows:2, estimatedWaitSeconds:420, calculatedAt:new Date(now).toISOString()};
  assert.equal(liveWaitMinutes(w, now), 7);
  assert.equal(liveWaitMinutes(undefined, now), undefined);
  assert.equal(liveWaitMinutes({...w,activeWindows:0}, now), undefined);
  assert.equal(liveWaitMinutes({...w,estimatedWaitSeconds:null}, now), undefined);
  assert.equal(liveWaitMinutes({...w,calculatedAt:new Date(now-61000).toISOString()}, now), undefined);
  assert.equal(liveWaitMinutes({...w,estimatedWaitSeconds:-1}, now), undefined);
});
test('GPS uncertainty and stale fixes cannot confirm arrival', async () => {
  const { isReliableArrival } = await load('../src/features/client/arrival/arrivalPolicy.ts');
  assert.equal(isReliableArrival(10, 5, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(10, 100, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(10, undefined, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(25, 5, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(26, 5, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(40, 50, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(40, 51, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(120, 100, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(121, 100, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(10, 101, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(5, 5, 20, 1000, 62000), false);
});
test('arrival validates destination services, locks before awaiting and keeps retry identity', async () => {
  const { createArrivalIssuer } = await load('../src/features/client/arrival/arrivalPolicy.ts');
  let calls = 0;
  let release;
  const identities = [];
  const issue = createArrivalIssuer({
    listServices: async id => { assert.equal(id,'destination'); await new Promise(r => {release=r}); return [{id:'correct'}]; },
    createQrTicket: async (branch, service, key) => { calls++; assert.equal(service,'correct'); if(calls===1) throw Error('lost response'); return {id:'ticket'}; },
    keyFor: identity => {identities.push(identity); return 'stable-key';},
    clearKey: () => {},
  });
  const first = issue('destination','correct','owner');
  assert.equal(await issue('destination','correct','owner'), undefined);
  release(); await assert.rejects(first,/lost response/);
  const retry = issue('destination','correct','owner'); release();
  assert.equal((await retry).id,'ticket');
  assert.equal(identities[0],identities[1]);
  const wrong = issue('destination','old-branch-service','owner'); release();
  await assert.rejects(wrong,/услуга/i);
  assert.equal(calls,2);
});
