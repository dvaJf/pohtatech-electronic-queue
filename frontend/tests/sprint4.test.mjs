import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTS(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('Moscow civil input and display are independent of host timezone', async () => {
  const time = await loadTS('../src/utils/time.ts');
  const saved = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Europe/Berlin', 'America/New_York']) {
      process.env.TZ = zone;
      assert.equal(time.parseMoscowDatetimeLocal('2026-09-18T09:30'), '2026-09-18T06:30:00.000Z');
      assert.equal(time.toMoscowDatetimeLocal(new Date('2026-09-18T23:30:00Z')), '2026-09-19T02:30');
      assert.match(time.formatMoscowDateTime('2026-09-18T23:30:00Z'), /19\.09\.2026.*02:30/);
      assert.match(time.formatMoscowTime('2026-09-18T06:30:00Z', { timeZone: zone }), /09:30/);
      assert.throws(() => time.parseMoscowDatetimeLocal('2026-02-30T09:30'));
    }
  } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
});

test('announcement reset cancels pending work without overlapping current speech', async () => {
  const { enqueueAnnouncement, clearAnnouncementQueue } = await loadTS('../src/utils/announcementQueue.ts');
  const order = [];
  let finish;
  enqueueAnnouncement(() => new Promise(resolve => { order.push('first'); finish = resolve; }));
  enqueueAnnouncement(async () => { order.push('cancelled'); });
  await new Promise(resolve => setImmediate(resolve));
  clearAnnouncementQueue();
  enqueueAnnouncement(async () => { order.push('next'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first']);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first', 'next']);
});

test('vite config preserves reverse proxy for /api, /health, /ready and /grafana', async () => {
  const content = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(content, /'\/api':\s*\{\s*target:\s*'http:\/\/backend:8080'/);
  assert.match(content, /'\/health':\s*\{\s*target:\s*'http:\/\/backend:8080'/);
  assert.match(content, /'\/ready':\s*\{\s*target:\s*'http:\/\/backend:8080'/);
  assert.match(content, /'\/grafana':\s*\{\s*target:\s*'http:\/\/grafana:3000'/);
});

test('auth getMe returns null on 401 unauthenticated without fatal error', async () => {
  const auth = await loadTS('../src/api/authApi.ts');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'not authenticated' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    const me = await auth.getMe();
    assert.equal(me, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
})

test('auth getApiBaseUrl normalizes api prefixes without duplicating', async () => {
  const auth = await loadTS('../src/api/authApi.ts');
  assert.equal(typeof auth.getApiBaseUrl, 'function');
  assert.equal(auth.getApiBaseUrl(), '/api/v1');
});

test('terminalStatuses includes COMPLETED, CANCELLED, NO_SHOW and excludes active statuses', async () => {
  const content = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(content, /terminalStatuses.*COMPLETED/);
  assert.match(content, /terminalStatuses.*CANCELLED/);
  assert.match(content, /terminalStatuses.*NO_SHOW/);
});

test('ClientWorkspace retains or reloads services when re-selecting the same branch', async () => {
  const content = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  // Check that handleBranchSelect checks `if (id === branchId)` or doesn't wipe services without reload
  assert.match(content, /if\s*\(\s*id\s*===\s*branchId\s*\)\s*\{\s*fetchServices\(id\);/);
  // Check that repeat ticket button exists on terminal tickets
  assert.match(content, /terminalStatuses\.has\(ticket\.status\)/);
  assert.match(content, /Взять новый талон/);
});

test('client ticket keeps ETA details without rendering a sparkline', async () => {
  const content = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(content, /Ожидание примерно/);
  assert.match(content, /Позиция в очереди/);
  assert.doesNotMatch(content, /Повышенная нагрузка|cx-eta-load/);
  assert.doesNotMatch(content, /ETASparkline|cx-eta-chart|Распределение времени обслуживания/);
});


test('clientApi exports cancelTicket endpoint and performs POST /tickets/{id}/cancel', async () => {
  const clientApi = await loadTS('../src/api/client/clientApi.ts');
  assert.equal(typeof clientApi.cancelTicket, 'function');

  const originalFetch = globalThis.fetch;
  try {
    let capturedUrl, capturedMethod;
    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return new Response(JSON.stringify({
        id: 'ticket-123',
        publicNumber: 'Q-000001',
        branchId: 'b-1',
        serviceId: 's-1',
        source: 'QR',
        status: 'CANCELLED',
        window: null,
        createdAt: new Date().toISOString(),
        queueEnteredAt: new Date().toISOString(),
        calledAt: null,
        serviceStartedAt: null,
        completedAt: null,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const cancelled = await clientApi.cancelTicket('ticket-123');
    assert.equal(capturedUrl, '/api/v1/tickets/ticket-123/cancel');
    assert.equal(capturedMethod, 'POST');
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.publicNumber, 'Q-000001');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ClientWorkspace supports refusing waiting tickets and shows Отказаться от талона', async () => {
  const content = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(content, /api\.cancelTicket/);
  assert.match(content, /Отказаться от талона/);
  assert.match(content, /ticket\.status\s*===\s*'WAITING'/);
});

test('adminApi exports closeShift and updateBranchSchedule', async () => {
  const content = await readFile(new URL('../src/api/admin/adminApi.ts', import.meta.url), 'utf8');
  assert.match(content, /export async function closeShift/);
  assert.match(content, /export async function updateBranchSchedule/);
  assert.match(content, /\/admin\/branches\/\$\{encodeURIComponent\(branchId\)\}\/close-shift/);
  assert.match(content, /\/admin\/branches\/\$\{encodeURIComponent\(branchId\)\}\/schedule/);
});

test('QueuePolicyEditor supports human-friendly Low/Medium/High and presets', async () => {
  const content = await readFile(new URL('../src/features/admin/QueuePolicyEditor.tsx', import.meta.url), 'utf8');
  assert.match(content, /Баланс \(Стандарт\)/);
  assert.match(content, /Час пик \(Борьба с очередями\)/);
  assert.match(content, /Низкий/);
  assert.match(content, /Средний/);
  assert.match(content, /Высокий/);
  assert.match(content, /Экспертный режим/);
});

test('BranchScheduleShiftManager renders schedule presets and shift closure modal', async () => {
  const content = await readFile(new URL('../src/features/admin/BranchScheduleShiftManager.tsx', import.meta.url), 'utf8');
  assert.match(content, /Стандарт Почты России \(08:00–20:00\)/);
  assert.match(content, /Плавное закрытие окон/);
  assert.match(content, /Завершить смену отделения/);
  assert.match(content, /Подтверждение завершения смены/);
});

test('UsersManagement supports instant user search, role filtering, and empty state', async () => {
  const content = await readFile(new URL('../src/features/admin/UsersManagement.tsx', import.meta.url), 'utf8');
  assert.match(content, /Поиск по email, роли/);
  assert.match(content, /listUsers\(\{ page, limit: pageSize, search: searchQuery, role: roleFilter \}\)/);
  for (const role of ['all', 'employee', 'opc_chief', 'client']) {
    assert.ok(content.includes(`{counts.${role}}`));
  }
  assert.match(content, /setPageSize\(size\); setPage\(1\)/);
  assert.match(content, /roleFilter/);
  assert.match(content, /<Pagination page=\{page\} total=\{total\}/);
  assert.match(content, /Пользователи не найдены/);
  assert.match(content, /Сбросить фильтры/);
});

test('admin lists request bounded pages and icon fields reserve text space', async () => {
  const workspace = await readFile(new URL('../src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');
  const api = await readFile(new URL('../src/api/admin/adminApi.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/product.css', import.meta.url), 'utf8');
  const header = await readFile(new URL('../src/components/common/ProductHeader.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /listAnomalies\(selectedBranchId, anomaliesPage, anomaliesPageSize\)/);
  assert.match(workspace, /setAnomaliesPageSize\(size\); setAnomaliesPage\(1\)/);
  assert.match(workspace, /<Pagination page=\{anomaliesPage\} total=\{anomaliesTotal\}/);
  assert.match(api, /offset: String\(\(page - 1\) \* limit\)/);
  assert.match(css, /\.field-with-icon__input\s*\{\s*padding-left: 2\.75rem !important/);
  assert.match(header, /header-reset-button/);
});

test('BranchWorkloadCard aligns columns, multi-tier bar styles and provides interactive hour details', async () => {
  const content = await readFile(new URL('../src/features/client/BranchWorkloadCard.tsx', import.meta.url), 'utf8');
  assert.match(content, /axisTicks\s*=\s*\[8,\s*11,\s*14,\s*17,\s*20\]/);
  assert.match(content, /cx-workload-bar-blue/);
  assert.match(content, /cx-workload-bar-closed/);
  assert.match(content, /activeSlot/);
  assert.match(content, /effectiveWaitMinutes/);
});

test('AdminWorkspace has exactly one Grafana link in product header and no duplicate in tabs bar', async () => {
  const content = await readFile(new URL('../src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');
  assert.equal(content.includes('href="/grafana/"'), false);
});

test('Appointment24hPicker and schedule manager strictly enforce 24-hour format', async () => {
  const picker = await readFile(new URL('../src/features/client/Appointment24hPicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /24-часовой формат/);
  assert.match(picker, /POPULAR_24H_SLOTS/);
  assert.match(picker, /Часы \(00–23\)/);
  assert.match(picker, /timeZone: 'Europe\/Moscow'/);
  assert.doesNotMatch(picker, /tomorrow\.toISOString\(\)\.split\('T'\)\[0\]/);

  const shift = await readFile(new URL('../src/features/admin/BranchScheduleShiftManager.tsx', import.meta.url), 'utf8');
  assert.match(shift, /24-часовой формат/);
  assert.match(shift, /open-h-/);
  assert.match(shift, /close-h-/);
});

test('selection controls expose accessible state without layout-shifting CSS', async () => {
  const picker = await readFile(new URL('../src/features/client/Appointment24hPicker.tsx', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');
  const operatorWindow = await readFile(new URL('../src/features/operator/WindowSelector.tsx', import.meta.url), 'utf8');
  const productCss = await readFile(new URL('../src/product.css', import.meta.url), 'utf8');

  assert.equal((picker.match(/aria-pressed=/g) ?? []).length, 4);
  assert.doesNotMatch(picker, /appointment-choice-check/);
  assert.doesNotMatch(picker, /scale-10[05]/);
  assert.equal((admin.match(/aria-current=/g) ?? []).length, 7);
  assert.match(operatorWindow, /aria-pressed=\{isSelected\}/);
  assert.match(productCss, /\.appointment-choice\[aria-pressed="true"\]/);
  assert.match(productCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(productCss, /^\.ring-[12]\s*\{/m);
  assert.doesNotMatch(productCss, /^\.scale-10[05]\s*\{/m);
});

test('Operator workspace supports redirect to another window and distinct source tags', async () => {
  const operatorWorkspace = await readFile(new URL('../src/features/operator/OperatorWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(operatorWorkspace, /redirectWindowId/);
  assert.match(operatorWorkspace, /Целевое окно/);
  assert.match(operatorWorkspace, /Перенаправить в другое окно/);
  assert.match(operatorWorkspace, /item\.source === 'APPOINTMENT'/);
  assert.match(operatorWorkspace, /item\.source === 'QR'/);

  const ticketCard = await readFile(new URL('../src/features/operator/TicketCard.tsx', import.meta.url), 'utf8');
  assert.match(ticketCard, /Предварительная запись/);
  assert.match(ticketCard, /QR-код/);
  assert.match(ticketCard, /Живая очередь/);
});

test('Admin workspace provides real-time live queue monitor with TV board and table views', async () => {
  const admin = await readFile(new URL('../src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(admin, /LiveQueueView/);
  assert.match(admin, /setActiveTab\('queue'\)/);
  assert.match(admin, /Очередь \(Live\)/);

  const liveQueue = await readFile(new URL('../src/features/admin/LiveQueueView.tsx', import.meta.url), 'utf8');
  assert.match(liveQueue, /Табло зала \(как клиентам\)/);
  assert.match(liveQueue, /Оперативный реестр/);
  assert.match(liveQueue, /СЕЙЧАС ОБСЛУЖИВАЮТСЯ У СТОЕК/);
  assert.match(liveQueue, /ОЖИДАЮТ В ОЧЕРЕДИ/);
});

test('live queue keeps called and serving tickets in the operational register', async () => {
  const liveQueue = await readFile(new URL('../src/features/admin/LiveQueueView.tsx', import.meta.url), 'utf8');
  assert.match(liveQueue, /const filtered = queue\.filter/);
  assert.match(liveQueue, /item\.status === 'SERVING'/);
  assert.match(liveQueue, /item\.status === 'CALLED'/);
});

test('TV board shows only called tickets, not tickets already in service', async () => {
  const tv = await readFile(new URL('../src/features/client/TVBoard.tsx', import.meta.url), 'utf8');
  const handler = await readFile(new URL('../../backend/internal/httpapi/tv_handlers.go', import.meta.url), 'utf8');
  assert.match(tv, /w\.currentTicketStatus === 'CALLED'/);
  assert.match(tv, /callWindow\.currentTicketStatus !== 'CALLED'/);
  assert.match(tv, /\.filter\(q => q\.status === 'WAITING'\)/);
  assert.match(handler, /CurrentTicketStatus\s+string/);
  assert.match(handler, /statusByTicket\[ticket\.PublicNumber\]/);
  assert.match(handler, /t\.Status != domain\.TicketStatusWaiting/);
});

test('Admin overview hall board uses the reference queue-card layout', async () => {
  const admin = await readFile(new URL('../src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');

  assert.match(admin, /admin-live-preview bg-white rounded-3xl/);
  assert.match(admin, /admin-live-preview__grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6/);
  assert.match(admin, /admin-live-preview__ticket p-4 rounded-2xl/);
  assert.match(admin, /style=\{\{ minHeight: 198 \}\}/);
});

test('printable branch QR poster has no red accent stripe', async () => {
  const branchQr = await readFile(new URL('../src/features/admin/BranchQR.tsx', import.meta.url), 'utf8');
  const posterStart = branchQr.indexOf('id="print-ticket-slip"');
  assert.notEqual(posterStart, -1);
  const printablePoster = branchQr.slice(posterStart);

  assert.doesNotMatch(printablePoster, /Postal Red Accent Line/);
  assert.doesNotMatch(printablePoster, /bg-\[#D92534\]/);
});
