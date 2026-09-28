import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { browserEnabled, mountMap } from './mapBrowserHarness.mjs';

async function mountHeader(t, width = 390, user = null) {
  const mounted = await mountMap(t, { width, height: 900 });
  await mounted.page.route('**/api/v1/auth/me', route => route.fulfill(user ? { json: user } : { status: 401, json: {} }));
  await mounted.page.evaluate(async () => {
    const [{ default: React }, { default: ReactDOM }, { ProductHeader }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/components/common/ProductHeader.tsx'),
    ]);
    const node = document.createElement('div');
    node.className = 'product-shell';
    document.body.prepend(node);
    ReactDOM.createRoot(node).render(React.createElement(ProductHeader, { currentPath: '/' }));
  });
  await mounted.page.locator('.main-product-header').waitFor();
  return mounted;
}

async function openA11yPanel(page) {
  const direct = page.getByRole('button', { name: 'Настройки доступности', exact: true });
  if (!await direct.isVisible()) {
    await page.getByRole('button', { name: 'Дополнительное меню' }).click();
    await page.getByRole('button', { name: 'Все настройки доступности' }).click();
  } else {
    await direct.click();
  }
  await page.getByRole('dialog', { name: 'Панель доступности' }).waitFor();
}

test('header keeps only brand, prominent Geo and overflow visible on mobile; desktop has one account cluster', { skip: !browserEnabled }, async t => {
  const user = { id: 'test-user', email: 'very-long-post-office-operator-name@example.com', role: 'employee', isTerminal: false, confirmed: true, phoneVerified: true };
  const { page } = await mountHeader(t, 390, user);
  for (const width of [320, 360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const scale of [100, 125, 150]) {
      if (scale !== 100) {
        await openA11yPanel(page);
        await page.getByRole('dialog', { name: 'Панель доступности' }).getByRole('button', { name: new RegExp(`${scale}%$`) }).click();
        await page.getByRole('dialog', { name: 'Панель доступности' }).getByRole('button', { name: 'Готово' }).click();
      }
      const header = page.locator('.main-product-header');
      const geo = header.getByRole('button', { name: 'Определить местоположение' });
      assert.equal(await geo.count(), 1);
      assert.equal(await geo.getAttribute('aria-pressed'), 'false');
      const visibleButtons = await header.locator('.product-header-row button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => node.getAttribute('aria-label') || node.textContent.trim()));
      if (width < 768) {
        assert.deepEqual(visibleButtons, ['Определить местоположение', 'Дополнительное меню']);
      } else {
        assert(visibleButtons.includes('Настройки доступности'));
        assert(visibleButtons.includes('Звуковое оповещение'));
        assert(visibleButtons.some(name => name.includes('very-long-post-office-operator-name')));
        assert(!visibleButtons.includes('Дополнительное меню'));
      }
      const undersized = await header.locator('.product-header-row button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => { const { width, height } = node.getBoundingClientRect(); return width < 44 || height < 44; }).map(node => node.getAttribute('aria-label') || node.textContent.trim()));
      assert.deepEqual(undersized, [], `44px targets at ${width}px and ${scale}%`);
      assert(await header.evaluate(node => node.scrollWidth <= innerWidth + 1), `header overflow at ${width}px and ${scale}%`);
      if (process.env.HEADER_SCREENSHOTS && scale === 100 && (width === 390 || width === 1440)) {
        await page.screenshot({ path: width === 390 ? '/tmp/header-phase-after-mobile-390x844.png' : '/tmp/header-phase-after-desktop-1440x900.png' });
      }
      if (width === 390 && scale === 100) {
        await page.getByRole('button', { name: 'Дополнительное меню' }).click();
        const menu = page.locator('#mobile-service-menu');
        assert.equal(await menu.getByRole('button', { name: 'Профиль' }).count(), 1);
        assert.equal(await menu.getByRole('button', { name: 'Выйти' }).count(), 1);
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'hidden' });
      }
    }
  }
  await page.getByRole('button', { name: /very-long-post-office-operator-name/ }).click();
  const account = page.getByRole('menu', { name: 'Учётная запись' });
  await account.waitFor();
  assert.equal(await account.getByRole('menuitem', { name: 'Профиль' }).count(), 1);
  assert.equal(await account.getByRole('menuitem', { name: 'Настройки' }).count(), 1);
  assert.equal(await account.getByRole('menuitem', { name: 'Выйти' }).count(), 1);
  await page.keyboard.press('Escape');
  await account.waitFor({ state: 'hidden' });
  assert(await page.getByRole('button', { name: /very-long-post-office-operator-name/ }).evaluate(node => node === document.activeElement));
});

