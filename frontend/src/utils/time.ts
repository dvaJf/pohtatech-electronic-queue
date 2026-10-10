/**
 * Утилиты времени: все отображаемые метки приведены к UTC+3 (Москва) независимо от локальной таймзоны браузера или сервера.
 */

const MOSCOW_TZ = 'Europe/Moscow';

/** Текущее время в Москве */
export function nowMoscow(): Date {
  return new Date();
}

/**
 * Форматирует время в московском часовом поясе.
 * @example "17:45:03"
 */
export function formatMoscowTime(
  date: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options,
    timeZone: MOSCOW_TZ,
  });
}

/**
 * Форматирует дату в московском часовом поясе.
 * @example "17.09.2026"
 */
export function formatMoscowDate(
  date: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
    timeZone: MOSCOW_TZ,
  });
}

/**
 * Форматирует дату и время в московском часовом поясе.
 * @example "17.09.2026, 17:45"
 */
export function formatMoscowDateTime(
  date: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
    timeZone: MOSCOW_TZ,
  });
}

/**
 * Возвращает строку HH:MM:SS текущего московского времени.
 * @example "17:45:03"
 */
export function moscowTimeString(date: Date): string {
  return date.toLocaleTimeString('ru-RU', {
    timeZone: MOSCOW_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Возвращает значение для input[type=datetime-local] с учётом московского
 * смещения (UTC+3), чтобы поле показывало и принимало московское время.
 */
export function toMoscowDatetimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: MOSCOW_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/**
 * Парсит значение из input[type=datetime-local] как московское время
 * и возвращает ISO-строку с явным смещением +03:00.
 */
export function parseMoscowDatetimeLocal(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Некорректное московское время');
  const civil = Date.parse(value + ':00Z');
  if (!Number.isFinite(civil)) throw new Error('Некорректная дата');
  let instant = civil;
  for (let i = 0; i < 3; i++) {
    const represented = Date.parse(toMoscowDatetimeLocal(new Date(instant)) + ':00Z');
    instant += civil - represented;
  }
  if (toMoscowDatetimeLocal(new Date(instant)) !== value) throw new Error('Некорректная дата');
  return new Date(instant).toISOString();
}
