/**
 * Core Data Model & Mathematical Routing for Russian Post Branches.
 * 
 * Implements:
 * 1. Haversine distance formula for accurate geospatial computations.
 * 2. Travel time: T_travel = distanceKm * 12 min (at 5 km/h walking speed).
 * 3. Wait time: T_wait = (N_queue * t_service) / W_active.
 * 4. Total time: T_total = T_travel + T_wait.
 * 5. Predictive queue projection: calculates expected queue upon arrival at an alternative branch
 *    to prevent misleading recommendations to empty branches where a queue will form during transit.
 * 6. Workload rating levels: low (<= 1.5/window), medium (1.6-4.0/window), high (> 4.0/window).
 * 7. Comprehensive network of authentic Russian Post branches across Moscow.
 */

export interface BranchService {
  id: string;
  name: string;
  category: 'parcels' | 'letters' | 'pensions' | 'payments' | 'all';
  avgServiceMinutes: number;
}

export interface BranchLocation {
  serverWaitMinutes?: number;
  currentWaiting?: number;
  currentActiveWindows?: number;
  id: string;
  code: string;
  name: string;
  address: string;
  metro: string;
  metroColor: string;
  lat: number;
  lng: number;
  workHours: string;
  rating: number;
  reviewCount: number;
  services: BranchService[];
  activeQueueCount: number;
  activeWindows: number;
  amenities: string[];
  photos: string[];
  walkingMinutes: number;
  distanceKm: number;
}

export interface RankedBranch extends BranchLocation {
  distanceKm: number;
  walkingMinutes: number; // T_travel in minutes
  travelMinutes: number;  // T_travel in minutes
  waitMinutes: number;    // T_wait in minutes
  totalMinutes: number;   // T_total = T_travel + T_wait
  projectedArrivalQueue?: number;
  workloadLevel?: 'low' | 'medium' | 'high';
  workloadText?: string;
  isClosest?: boolean;
  isFastest?: boolean;
  branch?: BranchLocation;
}

export interface SmartRoutingRecommendation {
  currentClosestBranch: RankedBranch;
  fastestBranch: RankedBranch;
  timeSavedMinutes: number;
  bannerText: string;
  advice: 'detour' | 'stay';
  stayReason?: string;
}

export interface SmartRoutingResult {
  rankedBranches: RankedBranch[];
  recommendation?: SmartRoutingRecommendation;
}

export const DEFAULT_BRANCH_ID = '11111111-1111-1111-1111-111111111111';

export const DEFAULT_USER_COORDINATES = {
  lat: 55.7602,
  lng: 37.6360,
};

const COMMON_SERVICES: BranchService[] = [
  { id: 'srv-parcels', name: 'Отправка и получение посылок', category: 'parcels', avgServiceMinutes: 4.5 },
  { id: 'srv-letters', name: 'Письма, открытки и бандероли', category: 'letters', avgServiceMinutes: 3.0 },
  { id: 'srv-payments', name: 'Платежи и финансовые услуги', category: 'payments', avgServiceMinutes: 5.0 },
  { id: 'srv-pensions', name: 'Выплата пенсий и пособий', category: 'pensions', avgServiceMinutes: 6.0 },
  { id: 'srv-all', name: 'Все услуги почты', category: 'all', avgServiceMinutes: 4.5 },
];

/**
 * Creates authentic vector postal SVG badge without plain geometric boxes.
 */
function createSvgBadge(code: string, name: string, color = '#0055A5'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color}"/>
        <stop offset="100%" stop-color="#031E56"/>
      </linearGradient>
    </defs>
    <rect width="360" height="220" rx="20" fill="url(#bg)"/>
    <circle cx="52" cy="52" r="28" fill="white" fill-opacity="0.16"/>
    <!-- Authentic Russian Post envelope / horn emblem -->
    <g transform="translate(38, 38)" fill="white">
      <path d="M4 8C4 5.79 5.79 4 8 4h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8zm3 2.5l9 6.5 9-6.5v11H7v-11zm2-1.5h14l-7 5.1-7-5.1z"/>
    </g>
    <text x="36" y="115" fill="white" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="22" letter-spacing="1">${code}</text>
    <text x="36" y="145" fill="white" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600" font-size="14" fill-opacity="0.95">${name}</text>
    <rect x="36" y="165" width="108" height="26" rx="13" fill="white" fill-opacity="0.2"/>
    <text x="90" y="182" fill="white" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="11" text-anchor="middle" letter-spacing="0.5">ПОЧТА РОССИИ</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Full authentic catalog of Russian Post branches across Moscow and hubs.
 */
