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
   constructor(_node,state){this.center=[...state.center];this.zoom=state.zoom;this.destroyed=false;this.geoObjects=new FakeCollection();this.container={fitToViewport:()=>{}};window.__queueFakeMaps.push(this)}
   panTo(coords){this.center=[...coords];return Promise.resolve()}
   setZoom(zoom){this.zoom=zoom;return Promise.resolve()}
   destroy(){this.destroyed=true}
  }
  window.__queueFakeMaps=[];
  window.ymaps={Map:FakeMap,Placemark:FakePlacemark,Clusterer:FakeClusterer,ready:callback=>callback(),templateLayoutFactory:{createClass:()=>function(){}}};
 });
 const page = await context.newPage();
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
try {
 const precise=await setup(3,true);
 const dialog=precise.page.getByRole('dialog',{name:/Похоже вы находитесь/});
 await dialog.waitFor({timeout:10000}).catch(async e => { console.log(precise.errors); console.log((await precise.page.locator('body').innerText()).slice(0,2500)); await precise.page.screenshot({path:'/tmp/queue-error.png'}); throw e; });
 await dialog.getByRole('button',{name:service.name,exact:true}).waitFor();
 const issue=dialog.getByRole('button',{name:'Получить талон в 1 клик'});
 await issue.click();
 await dialog.getByRole('alert').waitFor();
 await issue.click();
 await precise.page.getByText(ticket.publicNumber,{exact:true}).first().waitFor();
 assert.equal(precise.keys.length,2);
 assert.equal(precise.keys[0],precise.keys[1]);
 precise.setTicketStatus('COMPLETED');
 const review=precise.page.getByRole('dialog',{name:'Оцените визит'});
 await review.waitFor({timeout:10000});
 await review.getByRole('button',{name:'4 звезды'}).click();
 await review.getByLabel(/Комментарий/).fill('Всё прошло хорошо');
 await review.getByRole('button',{name:'Отправить оценку'}).click();
 await review.waitFor({state:'hidden'});
 const savedReview=await precise.page.evaluate(()=>JSON.parse(localStorage.getItem('client_visit_ratings:anon')||'{}'));
 assert.equal(savedReview.ratings[0].rating,4);
 assert.equal(savedReview.ratings[0].comment,'Всё прошло хорошо');
 assert(await precise.page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'mobile overflow');
 await precise.context.close();
 const coarse=await setup(100);
 await coarse.page.getByText('Умный маршрут',{exact:true}).waitFor();
 const initialGeoStats=await coarse.page.evaluate(()=>window.__geoStats);
 assert.equal(initialGeoStats.current,1,'granted geolocation should issue one initial lookup');
 assert.equal(initialGeoStats.watch,0,'initial location should not start watchPosition');
 const coarseArrival=coarse.page.getByRole('dialog',{name:/Похоже вы находитесь/});
 await coarseArrival.waitFor({timeout:10000}).catch(async error => {
  console.log('coarse GPS did not open arrival sheet:', coarse.errors);
  console.log((await coarse.page.locator('body').innerText()).slice(0,2500));
  await coarse.page.screenshot({path:'/tmp/queue-coarse-gps.png'});
  throw error;
 });
 await coarseArrival.getByRole('button',{name:'Закрыть'}).click();
 const geoButton=coarse.page.getByRole('button',{name:'Определить местоположение'});
 const geoStarted=Date.now();
 await geoButton.click();
 await coarse.page.waitForFunction(()=>window.__geoStats.current===2);
 await coarse.page.getByRole('button',{name:'Определить местоположение'}).waitFor();
 assert(Date.now()-geoStarted<1500,'explicit geolocation should update without a sequential timeout');
 assert.deepEqual(await coarse.page.evaluate(()=>window.__geoStats),{current:2,watch:0},'one click must create exactly one browser lookup');

 const a11yButton=coarse.page.getByRole('button',{name:'Настройки доступности',exact:true});
 await a11yButton.click();
 assert.equal(await a11yButton.evaluate(node=>getComputedStyle(node).outlineStyle),'none','mouse click must not leave a browser outline');
 const a11yDialog=coarse.page.getByRole('dialog',{name:'Панель доступности'});
 await a11yDialog.waitFor();
 assert.equal(await a11yDialog.getByText('Увеличенный текст').count(),0,'text size must not have a duplicate master switch');
 await a11yDialog.getByRole('button',{name:'А+ 125%'}).focus();
 await coarse.page.keyboard.press('Enter');
 await a11yDialog.getByRole('button',{name:'А++ 150%'}).click();
 assert.equal(await coarse.page.evaluate(()=>document.documentElement.style.fontSize),'150%');
 assert(await coarse.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'header or accessibility panel overflows at 150% on mobile');
 await coarse.page.screenshot({path:'/tmp/queue-a11y-mobile.png'});
 await a11yDialog.getByRole('button',{name:'А+ 125%'}).click();
 await a11yDialog.getByRole('button',{name:/Контрастная/}).focus();
 await coarse.page.keyboard.press('Enter');
 assert.equal(await coarse.page.evaluate(()=>document.documentElement.style.fontSize),'125%');
 assert(await coarse.page.evaluate(()=>document.documentElement.classList.contains('a11y-contrast')));
 await coarse.page.keyboard.press('Escape');
 assert(await a11yButton.evaluate(node=>node===document.activeElement),'focus must return to accessibility button');
 await coarse.page.reload();
 await coarse.page.getByText('Умный маршрут',{exact:true}).waitFor();
 const reloadedArrival=coarse.page.getByRole('dialog',{name:/Похоже вы находитесь/});
 if(await reloadedArrival.isVisible().catch(()=>false)) await reloadedArrival.getByRole('button',{name:'Закрыть'}).click();
 assert.deepEqual(await coarse.page.evaluate(()=>({scale:localStorage.getItem('pochta_a11y_scale'),contrast:localStorage.getItem('pochta_a11y_contrast'),fontSize:document.documentElement.style.fontSize})),{scale:'125',contrast:'true',fontSize:'125%'},'accessibility settings must survive reload');
 await coarse.page.getByRole('button',{name:'Настройки доступности',exact:true}).click();
 await coarse.page.getByRole('dialog',{name:'Панель доступности'}).getByRole('button',{name:'А 100%'}).click();
 await coarse.page.getByRole('dialog',{name:'Панель доступности'}).getByRole('button',{name:'Стандартная'}).click();
 await coarse.page.getByRole('dialog',{name:'Панель доступности'}).getByRole('button',{name:'Готово'}).click();
 await coarse.page.keyboard.press('Tab');
 const focusedOutline=await coarse.page.evaluate(()=>getComputedStyle(document.activeElement).outlineWidth);
 assert(parseFloat(focusedOutline)>=3,'keyboard focus-visible ring must remain visible');
 const bookingButton=coarse.page.getByRole('button').filter({hasText:'Записаться онлайн'}).first();
 await bookingButton.click();
 const pageSize=coarse.page.getByLabel('Количество отделений на странице');
 await pageSize.waitFor();
 assert.equal(await coarse.page.locator('button.cx-choice').count(),5,'booking must show the default five branches');
 assert(await coarse.page.locator('img[alt^="Отделение "]').count()>=5,'branch cards must show catalog photos');
 assert(await coarse.page.locator('[data-landmark-type="metro"]').count()>0,'metro must use structured line-color marker');
 await pageSize.selectOption('10');
 assert.equal(await coarse.page.locator('button.cx-choice').count(),7,'booking page size 10 must show all available branches');
 for (const viewport of [{width:1440,height:900},{width:768,height:900},{width:390,height:844}]) {
  await coarse.page.setViewportSize(viewport);
  assert(await coarse.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`horizontal overflow at ${viewport.width}px`);
 }
 await coarse.page.locator('button.cx-choice').first().click();
 await coarse.page.getByRole('button',{name:'Назад'}).click();
 await coarse.page.getByRole('button',{name:'Назад'}).click();
 await coarse.page.getByRole('button').filter({hasText:'Взять талон'}).first().click();
 const walkinPageSize=coarse.page.getByLabel('Количество отделений на странице');
 await walkinPageSize.waitFor();
 assert.equal(await walkinPageSize.inputValue(),'10','page size is shared by booking and walk-in lists');
 await walkinPageSize.selectOption('5');
 assert.equal(await coarse.page.locator('button.cx-choice').count(),5,'walk-in page size selector must paginate independently of search');
 await coarse.page.locator('button.cx-choice').first().click();
 const workload=coarse.page.getByRole('region',{name:'Загруженность отделения'});
 await workload.waitFor();
 const hoursBox=await workload.getByText(/Режим работы:/).boundingBox();
 const queueBox=await workload.getByText(/В очереди сейчас:/).boundingBox();
 assert(hoursBox&&queueBox&&queueBox.y>=hoursBox.y+hoursBox.height,'queue badge must be below work hours');
 await coarse.page.getByRole('button',{name:'Назад'}).click();
 await coarse.page.getByRole('button',{name:'Назад'}).click();
 coarse.setWait(0);
 await coarse.page.getByText('Умный маршрут',{exact:true}).waitFor({state:'hidden',timeout:25000});
 const mapButton=coarse.page.getByRole('button',{name:/Карта отделений/});
 await mapButton.click();
 await coarse.page.getByRole('dialog').waitFor();
 const manualViewport=await coarse.page.evaluate(()=>{const map=window.__queueFakeMaps.at(-1);map.center=[55.7,37.5];map.zoom=11;return {instances:window.__queueFakeMaps.length}});
 await coarse.page.waitForTimeout(2500);
 const stableViewport=await coarse.page.evaluate(()=>{const map=window.__queueFakeMaps.at(-1);return {instances:window.__queueFakeMaps.length,center:map.center,zoom:map.zoom,destroyed:map.destroyed}});
 assert.deepEqual(stableViewport,{instances:manualViewport.instances,center:[55.7,37.5],zoom:11,destroyed:false},'data refresh must not recreate or recenter the map');
 await coarse.page.getByRole('button',{name:'Определить моё местоположение'}).click();
 await coarse.page.waitForFunction(()=>window.__queueFakeMaps.at(-1)?.zoom===15);
 const explicitViewport=await coarse.page.evaluate(()=>{const map=window.__queueFakeMaps.at(-1);return {center:map.center,zoom:map.zoom}});
 assert.deepEqual(explicitViewport,{center:[55.761845,37.638521],zoom:15},'explicit locate button must recenter the map');
 assert(await coarse.page.getByText('4.92',{exact:true}).count() > 0,'branch map should show the catalog rating and a Yandex Maps source link');
 assert.equal(await coarse.page.getByText('Без координат',{exact:true}).count(),0);
 await coarse.page.screenshot({path:'/tmp/queue-map-mobile.png'});
 assert.deepEqual(precise.errors,[]);
 assert.deepEqual(coarse.errors,[]);
 await coarse.context.close();
 console.log('PASS: single fast geolocation, accessibility keyboard/persistence, focus ring, responsive header, branch UI, stable map viewport, explicit locate, no runtime errors');
} finally {await browser.close();}
