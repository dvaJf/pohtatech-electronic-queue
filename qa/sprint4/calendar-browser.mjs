import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/tmp/queue-browser/node_modules/playwright/index.mjs');
const baseURL = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';

const branch = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Главпочтамт г. Рязань',
  address: 'г. Рязань, ул. Почтовая, д. 49',
  workHours: '08:00–20:00',
  ratingAverage: 4.8,
  ratingCount: 12,
};

const ticket = {
  id: '9a8c3a6e-4982-4e55-9b9e-87ea30d096d1',
  publicNumber: 'A-000347',
  branchId: branch.id,
  serviceId: 'service-1',
  source: 'APPOINTMENT',
  status: 'SCHEDULED',
  window: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  queueEnteredAt: '2026-09-30T11:30:00.000Z',
  calledAt: null,
  serviceStartedAt: null,
  completedAt: null,
};

const appointment = { ticket, scheduledAt: '2026-09-30T11:30:00.000Z' };

async function fulfillApi(route) {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith('/auth/me')) return route.fulfill({ status: 401, json: { error: { message: 'unauthenticated' } } });
  if (pathname.endsWith('/branches')) return route.fulfill({ json: { items: [branch] } });
  if (pathname.endsWith(`/tickets/${ticket.id}`)) return route.fulfill({ json: ticket });
  if (pathname.endsWith('/position')) {
    return route.fulfill({ json: {
      ticketId: ticket.id, ticketStatus: 'SCHEDULED', reason: 'NOT_ELIGIBLE_YET', position: null,
      referenceWindow: null, calculatedAt: '2026-09-01T10:00:00.000Z', effectivePriority: null, effectiveQueueTime: null,
    } });
  }
  if (pathname.endsWith('/eta')) return route.fulfill({ json: {
    ticketId: ticket.id, ticketStatus: 'SCHEDULED', reason: 'NOT_ELIGIBLE_YET', estimatedWaitSeconds: null,
    estimatedCallAt: null, position: null, referenceWindow: null, sampleSize: 0, usedFallback: false, calculatedAt: '2026-09-01T10:00:00.000Z',
  } });
  if (pathname.endsWith('/notification-capabilities')) return route.fulfill({ json: {
    telegram: { enabled: false, mode: 'demo' }, webPush: { enabled: false, mode: 'demo' }, sms: { enabled: false, mode: 'demo' }, email: { enabled: false, mode: 'demo' },
  } });
  if (pathname.endsWith('/notifications')) return route.fulfill({ json: { items: [] } });
  if (pathname.endsWith('/workload')) return route.fulfill({ json: {
    branchId: branch.id, currentHour: 12, currentWaiting: 0, sampleCount: 0, isHistorical: false, hourly: [],
  } });
  return route.fulfill({ json: { items: [] } });
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(({ seededTicket, seededAppointment }) => {
    const scope = 'anon';
    sessionStorage.setItem(`client_active_tickets_cache:${scope}`, JSON.stringify([seededTicket]));
    sessionStorage.setItem(`client_active_ticket_ids:${scope}`, JSON.stringify([seededTicket.id]));
    sessionStorage.setItem(`client.appointments:${scope}`, JSON.stringify({ [seededTicket.id]: seededAppointment }));
  }, { seededTicket: ticket, seededAppointment: appointment });
  const page = await context.newPage();
  await page.route('**/api/**', fulfillApi);
  await page.goto(baseURL);

  await page.getByRole('button', { name: 'Открыть талон' }).click();
  const trigger = page.getByRole('button', { name: 'Добавить в календарь' });
  await trigger.waitFor();
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Добавить в календарь' });
  await dialog.waitFor();
  await assert.doesNotReject(() => dialog.getByRole('button', { name: /Скачать \.ics/ }).waitFor());

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('Добавить в календарь')), true, 'Escape restores focus to the calendar trigger');

  await trigger.click();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Скачать \.ics/ }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.ics$/i);
  await context.close();
  console.log('PASS: confirmed appointment calendar CTA, menu, Escape focus restoration, and .ics download');
} finally {
  await browser.close();
}
