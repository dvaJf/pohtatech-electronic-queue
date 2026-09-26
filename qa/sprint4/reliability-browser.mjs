import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/queue-browser/node_modules/playwright/index.mjs');
const baseURL = process.env.UI_BASE_URL || 'http://127.0.0.1:5181';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const branches = [
  {id:'11111111-1111-1111-1111-111111111111',name:'Первое отделение',address:'г. Москва, ул. Мясницкая, д. 26',workHours:'08:00–22:00'},
  {id:'22222222-2222-2222-2222-222222222222',name:'Второе отделение',address:'г. Москва, ул. Рождественка, д. 10/2',workHours:'08:00–20:00'},
  {id:'unknown',name:'Без координат',address:'Неизвестный адрес',workHours:'08:00–20:00'},
];
const service = {id:'service-at-destination',code:'PARCELS',name:'Выдача посылок'};
const ticket = {id:'ticket-created',publicNumber:'Q-123456',branchId:branches[0].id,serviceId:service.id,source:'QR',status:'WAITING',window:null,createdAt:new Date().toISOString(),queueEnteredAt:new Date().toISOString(),calledAt:null,serviceStartedAt:null,completedAt:null};
async function setup(accuracy, rejectFirst = false) {
 const context = await browser.newContext({viewport:{width:390,height:844},permissions:['geolocation'],geolocation:{latitude:55.761845,longitude:37.638521,accuracy}});
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
 assert.equal(await coarse.page.getByRole('dialog',{name:/Похоже вы находитесь/}).count(),0);
 coarse.setWait(0);
 await coarse.page.getByText('Умный маршрут',{exact:true}).waitFor({state:'hidden',timeout:25000});
 const mapButton=coarse.page.getByRole('button',{name:/Карта отделений/});
 await mapButton.click();
 await coarse.page.getByRole('dialog').waitFor();
 await coarse.page.getByText(/Часть отделений доступна только в списке/).waitFor();
 assert(await coarse.page.getByText('4.92',{exact:true}).count() > 0,'branch map should show the catalog rating and a Yandex Maps source link');
 assert.equal(await coarse.page.getByText('Отделение Тверская',{exact:true}).count(),0);
 await coarse.page.screenshot({path:'/tmp/queue-map-mobile.png'});
 assert.deepEqual(precise.errors,[]);
 assert.deepEqual(coarse.errors,[]);
 await coarse.context.close();
 console.log('PASS: service selection, lost response retry, GPS accuracy, completed-visit rating, live routing, Yandex source link, mobile layout, no runtime errors');
} finally {await browser.close();}