test('Geo control announces status and delegates one request to the location stream', { skip: !browserEnabled }, async t => {
  const { page } = await mountHeader(t, 390);
  const geo = page.getByRole('button', { name: 'Определить местоположение' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pochta:geo-status', { detail: { status: 'granted' } })));
  await page.waitForFunction(() => document.querySelector('button[aria-label="Определить местоположение"]')?.getAttribute('aria-pressed') === 'true');
  await page.evaluate(() => {
    window.__headerGeoRequests = 0;
    window.addEventListener('pochta:request-geo', () => window.__headerGeoRequests++);
  });
  await geo.click();
  assert.equal(await page.evaluate(() => window.__headerGeoRequests), 1);
  assert.equal(await page.getByRole('button', { name: 'Определяем местоположение' }).getAttribute('aria-busy'), 'true');
});

test('mobile disclosure connects its content, announces toggles and returns keyboard focus on Escape', { skip: !browserEnabled }, async t => {
  const { page } = await mountHeader(t, 320);
  const disclosure = page.getByRole('button', { name: 'Дополнительное меню' });
  await disclosure.click();
  const id = await disclosure.getAttribute('aria-controls');
  assert(id, 'mobile disclosure must identify its controlled content');
  const menu = page.locator(`#${id}`);
  await menu.waitFor();
  const sound = menu.getByRole('button', { name: /Звуковое оповещение/ });
  const before = await sound.getAttribute('aria-pressed');
  assert(['true', 'false'].includes(before), 'sound toggle must expose pressed state');
  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), String(before !== 'true'));
  const scale = menu.getByRole('button', { name: '150%', exact: true });
  await scale.click();
  assert.equal(await scale.getAttribute('aria-pressed'), 'true');
  await scale.focus();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Дополнительное меню');
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
});