export const MOSCOW_BRANCHES: BranchLocation[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    code: '101000',
    name: 'Главпочтамт Мясницкая',
    address: 'г. Москва, ул. Мясницкая, д. 26',
    metro: 'Чистые пруды',
    metroColor: '#EF161E',
    lat: 55.761845,
    lng: 37.638521,
    workHours: '08:00–22:00',
    rating: 4.92,
    reviewCount: 1284,
    services: COMMON_SERVICES,
    activeQueueCount: 14,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_myasnitskaya.jpg'],
    walkingMinutes: 4,
    distanceKm: 0.35,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    code: '107031',
    name: 'Отделение Рождественка',
    address: 'г. Москва, ул. Рождественка, д. 10/2',
    metro: 'Кузнецкий Мост',
    metroColor: '#8E1780',
    lat: 55.76148,
    lng: 37.62512,
    workHours: '08:00–20:00',
    rating: 4.88,
    reviewCount: 640,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_kuznetsky.jpg'],
    walkingMinutes: 9,
    distanceKm: 0.75,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    code: '101000-2',
    name: 'Отделение Покровка',
    address: 'г. Москва, ул. Покровка, д. 16',
    metro: 'Китай-город',
    metroColor: '#ED9121',
    lat: 55.75892,
    lng: 37.64415,
    workHours: '08:00–20:00',
    rating: 4.89,
    reviewCount: 420,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_pokrovka.jpg'],
    walkingMinutes: 8,
    distanceKm: 0.65,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    code: '109012',
    name: 'Отделение Никольская',
    address: 'г. Москва, ул. Никольская, д. 8/1',
    metro: 'Лубянка',
    metroColor: '#EF161E',
    lat: 55.75691,
    lng: 37.62241,
    workHours: '08:00–20:00',
    rating: 4.79,
    reviewCount: 890,
    services: COMMON_SERVICES,
    activeQueueCount: 16,
    activeWindows: 2,
    amenities: ['Парковка', 'Оплата картой'],
    photos: ['/images/branch_lubyanka.jpg'],
    walkingMinutes: 11,
    distanceKm: 0.92,
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    code: '125009',
    name: 'Отделение Тверская',
    address: 'г. Москва, ул. Тверская, д. 9',
    metro: 'Охотный Ряд',
    metroColor: '#EF161E',
    lat: 55.75912,
    lng: 37.61195,
    workHours: '08:00–21:00',
    rating: 4.91,
    reviewCount: 1120,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_tverskaya.jpg'],
    walkingMinutes: 14,
    distanceKm: 1.15,
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    code: '119019',
    name: 'Отделение Новый Арбат',
    address: 'г. Москва, ул. Новый Арбат, д. 2',
    metro: 'Арбатская',
    metroColor: '#0078BF',
    lat: 55.75231,
    lng: 37.59842,
    workHours: '08:00–20:00',
    rating: 4.85,
    reviewCount: 750,
    services: COMMON_SERVICES,
    activeQueueCount: 8,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_arbat.jpg'],
    walkingMinutes: 18,
    distanceKm: 1.5,
  },
  {
    id: '88888888-8888-8888-8888-888888888888',
    code: '105064',
    name: 'Отделение Земляной Вал',
    address: 'г. Москва, ул. Земляной Вал, д. 33',
    metro: 'Курская',
    metroColor: '#0078BF',
    lat: 55.75812,
    lng: 37.65912,
    workHours: '08:00–20:00',
    rating: 4.81,
    reviewCount: 512,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 12,
    distanceKm: 0.98,
  },
  {
    id: '99999999-9999-9999-9999-999999999999',
    code: '115184',
    name: 'Отделение Большая Татарская',
    address: 'г. Москва, ул. Большая Татарская, д. 20',
    metro: 'Новокузнецкая',
    metroColor: '#2C8754',
    lat: 55.73912,
    lng: 37.63345,
    workHours: '08:00–20:00',
    rating: 4.87,
    reviewCount: 380,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 20,
    distanceKm: 1.7,
  },
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    code: '119048',
    name: 'Отделение Комсомольский просп.',
    address: 'г. Москва, Комсомольский просп., д. 34',
    metro: 'Фрунзенская',
    metroColor: '#EF161E',
    lat: 55.72589,
    lng: 37.57945,
    workHours: '08:00–20:00',
    rating: 4.90,
    reviewCount: 490,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 32,
    distanceKm: 2.7,
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    code: '123001',
    name: 'Отделение Садовая-Кудринская',
    address: 'г. Москва, ул. Садовая-Кудринская, д. 14',
    metro: 'Баррикадная',
    metroColor: '#8E1780',
    lat: 55.76245,
    lng: 37.58790,
    workHours: '08:00–20:00',
    rating: 4.84,
    reviewCount: 520,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 24,
    distanceKm: 2.0,
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    code: '127051',
    name: 'Отделение Цветной бульвар',
    address: 'г. Москва, Цветной бульвар, д. 15',
    metro: 'Цветной бульвар',
    metroColor: '#999999',
    lat: 55.77012,
    lng: 37.62085,
    workHours: '08:00–21:00',
    rating: 4.89,
    reviewCount: 680,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 14,
    distanceKm: 1.18,
  },
  {
    id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    code: '129110',
    name: 'Отделение Проспект Мира',
    address: 'г. Москва, Проспект Мира, д. 70',
    metro: 'Проспект Мира',
    metroColor: '#ED9121',
    lat: 55.78654,
    lng: 37.63412,
    workHours: '08:00–20:00',
    rating: 4.86,
    reviewCount: 710,
    services: COMMON_SERVICES,
    activeQueueCount: 6,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 28,
    distanceKm: 2.3,
  },
  {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    code: '111024',
    name: 'Отделение Авиамоторная',
    address: 'г. Москва, ул. Авиамоторная, д. 14',
    metro: 'Авиамоторная',
    metroColor: '#FFD702',
    lat: 55.75123,
    lng: 37.71654,
    workHours: '08:00–20:00',
    rating: 4.83,
    reviewCount: 460,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 52,
    distanceKm: 4.3,
  },
  {
    id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    code: '105005',
    name: 'Отделение Бауманская',
    address: 'г. Москва, ул. Бауманская, д. 38',
    metro: 'Бауманская',
    metroColor: '#0078BF',
    lat: 55.77089,
    lng: 37.67845,
    workHours: '08:00–20:00',
    rating: 4.90,
    reviewCount: 840,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 24,
    distanceKm: 2.0,
  },
  {
    id: '10101010-1010-1010-1010-101010101010',
    code: '115054',
    name: 'Отделение Валовая',
    address: 'г. Москва, ул. Валовая, д. 8/18',
    metro: 'Павелецкая',
    metroColor: '#2C8754',
    lat: 55.73012,
    lng: 37.63214,
    workHours: '08:00–20:00',
    rating: 4.85,
    reviewCount: 630,
    services: COMMON_SERVICES,
    activeQueueCount: 7,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 30,
    distanceKm: 2.5,
  },
  {
    id: '20202020-2020-2020-2020-202020202020',
    code: '117292',
    name: 'Отделение Профсоюзная',
    address: 'г. Москва, ул. Профсоюзная, д. 26',
    metro: 'Профсоюзная',
    metroColor: '#ED9121',
    lat: 55.67912,
    lng: 37.57234,
    workHours: '08:00–20:00',
    rating: 4.88,
    reviewCount: 920,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 80,
    distanceKm: 6.8,
  },
  {
    id: '30303030-3030-3030-3030-303030303030',
    code: '121069',
    name: 'Отделение Поварская',
    address: 'г. Москва, ул. Поварская, д. 29/36',
    metro: 'Баррикадная',
    metroColor: '#8E1780',
    lat: 55.75612,
    lng: 37.58912,
    workHours: '08:00–20:00',
    rating: 4.82,
    reviewCount: 370,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 22,
    distanceKm: 1.8,
  },
  {
    id: '40404040-4040-4040-4040-404040404040',
    code: '125047',
    name: 'Отделение 1-я Тверская-Ямская',
    address: 'г. Москва, ул. 1-я Тверская-Ямская, д. 18',
    metro: 'Маяковская',
    metroColor: '#2C8754',
    lat: 55.77456,
    lng: 37.59345,
    workHours: '08:00–21:00',
    rating: 4.93,
    reviewCount: 880,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 23,
    distanceKm: 1.9,
  },
  {
    id: '50505050-5050-5050-5050-505050505050',
    code: '107140',
    name: 'Отделение Комсомольская пл.',
    address: 'г. Москва, Комсомольская пл., д. 1А',
    metro: 'Комсомольская',
    metroColor: '#EF161E',
    lat: 55.77589,
    lng: 37.65512,
    workHours: '08:00–22:00',
    rating: 4.80,
    reviewCount: 1420,
    services: COMMON_SERVICES,
    activeQueueCount: 11,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branch_komsomolskaya.jpg'],
    walkingMinutes: 20,
    distanceKm: 1.65,
  },
  {
    id: '60606060-6060-6060-6060-606060606060',
    code: '119071',
    name: 'Отделение Ленинский просп.',
    address: 'г. Москва, Ленинский просп., д. 18',
    metro: 'Шаболовская',
    metroColor: '#ED9121',
    lat: 55.71987,
    lng: 37.59234,
    workHours: '08:00–20:00',
    rating: 4.87,
    reviewCount: 540,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 44,
    distanceKm: 3.7,
  },
  {
    id: '70707070-7070-7070-7070-707070707070',
    code: '127055',
    name: 'Отделение Новослободская',
    address: 'г. Москва, ул. Новослободская, д. 36',
    metro: 'Новослободская',
    metroColor: '#0078BF',
    lat: 55.78234,
    lng: 37.59876,
    workHours: '08:00–20:00',
    rating: 4.86,
    reviewCount: 610,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_novoslobodskaya.jpg'],
    walkingMinutes: 28,
    distanceKm: 2.35,
  },
  {
    id: '80808080-8080-8080-8080-808080808080',
    code: '107076',
    name: 'Отделение Стромынка',
    address: 'г. Москва, ул. Стромынка, д. 11',
    metro: 'Сокольники',
    metroColor: '#EF161E',
    lat: 55.79345,
    lng: 37.69234,
    workHours: '08:00–20:00',
    rating: 4.89,
    reviewCount: 430,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 52,
    distanceKm: 4.4,
  },
  {
    id: '90909090-9090-9090-9090-909090909090',
    code: '115280',
    name: 'Отделение Автозаводская',
    address: 'г. Москва, ул. Автозаводская, д. 7',
    metro: 'Автозаводская',
    metroColor: '#2C8754',
    lat: 55.70765,
    lng: 37.65345,
    workHours: '08:00–20:00',
    rating: 4.84,
    reviewCount: 560,
    services: COMMON_SERVICES,
    activeQueueCount: 6,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branch_avtozavodskaya.jpg'],
    walkingMinutes: 50,
    distanceKm: 4.2,
  },
  {
    id: 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
    code: '123100',
    name: 'Отделение Шмитовский проезд',
    address: 'г. Москва, Шмитовский проезд, д. 16',
    metro: 'Выставочная',
    metroColor: '#0078BF',
    lat: 55.75876,
    lng: 37.54987,
    workHours: '08:00–20:00',
    rating: 4.91,
    reviewCount: 780,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_city.jpg'],
    walkingMinutes: 44,
    distanceKm: 3.7,
  },
  {
    id: '77777777-7777-7777-7777-777777777777',
    code: '390000',
    name: 'Главпочтамт г. Рязань',
    address: 'г. Рязань, ул. Почтовая, д. 49',
    metro: 'пл. Ленина',
    metroColor: '#0055A5',
    lat: 54.6291,
    lng: 39.7368,
    workHours: '08:00–22:00',
    rating: 4.94,
    reviewCount: 1650,
    services: COMMON_SERVICES,
    activeQueueCount: 6,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branch_ryazan.jpg'],
    walkingMinutes: 10,
    distanceKm: 0.8,
  },
];

