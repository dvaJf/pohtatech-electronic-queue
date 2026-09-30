import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const appointment = {
  ticket: {
    id: '9a8c3a6e-4982-4e55-9b9e-87ea30d096d1',
    publicNumber: 'A-000347',
    branchId: 'branch-1',
    serviceId: 'service-1',
    source: 'APPOINTMENT',
    status: 'SCHEDULED',
  },
  // 14:30 МСК; the calendar event must preserve this instant, not reinterpret it.
  scheduledAt: '2026-09-30T11:30:00.000Z',
};

const branch = {
  id: 'branch-1',
  name: 'Главпочтамт г. Рязань',
  address: 'ул. Почтовая, д. 49',
};

test('maps a confirmed appointment to one stable, UTC calendar event', async () => {
  const { createAppointmentCalendarEvent } = await load('../src/features/client/calendar/appointmentCalendar.ts');
  const event = createAppointmentCalendarEvent(appointment, branch);

  assert.deepEqual(event, {
    uid: 'appointment-9a8c3a6e-4982-4e55-9b9e-87ea30d096d1@pointers-team.tech',
    title: 'Запись в Почту России — Главпочтамт г. Рязань',
    start: '2026-09-30T11:30:00.000Z',
    location: 'ул. Почтовая, д. 49',
    description: 'Предварительная запись в отделение Почты России.\nНомер записи: A-000347\nОтделение: Главпочтамт г. Рязань\nАдрес: ул. Почтовая, д. 49',
  });
  assert.equal(new Date(event.start).getTime(), new Date(appointment.scheduledAt).getTime());
});

test('does not offer calendar export for a queue ticket, failed booking, or stale cached appointment', async () => {
  const { isAppointmentCalendarEventAvailable } = await load('../src/features/client/calendar/appointmentCalendar.ts');
  assert.equal(isAppointmentCalendarEventAvailable(undefined, branch), false);
  assert.equal(isAppointmentCalendarEventAvailable({ ...appointment, ticket: { ...appointment.ticket, source: 'LIVE' } }, branch), false);
  assert.equal(isAppointmentCalendarEventAvailable({ ...appointment, scheduledAt: 'not-a-date' }, branch), false);
  assert.equal(isAppointmentCalendarEventAvailable(appointment, { ...branch, address: undefined }), false);
});

test('builds an RFC 5545 ICS event without invented end or duration', async () => {
  const { buildAppointmentIcs, createAppointmentCalendarEvent } = await load('../src/features/client/calendar/appointmentCalendar.ts');
  const ics = buildAppointmentIcs(createAppointmentCalendarEvent(appointment, branch), new Date('2026-09-01T10:00:00.000Z'));
  const unfolded = ics.replace(/\r\n /g, '');

  assert.match(unfolded, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/Pochta Rossii\/\/Digital Queue\/\/RU\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\n/m);
  assert.match(unfolded, /UID:appointment-9a8c3a6e-4982-4e55-9b9e-87ea30d096d1@pointers-team\.tech\r\n/);
  assert.match(unfolded, /DTSTAMP:20260901T100000Z\r\n/);
  assert.match(unfolded, /DTSTART:20260930T113000Z\r\n/);
  assert.doesNotMatch(unfolded, /DTSTART;TZID=/);
  assert.match(unfolded, /BEGIN:VALARM\r\nTRIGGER:-PT30M\r\nACTION:DISPLAY\r\nDESCRIPTION:Напоминание о записи в Почту России\r\nEND:VALARM\r\n/);
  assert.match(ics, /END:VEVENT\r\nEND:VCALENDAR\r\n$/);
  assert.doesNotMatch(ics, /\r\nDTEND[;:]/);
  assert.doesNotMatch(ics, /\r\nDURATION[;:]/);
  assert.equal(ics.includes('\n') && !ics.includes('\r\n'), false, 'ICS uses CRLF line endings');
  const encoder = new TextEncoder();
  assert.equal(ics.split('\r\n').filter(Boolean).every(line => encoder.encode(line).length <= 75), true, 'every folded physical line fits RFC 5545 octet limit');
});

