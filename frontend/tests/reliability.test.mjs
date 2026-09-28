import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
const HOME_TEST_OUTPUT = path.resolve('tmp/test-output');

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(value).split('?')[0];
  }
}

async function saveHomeDiagnostics(page, diagnostics, artifactName, error) {
  await mkdir(HOME_TEST_OUTPUT, { recursive: true });
  const base = path.join(HOME_TEST_OUTPUT, artifactName.replace(/[^a-z0-9_-]+/gi, '-'));
  let pageState = { url: safeUrl(page.url()), readyState: 'unavailable', bodyText: 'unavailable' };
  try {
    const documentState = await page.evaluate(() => ({
      readyState: document.readyState,
      bodyText: document.body?.innerText?.slice(0, 12000) || '',
    }));
    pageState = { url: safeUrl(page.url()), ...documentState };
  } catch {}
  try { await page.screenshot({ path: `${base}.png`, fullPage: true }); } catch {}
  try { await writeFile(`${base}.html`, await page.content(), 'utf8'); } catch {}
  await writeFile(`${base}.json`, JSON.stringify({
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    page: pageState,
    ...diagnostics,
  }, null, 2), 'utf8');
  process.stderr.write(`[home-browser-diagnostics] ${JSON.stringify({ artifact: base, page: pageState, ...diagnostics })}\n`);
}

