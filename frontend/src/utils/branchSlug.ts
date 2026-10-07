export const DEFAULT_BRANCH_ID = '11111111-1111-1111-1111-111111111111';

export interface BranchPostalRef {
  id: string;
  code: string;
  name: string;
  address: string;
}

/**
 * Очищает название отделения от избыточного почтового индекса в конце строки
 * (например: «Главпочтамт г. Казань 420000» -> «Главпочтамт г. Казань»).
 */
export function cleanBranchName(name: string): string {
  if (!name) return '';
  return name.replace(/\s+\d{6}$/, '').trim();
}

/**
 * Официальный каталог отделений Почты России с индексами (pochta.ru).
 */
export const POSTAL_BRANCHES: BranchPostalRef[] = [
  { id: '11111111-1111-1111-1111-111111111111', code: '101000', name: 'Главпочтамт Мясницкая', address: 'г. Москва, ул. Мясницкая, д. 26' },
  { id: '22222222-2222-2222-2222-222222222222', code: '107031', name: 'Отделение Рождественка', address: 'г. Москва, ул. Рождественка, д. 10/2' },
  { id: '33333333-3333-3333-3333-333333333333', code: '105062', name: 'Отделение Покровка', address: 'г. Москва, ул. Покровка, д. 16' },
  { id: '44444444-4444-4444-4444-444444444444', code: '109012', name: 'Отделение Никольская', address: 'г. Москва, ул. Никольская, д. 8/1' },
  { id: '55555555-5555-5555-5555-555555555555', code: '125009', name: 'Отделение Тверская', address: 'г. Москва, ул. Тверская, д. 9' },
  { id: '66666666-6666-6666-6666-666666666666', code: '119019', name: 'Отделение Новый Арбат', address: 'г. Москва, ул. Новый Арбат, д. 2' },
  { id: '88888888-8888-8888-8888-888888888888', code: '105064', name: 'Отделение Земляной Вал', address: 'г. Москва, ул. Земляной Вал, д. 33' },
  { id: '99999999-9999-9999-9999-999999999999', code: '115184', name: 'Отделение Большая Татарская', address: 'г. Москва, ул. Большая Татарская, д. 20' },
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', code: '119048', name: 'Отделение Комсомольский просп.', address: 'г. Москва, Комсомольский просп., д. 34' },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', code: '123001', name: 'Отделение Садовая-Кудринская', address: 'г. Москва, ул. Садовая-Кудринская, д. 14' },
  { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', code: '127051', name: 'Отделение Цветной бульвар', address: 'г. Москва, Цветной бульвар, д. 15' },
];

/**
 * Официальные 6-значные почтовые индексы отделений Почты России (с официального сайта pochta.ru).
 */
export const OFFICIAL_BRANCH_POSTAL_CODES: Record<string, string> = {
  '11111111-1111-1111-1111-111111111111': '101000', // Москва, Главпочтамт Мясницкая 26 / Демо-отделение 1
  '22222222-2222-2222-2222-222222222222': '107031', // Москва, Рождественка 10/2
  '33333333-3333-3333-3333-333333333333': '105062', // Москва, Покровка 16
  '44444444-4444-4444-4444-444444444444': '109012', // Москва, Никольская 8/1
  '55555555-5555-5555-5555-555555555555': '125009', // Москва, Тверская 9
  '66666666-6666-6666-6666-666666666666': '119019', // Москва, Новый Арбат 2
  '88888888-8888-8888-8888-888888888888': '105064', // Москва, Земляной Вал 33
  '99999999-9999-9999-9999-999999999999': '115184', // Москва, Большая Татарская 20
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': '119048', // Москва, Комсомольский просп. 34
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': '123001', // Москва, Садовая-Кудринская 14
  'cccccccc-cccc-cccc-cccc-cccccccccccc': '127051', // Москва, Цветной бульвар 15
};

/**
 * Карта маппинга почтовых индексов (с сайта pochta.ru) на внутренние ID отделений.
 */
export const POSTAL_CODE_TO_ID: Record<string, string> = {
  // 101000 — Москва, Главпочтамт, ул. Мясницкая, 26
  '101000': '11111111-1111-1111-1111-111111111111',
  '101000-2': '33333333-3333-3333-3333-333333333333',
  // 390000 — Рязань, Главпочтамт / ул. Ленина, 20 (демо-адрес в БД)
  '390000': '11111111-1111-1111-1111-111111111111',
  // 107031 — Москва, Рождественка 10/2 (м. Кузнецкий Мост)
  '107031': '22222222-2222-2222-2222-222222222222',
  // 105062 — Москва, Покровка 16 (м. Китай-город)
  '105062': '33333333-3333-3333-3333-333333333333',
  // 109012 — Москва, Никольская 8/1 (м. Лубянка)
  '109012': '44444444-4444-4444-4444-444444444444',
  // 125009 — Москва, Тверская 9 (м. Охотный Ряд)
  '125009': '55555555-5555-5555-5555-555555555555',
  // 119019 — Москва, Новый Арбат 2 (м. Арбатская)
  '119019': '66666666-6666-6666-6666-666666666666',
  // 105064 — Москва, Земляной Вал 33 (м. Курская)
  '105064': '88888888-8888-8888-8888-888888888888',
  // 115184 — Москва, Большая Татарская 20 (м. Новокузнецкая)
  '115184': '99999999-9999-9999-9999-999999999999',
  // 119048 — Москва, Комсомольский просп. 34 (м. Фрунзенская)
  '119048': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  // 123001 — Москва, Садовая-Кудринская 14 (м. Баррикадная)
  '123001': 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  // 127051 — Москва, Цветной бульвар 15 (м. Цветной бульвар)
  '127051': 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

// Текстовые алиасы (названия) для обратной совместимости
const TEXT_SLUGS: Record<string, string> = {
  'demo': '11111111-1111-1111-1111-111111111111',
  'демо': '11111111-1111-1111-1111-111111111111',
  'мясницкая': '11111111-1111-1111-1111-111111111111',
  'myasnitskaya': '11111111-1111-1111-1111-111111111111',
  'главпочтамт': '11111111-1111-1111-1111-111111111111',
  'рождественка': '22222222-2222-2222-2222-222222222222',
  'rozhdestvenka': '22222222-2222-2222-2222-222222222222',
  'покровка': '33333333-3333-3333-3333-333333333333',
  'pokrovka': '33333333-3333-3333-3333-333333333333',
  'никольская': '44444444-4444-4444-4444-444444444444',
  'nikolskaya': '44444444-4444-4444-4444-444444444444',
  'тверская': '55555555-5555-5555-5555-555555555555',
  'tverskaya': '55555555-5555-5555-5555-555555555555',
  'арбат': '66666666-6666-6666-6666-666666666666',
  'arbat': '66666666-6666-6666-6666-666666666666',
  'земляной-вал': '88888888-8888-8888-8888-888888888888',
  'zemlyanoy-val': '88888888-8888-8888-8888-888888888888',
};

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[—_]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zа-я0-9-]/gi, '')
    .trim();
}

