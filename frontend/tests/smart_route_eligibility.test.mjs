import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import * as esbuild from 'esbuild';

async function loadTS(relativePath) {
  const filePath = resolve(import.meta.dirname, relativePath);
  const result = esbuild.buildSync({
    entryPoints: [filePath],
    bundle: true,
    format: 'esm',
    write: false,
    external: ['react', 'react-dom'],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('Bug #15 Reproduction & Verification: Closed branch is never eligible for walk-in or recommended by Smart Route', async () => {
  const { isBranchEligibleForWalkIn } = await loadTS('../src/features/client/map/branchSchedule.ts');
  const { calculateSmartRouting } = await loadTS('../src/features/client/map/branchLocations.ts');
  const { calculatePersonalRouting } = await loadTS('../src/features/client/map/liveBranches.ts');

  // Branch Mayakovskogo with standard working hours 08:00–20:00
  const mayakovskogoBranch = {
    id: 'b1e06492-3c4a-5812-9c1a-2895f32a0006',
    name: 'Отделение Маяковского',
    address: 'г. Рязань, ул. Маяковского, д. 64',
    code: '390000',
    workHours: '08:00–20:00',
    lat: 54.62314,
    lng: 39.74891,
    activeQueueCount: 0,
    activeWindows: 3,
  };

  // Test at 21:00 (closed)
  const nightDate = new Date('2026-10-04T21:00:00+03:00');
  const nightCheck = isBranchEligibleForWalkIn(mayakovskogoBranch, undefined, 39, nightDate);
  assert.equal(nightCheck.eligible, false, 'Branch must not be eligible when closed at 21:00');

  // Test calculateSmartRouting at 21:00: closed branch must be excluded
  // User coordinates near Ryazan center
  const userLat = 54.62;
  const userLng = 39.74;
  const routing = calculateSmartRouting(userLat, userLng, [mayakovskogoBranch], undefined, nightDate);
  assert.equal(routing.rankedBranches.length, 0, 'Closed branch must be excluded from smart routing');
  assert.equal(routing.recommendation, undefined, 'No recommendation when all branches are closed');

  // Test during business hours on Monday at 12:00: branch must be eligible
  const dayDate = new Date('2026-10-05T12:00:00+03:00');
  const dayCheck = isBranchEligibleForWalkIn(mayakovskogoBranch, undefined, 39, dayDate);
  assert.equal(dayCheck.eligible, true, 'Branch must be eligible during normal open hours on Monday');

  // Test when arriving after closing: Monday 19:40 with 39 minutes travel time (arrives at 20:19 > 20:00)
  const lateDate = new Date('2026-10-05T19:40:00+03:00');
  const lateCheck = isBranchEligibleForWalkIn(mayakovskogoBranch, undefined, 39, lateDate);
  assert.equal(lateCheck.eligible, false, 'Branch must not be eligible if user arrives after closing');

  const unreachable = calculatePersonalRouting(
    { lat: 54.62, lng: 39.74 },
    [{ ...mayakovskogoBranch, serverWaitMinutes: 5 }],
    true,
    'real_gps',
    new Date('2026-10-05T19:55:00+03:00'),
  );
  assert.equal(unreachable.rankedBranches.length, 0, 'Personal routing must reject a branch the user cannot reach before closing');

  const queueWouldFinishAfterClose = calculatePersonalRouting(
    { lat: 54.62, lng: 39.74 },
    [{ ...mayakovskogoBranch, lat: 54.6275, lng: 39.74, serverWaitMinutes: 40 }],
    true,
    'real_gps',
    new Date('2026-10-05T19:20:00+03:00'),
  );
  assert.equal(queueWouldFinishAfterClose.rankedBranches.length, 0, 'Personal routing must reject a branch when travel plus queue exceeds closing time');
});
