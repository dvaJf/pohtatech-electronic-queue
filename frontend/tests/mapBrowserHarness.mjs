import assert from 'node:assert/strict';

export const browserEnabled = !!process.env.MAP_BROWSER_URL;
export async function mountMap(t, viewport = { width: 1280, height: 900 }) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/queue-browser/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'component has no uncaught browser errors'));
  await page.route('**/__map_test', route => route.fulfill({ contentType: 'text/html', body: '<button id="opener">Открыть карту</button><div id="fixture"></div>' }));
  await page.addInitScript(() => {
    window.__maps = [];
    window.__geoRequests = 0;
    navigator.geolocation.getCurrentPosition = () => { window.__geoRequests++; };
    class Collection {
      items = [];
      add(item) { this.items.push(item); }
      removeAll() { this.items = []; }
    }
    class Placemark {
      constructor(coords) { this.coords = [...coords]; this.events = { add() {} }; this.geometry = { setCoordinates: value => { this.coords = [...value]; } }; }
    }
    class Map {
      constructor(_node, state) {
        this.center = [...state.center]; this.zoom = state.zoom; this.pans = []; this.zooms = []; this.handlers = {};
        this.events = { add: (name, fn) => { this.handlers[name] = fn; } };
        this.geoObjects = new Collection(); this.container = { fitToViewport() {} };
        this.margin = { addArea: area => ({ area, setArea(value) { this.area = value; }, remove() {} }) };
        window.__maps.push(this);
      }
      panTo(coords, options) { this.pans.push({ coords: [...coords], options }); this.center = [...coords]; return this.deferPan ? new Promise(resolve => { this.resolvePan = resolve; }) : Promise.resolve(); }
      setZoom(value) { this.zooms.push(value); this.zoom = value; return this.deferZoom ? new Promise(resolve => { this.resolveZoom = resolve; }) : Promise.resolve(); }
      getZoom() { return this.zoom; }
      destroy() { this.destroyed = true; }
    }
    window.ymaps = { Map, Placemark, Clusterer: Collection, ready: fn => fn(), templateLayoutFactory: { createClass: () => function() {} } };
  });
  await page.goto(`${process.env.MAP_BROWSER_URL}/__map_test`);
  await page.evaluate(() => import('/tests/mapFixture.tsx'));
  const render = async props => { await page.evaluate(next => window.__renderMap(next), props); await page.waitForTimeout(80); };
  const open = async props => { await page.locator('#opener').focus(); await render({ isOpen: true, ...props }); await page.getByRole('dialog').waitFor(); await page.waitForFunction(() => window.__maps.length > 0); };
  return { page, render, open };
}