/**
 * Преобразует почтовый индекс (например, '101000', '107031', '125009')
 * или текстовый слаг из URL в канонический UUID отделения.
 */
export function resolveBranchIdFromPostalCode(
  postalCodeOrSlug?: string | null,
  extraBranches?: Array<{ id: string; name: string }>
): string {
  if (!postalCodeOrSlug) return DEFAULT_BRANCH_ID;

  const raw = decodeURIComponent(postalCodeOrSlug).trim();
  if (!raw) return DEFAULT_BRANCH_ID;

  // Если это уже UUID — возвращаем напрямую
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(raw)) {
    return raw;
  }

  const norm = normalize(raw);

  // 1. Поиск по точному почтовому индексу
  if (POSTAL_CODE_TO_ID[norm]) {
    return POSTAL_CODE_TO_ID[norm];
  }

  // 2. Поиск по коду в каталоге POSTAL_BRANCHES
  for (const b of POSTAL_BRANCHES) {
    if (b.id === raw) return b.id;
    if (b.code && normalize(b.code) === norm) {
      return b.id;
    }
  }

  // 3. Поиск по текстовым слагам/алиасам
  if (TEXT_SLUGS[norm]) {
    return TEXT_SLUGS[norm];
  }

  // 4. Поиск по названиям отделений (если передали часть названия)
  for (const b of POSTAL_BRANCHES) {
    const normName = normalize(b.name);
    if (normName === norm || normName.includes(norm) || norm.includes(normName)) {
      return b.id;
    }
  }

  if (extraBranches) {
    for (const b of extraBranches) {
      if (b.id === raw) return b.id;
      const normName = normalize(b.name);
      if (normName === norm || normName.includes(norm) || norm.includes(normName)) {
        return b.id;
      }
    }
  }

  return raw;
}

/**
 * Возвращает официальный 6-значный почтовый индекс для отделения.
 * Используется в URL табло: /tv/101000, /tv/107031 и т.д.
 */
export function getBranchPostalCode(branchId: string, branchName?: string): string {
  if (OFFICIAL_BRANCH_POSTAL_CODES[branchId]) {
    return OFFICIAL_BRANCH_POSTAL_CODES[branchId];
  }

  const found = POSTAL_BRANCHES.find(b => b.id === branchId);
  if (found?.code) {
    return found.code.replace(/[^0-9]/g, '');
  }

  if (branchName) {
    // Проверяем, есть ли индекс в названии или адресе
    const match = branchName.match(/\b\d{6}\b/);
    if (match) return match[0];
  }

  return branchId;
}

/**
 * Алиасы для обратной совместимости
 */
export const resolveBranchIdFromSlug = resolveBranchIdFromPostalCode;
export const getBranchSlug = getBranchPostalCode;

/**
 * Возвращает полное красивое название отделения с его официальным индексом для шапки ТВ.
 * Например: «ОПС 101000 · Главпочтамт Мясницкая»
 */
export function getBranchDisplayName(
  branchIdOrCode: string,
  branches?: Array<{ id: string; name: string }>
): string {
  const resolvedId = resolveBranchIdFromPostalCode(branchIdOrCode, branches);
  const postalCode = OFFICIAL_BRANCH_POSTAL_CODES[resolvedId] ||
    POSTAL_BRANCHES.find(b => b.id === resolvedId)?.code || '';

  // Ищем имя в API-списке
  let name = '';
  if (branches) {
    const found = branches.find(b => b.id === resolvedId || b.id === branchIdOrCode);
    if (found?.name) name = found.name;
  }

  // Ищем имя в POSTAL_BRANCHES
  if (!name) {
    const found = POSTAL_BRANCHES.find(b => b.id === resolvedId);
    if (found?.name) name = found.name;
  }

  if (!name) {
    name = branchIdOrCode ? `Отделение ${branchIdOrCode}` : 'Табло электронной очереди';
  }

  // Если имя уже содержит индекс — выводим как есть
  if (name.includes(postalCode) || !postalCode) {
    return name;
  }

  // Форматируем с официальным почтовым индексом: ОПС 101000 · Название
  return `ОПС ${postalCode} · ${name}`;
}
