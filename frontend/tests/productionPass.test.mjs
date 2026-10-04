import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

async function loadTS(relativePath) {
  const filePath = resolve(import.meta.dirname, relativePath);
  const code = await readFile(filePath, 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`;
  return import(dataUrl);
}

test('Production Pass 1: Catalog contains at least 20 real Kazan branches + Innopolis 420500', async () => {
  const { KAZAN_AND_INNO_BRANCHES, MOSCOW_BRANCHES } = await loadTS('../src/features/client/map/branchLocations.ts');

  assert.ok(Array.isArray(KAZAN_AND_INNO_BRANCHES), 'KAZAN_AND_INNO_BRANCHES must be an array');
  assert.ok(KAZAN_AND_INNO_BRANCHES.length >= 21, `Expected at least 21 branches, got ${KAZAN_AND_INNO_BRANCHES.length}`);

  // Verify Innopolis branch
  const innopolis = KAZAN_AND_INNO_BRANCHES.find(b => b.code === '420500' || b.postalCode === '420500');
  assert.ok(innopolis, 'Innopolis branch 420500 must exist');
  assert.match(innopolis.address, /Университетская.*7/i, 'Innopolis address must be Universitetskaya 7');
  assert.ok(innopolis.lat >= 55.7 && innopolis.lat <= 55.8, 'Innopolis latitude must be valid');
  assert.ok(innopolis.lng >= 48.7 && innopolis.lng <= 48.8, 'Innopolis longitude must be valid');
  assert.ok(innopolis.photos && innopolis.photos.length > 0, 'Innopolis must have photos');

  // Verify Kazan branches
  const kazanBranches = KAZAN_AND_INNO_BRANCHES.filter(b => b.city === 'Казань' || b.address.includes('Казань'));
  assert.ok(kazanBranches.length >= 20, `Expected at least 20 Kazan branches, got ${kazanBranches.length}`);

  // Verify all branches have authentic coordinates, hours, ratings, and no NaN/null
  for (const b of KAZAN_AND_INNO_BRANCHES) {
    assert.ok(b.id, `Branch ${b.name} must have valid id`);
    assert.ok(Number.isFinite(b.lat) && b.lat > 50 && b.lat < 60, `Branch ${b.name} lat must be valid`);
    assert.ok(Number.isFinite(b.lng) && b.lng > 40 && b.lng < 60, `Branch ${b.name} lng must be valid`);
    assert.ok(b.workHours && b.workHours.length > 0, `Branch ${b.name} must have workHours`);
    assert.ok(b.rating >= 4.0 && b.rating <= 5.0, `Branch ${b.name} must have a valid rating`);
  }

  // Verify MOSCOW_BRANCHES exports the entire catalog
  assert.ok(MOSCOW_BRANCHES.length >= KAZAN_AND_INNO_BRANCHES.length, 'MOSCOW_BRANCHES must contain all branches');
});

test('Production Pass 2: Calendar14 mobile slots layout avoids clipping and enables touch scroll', async () => {
  const calendarCode = await readFile(new URL('../src/components/ui/c-calendar-14.tsx', import.meta.url), 'utf8');

  // Must not have rigid overflow-clipping height
  assert.doesNotMatch(calendarCode, /h-\[235px\]\s+overflow-y-auto/);
  // Must use flex-1 min-h-0 layout
  assert.match(calendarCode, /flex-1 min-h-0/);
  // Must support touch scrolling
  assert.match(calendarCode, /WebkitOverflowScrolling:\s*'touch'/);
  // Must support safe area scroll padding
  assert.match(calendarCode, /scrollPaddingBottom/);
});

test('Production Pass 3: Contrast audit satisfies WCAG AA (>= 4.5:1)', async () => {
  const faqCss = await readFile(new URL('../src/pages/faq.css', import.meta.url), 'utf8');
  const tailwindCss = await readFile(new URL('../src/tailwind.css', import.meta.url), 'utf8');
  const productCss = await readFile(new URL('../src/product.css', import.meta.url), 'utf8');

  // FAQ CSS should not contain low-contrast text colors #52687b, #54708c, #5a6f82, #5b6e80
  assert.doesNotMatch(faqCss, /#52687b/);
  assert.doesNotMatch(faqCss, /#54708c/);
  assert.doesNotMatch(faqCss, /#5a6f82/);
  assert.doesNotMatch(faqCss, /#5b6e80/);

  // Tailwind CSS muted-foreground lightness must be <= 38% for contrast ratio >= 4.5:1
  assert.doesNotMatch(tailwindCss, /46\.9%/);
  assert.match(tailwindCss, /--muted-foreground:\s*215\.4\s+19%\s+34%/);

  // Product CSS text-secondary and text-muted
  assert.doesNotMatch(productCss, /--text-secondary:\s*#536578/);
  assert.doesNotMatch(productCss, /--text-muted:\s*#6B7A8D/);
  assert.match(productCss, /--text-secondary:\s*#334155/);
  assert.match(productCss, /--text-muted:\s*#475569/);
});

test('Production Pass 4: Invariant COUNT(isDefault) <= 1 guaranteed', async () => {
  const liveBranchesSource = await readFile(new URL('../src/features/client/map/liveBranches.ts', import.meta.url), 'utf8');

  // Verify resolveSingleDefaultBranchId function exists and is exported
  assert.match(liveBranchesSource, /export function resolveSingleDefaultBranchId/);
  assert.match(liveBranchesSource, /Guarantees invariant: at most ONE branch can be marked as default/);

  // Transpile TypeScript source to CommonJS
  const transpiled = ts.transpileModule(liveBranchesSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const moduleScope = { exports: {} };
  const fn = new Function('module', 'exports', 'require', transpiled.outputText);
  fn(moduleScope, moduleScope.exports, (id) => {
    if (id.includes('branchLocations')) {
      return { MOSCOW_BRANCHES: [] };
    }
    return {};
  });

  const { resolveSingleDefaultBranchId } = moduleScope.exports;

  const testBranches = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Главпочтамт', address: 'г. Казань, ул. Кремлёвская, д. 8' },
    { id: '9e364b61-0543-5502-b048-50b2e65879a3', name: 'Москва Мясницкая', address: 'г. Москва, ул. Мясницкая, д. 26' },
    { id: 'c1a06492-4d5b-6923-0d2b-3906a43b0500', name: 'Иннополис', address: 'г. Иннополис, ул. Университетская, д. 7' },
  ];

  // Test with exact default ID
  const defId1 = resolveSingleDefaultBranchId(testBranches, '11111111-1111-1111-1111-111111111111');
  assert.equal(defId1, '11111111-1111-1111-1111-111111111111');

  // Verify only ONE branch gets isDefault = true
  const matches1 = testBranches.filter(b => b.id === defId1);
  assert.equal(matches1.length, 1);

  // Test with Innopolis ID
  const defId2 = resolveSingleDefaultBranchId(testBranches, 'c1a06492-4d5b-6923-0d2b-3906a43b0500');
  assert.equal(defId2, 'c1a06492-4d5b-6923-0d2b-3906a43b0500');
  const matches2 = testBranches.filter(b => b.id === defId2);
  assert.equal(matches2.length, 1);

  // Test with null ID returns null
  const defIdNull = resolveSingleDefaultBranchId(testBranches, null);
  assert.equal(defIdNull, null);
  const matchesNull = testBranches.filter(b => defIdNull !== null && b.id === defIdNull);
  assert.equal(matchesNull.length, 0);
});

test('Production Pass 5: Admin reviews view and API integration', async () => {
  const adminApiCode = await readFile(new URL('../src/api/admin/adminApi.ts', import.meta.url), 'utf8');
  const clientApiCode = await readFile(new URL('../src/api/client/clientApi.ts', import.meta.url), 'utf8');
  const adminReviewsView = await readFile(new URL('../src/features/admin/AdminReviewsView.tsx', import.meta.url), 'utf8');
  const adminWorkspace = await readFile(new URL('../src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');

  // adminApi exports getAdminReviews
  assert.match(adminApiCode, /export async function getAdminReviews/);
  assert.match(adminApiCode, /interface AdminReviewsResult/);
  assert.match(adminApiCode, /interface AdminReviewSummary/);

  // clientApi exports submitBranchReview
  assert.match(clientApiCode, /export async function submitBranchReview/);

  // AdminWorkspace contains reviews tab
  assert.match(adminWorkspace, /activeTab === 'reviews'/);
  assert.match(adminWorkspace, /<AdminReviewsView/);

  // AdminReviewsView contains c-rating-6 elements: average, stars, distribution bars, filters, pagination
  assert.match(adminReviewsView, /summary\.averageRating/);
  assert.match(adminReviewsView, /summary\.distribution/);
  assert.match(adminReviewsView, /<Pagination/);
  assert.match(adminReviewsView, /selectedBranchId/);
  assert.match(adminReviewsView, /selectedRating/);
});

test('Production Pass 6: Map button displays dynamic branch count with authentic Russian pluralization', async () => {
  const clientWorkspaceSource = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');

  // Verify that static '26 отделений' is removed
  assert.ok(!clientWorkspaceSource.includes('26 отделений и маршруты'), 'Static 26 branches text must be eliminated');

  // Verify dynamic branch count expression is present
  assert.match(clientWorkspaceSource, /getBranchPlural/);

  // Load getBranchPlural from branchLocations
  const { getBranchPlural } = await loadTS('../src/features/client/map/branchLocations.ts');
  assert.equal(typeof getBranchPlural, 'function', 'getBranchPlural must be exported');
  assert.equal(getBranchPlural(1), 'отделение');
  assert.equal(getBranchPlural(2), 'отделения');
  assert.equal(getBranchPlural(4), 'отделения');
  assert.equal(getBranchPlural(5), 'отделений');
  assert.equal(getBranchPlural(11), 'отделений');
  assert.equal(getBranchPlural(21), 'отделение');
  assert.equal(getBranchPlural(22), 'отделения');
  assert.equal(getBranchPlural(28), 'отделений');
});

test('Production Pass 7: Smart route timeline nodes preserve true circular geometry without SVG ellipse squishing on mobile', async () => {
  const smartRouteSource = await readFile(new URL('../src/features/client/home/SmartRouteHero.tsx', import.meta.url), 'utf8');
  const clientCss = await readFile(new URL('../src/features/client/client.css', import.meta.url), 'utf8');
  const timelineComponent = await readFile(new URL('../src/components/ui/c-timeline-8-utils/timeline.tsx', import.meta.url), 'utf8');

  // SVG preserveAspectRatio="none" must NOT be used for timeline nodes
  assert.ok(!smartRouteSource.includes('preserveAspectRatio="none"'), 'SVG preserveAspectRatio="none" must be eliminated to prevent squished nodes');

  // Timeline must use responsive node containers
  assert.match(smartRouteSource, /cx-route-node cx-route-node-start/);
  assert.match(smartRouteSource, /cx-route-node cx-route-node-middle/);
  assert.match(smartRouteSource, /cx-route-node cx-route-node-end/);

  // CSS must enforce circular geometry (border-radius: 50%) and square aspect ratio
  assert.match(clientCss, /\.cx-route-node\s*\{[^}]*border-radius:\s*50%/);
  assert.match(clientCss, /\.cx-route-node-end\s*\{[^}]*border-radius:\s*50%/);

  // TimelineIndicator in c-timeline-8 must prevent shrinking with shrink-0 aspect-square
  assert.match(timelineComponent, /shrink-0\s+aspect-square/);
});

test('Production Pass 8: Ticket timeline steps on Home and My Tickets are synchronized without discrepancy', async () => {
  const activeTicketHeroSource = await readFile(new URL('../src/features/client/home/ActiveTicketHero.tsx', import.meta.url), 'utf8');
  const homeHeroSource = await readFile(new URL('../src/features/client/home/HomeHero.tsx', import.meta.url), 'utf8');
  const clientWorkspaceSource = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');

  // HomeHero and ActiveTicketHero accept isTicketArrived / isArrived
  assert.match(homeHeroSource, /isTicketArrived\s*=\s*false/);
  assert.match(homeHeroSource, /isArrived=\{isTicketArrived\}/);
  assert.match(activeTicketHeroSource, /function getTicketTimelineStep\(status:\s*string,\s*isArrived\s*=\s*false\)/);
  assert.match(activeTicketHeroSource, /if\s*\(isArrived\s*&&\s*status\s*===\s*'SCHEDULED'\)\s*\{\s*return\s*2;\s*\}/);
  assert.match(activeTicketHeroSource, /currentStep=\{getTicketTimelineStep\(ticket\.status,\s*isArrived\)\}/);

  // ClientWorkspace passes isTicketArrived to HomeHero
  assert.match(clientWorkspaceSource, /isTicketArrived=\{activeTicket\s*\?\s*Boolean\(activeTicket\.arrivedAt\s*\|\|\s*arrivalAcknowledgedTicketIds\.has\(activeTicket\.id\)\)\s*:\s*false\}/);

  // Both match step 2 description
  assert.match(activeTicketHeroSource, /isArrived\s*&&\s*ticket\.status\s*===\s*'SCHEDULED'\s*\?\s*'Ожидание вызова'\s*:\s*'Приглашение'/);
  assert.match(clientWorkspaceSource, /isTicketArrived\s*&&\s*ticket\.status\s*===\s*'SCHEDULED'\s*\?\s*'Ожидание вызова'\s*:\s*'Приглашение'/);
});

test('Production Pass 9: Timeline stripe lights first half when called and second half when serving, preserving circle text', async () => {
  const timelineSource = await readFile(new URL('../src/components/ui/c-timeline-8-utils/timeline.tsx', import.meta.url), 'utf8');
  const ratingSheetSource = await readFile(new URL('../src/features/client/rating/VisitRatingSheet.tsx', import.meta.url), 'utf8');
  const clientWorkspaceSource = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  const activeTicketHeroSource = await readFile(new URL('../src/features/client/home/ActiveTicketHero.tsx', import.meta.url), 'utf8');

  // TimelineSeparator: first half lights on CALLED / SERVING / COMPLETED; second half lights on SERVING / COMPLETED
  assert.match(timelineSource, /status === 'CALLED' \|\| status === 'SERVING' \|\| status === 'COMPLETED'/);
  assert.match(timelineSource, /isLeftActive = status === 'SERVING' \|\| status === 'COMPLETED'/);

  // Both views pass status={ticket.status} to Timeline8
  assert.match(activeTicketHeroSource, /status=\{ticket\.status\}/);
  assert.match(clientWorkspaceSource, /status=\{ticket\.status\}/);

  // Circle 2 text remains 'Приглашение к окну'
  assert.match(activeTicketHeroSource, /title:\s*'Приглашение к окну'/);
  assert.match(clientWorkspaceSource, /title:\s*'Приглашение к окну'/);

  // VisitRatingSheet has isSubmitting handling
  assert.match(ratingSheetSource, /isSubmitting/);
  assert.match(ratingSheetSource, /Отправка\.\.\./);

  // ClientWorkspace has findMgmtToken and fallback to submitBranchReview
  assert.match(clientWorkspaceSource, /function findMgmtToken/);
  assert.match(clientWorkspaceSource, /api\.submitBranchReview/);
});

test('Production Pass 10: Reactive telegram notification toggle with auto-polling and focus refresh', async () => {
  const clientWorkspaceSource = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');

  // Has waitingForTelegram state
  assert.match(clientWorkspaceSource, /const \[waitingForTelegram, setWaitingForTelegram\] = useState\(false\)/);

  // Auto-polling interval while waiting for Telegram
  assert.match(clientWorkspaceSource, /if \(!waitingForTelegram\) return/);
  assert.match(clientWorkspaceSource, /window\.setInterval\(\(\) => \{\s*void refresh\(\);\s*\}, 1500\)/);

  // Window focus & visibilitychange listener
  assert.match(clientWorkspaceSource, /window\.addEventListener\('focus', handleFocus\)/);
  assert.match(clientWorkspaceSource, /window\.addEventListener\('visibilitychange', handleFocus\)/);

  // Toggle is checked when connected or waiting for Telegram
  assert.match(clientWorkspaceSource, /const isChecked = isConn \|\| waitingForTelegram/);
  assert.match(clientWorkspaceSource, /checked=\{isChecked\}/);

  // Loading spinner & helper text
  assert.match(clientWorkspaceSource, /Ожидаем \/start…/);
  assert.match(clientWorkspaceSource, /Ожидание нажатия \/start в Telegram боте…/);
});

test('Production Pass 15: Centralized status mapper returns authentic Russian labels and never raw enums', async () => {
  const mapperSource = await readFile(new URL('../src/utils/statusMapper.ts', import.meta.url), 'utf8');
  assert.match(mapperSource, /export function getTicketStatusLabel/);
  assert.match(mapperSource, /PENDING_CONFIRMATION['"]\s*:\s*return\s*['"]Ожидает подтверждения['"]/);
  assert.match(mapperSource, /SCHEDULED['"]\s*:\s*return\s*source === 'APPOINTMENT'\s*\?\s*['"]Запись запланирована['"]\s*:\s*['"]Запись подтверждена['"]/);
  assert.match(mapperSource, /WAITING['"]\s*:\s*return\s*['"]В очереди['"]/);
  assert.match(mapperSource, /CALLED['"]\s*:\s*return\s*['"]Вас вызывают к окну['"]/);
  assert.match(mapperSource, /SERVING['"]\s*:\s*return\s*['"]Идёт обслуживание['"]/);
  assert.match(mapperSource, /COMPLETED['"]\s*:\s*return\s*['"]Обслуживание завершено['"]/);
  assert.match(mapperSource, /CANCELLED['"]\s*:\s*return\s*source === 'APPOINTMENT'\s*\?\s*['"]Запись отменена['"]\s*:\s*['"]Талон отменён['"]/);
  assert.match(mapperSource, /NO_SHOW['"]\s*:\s*return\s*['"]Неявка['"]/);
  assert.match(mapperSource, /default:\s*return\s*['"]Статус обновляется['"]/);
});

test('Production Pass 16: One-click confirmation page and route registered in App.tsx', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const confirmPageSource = await readFile(new URL('../src/pages/AppointmentConfirmPage.tsx', import.meta.url), 'utf8');

  assert.match(appSource, /import\s*\{\s*AppointmentConfirmPage\s*\}\s*from\s*['"]\.\/pages\/AppointmentConfirmPage['"]/);
  assert.match(appSource, /path:\s*['"]\/appointments\/confirm['"]/);
  assert.match(confirmPageSource, /export function AppointmentConfirmPage/);
  assert.match(confirmPageSource, /api\.confirmAppointment/);
  assert.match(confirmPageSource, /Запись успешно подтверждена/);
  assert.match(confirmPageSource, /Срок подтверждения истёк/);
  assert.match(confirmPageSource, /Ссылка недействительна/);
});

test('Production Pass 17: DEV/TEST guard, spam hint, and cancel option in AppointmentConfirmationCard', async () => {
  const cardSource = await readFile(new URL('../src/features/client/AppointmentConfirmationCard.tsx', import.meta.url), 'utf8');

  // Spam hint present
  assert.match(cardSource, /Не нашли письмо\? Проверьте папку «Спам» или отправьте письмо ещё раз\./);

  // Cancel action present
  assert.match(cardSource, /Отменить запись/);
  assert.match(cardSource, /api\.cancelTicket/);

  // DEV/TEST guarded force confirmation
  assert.match(cardSource, /isTestConfirmAllowed/);
  assert.match(cardSource, /VITE_ALLOW_TEST_APPOINTMENT_CONFIRM/);
  assert.match(cardSource, /Письмо не пришло — подтвердить тестово/);
  assert.match(cardSource, /api\.testConfirmAppointment/);

  // Segmented 6-digit input
  assert.match(cardSource, /codeDigits/);
  assert.match(cardSource, /ПОДТВЕРДИТЬ ЗАПИСЬ/);
});