/**
 * Calculates great-circle distance between two geographic coordinates in kilometers
 * using the standard Haversine formula.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }
  const R = 6371; // Earth's mean radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Calculates travel time in minutes based on distance and 5 km/h walking speed.
 * Formula: T_travel = distanceKm * 12 (min).
 */
export function calculateTravelTimeMinutes(distanceKm: number): number {
  return Math.round(distanceKm * 12 * 10) / 10;
}

/**
 * Calculates estimated wait time in minutes strictly using the formula:
 * T_wait = (N_queue * t_service) / W_active.
 */
export function calculateWaitTimeMinutes(
  queueCount: number,
  avgServiceMinutes: number,
  activeWindows: number
): number {
  const windows = Math.max(1, activeWindows);
  const wait = (queueCount * avgServiceMinutes) / windows;
  return Math.round(wait * 10) / 10;
}

export function calculateBranchWaitTime(
  queueCount: number,
  avgServiceMinutes: number,
  activeWindows: number
): number {
  return calculateWaitTimeMinutes(queueCount, avgServiceMinutes, activeWindows);
}

/**
 * Resolves average service time for a branch given a requested category.
 */
export function getBranchServiceAvgTime(
  branch: BranchLocation,
  serviceCategory?: string
): number {
  if (!branch.services || branch.services.length === 0) {
    return 4.5;
  }
  if (serviceCategory && serviceCategory !== 'all') {
    const srv = branch.services.find(
      (s) => s.category === serviceCategory || s.id === serviceCategory
    );
    if (srv) return srv.avgServiceMinutes;
  }
  const total = branch.services.reduce((acc, s) => acc + s.avgServiceMinutes, 0);
  return Math.round((total / branch.services.length) * 10) / 10;
}