test('escapes untrusted values and prevents ICS newline injection', async () => {
  const { buildAppointmentIcs, createAppointmentCalendarEvent } = await load('../src/features/client/calendar/appointmentCalendar.ts');
  const unsafe = createAppointmentCalendarEvent(
    { ...appointment, ticket: { ...appointment.ticket, publicNumber: 'A;1,2\\3\r\nBEGIN:VEVENT' } },
    { ...branch, name: 'Рязань; Центр, 1\\2\nX-Injected: true', address: 'ул. Ленина, д. 1\r\nDTEND:20270101T000000Z' },
  );
  const ics = buildAppointmentIcs(unsafe, new Date('2026-09-01T10:00:00.000Z'));
  const unfolded = ics.replace(/\r\n /g, '');

  assert.match(unfolded, /SUMMARY:Запись в Почту России — Рязань\\; Центр\\, 1\\\\2\\nX-Injected: true\r\n/);
  assert.match(unfolded, /LOCATION:ул\. Ленина\\, д\. 1\\nDTEND:20270101T000000Z\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 1);
  assert.doesNotMatch(ics, /\r\nDTEND:20270101T000000Z\r\n/);
});

test('folds Cyrillic on UTF-8 character boundaries', async () => {
  const { buildAppointmentIcs, createAppointmentCalendarEvent } = await load('../src/features/client/calendar/appointmentCalendar.ts');
  const longBranch = { ...branch, name: `Рязань ${'Ж'.repeat(120)}` };
  const ics = buildAppointmentIcs(createAppointmentCalendarEvent(appointment, longBranch), new Date('2026-09-01T10:00:00.000Z'));
  assert.equal(ics.includes('�'), false, 'UTF-8 characters are never cut into invalid sequences');
  assert.equal(ics.split('\r\n').filter(Boolean).every(line => new TextEncoder().encode(line).length <= 75), true);
  assert.match(ics.replace(/\r\n /g, ''), new RegExp(`SUMMARY:Запись в Почту России — Рязань ${'Ж'.repeat(120)}`));
});

test('creates a safe, stable download filename from the confirmed start', async () => {
  const { getAppointmentIcsFilename } = await load('../src/features/client/calendar/appointmentCalendar.ts');
  assert.equal(getAppointmentIcsFilename(appointment.scheduledAt), 'pochta-appointment-2026-09-30-1130.ics');
});

test('revokes the object URL only after the generated file is used', async () => {
  const { createAppointmentCalendarEvent, downloadAppointmentIcs } = await load('../src/features/client/calendar/appointmentCalendar.ts');
  const order = [];
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  const originalWindow = globalThis.window;
  const anchor = { style: {}, click: () => order.push('click'), remove: () => order.push('remove') };
  globalThis.document = {
    createElement: () => anchor,
    body: { appendChild: () => order.push('append') },
  };
  globalThis.URL = {
    createObjectURL: () => { order.push('create'); return 'blob:calendar'; },
    revokeObjectURL: () => order.push('revoke'),
  };
  globalThis.window = { setTimeout: (callback) => { order.push('timer'); callback(); return 1; } };
  try {
    downloadAppointmentIcs(createAppointmentCalendarEvent(appointment, branch));
    assert.deepEqual(order, ['create', 'append', 'click', 'remove', 'timer', 'revoke']);
  } finally {
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
    globalThis.window = originalWindow;
  }
});

test('calendar UI is available only for a confirmed appointment and uses one ICS generator', async () => {
  const source = await readFile(new URL('../src/features/client/ClientWorkspace.tsx', import.meta.url), 'utf8');
  const menu = await readFile(new URL('../src/features/client/calendar/AppointmentCalendarMenu.tsx', import.meta.url), 'utf8');
  assert.match(source, /ticket\.source === 'APPOINTMENT'/);
  assert.match(source, /isAppointmentCalendarEventAvailable\(appointment, branch\)/);
  assert.match(menu, /type="button"[\s\S]*Добавить в календарь/);
  assert.match(menu, /Apple Calendar \(\.ics\)/);
  assert.match(menu, /Скачать \.ics/);
  assert.match(menu, /downloadAppointmentIcs\(calendarEvent\)/);
  assert.doesNotMatch(menu, /Google Calendar/);
});
