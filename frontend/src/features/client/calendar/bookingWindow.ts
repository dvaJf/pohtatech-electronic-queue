/**
 * Single source of truth for the 14-day Moscow appointment booking window.
 * Matches backend `validateAppointmentBookingWindow` in `sprint2.go`.
 * Allowed range: today through today + 14 calendar days inclusive.
 * (today + 15 calendar days is strictly rejected).
 */

export function getMoscowToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const val = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return new Date(Number(val('year')), Number(val('month')) - 1, Number(val('day')), 0, 0, 0, 0);
}

export function getBookingWindowMoscow(): { minDate: Date; maxDate: Date } {
  const today = getMoscowToday();
  const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14, 23, 59, 59, 999);
  return { minDate: today, maxDate };
}

export function isDateWithinBookingWindow(date: Date): boolean {
  const { minDate, maxDate } = getBookingWindowMoscow();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  return target >= minDate && target <= maxDate;
}

export const BOOKING_WINDOW_INFO_TEXT = 'Запись доступна на ближайшие 14 дней.';