async function mountHome(t, {
  accuracy = 5,
  permission = 'granted',
  services = 'pending',
  artifactName = 'home-browser-failure',
  pendingTicketWithUnrelatedCache = false,
} = {}) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/queue-browser/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const diagnostics = { console: [], pageErrors: [], failedRequests: [], errorResponses: [], steps: [] };
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.console.push({ type: message.type(), text: message.text().slice(0, 2000) });
    }
  });
  page.on('pageerror', error => diagnostics.pageErrors.push({ name: error.name, message: error.message }));
  page.on('requestfailed', request => diagnostics.failedRequests.push({
    method: request.method(), url: safeUrl(request.url()), failure: request.failure()?.errorText || 'unknown',
  }));
  page.on('response', response => {
    if (response.status() >= 400) diagnostics.errorResponses.push({ status: response.status(), url: safeUrl(response.url()) });
  });
  let serviceRequests = 0;
  let ticketRequests = 0;
  let releaseServices;
  let releaseTicketLoad;
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
    if (path === '/api/v1/tickets/pending-ticket') {
      ticketRequests++;
      await new Promise(resolve => { releaseTicketLoad = resolve; });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"NOT_FOUND"}' });
    }
    if (path === '/api/v1/auth/me') return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    return fulfill({ items: [] });
  });
  await page.addInitScript(({ accuracy, permission, pendingTicketWithUnrelatedCache }) => {
    if (pendingTicketWithUnrelatedCache) {
      localStorage.setItem('client_active_ticket_ids:anon', JSON.stringify(['pending-ticket']));
      localStorage.setItem('client_active_tickets_cache:anon', JSON.stringify([{
        id: 'other-branch-ticket', branchId: 'other-branch', serviceId: 'parcel', publicNumber: 'A001',
        status: 'WAITING', source: 'QR', createdAt: new Date().toISOString(), queueEnteredAt: new Date().toISOString(),
      }]));
    }
    const permissionStatus = new EventTarget();
    Object.defineProperty(permissionStatus, 'state', { configurable: true, get: () => permission });
    permissionStatus.onchange = null;
    navigator.permissions.query = async ({ name }) => {
      if (name !== 'geolocation') throw new TypeError(`Unsupported permission: ${name}`);
      return permissionStatus;
    };
    let nextWatchId = 1;
    const watchers = new Map();
    const position = (latitude, longitude, nextAccuracy = accuracy) => ({
      coords: { latitude, longitude, accuracy: nextAccuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    });
    window.__homeGeoTrace = { getCalls: 0, watchCalls: 0, clearCalls: [], publishedWatchIds: [], lastPosition: null };
    window.__publishHomeGps = (nextAccuracy = 5, latitude = 55.7558, longitude = 37.6173) => {
      const active = [...watchers.entries()];
      const next = position(latitude, longitude, nextAccuracy);
      window.__homeGeoTrace.lastPosition = next;
      for (const [id, publish] of active) {
        window.__homeGeoTrace.publishedWatchIds.push(id);
        publish(next);
      }
      return active.length;
    };
    navigator.geolocation.watchPosition = publish => {
      const id = nextWatchId++;
      watchers.set(id, publish);
      window.__homeGeoTrace.watchCalls++;
      return id;
    };
    navigator.geolocation.clearWatch = id => {
      window.__homeGeoTrace.clearCalls.push(id);
      watchers.delete(id);
    };
    navigator.geolocation.getCurrentPosition = publish => {
      window.__homeGeoTrace.getCalls++;
      const initial = position(55.7558, 37.6173, accuracy);
      window.__homeGeoTrace.lastPosition = initial;
      publish(initial);
    };
  }, { accuracy, permission, pendingTicketWithUnrelatedCache });
  try {
    const moduleProbe = await page.request.get(`${process.env.HOME_BROWSER_URL}/src/features/client/ClientWorkspace.tsx`);
    assert.equal(moduleProbe.ok(), true, `Vite test server is not ready: ${moduleProbe.status()} ${safeUrl(moduleProbe.url())}`);
    diagnostics.steps.push('vite modules reachable');
    await page.goto(`${process.env.HOME_BROWSER_URL}/__home_test`);
    diagnostics.steps.push('fixture document loaded');
    await page.evaluate(async () => {
      const [{ default: React }, { default: ReactDOM }, { ClientWorkspace }] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'), import('/src/features/client/ClientWorkspace.tsx'),
        import('/src/tailwind.css'), import('/src/design-system.css'), import('/src/product.css'),
      ]);
      ReactDOM.createRoot(document.querySelector('#fixture')).render(React.createElement(ClientWorkspace));
    });
    await page.waitForFunction(() => document.querySelector('#fixture')?.childElementCount > 0);
    diagnostics.steps.push('root app mounted');
    await page.getByRole('heading', { name: 'Цифровая очередь', exact: true }).waitFor();
    if (accuracy <= 100) {
      await page.getByText('Тестовое отделение').first().waitFor();
      diagnostics.steps.push('branch data loaded');
    } else {
      await page.getByText('Определяем ваше местоположение…').first().waitFor();
      diagnostics.steps.push('neutral GPS waiting state visible');
    }
    await page.waitForFunction(() => window.__homeGeoTrace?.watchCalls === 1);
    diagnostics.steps.push('one GPS watcher registered');
    const initialGeo = await page.evaluate(() => window.__homeGeoTrace);
    assert.equal(initialGeo.getCalls, 1, 'initial getCurrentPosition should run once');
    assert.equal(initialGeo.watchCalls, 1, 'exactly one watchPosition should be active');
    assert.deepEqual(
      [initialGeo.lastPosition.coords.latitude, initialGeo.lastPosition.coords.longitude],
      [55.7558, 37.6173],
      'initial GPS position should be outside the test branch geofence',
    );
    diagnostics.steps.push('initial GPS fix outside geofence');
    return {
      page,
      diagnostics,
      requestCount: () => serviceRequests,
      ticketRequestCount: () => ticketRequests,
      confirmServices: () => releaseServices?.(),
      confirmTicketLoad: () => releaseTicketLoad?.(),
    };
  } catch (error) {
    await saveHomeDiagnostics(page, diagnostics, artifactName, error);
    throw error;
  }
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