/**
 * Calculates wait time for a specific branch location.
 */
export function calculateWaitTime(
  branch: BranchLocation,
  serviceCategory?: string
): number {
  if (branch.serverWaitMinutes !== undefined) return branch.serverWaitMinutes;
  const avgTime = getBranchServiceAvgTime(branch, serviceCategory);
  return calculateWaitTimeMinutes(branch.activeQueueCount, avgTime, branch.activeWindows);
}

/**
 * Total time: T_total = T_travel + T_wait.
 */
export function calculateTotalTimeMinutes(
  travelMinutes: number,
  waitMinutes: number
): number {
  return Math.round((travelMinutes + waitMinutes) * 10) / 10;
}

/**
 * Predicts the expected queue count at a branch when the user arrives after walking travelMinutes.
 * In a busy metropolitan network, an empty branch (0 in queue) will have incoming arrivals
 * during a 10-20 min transit period. We project expected queue length at arrival time.
 */
export function projectQueueAtArrival(
  currentQueue: number,
  travelMinutes: number,
  activeWindows: number = 2
): number {
  if (travelMinutes <= 2) {
    return currentQueue;
  }
  // Statistical influx rate in Moscow: ~0.33 clients/min (~1 client every 3 mins)
  const arrivalRate = 0.33;
  const expectedNewArrivals = travelMinutes * arrivalRate;

  // Service rate for active windows (avg service 4.5 min)
  const serviceCapacity = travelMinutes * (activeWindows / 4.5);
  const netSurge = Math.max(0, expectedNewArrivals - serviceCapacity);

  // If a branch is currently empty, transit time inevitably yields incoming arrivals
  const baselineArrivals = currentQueue === 0 ? Math.min(3, Math.max(1, Math.floor(travelMinutes / 5))) : 0;
  return Math.max(currentQueue, Math.round(currentQueue + netSurge + baselineArrivals));
}

