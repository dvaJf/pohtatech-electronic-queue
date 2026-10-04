import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadTS(path) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  if (source.includes('../../../utils/workload')) {
    const workloadSource = await readFile(new URL('../src/utils/workload.ts', import.meta.url), 'utf8');
    const { outputText: wOut } = ts.transpileModule(workloadSource, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    });
    const wData = 'data:text/javascript;base64,' + Buffer.from(wOut).toString('base64');
    source = source.replace(/['"]\.\.\/\.\.\/\.\.\/utils\/workload['"]/g, `'${wData}'`);
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('authentic branch schedules provide confirmed official Yandex Maps hours for Moscow branches', async () => {
  const { getBranchWeeklySchedule } = await loadTS('../src/features/client/map/branchSchedule.ts');

  // Главпочтамт Мясницкая (101000)
  const myasnitskaya = getBranchWeeklySchedule('101000', 'Главпочтамт Мясницкая');
  assert.equal(myasnitskaya.length, 7);
  assert.equal(myasnitskaya[0].hoursText, '08:00–22:00'); // Пн
  assert.equal(myasnitskaya[5].hoursText, '09:00–18:00'); // Сб (сокращённый)
  assert.equal(myasnitskaya[5].isShortened, true);
  assert.equal(myasnitskaya[6].hoursText, '09:00–18:00'); // Вс

  // Тверская (125009)
  const tverskaya = getBranchWeeklySchedule('125009', 'Тверская');
  assert.equal(tverskaya.length, 7);
  assert.equal(tverskaya[0].hoursText, '08:00–21:00');
  assert.equal(tverskaya[5].hoursText, '09:00–18:00');
  assert.equal(tverskaya[5].isShortened, true);

  // Новый Арбат (119019) with Sunday day off
  const arbat = getBranchWeeklySchedule('119019', 'Новый Арбат');
  assert.equal(arbat.length, 7);
  assert.equal(arbat[0].hoursText, '08:00–20:00');
  assert.equal(arbat[5].hoursText, '09:00–18:00'); // Сб сокращённый
  assert.equal(arbat[5].isShortened, true);
  assert.equal(arbat[6].isDayOff, true); // Вс выходной
  assert.equal(arbat[6].hoursText, 'Выходной');
});

test('getBranchScheduleStatus identifies shift closure and generates accurate closedUntilText', async () => {
  const { getBranchScheduleStatus } = await loadTS('../src/features/client/map/branchSchedule.ts');

  // Test operational shift closed by admin/workload
  const branch = { code: '101000', name: 'Главпочтамт Мясницкая', workHours: '08:00–20:00' };
  const closedWorkload = {
    branchId: 'b-1',
    activeWindows: 0,
    currentWaiting: 0,
    estimatedWaitSeconds: 0,
    calculatedAt: new Date().toISOString(),
    currentHour: 14,
    sampleCount: 1,
    isHistorical: false,
    hourly: [],
  };

  const status = getBranchScheduleStatus(branch, closedWorkload);
  assert.equal(status.isClosed, true);
  assert.equal(status.reason, 'shift_closed');
  assert.match(status.closedUntilText, /до .*08:00/);
});

test('BranchMapModal turns closed branch map pins gray and unclickable', async () => {
  const modalSource = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');

  // Closed pin styling is gray
  assert.match(modalSource, /pinBg\s*=\s*isClosed\s*\?\s*'#64748B'/);

  // Compact marker by default and hover expansion card
  assert.match(modalSource, /pvz-closed-compact/);
  assert.match(modalSource, /pvz-closed-card/);

  // Yandex Maps placemark interaction blocked
  assert.match(modalSource, /interactive:\s*!isClosed/);
  assert.match(modalSource, /if\s*\(isClosed\)\s*return;/);

  // Closed branch badge label
  assert.match(modalSource, /Закрыто/);

  // Fallback map (Leaflet/OSM) pins also turn gray and unclickable
  assert.match(modalSource, /isClosed\s*\?\s*'cursor-default pointer-events-none opacity-80'/);
});

test('BranchMapModal sorts by real user distance while ClientWorkspace keeps closed branches below open branches', async () => {
  const modalSource = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');
  const workspaceSource = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');

  // Map list uses the same real user coordinate as its marker and sorts by
  // Haversine distance instead of default-branch or open/closed priority.
  assert.match(modalSource, /sortedFilteredBranches/);
  assert.match(modalSource, /calculateHaversineDistance\(userLocation\[0\], userLocation\[1\], a\.coordinates\[0\], a\.coordinates\[1\]\)/);
  assert.match(modalSource, /return aDistance - bDistance/);
  assert.match(modalSource, /if \(!userLocation\) return filteredBranches/);

  // ClientWorkspace sorts open branches above closed branches
  assert.match(workspaceSource, /displayBranches\s*=\s*useMemo/);
  assert.match(workspaceSource, /if\s*\(aClosed\s*&&\s*!bClosed\)\s*return\s*1;/);
  assert.match(workspaceSource, /if\s*\(!aClosed\s*&&\s*bClosed\)\s*return\s*-1;/);

  // Displays «Отделение закрыто до ...» note in branch cards
  assert.match(modalSource, /Отделение закрыто\s*\{scheduleStatus\.closedUntilText\}/);
  assert.match(workspaceSource, /Отделение закрыто\s*\{scheduleStatus\.closedUntilText\}/);
});

test('WeeklyScheduleView renders 7-day schedule with day off markers without redundant badges or labels', async () => {
  const scheduleSource = await readFile(new URL('../src/features/client/map/WeeklyScheduleView.tsx', import.meta.url), 'utf8');

  // Badges and text
  assert.match(scheduleSource, /Расписание на неделю/);
  assert.match(scheduleSource, /Выходной/);

  // Redundant badges removed
  assert.doesNotMatch(scheduleSource, /Сегодня/);
  assert.doesNotMatch(scheduleSource, /Сокращённый/);
  assert.doesNotMatch(scheduleSource, /Яндекс Карты/);
  assert.doesNotMatch(scheduleSource, /Официальное расписание/);
});

test('DetailedBranchCard hides waiting count and queue time when branch is closed', async () => {
  const modalSource = await readFile(new URL('../src/features/client/map/BranchMapModal.tsx', import.meta.url), 'utf8');
  assert.match(modalSource, /!scheduleStatus\.isClosed\s*&&\s*\(\(\)\s*=>/);
});
