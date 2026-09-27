import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/queue-browser/node_modules/playwright/index.mjs');
const baseURL = process.env.UI_BASE_URL || 'http://127.0.0.1:5181';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const branches = [
  {id:'11111111-1111-1111-1111-111111111111',name:'Первое отделение',address:'г. Москва, ул. Мясницкая, д. 26',workHours:'08:00–22:00'},
  {id:'22222222-2222-2222-2222-222222222222',name:'Второе отделение',address:'г. Москва, ул. Рождественка, д. 10/2',workHours:'08:00–20:00'},
  {id:'33333333-3333-3333-3333-333333333333',name:'Покровка',address:'г. Москва, ул. Покровка, д. 16',workHours:'08:00–20:00'},
  {id:'44444444-4444-4444-4444-444444444444',name:'Никольская',address:'г. Москва, ул. Никольская, д. 8/1',workHours:'08:00–20:00'},
  {id:'55555555-5555-5555-5555-555555555555',name:'Тверская',address:'г. Москва, ул. Тверская, д. 9',workHours:'08:00–20:00'},
  {id:'66666666-6666-6666-6666-666666666666',name:'Новый Арбат',address:'г. Москва, ул. Новый Арбат, д. 2',workHours:'08:00–20:00'},
  {id:'unknown',name:'Без координат',address:'Неизвестный адрес',workHours:'08:00–20:00'},
];
const service = {id:'service-at-destination',code:'PARCELS',name:'Выдача посылок'};
const ticket = {id:'ticket-created',publicNumber:'Q-123456',branchId:branches[0].id,serviceId:service.id,source:'QR',status:'WAITING',window:null,createdAt:new Date().toISOString(),queueEnteredAt:new Date().toISOString(),calledAt:null,serviceStartedAt:null,completedAt:null};
async function setup(accuracy, rejectFirst = false) {
 const context = await browser.newContext({viewport:{width:390,height:844},permissions:['geolocation'],geolocation:{latitude:55.761845,longitude:37.638521,accuracy}});
 await context.addInitScript(() => {
  window.__geoStats={current:0,watch:0};
  const browserGeo=navigator.geolocation;
  const originalCurrent=browserGeo.getCurrentPosition.bind(browserGeo);
  browserGeo.getCurrentPosition=(...args)=>{window.__geoStats.current++;return originalCurrent(...args)};
  if(browserGeo.watchPosition){const originalWatch=browserGeo.watchPosition.bind(browserGeo);browserGeo.watchPosition=(...args)=>{window.__geoStats.watch++;return originalWatch(...args)}}
  class FakeCollection { constructor(){this.items=[]} add(item){this.items.push(item)} removeAll(){this.items=[]} }
  class FakeClusterer extends FakeCollection {}
  class FakePlacemark {
   constructor(coords){this.coords=coords;this.events={add:()=>{}};this.geometry={setCoordinates:value=>{this.coords=value}}}
  }
  class FakeMap {
   constructor(_node,state){this.center=[...state.center];this.zoom=state.zoom;this.destroyed=false;this.geoObjects=new FakeCollection();this.container={fitToViewport:()=>{}};this.margin={areas:[],addArea:area=>{const accessor={area,setArea:value=>{accessor.area=value;return accessor},remove:()=>{this.margin.areas=this.margin.areas.filter(item=>item!==accessor)}};this.margin.areas.push(accessor);return accessor}};window.__queueFakeMaps.push(this)}
   panTo(coords,options){this.center=[...coords];this.lastPanOptions=options;return Promise.resolve()}
   getZoom(){return this.zoom}
   setZoom(zoom){this.zoom=zoom;return Promise.resolve()}
   destroy(){this.destroyed=true}
  }
  window.__queueFakeMaps=[];
  window.ymaps={Map:FakeMap,Placemark:FakePlacemark,Clusterer:FakeClusterer,ready:callback=>callback(),templateLayoutFactory:{createClass:()=>function(){}}};
 });
 const page = await context.newPage();
 page.setDefaultTimeout(5000);
 const errors=[]; const keys=[]; let wait=1800; let unavailable=false; let ticketStatus='WAITING';
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url = new URL(route.request().url());
  if(url.origin !== new URL(baseURL).origin) return route.abort();
  if(url.pathname.startsWith('/api/')) {
   const path=url.pathname; let data;
   if(path.endsWith('/auth/me')) return route.fulfill({status:401,json:{error:{message:'unauthenticated'}}});
   if(path.endsWith('/branches')) data={items:branches};
   else if(path.endsWith('/services')) data={items:[service]};
   else if(path.endsWith('/workload')) {
    if(unavailable) return route.fulfill({status:503,json:{error:{message:'offline'}}});
    const id=path.split('/')[4];
    data={branchId:id,currentWaiting:6,activeWindows:2,estimatedWaitSeconds:id===branches[0].id ? wait : 60,calculatedAt:new Date().toISOString(),hourly:[],currentHour:12,sampleCount:0,isHistorical:false};
   } else if(path.endsWith('/tickets/qr')) {
    keys.push(route.request().headers()['idempotency-key']);
    assert.equal(route.request().postDataJSON().serviceId,service.id);
    if(rejectFirst && keys.length===1) return route.abort();
    data=ticket;
   } else if(path.endsWith('/position')) data={ticketId:ticket.id,ticketStatus:'WAITING',reason:'AVAILABLE',position:1};
   else if(path.endsWith('/eta')) data={ticketId:ticket.id,ticketStatus:'WAITING',reason:'AVAILABLE',estimatedWaitSeconds:60,position:1};
   else if(path.endsWith(`/tickets/${ticket.id}`)) data={...ticket,status:ticketStatus};
   else data={status:'ok'};
   return route.fulfill({json:data});
  }
  return route.continue();
 });
 await page.goto(baseURL);
 const emblem = page.locator('main svg').first();
 await emblem.waitFor();
 const emblemBox = await emblem.boundingBox();
 assert(emblemBox && emblemBox.width <= 48 && emblemBox.height <= 48,
   `brand emblem lost its utility sizing: ${JSON.stringify(emblemBox)}`);
 return {context,page,errors,keys,setWait:value=>{wait=value},setUnavailable:value=>{unavailable=value},setTicketStatus:value=>{ticketStatus=value}};
}
export async function runBrowserChecks({ screenshots = false } = {}) {
 try {
  const home = await setup(5);
  const { page } = home;
  const heading = page.getByRole('heading', { name: 'Цифровая очередь', exact: true });
  await heading.waitFor();
  await page.getByRole('region', { name: 'Рекомендация отделения' }).waitFor();
  const nearby = page.getByRole('complementary', { name: 'Отделение рядом' });
  await nearby.waitFor();
  assert.equal(home.keys.length, 0, 'nearby suggestion must not issue a ticket');
  await nearby.getByRole('button', { name: 'Закрыть предложение отделения рядом' }).click();
  const geo = page.getByRole('button', { name: 'Определить местоположение', exact: true });
  const requests = await page.evaluate(() => window.__geoStats.current);
  const watches = await page.evaluate(() => window.__geoStats.watch);
  await geo.click();
  await page.waitForFunction(count => window.__geoStats.current === count + 1, requests);
  await geo.waitFor();
  assert.equal(await page.evaluate(() => window.__geoStats.watch), watches, 'explicit lookup must not add a geofence watch');
  const rootSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  for (const width of [320, 360, 390, 430, 1440]) {
   await page.setViewportSize({ width, height: 900 });
   let baseHeading, baseGeometry;
   for (const scale of [100, 125, 150]) {
    await page.getByRole('button', { name: 'Настройки доступности', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Панель доступности' });
    await settings.getByRole('button', { name: new RegExp(scale + '%$') }).click();
    assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), rootSize);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.textScale), String(scale));
    const size = await heading.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    if (scale === 100) baseHeading = size;
    assert(Math.abs(size - baseHeading * scale / 100) < 0.1, 'hero text scale');
    assert(await page.getByRole('region', { name: 'Рекомендация отделения' }).locator('h2').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'recommendation branch title overlaps the time summary');
    const small = await page.locator('.main-product-header button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => node.getBoundingClientRect().width < 44 || node.getBoundingClientRect().height < 44).map(node => node.textContent.trim()));
    assert.deepEqual(small, [], 'critical header targets');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Настройки доступности');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'home overflow at ' + width + '/' + scale);
    assert(await page.locator('.main-product-header button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).every(node => node.getBoundingClientRect().right <= innerWidth + 1)), 'header clipping');
    if (screenshots) await page.screenshot({ path: '/tmp/task4-home-' + width + '-' + scale + '.png', fullPage: true });
    await page.getByRole('button', { name: /Карта отделений/ }).click();
    const map = page.getByRole('dialog', { name: 'Отделения Почты России' });
    await map.waitFor();
    const list = width < 768 ? map.getByTestId('mobile-branch-bottom-sheet') : map.locator('aside');
    await list.getByRole('button', { name: /Первое отделение/ }).first().click();
    const photo = map.locator('img[alt="Иллюстрация почтового отделения"]').last();
    assert.equal(await photo.getAttribute('loading'), 'lazy');
    assert.equal(await photo.getAttribute('decoding'), 'async');
    const geometry = await map.getByRole('button', { name: 'Закрыть карту' }).evaluate(node => {
     const box = node.getBoundingClientRect(), icon = node.querySelector('svg').getBoundingClientRect();
     return [box.width, box.height, icon.width, icon.height];
    });
    if (scale === 100) baseGeometry = geometry;
    assert.deepEqual(geometry, baseGeometry, 'fixed map controls');
    assert(await map.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'map overflow');
    if (width === 1440) {
     const card = map.getByTestId('desktop-branch-card-overlay');
     const [rating, queue] = await Promise.all([card.locator('.branch-rating-badge').boundingBox(), card.locator('.branch-queue-badge').boundingBox()]);
     const overlap = rating && queue && rating.x < queue.x + queue.width && rating.x + rating.width > queue.x && rating.y < queue.y + queue.height && rating.y + rating.height > queue.y;
     assert(!overlap, 'branch badges overlap');
    }
    if (screenshots) await page.screenshot({ path: '/tmp/task4-map-' + width + '-' + scale + '.png' });
    await page.keyboard.press('Escape');
    await map.waitFor({ state: 'hidden' });
   }
   if (width < 640) {
    const disclosure = page.getByRole('button', { name: 'Дополнительное меню' });
    await disclosure.click();
    const menu = page.locator('#' + await disclosure.getAttribute('aria-controls'));
    const sound = menu.getByRole('button', { name: /Звуковое оповещение/ });
    const before = await sound.getAttribute('aria-pressed');
    await sound.click();
    assert.equal(await sound.getAttribute('aria-pressed'), String(before !== 'true'));
    await sound.focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Дополнительное меню');
   }
  }
  await page.reload();
  await heading.waitFor();
  assert.deepEqual(await page.evaluate(() => ({ stored: localStorage.getItem('pochta_a11y_scale'), scale: document.documentElement.dataset.textScale, font: document.documentElement.style.fontSize })), { stored: '150', scale: '150', font: '' }, 'scale persists without root mutation');
  if (await nearby.isVisible()) await nearby.getByRole('button', { name: 'Закрыть предложение отделения рядом' }).click();
  await page.getByRole('button', { name: /Записаться онлайн/ }).first().click();
  await page.getByLabel('Количество отделений на странице').waitFor();
  for (const width of [320, 360, 390, 430, 1440]) {
   await page.setViewportSize({ width, height: 900 });
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'picker overflow at ' + width);
   assert(await page.locator('button.cx-choice img').evaluateAll(nodes => nodes.every(node => node.loading === 'lazy' && node.decoding === 'async' && node.alt.includes('Иллюстрация'))));
   if (screenshots) await page.screenshot({ path: '/tmp/task4-picker-' + width + '-150.png', fullPage: true });
  }
  assert.deepEqual(home.errors, []);
  await home.context.close();
  console.log('PASS: 320/360/390/430/1440px × 100/125/150%; scoped text, header ARIA/focus/targets, map geometry, thumbnails, persistence, no page errors');
 } finally { await browser.close(); }
}
if (process.argv[1]?.endsWith('/reliability-browser.mjs')) await runBrowserChecks();