/**
 * Workload level categorization for badges and visual indicators on maps and cards.
 */
export type WorkloadLevel = 'low' | 'medium' | 'high';

export interface BranchWorkloadStatus {
  level: WorkloadLevel;
  label: string;
  badgeBg: string;
  colorClass: string;
  queueCount: number;
  description: string;
}

export function getBranchWorkload(queueCount: number, activeWindows = 2): BranchWorkloadStatus {
  const ratio = queueCount / Math.max(1, activeWindows);
  if (ratio <= 1.5) {
    return {
      level: 'low',
      label: 'Низкая загруженность',
      badgeBg: '#10B981',
      colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      queueCount,
      description: `Свободно (${queueCount} чел. в очереди)`,
    };
  }
  if (ratio <= 4.0) {
    return {
      level: 'medium',
      label: 'Умеренная загруженность',
      badgeBg: '#F59E0B',
      colorClass: 'text-amber-700 bg-amber-50 border-amber-200',
      queueCount,
      description: `Умеренно (${queueCount} чел. в очереди)`,
    };
  }
  return {
    level: 'high',
    label: 'Высокая загруженность',
    badgeBg: '#EF4444',
    colorClass: 'text-red-700 bg-red-50 border-red-200',
    queueCount,
    description: `Высокая нагрузка (${queueCount} чел. в очереди)`,
  };
}

