import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function loadTS(relativePath) {
  const filePath = resolve(import.meta.dirname, relativePath);
  const code = await readFile(filePath, 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`);
}

test('14-day calendar booking window: today and today+14 are valid, today+15 and past are rejected', async () => {
  const {
    getMoscowToday,
    getBookingWindowMoscow,
    isDateWithinBookingWindow,
    BOOKING_WINDOW_INFO_TEXT,
  } = await loadTS('../src/features/client/calendar/bookingWindow.ts');

  const { minDate, maxDate } = getBookingWindowMoscow();
  const today = getMoscowToday();

  // 1. Min date is today 00:00:00
  assert.equal(minDate.getTime(), today.getTime());

  // 2. Today is within window
  assert.equal(isDateWithinBookingWindow(today), true);

  // 3. Yesterday is rejected
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(isDateWithinBookingWindow(yesterday), false);

  // 4. Day 14 is accepted
  const day14 = new Date(today);
  day14.setDate(day14.getDate() + 14);
  assert.equal(isDateWithinBookingWindow(day14), true);

  // 5. Day 15 is strictly rejected
  const day15 = new Date(today);
  day15.setDate(day15.getDate() + 15);
  assert.equal(isDateWithinBookingWindow(day15), false);

  // 6. Informative copy is present and authentic
  assert.equal(BOOKING_WINDOW_INFO_TEXT, 'Запись доступна на ближайшие 14 дней.');
});