test('nearby card mounts after a fresh watch fix enters a branch geofence without an active ticket', { skip: !homeBrowserEnabled }, async t => {
  const home = await mountHome(t, { services: 'empty', artifactName: 'nearby-card-lifecycle' });
  const { page, diagnostics } = home;
  try {
    assert.equal(await page.getByTestId('nearby-branch-card').count(), 0, 'initial outside fix must not show nearby card');
    diagnostics.steps.push('initial outside: no popup');
    await page.waitForFunction(() => !document.body.innerText.includes('Загружаем ваши талоны'));
    diagnostics.steps.push('ticket gate loaded with no active ticket');
    const published = await page.evaluate(() => window.__publishHomeGps(5, 55.76, 37.636));
    assert.equal(published, 1, 'inside fix must be delivered to the one active watcher');
    const insideGeo = await page.evaluate(() => window.__homeGeoTrace);
    assert.deepEqual(
      [insideGeo.lastPosition.coords.latitude, insideGeo.lastPosition.coords.longitude],
      [55.76, 37.636],
      'watch fix coordinates must match branch coordinates',
    );
    diagnostics.steps.push('watch callback invoked with branch coordinates');
    const nearbyCard = page.getByTestId('nearby-branch-card');
    await nearbyCard.waitFor();
    diagnostics.steps.push('nearby branch detected and NearbyBranchCard mounted');
    assert.equal(await nearbyCard.getByText('Тестовое отделение').count(), 1);
  } catch (error) {
    await saveHomeDiagnostics(page, diagnostics, 'nearby-card-lifecycle', error);
    throw error;
  }
});

test('nearby card stays hidden until ticket loading finishes even with an unrelated cached ticket', { skip: !homeBrowserEnabled }, async t => {
  const home = await mountHome(t, { services: 'empty', pendingTicketWithUnrelatedCache: true });
  assert.equal(home.ticketRequestCount(), 1, 'saved ticket lookup must still be pending');
  await home.page.evaluate(() => {
    window.__nearbyCardMounts = 0;
    window.__nearbyCardObserver = new MutationObserver(() => {
      if (document.querySelector('[data-testid="nearby-branch-card"]')) window.__nearbyCardMounts++;
    });
    window.__nearbyCardObserver.observe(document.body, { childList: true, subtree: true });
  });
  await home.page.evaluate(() => window.__publishHomeGps(5, 55.76, 37.636));
  await home.page.waitForTimeout(400);
  assert.equal(await home.page.getByTestId('nearby-branch-card').count(), 0);
  assert.equal(await home.page.evaluate(() => window.__nearbyCardMounts), 0, 'nearby card must never mount during ticket loading');
  home.confirmTicketLoad();
  await home.page.getByTestId('nearby-branch-card').waitFor();
});

test('route offer is a focus-managed modal with GPS directions and backdrop-only dismissal', { skip: !homeBrowserEnabled }, async t => {
  const { page } = await mountHome(t, { services: 'empty' });
  const recommendation = page.getByRole('region', { name: 'Рекомендация отделения' });
  const opener = recommendation.getByRole('button', { name: 'Маршрут', exact: true });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Тестовое отделение' });
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('tabindex'), '-1');
  assert.equal(await dialog.getAttribute('data-testid'), 'route-offer-dialog');
  const directions = dialog.getByRole('link', { name: 'Проложить пеший маршрут в Яндекс.Картах' });
  assert.equal(await directions.getAttribute('href'), 'https://yandex.ru/maps/?rtext=55.7558,37.6173~55.76,37.636&rtt=pd');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('Проложить пеший маршрут')), true);

  await dialog.click({ position: { x: 10, y: 10 } });
  assert.equal(await dialog.count(), 1, 'clicking modal content must not dismiss it');
  await page.getByTestId('route-offer-backdrop').evaluate(element => element.click());
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true, 'focus returns to the route opener');

  await opener.click();
  await page.getByTestId('route-offer-dialog').getByRole('button', { name: 'Посмотреть на карте' }).click();
  const selectedBranchSheet = page.getByTestId('mobile-branch-bottom-sheet');
  await selectedBranchSheet.getByText('Тестовое отделение').waitFor();
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