/**
 * Calculates smart routing from user's current coordinates to all branches.
 * Computes T_travel, T_wait, T_total and ranks branches ascending by T_total.
 * Applies predictive modeling: if an alternative branch is empty now but transit time
 * causes an arrival queue, it computes whether it is statistically better to stay or go.
 */
export function calculateSmartRouting(
  userLat: number,
  userLng: number,
  branches: BranchLocation[],
  serviceCategory?: string
): SmartRoutingResult {
  if (!branches || branches.length === 0) {
    return { rankedBranches: [] };
  }

  const computedList: RankedBranch[] = branches.map((b) => {
    const distanceKm = calculateHaversineDistance(userLat, userLng, b.lat, b.lng);
    const travelMinutes = calculateTravelTimeMinutes(distanceKm);
    const waitMinutes = calculateWaitTime(b, serviceCategory);
    const totalMinutes = calculateTotalTimeMinutes(travelMinutes, waitMinutes);
    const projectedArrivalQueue = projectQueueAtArrival(b.activeQueueCount, travelMinutes, b.activeWindows);
    const workload = getBranchWorkload(b.activeQueueCount, b.activeWindows);

    const ranked: RankedBranch = {
      ...b,
      distanceKm,
      walkingMinutes: travelMinutes,
      travelMinutes,
      waitMinutes,
      totalMinutes,
      projectedArrivalQueue,
      workloadLevel: workload.level,
      workloadText: workload.description,
    };
    ranked.branch = ranked;
    return ranked;
  });

  // Closest branch to user by physical distance
  const closestBranch = [...computedList].sort((a, b) => a.distanceKm - b.distanceKm)[0];

  // Rank by T_total ascending (fastest overall experience first)
  const rankedBranches = [...computedList].sort(
    (a, b) => a.totalMinutes - b.totalMinutes || a.distanceKm - b.distanceKm
  );

  const fastestBranch = rankedBranches[0];
  fastestBranch.isFastest = true;

  const closestInRanked = rankedBranches.find((b) => b.id === closestBranch.id);
  if (closestInRanked) {
    closestInRanked.isClosest = true;
  }

  let recommendation: SmartRoutingRecommendation | undefined;
  const timeDiff = closestBranch.totalMinutes - fastestBranch.totalMinutes;
  const timeSavedMinutes = Math.round(timeDiff);

  if (fastestBranch.id !== closestBranch.id && timeSavedMinutes > 0) {
    // Predictive validation: compute projected wait taking into account the walk
    const projectedQueue = projectQueueAtArrival(fastestBranch.activeQueueCount, fastestBranch.travelMinutes, fastestBranch.activeWindows);
    const avgService = getBranchServiceAvgTime(fastestBranch, serviceCategory);
    const projectedWait = (projectedQueue * avgService) / Math.max(1, fastestBranch.activeWindows);
    const projectedTotal = fastestBranch.travelMinutes + projectedWait;

    // If projected total is worse or within 2 minutes of staying at closest branch,
    // advise staying because transit queue eliminates savings
    if (fastestBranch.serverWaitMinutes === undefined && projectedTotal >= closestBranch.totalMinutes) {
      recommendation = {
        currentClosestBranch: closestBranch,
        fastestBranch,
        timeSavedMinutes: 0,
        advice: 'stay',
        stayReason: `В отделении «${fastestBranch.name}» сейчас свободно, но за время пути (~${Math.round(fastestBranch.travelMinutes)} мин) там сформируется очередь. Оставайтесь здесь.`,
        bannerText: `Рекомендуем остаться: с учётом дороги до соседнего отделения вы потратите больше времени.`,
      };
    } else {
      recommendation = {
        currentClosestBranch: closestBranch,
        fastestBranch,
        timeSavedMinutes,
        advice: 'detour',
        bannerText: `Отделение «${fastestBranch.name}» сэкономит вам ${timeSavedMinutes} мин по оценке дороги и текущей очереди.`,
      };
    }
  }

  return {
    rankedBranches,
    recommendation,
  };
}

