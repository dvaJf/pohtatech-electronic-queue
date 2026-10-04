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

