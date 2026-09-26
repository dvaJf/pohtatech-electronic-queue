import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTS(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

test('Haversine distance calculation is accurate across short and long distances', async () => {
  const { calculateHaversineDistance } = await loadTS('../src/features/client/map/branchLocations.ts');

  // Identical points have 0 distance
  assert.equal(calculateHaversineDistance(55.7558, 37.6173, 55.7558, 37.6173), 0);

  // Symmetry
  const d1 = calculateHaversineDistance(55.752, 37.6175, 55.7029, 37.5309);
  const d2 = calculateHaversineDistance(55.7029, 37.5309, 55.752, 37.6175);
  assert.equal(d1, d2);

  // Moscow Kremlin to MSU (~7.8 - 8.0 km)
  assert.ok(d1 >= 7.5 && d1 <= 8.5, `Expected Kremlin to MSU distance ~7.9 km, got ${d1}`);

  // Moscow to Saint Petersburg (~630 - 640 km)
  const dSpb = calculateHaversineDistance(55.7558, 37.6173, 59.9343, 30.3351);
  assert.ok(dSpb >= 625 && dSpb <= 645, `Expected Moscow to SPb distance ~634 km, got ${dSpb}`);

  // Walking distance (~500m)
  const dWalk = calculateHaversineDistance(55.761845, 37.638521, 55.75872, 37.64753);
  assert.ok(dWalk >= 0.5 && dWalk <= 0.8, `Expected ~0.65 km walk, got ${dWalk}`);
});

test('Wait time formula strictly implements (N_queue * t_service) / W_active', async () => {
  const {
    calculateWaitTimeMinutes,
    calculateBranchWaitTime,
    calculateWaitTime,
    getBranchServiceAvgTime,
  } = await loadTS('../src/features/client/map/branchLocations.ts');

  // Direct calculation checks: (N * t) / W
  assert.equal(calculateWaitTimeMinutes(6, 4, 2), 12.0);
  assert.equal(calculateBranchWaitTime(6, 4, 2), 12.0);

  assert.equal(calculateWaitTimeMinutes(15, 3, 3), 15.0);
  assert.equal(calculateWaitTimeMinutes(5, 4.5, 3), 7.5);
  assert.equal(calculateWaitTimeMinutes(0, 5, 2), 0.0);

  // Safety fallback for windows <= 0
  assert.equal(calculateWaitTimeMinutes(4, 5, 0), 20.0);

  // Evaluation on a mock branch with serviceCategory
  const mockBranch = {
    id: 'test-1',
    code: '101000',
    name: 'Тестовое отделение',
    address: 'ул. Тестовая, 1',
    metro: 'Тестовая',
    metroColor: '#EF161E',
    lat: 55.76,
    lng: 37.63,
    workHours: '08:00–20:00',
    rating: 4.9,
    reviewCount: 100,
    services: [
      { id: 'srv-p', name: 'Посылки', category: 'parcels', avgServiceMinutes: 4.0 },
      { id: 'srv-l', name: 'Письма', category: 'letters', avgServiceMinutes: 2.0 },
    ],
    activeQueueCount: 6,
    activeWindows: 2,
    amenities: [],
    photos: [],
    walkingMinutes: 5,
    distanceKm: 0.4,
  };

  // Letters: t_service = 2.0 min -> wait = (6 * 2.0) / 2 = 6.0 min
  assert.equal(getBranchServiceAvgTime(mockBranch, 'letters'), 2.0);
  assert.equal(calculateWaitTime(mockBranch, 'letters'), 6.0);

  // Parcels: t_service = 4.0 min -> wait = (6 * 4.0) / 2 = 12.0 min
  assert.equal(getBranchServiceAvgTime(mockBranch, 'parcels'), 4.0);
  assert.equal(calculateWaitTime(mockBranch, 'parcels'), 12.0);

  // All / unspecified: avg = (4.0 + 2.0) / 2 = 3.0 min -> wait = (6 * 3.0) / 2 = 9.0 min
  assert.equal(getBranchServiceAvgTime(mockBranch), 3.0);
  assert.equal(calculateWaitTime(mockBranch), 9.0);
});

test('Ranking by T_total = T_travel + T_wait ranks fastest overall branch first', async () => {
  const {
    calculateTravelTimeMinutes,
    calculateTotalTimeMinutes,
    calculateSmartRouting,
    calculateSmartRoutes,
  } = await loadTS('../src/features/client/map/branchLocations.ts');

  // Verify travel time formula: distanceKm * 12 min
  assert.equal(calculateTravelTimeMinutes(1.0), 12.0);
  assert.equal(calculateTravelTimeMinutes(0.5), 6.0);
  assert.equal(calculateTravelTimeMinutes(2.5), 30.0);

  // Total time formula
  assert.equal(calculateTotalTimeMinutes(12.0, 8.0), 20.0);

  // User position
  const userLat = 55.7600;
  const userLng = 37.6350;

  // Branch A: closest, but crowded
  // distance ~0.2 km -> travel ~2.4 min; queue=16, windows=2, avgService=4 -> wait=32 min -> total=34.4 min
  const branchCrowdedClose = {
    id: 'branch-close-crowded',
    code: '101001',
    name: 'Ближнее перегруженное',
    address: 'ул. Близкая, 1',
    metro: 'Станция 1',
    metroColor: '#EF161E',
    lat: 55.7615,
    lng: 37.6360,
    workHours: '08:00–20:00',
    rating: 4.8,
    reviewCount: 500,
    services: [{ id: 's1', name: 'Все', category: 'all', avgServiceMinutes: 4 }],
    activeQueueCount: 16,
    activeWindows: 2,
    amenities: [],
    photos: [],
    walkingMinutes: 2,
    distanceKm: 0.2,
  };

  // Branch B: moderate distance, nearly empty
  // distance ~0.7 km -> travel ~8.4 min; queue=2, windows=3, avgService=3 -> wait=2 min -> total=10.4 min
  const branchFastAlternative = {
    id: 'branch-fast-alternative',
    code: '101002',
    name: 'Быстрое альтернативное',
    address: 'ул. Быстрая, 5',
    metro: 'Станция 2',
    metroColor: '#0078BF',
    lat: 55.7645,
    lng: 37.6410,
    workHours: '08:00–20:00',
    rating: 4.9,
    reviewCount: 400,
    services: [{ id: 's1', name: 'Все', category: 'all', avgServiceMinutes: 3 }],
    activeQueueCount: 2,
    activeWindows: 3,
    amenities: [],
    photos: [],
    walkingMinutes: 8,
    distanceKm: 0.7,
  };

  // Branch C: far away, empty
  // distance ~2.5 km -> travel ~30 min; wait=0 -> total=30 min
  const branchFarEmpty = {
    id: 'branch-far-empty',
    code: '101003',
    name: 'Дальнее свободное',
    address: 'ул. Дальняя, 10',
    metro: 'Станция 3',
    metroColor: '#8E1780',
    lat: 55.7800,
    lng: 37.6500,
    workHours: '08:00–20:00',
    rating: 4.7,
    reviewCount: 200,
    services: [{ id: 's1', name: 'Все', category: 'all', avgServiceMinutes: 3 }],
    activeQueueCount: 0,
    activeWindows: 3,
    amenities: [],
    photos: [],
    walkingMinutes: 30,
    distanceKm: 2.5,
  };

  const result = calculateSmartRouting(userLat, userLng, [
    branchCrowdedClose,
    branchFastAlternative,
    branchFarEmpty,
  ]);

  const { rankedBranches } = result;
  assert.equal(rankedBranches.length, 3);

  // Ranked order MUST be: 1. branchFastAlternative, 2. branchFarEmpty, 3. branchCrowdedClose
  assert.equal(rankedBranches[0].id, 'branch-fast-alternative');
  assert.equal(rankedBranches[0].isFastest, true);
  assert.ok(rankedBranches[0].totalMinutes < rankedBranches[1].totalMinutes);
  assert.ok(rankedBranches[1].totalMinutes < rankedBranches[2].totalMinutes);

  // Closest branch must be tagged
  const closest = rankedBranches.find((b) => b.id === 'branch-close-crowded');
  assert.ok(closest);
  assert.equal(closest.isClosest, true);

  // Backwards-compatible calculateSmartRoutes gives same ranking
  const backwardsRanked = calculateSmartRoutes([
    branchCrowdedClose,
    branchFastAlternative,
    branchFarEmpty,
  ], userLat, userLng);
  assert.equal(backwardsRanked[0].id, 'branch-fast-alternative');
});

test('Recommendation triggers when an alternative branch is faster than the closest one', async () => {
  const {
    calculateSmartRouting,
    calculateFastestAlternative,
  } = await loadTS('../src/features/client/map/branchLocations.ts');

  const userLat = 55.7600;
  const userLng = 37.6350;

  // Closest branch has 30 min queue wait + 2 min travel = 32 min
  const closeBranch = {
    id: 'close-crowded',
    code: '101001',
    name: 'Главпочтамт Мясницкая',
    address: 'ул. Мясницкая, 26',
    metro: 'Чистые пруды',
    metroColor: '#EF161E',
    lat: 55.7610,
    lng: 37.6360,
    workHours: '08:00–20:00',
    rating: 4.9,
    reviewCount: 1000,
    services: [{ id: 's1', name: 'Все', category: 'all', avgServiceMinutes: 5 }],
    activeQueueCount: 12,
    activeWindows: 2, // wait = (12 * 5)/2 = 30 min
    amenities: [],
    photos: [],
    walkingMinutes: 2,
    distanceKm: 0.15,
  };

  // Alternative branch is 6 min walk away, but only 2 min wait = 8 min total!
  const alternativeBranch = {
    id: 'alt-fast',
    code: '107031',
    name: 'Отделение Рождественка',
    address: 'ул. Рождественка, 10',
    metro: 'Кузнецкий Мост',
    metroColor: '#8E1780',
    lat: 55.7635,
    lng: 37.6310,
    workHours: '08:00–20:00',
    rating: 4.85,
    reviewCount: 500,
    services: [{ id: 's1', name: 'Все', category: 'all', avgServiceMinutes: 3 }],
    activeQueueCount: 2,
    activeWindows: 3, // wait = (2 * 3)/3 = 2 min
    amenities: [],
    photos: [],
    walkingMinutes: 6,
    distanceKm: 0.5,
  };

  const result = calculateSmartRouting(userLat, userLng, [closeBranch, alternativeBranch]);

  assert.ok(result.recommendation, 'Recommendation should be triggered');
  assert.equal(result.recommendation.currentClosestBranch.id, 'close-crowded');
  assert.equal(result.recommendation.fastestBranch.id, 'alt-fast');
  assert.ok(result.recommendation.timeSavedMinutes > 15, `Expected >15 min saved, got ${result.recommendation.timeSavedMinutes}`);
  assert.ok(result.recommendation.bannerText.includes('Отделение Рождественка'));
  assert.ok(result.recommendation.bannerText.includes(String(result.recommendation.timeSavedMinutes)));

  // Test backwards-compatible calculateFastestAlternative
  const altResult = calculateFastestAlternative('close-crowded', [closeBranch, alternativeBranch], userLat, userLng);
  assert.ok(altResult);
  assert.equal(altResult.fastestBranch.id, 'alt-fast');
  assert.equal(altResult.timeSavedMinutes, result.recommendation.timeSavedMinutes);

  // Negative test: when the closest branch is ALREADY the fastest, no recommendation is produced
  const freeCloseBranch = {
    ...closeBranch,
    activeQueueCount: 0, // wait = 0 min, total = ~2 min
  };
  const noRecResult = calculateSmartRouting(userLat, userLng, [freeCloseBranch, alternativeBranch]);
  assert.equal(noRecResult.recommendation, undefined, 'No recommendation when closest branch is already the fastest');
});

test('MOSCOW_BRANCHES contains at least 7 realistic branches and includes default backend UUID', async () => {
  const {
    MOSCOW_BRANCHES,
    DEFAULT_BRANCH_ID,
  } = await loadTS('../src/features/client/map/branchLocations.ts');

  assert.ok(MOSCOW_BRANCHES.length >= 7, `Expected >= 7 branches, got ${MOSCOW_BRANCHES.length}`);

  // Must include real backend branch id
  const demoBranch = MOSCOW_BRANCHES.find((b) => b.id === '11111111-1111-1111-1111-111111111111');
  assert.ok(demoBranch, 'Must contain real backend branch id 11111111-1111-1111-1111-111111111111');
  assert.equal(DEFAULT_BRANCH_ID, '11111111-1111-1111-1111-111111111111');

  // Verify all branches meet interface requirements
  for (const b of MOSCOW_BRANCHES) {
    assert.ok(typeof b.id === 'string' && b.id.length > 0, `Branch ${b.name} has invalid id`);
    assert.ok(typeof b.code === 'string' && b.code.length > 0, `Branch ${b.name} has invalid code`);
    assert.ok(typeof b.name === 'string' && b.name.length > 0, `Branch ${b.name} has invalid name`);
    assert.ok(typeof b.address === 'string' && b.address.length > 0, `Branch ${b.name} has invalid address`);
    assert.ok(typeof b.metro === 'string' && b.metro.length > 0, `Branch ${b.name} has invalid metro`);
    assert.ok(typeof b.metroColor === 'string' && b.metroColor.startsWith('#'), `Branch ${b.name} has invalid metroColor`);
    assert.ok(typeof b.lat === 'number' && b.lat > 50, `Branch ${b.name} has invalid lat`);
    assert.ok(typeof b.lng === 'number' && b.lng > 30, `Branch ${b.name} has invalid lng`);
    assert.ok(typeof b.workHours === 'string' && b.workHours.length > 0, `Branch ${b.name} has invalid workHours`);
    assert.ok(typeof b.rating === 'number' && b.rating >= 4.0 && b.rating <= 5.0, `Branch ${b.name} has invalid rating`);
    assert.ok(typeof b.reviewCount === 'number' && b.reviewCount > 0, `Branch ${b.name} has invalid reviewCount`);
    assert.ok(Array.isArray(b.services) && b.services.length >= 3, `Branch ${b.name} has invalid services`);
    assert.ok(typeof b.activeQueueCount === 'number' && b.activeQueueCount >= 0, `Branch ${b.name} has invalid activeQueueCount`);
    assert.ok(typeof b.activeWindows === 'number' && b.activeWindows >= 1, `Branch ${b.name} activeWindows must be >= 1`);
    assert.ok(Array.isArray(b.amenities) && b.amenities.length > 0, `Branch ${b.name} has invalid amenities`);
    assert.ok(Array.isArray(b.photos) && b.photos.length > 0, `Branch ${b.name} has invalid photos`);
    assert.ok(typeof b.walkingMinutes === 'number' && b.walkingMinutes >= 0, `Branch ${b.name} has invalid walkingMinutes`);
    assert.ok(typeof b.distanceKm === 'number' && b.distanceKm >= 0, `Branch ${b.name} has invalid distanceKm`);
  }
});
