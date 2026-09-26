import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
test('catalog coordinates require matching server address', async () => {
  const { matchBranchLocation } = await load('../src/features/client/map/liveBranches.ts');
  const catalog = [{id:'same', address:'г. Москва, ул. Мясницкая, д. 26', lat:55, lng:37}];
  assert.equal(matchBranchLocation({id:'same',address:'г. Рязань, ул. Ленина, д. 20'}, catalog), undefined);
  assert.equal(matchBranchLocation({id:'same'}, catalog), undefined);
  assert.equal(matchBranchLocation({id:'same',address:catalog[0].address}, catalog), catalog[0]);
});
test('unknown, stale, closed and invalid workload never becomes zero wait', async () => {
  const { liveWaitMinutes } = await load('../src/features/client/map/liveBranches.ts');
  const now = Date.now();
  const w = {activeWindows:2, estimatedWaitSeconds:420, calculatedAt:new Date(now).toISOString()};
  assert.equal(liveWaitMinutes(w, now), 7);
  assert.equal(liveWaitMinutes(undefined, now), undefined);
  assert.equal(liveWaitMinutes({...w,activeWindows:0}, now), undefined);
  assert.equal(liveWaitMinutes({...w,estimatedWaitSeconds:null}, now), undefined);
  assert.equal(liveWaitMinutes({...w,calculatedAt:new Date(now-61000).toISOString()}, now), undefined);
  assert.equal(liveWaitMinutes({...w,estimatedWaitSeconds:-1}, now), undefined);
});
test('GPS uncertainty and stale fixes cannot confirm arrival', async () => {
  const { isReliableArrival } = await load('../src/features/client/arrival/arrivalPolicy.ts');
  assert.equal(isReliableArrival(10, 5, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(10, 100, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(10, undefined, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(25, 5, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(26, 5, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(40, 50, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(40, 51, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(120, 100, 20, 1000, 2000), true);
  assert.equal(isReliableArrival(121, 100, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(10, 101, 20, 1000, 2000), false);
  assert.equal(isReliableArrival(5, 5, 20, 1000, 62000), false);
});
test('arrival validates destination services, locks before awaiting and keeps retry identity', async () => {
  const { createArrivalIssuer } = await load('../src/features/client/arrival/arrivalPolicy.ts');
  let calls = 0;
  let release;
  const identities = [];
  const issue = createArrivalIssuer({
    listServices: async id => { assert.equal(id,'destination'); await new Promise(r => {release=r}); return [{id:'correct'}]; },
    createQrTicket: async (branch, service, key) => { calls++; assert.equal(service,'correct'); if(calls===1) throw Error('lost response'); return {id:'ticket'}; },
    keyFor: identity => {identities.push(identity); return 'stable-key';},
    clearKey: () => {},
  });
  const first = issue('destination','correct','owner');
  assert.equal(await issue('destination','correct','owner'), undefined);
  release(); await assert.rejects(first,/lost response/);
  const retry = issue('destination','correct','owner'); release();
  assert.equal((await retry).id,'ticket');
  assert.equal(identities[0],identities[1]);
  const wrong = issue('destination','old-branch-service','owner'); release();
  await assert.rejects(wrong,/услуга/i);
  assert.equal(calls,2);
});