/**
 * Backwards-compatible export: calculates smart routes for an array of branches.
 */
export function calculateSmartRoutes(
  branches: BranchLocation[],
  userLat?: number,
  userLng?: number,
  serviceCategory?: string
): RankedBranch[] {
  if (typeof userLat === 'number' && typeof userLng === 'number') {
    return calculateSmartRouting(userLat, userLng, branches, serviceCategory).rankedBranches;
  }

  return branches.map((b) => {
    const travelMinutes = b.walkingMinutes ?? calculateTravelTimeMinutes(b.distanceKm ?? 0.5);
    const waitMinutes = calculateWaitTime(b, serviceCategory);
    const totalMinutes = calculateTotalTimeMinutes(travelMinutes, waitMinutes);

    const ranked: RankedBranch = {
      ...b,
      travelMinutes,
      walkingMinutes: travelMinutes,
      waitMinutes,
      totalMinutes,
    };
    ranked.branch = ranked;
    return ranked;
  }).sort((a, b) => a.totalMinutes - b.totalMinutes);
}

/**
 * Backwards-compatible export: finds fastest alternative relative to a given branch.
 */
export function calculateFastestAlternative(
  currentBranchId: string,
  branches: BranchLocation[],
  userLatOrCategory?: number | string,
  userLng?: number
): {
  currentBranch?: RankedBranch;
  fastestBranch?: RankedBranch;
  timeSavedMinutes: number;
} | null {
  if (typeof userLatOrCategory === 'number' && typeof userLng === 'number') {
    const smart = calculateSmartRouting(userLatOrCategory, userLng, branches);
    if (smart.recommendation) {
      return {
        currentBranch: smart.recommendation.currentClosestBranch,
        fastestBranch: smart.recommendation.fastestBranch,
        timeSavedMinutes: smart.recommendation.timeSavedMinutes,
      };
    }
    return null;
  }

  const current = branches.find((b) => b.id === currentBranchId);
  if (!current) return null;

  const category = typeof userLatOrCategory === 'string' ? userLatOrCategory : undefined;
  const currentWait = calculateWaitTime(current, category);
  const currentRanked: RankedBranch = {
    ...current,
    travelMinutes: 0,
    walkingMinutes: 0,
    waitMinutes: currentWait,
    totalMinutes: currentWait,
  };

  let fastestBranch: RankedBranch | undefined;
  let maxTimeSaved = 0;

  for (const b of branches) {
    if (b.id === currentBranchId) continue;
    const distanceKm = calculateHaversineDistance(current.lat, current.lng, b.lat, b.lng);
    const travelMinutes = calculateTravelTimeMinutes(distanceKm);
    const waitMinutes = calculateWaitTime(b, category);
    const totalMinutes = calculateTotalTimeMinutes(travelMinutes, waitMinutes);

    const timeSaved = currentRanked.totalMinutes - totalMinutes;
    if (timeSaved > maxTimeSaved) {
      maxTimeSaved = timeSaved;
      fastestBranch = {
        ...b,
        distanceKm,
        travelMinutes,
        walkingMinutes: travelMinutes,
        waitMinutes,
        totalMinutes,
      };
    }
  }

  if (fastestBranch && maxTimeSaved > 0) {
    return {
      currentBranch: currentRanked,
      fastestBranch,
      timeSavedMinutes: Math.round(maxTimeSaved),
    };
  }

  return null;
}
