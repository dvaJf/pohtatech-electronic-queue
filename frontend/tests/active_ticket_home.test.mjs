import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('active ticket presentation treats only live backend statuses as active', async () => {
  const { isActiveTicketStatus } = await load('../src/features/client/home/activeTicketPresentation.ts');
  for (const status of ['SCHEDULED', 'WAITING', 'CALLED', 'SERVING']) {
    assert.equal(isActiveTicketStatus(status), true, `${status} must keep the ticket hero visible`);
  }
  for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) {
    assert.equal(isActiveTicketStatus(status), false, `${status} must return the home hero to Smart Route`);
  }
});

test('waiting ticket presentation makes queue position and server ETA understandable', async () => {
  const { getActiveTicketPresentation } = await load('../src/features/client/home/activeTicketPresentation.ts');
  assert.deepEqual(getActiveTicketPresentation({ status: 'WAITING', peopleAhead: 4, estimatedWaitSeconds: 720 }), {
    eyebrow: 'Активный талон',
    status: 'Ожидайте вызова',
    peopleAhead: 'Перед вами 4 человека',
    eta: '≈12 мин',
    etaCaption: 'до вашей очереди',
    announce: false,
  });
  assert.equal(getActiveTicketPresentation({ status: 'WAITING', peopleAhead: 1, estimatedWaitSeconds: 60 }).peopleAhead, 'Перед вами 1 человек');
  assert.equal(getActiveTicketPresentation({ status: 'WAITING', peopleAhead: 5, estimatedWaitSeconds: 60 }).peopleAhead, 'Перед вами 5 человек');
  assert.equal(getActiveTicketPresentation({ status: 'WAITING', peopleAhead: 0, estimatedWaitSeconds: null }).peopleAhead, 'Вы следующий');
});

test('called and serving ticket presentation suppresses stale queue ETA', async () => {
  const { getActiveTicketPresentation } = await load('../src/features/client/home/activeTicketPresentation.ts');
  assert.deepEqual(getActiveTicketPresentation({ status: 'CALLED', peopleAhead: 0, estimatedWaitSeconds: 120, windowNumber: 4 }), {
    eyebrow: 'Ваша очередь',
    status: 'Подойдите к окну №4',
    peopleAhead: null,
    eta: 'Сейчас',
    etaCaption: null,
    announce: true,
  });
  assert.deepEqual(getActiveTicketPresentation({ status: 'SERVING', peopleAhead: 0, estimatedWaitSeconds: 120 }), {
    eyebrow: 'Активный талон',
    status: 'Вас обслуживают',
    peopleAhead: null,
    eta: null,
    etaCaption: null,
    announce: false,
  });
});
