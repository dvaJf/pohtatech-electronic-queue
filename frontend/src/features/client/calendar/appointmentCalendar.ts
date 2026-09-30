import type { Appointment, Branch } from '../../../api/client/types';

const UID_DOMAIN = 'pointers-team.tech';
const CALENDAR_PROD_ID = '-//Pochta Rossii//Digital Queue//RU';

export type AppointmentCalendarEvent = {
  uid: string;
  title: string;
  start: string;
  location: string;
  description: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stableUidPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Calendar export is enabled only for a server-confirmed appointment with usable branch data. */
export function isAppointmentCalendarEventAvailable(
  appointment: Appointment | null | undefined,
  branch: Branch | null | undefined,
): boolean {
  if (!appointment || !branch || !isNonEmptyString(branch.name) || !isNonEmptyString(branch.address)) return false;
  const ticket = appointment.ticket;
  return ticket?.source === 'APPOINTMENT'
    && isNonEmptyString(ticket.id)
    && isNonEmptyString(ticket.publicNumber)
    && isNonEmptyString(appointment.scheduledAt)
    && Number.isFinite(Date.parse(appointment.scheduledAt));
}

/**
 * Produces the one event model shared by every calendar export.
 * The backend currently confirms an instant, not a visit duration, so the model
 * intentionally has no end field.
 */
export function createAppointmentCalendarEvent(appointment: Appointment, branch: Branch): AppointmentCalendarEvent {
  if (!isAppointmentCalendarEventAvailable(appointment, branch)) {
    throw new Error('Недостаточно данных подтверждённой записи для календаря');
  }
  const ticket = appointment.ticket;
  const branchName = branch.name.trim();
  const address = branch.address!.trim();
  return {
    uid: `appointment-${stableUidPart(ticket.id.trim())}@${UID_DOMAIN}`,
    title: `Запись в Почту России — ${branchName}`,
    start: new Date(appointment.scheduledAt).toISOString(),
    location: address,
    description: [
      'Предварительная запись в отделение Почты России.',
      `Номер записи: ${ticket.publicNumber.trim()}`,
      `Отделение: ${branchName}`,
      `Адрес: ${address}`,
    ].join('\n'),
  };
}

function formatUtcIcsDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error('Некорректная дата календарного события');
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Escapes user-controlled text before it becomes an RFC 5545 TEXT value. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** RFC 5545 folds physical lines at 75 UTF-8 octets, with a single-space continuation. */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;

  for (const character of line) {
    const size = encoder.encode(character).length;
    if (current && bytes + size > limit) {
      chunks.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation's initial space occupies one octet
    }
    current += character;
    bytes += size;
  }
  chunks.push(current);
  return chunks.map((chunk, index) => index === 0 ? chunk : ` ${chunk}`).join('\r\n');
}

export function buildAppointmentIcs(event: AppointmentCalendarEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${CALENDAR_PROD_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatUtcIcsDate(now)}`,
    `DTSTART:${formatUtcIcsDate(event.start)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText('Напоминание о записи в Почту России')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

export function getAppointmentIcsFilename(start: string): string {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) throw new Error('Некорректная дата записи');
  const pad = (part: number) => String(part).padStart(2, '0');
  return `pochta-appointment-${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}.ics`;
}

/** Used by both Apple Calendar and the generic download action. */
export function downloadAppointmentIcs(event: AppointmentCalendarEvent): void {
  const blob = new Blob([buildAppointmentIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = getAppointmentIcsFilename(event.start);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