test('text scale enlarges client text without changing root rem, marker, icon or control geometry across widths', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountHeader(t);
  await openA11yPanel(page);
  await page.getByRole('dialog', { name: 'Панель доступности' }).getByRole('button', { name: 'А+ 125%' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '', 'text preference must not mutate root font-size');
  await page.getByRole('dialog', { name: 'Панель доступности' }).getByRole('button', { name: 'Готово' }).click();
  await page.evaluate(() => {
    const original = window.ymaps.templateLayoutFactory.createClass;
    window.__markerTemplates = [];
    window.ymaps.templateLayoutFactory.createClass = html => { window.__markerTemplates.push(html); return original(html); };
  });
  const rootSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  for (const width of [320, 360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    let geometry;
    let textSize;
    for (const scale of [100, 125, 150]) {
      await openA11yPanel(page);
      const settings = page.getByRole('dialog', { name: 'Панель доступности' });
      await settings.getByRole('button', { name: new RegExp(`${scale}%$`) }).click();
      assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '', 'root inline font-size must remain untouched');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), rootSize);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.textScale), String(scale));
      const currentText = await settings.locator('#a11y-settings-title').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
      if (scale === 100) textSize = currentText;
      assert(Math.abs(currentText - textSize * scale / 100) < 0.1, 'panel text follows requested scale');
      const small = await page.locator('.main-product-header button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => node.getBoundingClientRect().width < 44 || node.getBoundingClientRect().height < 44).map(node => node.textContent.trim() || node.getAttribute('aria-label')));
      assert.deepEqual(small, [], 'visible header and settings targets are at least 44px');
      await settings.getByRole('button', { name: 'Готово' }).click();
      await open({ selectedBranchId: 'A' });
      await page.evaluate(() => {
        document.querySelector('#marker-measurement')?.remove();
        const host = document.createElement('div');
        host.id = 'marker-measurement';
        host.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none';
        host.innerHTML = window.__markerTemplates.find(html => html.includes('pvz-pin-marker')) || '';
        document.body.append(host);
      });
      const current = await page.evaluate(() => {
        const marker = document.querySelector('#marker-measurement .pvz-pin-marker');
        const control = document.querySelector('button[aria-label="Закрыть карту"]');
        const icon = control.querySelector('svg');
        return [marker, control, icon].map(node => { const box = node.getBoundingClientRect(); return [box.width, box.height]; });
      });
      if (scale === 100) geometry = current;
      assert.deepEqual(current, geometry, `marker/control/icon geometry at ${width}px, ${scale}%`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}px, ${scale}%`);
      await render({ isOpen: false });
    }
  }
});

test('map controls retain their hit geometry when header text preference increases', { skip: !browserEnabled }, async t => {
  const { page, open, render } = await mountHeader(t);
  await open();
  const baseline = await page.getByRole('button', { name: 'Закрыть карту' }).boundingBox();
  await render({ isOpen: false });
  await openA11yPanel(page);
  await page.getByRole('dialog', { name: 'Панель доступности' }).getByRole('button', { name: 'А++ 150%' }).click();
  await page.getByRole('dialog', { name: 'Панель доступности' }).getByRole('button', { name: 'Готово' }).click();
  await open();
  const scaled = await page.getByRole('button', { name: 'Закрыть карту' }).boundingBox();
  assert.deepEqual([scaled.width, scaled.height], [baseline.width, baseline.height]);
});

test('branch card images load lazily and describe stock imagery honestly', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t);
  await open({ selectedBranchId: 'A' });
  const photo = page.getByTestId('desktop-branch-card-overlay').locator('img');
  assert.equal(await photo.getAttribute('loading'), 'lazy');
  assert.equal(await photo.getAttribute('decoding'), 'async');
  assert.match(await photo.getAttribute('alt'), /Иллюстрация/);
  assert.doesNotMatch(await photo.getAttribute('alt'), /Вход в отделение/);
});

test('client branch picker thumbnails also expose truthful lazy and asynchronous imagery', { skip: !browserEnabled }, async t => {
  const { page } = await mountHeader(t);
  await page.route('**/api/v1/**', route => route.fulfill({ json: { items: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Первое отделение', address: 'г. Москва, ул. Мясницкая, д. 26' },
  ] } }));
  await page.evaluate(async () => {
    const [{ default: React }, { default: ReactDOM }, { ClientWorkspace }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'), import('/src/features/client/ClientWorkspace.tsx'),
    ]);
    const node = document.createElement('div');
    document.body.append(node);
    ReactDOM.createRoot(node).render(React.createElement(ClientWorkspace));
  });
  await page.getByRole('button', { name: /Записаться онлайн/ }).click();
  const photo = page.locator('button.cx-choice img').first();
  await photo.waitFor();
  assert.equal(await photo.getAttribute('loading'), 'lazy');
  assert.equal(await photo.getAttribute('decoding'), 'async');
  assert.match(await photo.getAttribute('alt'), /Иллюстрация/);
  await page.evaluate(() => { document.documentElement.dataset.textScale = '150'; });
  const crampedText = await page.locator('button.cx-choice .text-xs').evaluateAll(nodes => nodes.filter(node => parseFloat(getComputedStyle(node).lineHeight) < parseFloat(getComputedStyle(node).fontSize)).map(node => node.textContent.trim()));
  assert.deepEqual(crampedText, [], 'enlarged multi-line labels need matching line height');
});

test('header delegates one geolocation request and exposes locating state', async () => {
  const content = await readFile(new URL('../src/components/common/ProductHeader.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(content, /handleRequestGeo[\s\S]*navigator\.geolocation\.getCurrentPosition/);
  assert.match(content, /geoStatus === 'locating'/);
  assert.match(content, /aria-busy=/);
});

test('map dialog traps focus, closes on Escape, returns focus and restores body scrolling', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t, { width: 390, height: 844 });
  await open();
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  assert(await page.getByRole('dialog').evaluate(node => node.contains(document.activeElement)));
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    assert(await page.getByRole('dialog').evaluate(node => node.contains(document.activeElement)), `Tab ${i} escaped dialog`);
  }
  await page.locator('#opener').focus();
  assert(await page.getByRole('dialog').evaluate(node => node.contains(document.activeElement)), 'programmatic background focus is contained');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert(await page.locator('#opener').evaluate(node => node === document.activeElement));
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
});

test('mobile sheet exposes its expanded state through a keyboard-operable handle', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t, { width: 390, height: 844 });
  await open();
  const handle = page.getByRole('button', { name: 'Размер списка отделений' });
  assert.equal(await handle.count(), 1, 'mobile sheet handle is a labelled button');
  await handle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await handle.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Enter');
  assert.equal(await handle.getAttribute('aria-expanded'), 'false');
});

test('mobile branch choices and selected-card buttons are usable with keyboard and touch', { skip: !browserEnabled }, async t => {
  const { page, open } = await mountMap(t, { width: 390, height: 844 });
  await open();
  const branch = page.getByTestId('mobile-branch-bottom-sheet').getByRole('button', { name: /Первое отделение/ });
  assert.equal(await branch.count(), 1, 'mobile branch choice is keyboard operable');
  await page.getByTestId('mobile-branch-bottom-sheet').getByLabel('Поиск отделения').fill('Первое');
  const clearBox = await page.getByTestId('mobile-branch-bottom-sheet').getByRole('button', { name: 'Очистить поиск' }).boundingBox();
  assert(clearBox.width >= 44 && clearBox.height >= 44, 'search clear control has a 44px touch target');
  await page.getByTestId('mobile-branch-bottom-sheet').getByRole('button', { name: 'Очистить поиск' }).click();
  await branch.focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('mobile-branch-bottom-sheet').getByRole('button', { name: 'Свернуть карточку отделения' }).waitFor();
  const undersized = await page.getByRole('dialog').evaluate(node => Array.from(node.querySelectorAll('button')).filter(button => button.getClientRects().length).map(button => ({ name: button.getAttribute('aria-label') || button.textContent.trim(), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })).filter(button => button.width < 44 || button.height < 44));
  assert.deepEqual(undersized, [], 'visible owned map buttons have 44px touch targets');
});

test('accessibility panel has one source of truth for scale and keyboard-safe dialog semantics', async () => {
  const content = await readFile(new URL('../src/components/common/ProductHeader.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(content, /Увеличенный текст/);
  assert.match(content, /role="dialog"/);
  assert.match(content, /aria-labelledby="a11y-settings-title"/);
  assert.match(content, /a11yButtonRef\.current\?\.focus/);
  assert.match(content, /pochta_a11y_scale/);
});

test('focus system removes pointer outlines while retaining a shared focus-visible ring', async () => {
  const content = await readFile(new URL('../src/product.css', import.meta.url), 'utf8');
  assert.match(content, /--focus-ring-color:/);
  assert.match(content, /:focus:not\(:focus-visible\)/);
  assert.match(content, /\.cx-link-button/);
});
