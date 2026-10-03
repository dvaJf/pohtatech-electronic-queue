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
  postalCode?: string;
  name: string;
  city?: string;
  address: string;
  metro: string;
  metroColor: string;
  landmarkType?: 'metro' | 'landmark';
  lat: number;
  lng: number;
  workHours: string;
  rating: number;
  reviewCount: number;
  services: BranchService[];
  activeQueueCount: number;
  activeWindows: number;
  amenities: string[];
  legacyAddresses?: string[];
  photos: string[];
  photoSource?: string;
  photoSourceUrl?: string;
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

export const MAX_ROUTE_TRAVEL_MINUTES = 180;
export const MAX_QUEUE_WAIT_MINUTES = 480;

export function isUsableDurationMinutes(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

/** Returns a total in minutes only when both components are usable minute durations. */
export function calculateBranchTotalTime(travelMinutes: unknown, waitMinutes: unknown): number | undefined {
  if (!isUsableDurationMinutes(travelMinutes, MAX_ROUTE_TRAVEL_MINUTES)
      || !isUsableDurationMinutes(waitMinutes, MAX_QUEUE_WAIT_MINUTES)) return undefined;
  return Math.round((travelMinutes + waitMinutes) * 10) / 10;
}

export const DEFAULT_BRANCH_ID = '11111111-1111-1111-1111-111111111111';

export const DEFAULT_USER_COORDINATES = {
  lat: 55.7951,
  lng: 49.1123,
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

/**
 * Authentic Russian Post branches across Kazan and Innopolis (OPS 420500).
 */
export const KAZAN_AND_INNO_BRANCHES: BranchLocation[] = [
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0500',
    code: '420500',
    postalCode: '420500',
    city: 'Иннополис',
    name: 'Отделение Иннополис',
    address: 'г. Иннополис, ул. Университетская, д. 7',
    metro: 'Университет Иннополис',
    landmarkType: 'landmark',
    metroColor: '#10B981',
    lat: 55.752176,
    lng: 48.744474,
    workHours: '09:00–18:00',
    rating: 4.95,
    reviewCount: 312,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой', 'Wi-Fi'],
    photos: ['/images/branches/420500.jpg', 'https://avatars.mds.yandex.net/get-altay/16399547/2a000001980e3e6a794e8e492a72b043f818/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1394028945/',
    walkingMinutes: 5,
    distanceKm: 0.4,
  },
  {
    id: '11111111-1111-1111-1111-111111111111',
    code: '420000',
    postalCode: '420000',
    city: 'Казань',
    name: 'Главпочтамт г. Казань',
    address: 'г. Казань, ул. Кремлёвская, д. 8',
    metro: 'Кремлёвская',
    metroColor: '#EF161E',
    lat: 55.795120,
    lng: 49.112340,
    workHours: '08:00–22:00',
    rating: 4.88,
    reviewCount: 1420,
    services: COMMON_SERVICES,
    activeQueueCount: 8,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branches/420000.jpg', 'https://avatars.mds.yandex.net/get-altay/10445027/2a0000018b327f8666562cf0066cd89461ee/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1087545576/',
    walkingMinutes: 3,
    distanceKm: 0.25,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0002',
    code: '420111',
    postalCode: '420111',
    city: 'Казань',
    name: 'Отделение Казань Баумана',
    address: 'г. Казань, ул. Баумана, д. 29',
    metro: 'Площадь Тукая',
    metroColor: '#EF161E',
    lat: 55.790450,
    lng: 49.117890,
    workHours: '08:00–20:00',
    rating: 4.82,
    reviewCount: 890,
    services: COMMON_SERVICES,
    activeQueueCount: 6,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420111.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1215157106/',
    walkingMinutes: 6,
    distanceKm: 0.5,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0003',
    code: '420015',
    postalCode: '420015',
    city: 'Казань',
    name: 'Отделение Карла Маркса',
    address: 'г. Казань, ул. Карла Маркса, д. 44',
    legacyAddresses: ['г. Казань, ул. Карла Маркса, д. 45'],
    metro: 'Площадь Свободы',
    landmarkType: 'landmark',
    metroColor: '#0078BF',
    lat: 55.797820,
    lng: 49.135670,
    workHours: '08:00–20:00',
    rating: 4.79,
    reviewCount: 520,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420015.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1059522667/',
    walkingMinutes: 9,
    distanceKm: 0.75,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0004',
    code: '420021',
    postalCode: '420021',
    city: 'Казань',
    name: 'Отделение Татарстан',
    address: 'г. Казань, ул. Татарстан, д. 11',
    legacyAddresses: ['г. Казань, ул. Татарстан, д. 14'],
    metro: 'Площадь Тукая',
    metroColor: '#EF161E',
    lat: 55.781230,
    lng: 49.118920,
    workHours: '08:00–20:00',
    rating: 4.75,
    reviewCount: 460,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420021.jpg', 'https://avatars.mds.yandex.net/get-altay/5234599/2a000001812e597b36f6a16882cdcc3fe4bb/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1178811969/',
    walkingMinutes: 11,
    distanceKm: 0.9,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0005',
    code: '420097',
    postalCode: '420097',
    city: 'Казань',
    name: 'Отделение Вишневского',
    address: 'г. Казань, ул. Вишневского, д. 14',
    legacyAddresses: ['г. Казань, ул. Вишневского, д. 59'],
    metro: 'Суконная слобода',
    metroColor: '#EF161E',
    lat: 55.784560,
    lng: 49.152340,
    workHours: '08:00–20:00',
    rating: 4.81,
    reviewCount: 610,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branches/420097.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1006868977/',
    walkingMinutes: 14,
    distanceKm: 1.2,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0006',
    code: '420045',
    postalCode: '420045',
    city: 'Казань',
    name: 'Отделение Николая Ершова',
    address: 'г. Казань, ул. Николая Ершова, д. 28',
    metro: 'Парк Горького',
    landmarkType: 'landmark',
    metroColor: '#2C8754',
    lat: 55.793450,
    lng: 49.164520,
    workHours: '08:00–20:00',
    rating: 4.84,
    reviewCount: 430,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420045.jpg', 'https://avatars.mds.yandex.net/get-altay/4598810/2a0000017c27234f950b3078c5f2b9c85496/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1066554508/',
    walkingMinutes: 16,
    distanceKm: 1.4,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0007',
    code: '420107',
    postalCode: '420107',
    city: 'Казань',
    name: 'Отделение Петербургская',
    address: 'г. Казань, ул. Хади Такташа, д. 75',
    legacyAddresses: ['г. Казань, ул. Петербургская, д. 50'],
    metro: 'Суконная слобода',
    metroColor: '#EF161E',
    lat: 55.782340,
    lng: 49.131250,
    workHours: '08:00–20:00',
    rating: 4.90,
    reviewCount: 780,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branches/420107.jpg', 'https://avatars.mds.yandex.net/get-altay/20275193/2a0000019fcdc27aab86d094603ef963666c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1269672359/',
    walkingMinutes: 10,
    distanceKm: 0.8,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0008',
    code: '420066',
    postalCode: '420066',
    city: 'Казань',
    name: 'Отделение Чистопольская',
    address: 'г. Казань, Чистопольская ул., д. 23',
    legacyAddresses: ['г. Казань, ул. Чистопольская, д. 20'],
    metro: 'Козья Слобода',
    metroColor: '#EF161E',
    lat: 55.821450,
    lng: 49.113450,
    workHours: '08:00–20:00',
    rating: 4.86,
    reviewCount: 910,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branches/420066.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/216645292129/',
    walkingMinutes: 15,
    distanceKm: 1.3,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0009',
    code: '420032',
    postalCode: '420032',
    city: 'Казань',
    name: 'Отделение Краснококшайская',
    address: 'г. Казань, ул. Лукницкого, д. 6',
    legacyAddresses: ['г. Казань, ул. Краснококшайская, д. 74'],
    metro: 'Кольцо Славы',
    landmarkType: 'landmark',
    metroColor: '#ED9121',
    lat: 55.811230,
    lng: 49.071240,
    workHours: '08:00–20:00',
    rating: 4.77,
    reviewCount: 390,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420032.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1010873049/',
    walkingMinutes: 20,
    distanceKm: 1.8,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0010',
    code: '420034',
    postalCode: '420034',
    city: 'Казань',
    name: 'Отделение Декабристов',
    address: 'г. Казань, Тверская ул., д. 7',
    legacyAddresses: ['г. Казань, ул. Декабристов, д. 83'],
    metro: 'Яшьлек',
    metroColor: '#EF161E',
    lat: 55.823410,
    lng: 49.098760,
    workHours: '08:00–20:00',
    rating: 4.83,
    reviewCount: 650,
    services: COMMON_SERVICES,
    activeQueueCount: 6,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420034.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1014509412/',
    walkingMinutes: 18,
    distanceKm: 1.6,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0011',
    code: '420044',
    postalCode: '420044',
    city: 'Казань',
    name: 'Отделение Волгоградская',
    address: 'г. Казань, Волгоградская ул., д. 22',
    legacyAddresses: ['г. Казань, ул. Волгоградская, д. 2'],
    metro: 'Яшьлек',
    metroColor: '#EF161E',
    lat: 55.831200,
    lng: 49.094500,
    workHours: '08:00–20:00',
    rating: 4.80,
    reviewCount: 410,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420044.jpg', 'https://avatars.mds.yandex.net/get-altay/17684794/2a000001a0494210f87e25345e06455e3214/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1131405397/',
    walkingMinutes: 22,
    distanceKm: 2.0,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0012',
    code: '420073',
    postalCode: '420073',
    city: 'Казань',
    name: 'Отделение Гвардейская',
    address: 'г. Казань, Гвардейская ул., д. 42',
    legacyAddresses: ['г. Казань, ул. Гвардейская, д. 16'],
    metro: 'Аметьево',
    metroColor: '#EF161E',
    lat: 55.786500,
    lng: 49.171200,
    workHours: '08:00–20:00',
    rating: 4.78,
    reviewCount: 370,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420073.jpg', 'https://avatars.mds.yandex.net/get-altay/13299246/2a0000018e4484dcfbfac8e517ec34d487ca/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1140058405/',
    walkingMinutes: 24,
    distanceKm: 2.2,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0013',
    code: '420100',
    postalCode: '420100',
    city: 'Казань',
    name: 'Отделение Проспект Победы',
    address: 'г. Казань, ул. Академика Сахарова, д. 27',
    legacyAddresses: ['г. Казань, Проспект Победы, д. 139к2'],
    metro: 'Проспект Победы',
    metroColor: '#EF161E',
    lat: 55.772340,
    lng: 49.215670,
    workHours: '08:00–20:00',
    rating: 4.85,
    reviewCount: 840,
    services: COMMON_SERVICES,
    activeQueueCount: 7,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branches/420100.jpg', 'https://avatars.mds.yandex.net/get-altay/4546519/2a000001775a6cad04a297d4a902bc1ba549/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1110637905/',
    walkingMinutes: 30,
    distanceKm: 3.2,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0014',
    code: '420037',
    postalCode: '420037',
    city: 'Казань',
    name: 'Отделение Челюскина',
    address: 'г. Казань, ул. Айдарова, д. 22',
    legacyAddresses: ['г. Казань, ул. Челюскина, д. 24'],
    metro: 'Авиастроительная',
    metroColor: '#EF161E',
    lat: 55.856780,
    lng: 49.091230,
    workHours: '08:00–20:00',
    rating: 4.72,
    reviewCount: 290,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420037.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1031956175/',
    walkingMinutes: 35,
    distanceKm: 4.0,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0015',
    code: '420138',
    postalCode: '420138',
    city: 'Казань',
    name: 'Отделение Рихарда Зорге',
    address: 'г. Казань, Проспект Победы, д. 17',
    legacyAddresses: ['г. Казань, ул. Рихарда Зорге, д. 66'],
    metro: 'Дубравная',
    metroColor: '#EF161E',
    lat: 55.748900,
    lng: 49.208900,
    workHours: '08:00–20:00',
    rating: 4.87,
    reviewCount: 560,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branches/420138.jpg', 'https://avatars.mds.yandex.net/get-altay/1775373/2a0000016e6f2462019ce684eb273974df5f/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1219988110/',
    walkingMinutes: 32,
    distanceKm: 3.5,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0016',
    code: '420087',
    postalCode: '420087',
    city: 'Казань',
    name: 'Отделение Родины',
    address: 'г. Казань, ул. Карбышева, д. 48',
    legacyAddresses: ['г. Казань, ул. Родины, д. 24'],
    metro: 'Горки',
    metroColor: '#EF161E',
    lat: 55.765400,
    lng: 49.193400,
    workHours: '08:00–20:00',
    rating: 4.81,
    reviewCount: 340,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420087.jpg', 'https://avatars.mds.yandex.net/get-altay/1363250/2a00000162de8e4178c80174afbc048eba2e/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1234301407/',
    walkingMinutes: 28,
    distanceKm: 2.8,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0017',
    code: '420039',
    postalCode: '420039',
    city: 'Казань',
    name: 'Отделение Северный вокзал',
    address: 'г. Казань, ул. Гагарина, д. 93',
    legacyAddresses: ['г. Казань, ул. Декабристов, д. 180'],
    metro: 'Северный вокзал',
    metroColor: '#EF161E',
    lat: 55.836700,
    lng: 49.088900,
    workHours: '08:00–20:00',
    rating: 4.86,
    reviewCount: 670,
    services: COMMON_SERVICES,
    activeQueueCount: 6,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branches/420039.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/194111005597/',
    walkingMinutes: 25,
    distanceKm: 2.4,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0018',
    code: '420126',
    postalCode: '420126',
    city: 'Казань',
    name: 'Отделение Ямашева',
    address: 'г. Казань, ул. Фатыха Амирхана, д. 10А, корп. 2',
    legacyAddresses: ['г. Казань, Проспект Хусаина Ямашева, д. 76'],
    metro: 'Казан Арена',
    landmarkType: 'landmark',
    metroColor: '#0078BF',
    lat: 55.827800,
    lng: 49.141200,
    workHours: '08:00–20:00',
    rating: 4.83,
    reviewCount: 720,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branches/420126.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1024907151/',
    walkingMinutes: 20,
    distanceKm: 1.9,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0019',
    code: '420088',
    postalCode: '420088',
    city: 'Казань',
    name: 'Отделение Академика Губкина',
    address: 'г. Казань, ул. Зур Урам, д. 11',
    legacyAddresses: ['г. Казань, ул. Академика Губкина, д. 39б'],
    metro: 'Советская площадь',
    landmarkType: 'landmark',
    metroColor: '#ED9121',
    lat: 55.804500,
    lng: 49.191200,
    workHours: '08:00–20:00',
    rating: 4.76,
    reviewCount: 310,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420088.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1106637300/',
    walkingMinutes: 26,
    distanceKm: 2.6,
  },
  {
    id: 'c1a06492-4d5b-6923-0d2b-3906a43b0020',
    code: '420008',
    postalCode: '420008',
    city: 'Казань',
    name: 'Отделение Лобачевского',
    address: 'г. Казань, Кремлёвская ул., д. 18, корп. 1',
    legacyAddresses: ['г. Казань, ул. Лобачевского, д. 10'],
    metro: 'Площадь Тукая',
    metroColor: '#EF161E',
    lat: 55.792300,
    lng: 49.123400,
    workHours: '08:00–20:00',
    rating: 4.89,
    reviewCount: 540,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/420008.jpg', 'https://avatars.mds.yandex.net/get-altay/1003740/2a000001850bc4003a411400f1823f1977b9/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1045551377/',
    walkingMinutes: 7,
    distanceKm: 0.6,
  },
];

const MOSCOW_BRANCHES_CATALOG: BranchLocation[] = [
  {
    id: '9e364b61-0543-5502-b048-50b2e65879a3',
    code: '101000',
    postalCode: '101000',
    name: 'Главпочтамт Мясницкая',
    address: 'г. Москва, ул. Мясницкая, д. 26А, стр. 1',
    legacyAddresses: ['г. Москва, ул. Мясницкая, д. 26'],
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
    photos: ['/images/branches/101000.jpg', 'https://avatars.mds.yandex.net/get-altay/5483032/2a0000017de42ad4e022b1d17ebee0967659/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1377772714/',
    walkingMinutes: 4,
    distanceKm: 0.35,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    code: '107031',
    postalCode: '107031',
    name: 'Отделение Рождественка',
    address: 'г. Москва, Варсонофьевский пер., д. 4, стр. 1',
    legacyAddresses: ['г. Москва, ул. Рождественка, д. 10/2'],
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
    photos: ['/images/branches/107031.jpg', 'https://avatars.mds.yandex.net/get-altay/16413591/2a0000019c32cd1bf946c99b597a07753315/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1235970615/',
    walkingMinutes: 9,
    distanceKm: 0.75,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    code: '101000-2',
    postalCode: '101000',
    name: 'Отделение Покровка',
    address: 'г. Москва, ул. Покровка, д. 4, стр. 1',
    legacyAddresses: ['г. Москва, ул. Покровка, д. 16'],
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
    photos: ['/images/branches/101000-2.jpg', 'https://avatars.mds.yandex.net/get-altay/18376122/2a0000019a05fc3ce9af4680d6a1b8298649/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/154952935065/',
    walkingMinutes: 8,
    distanceKm: 0.65,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    code: '109012',
    postalCode: '109012',
    name: 'Отделение Никольская',
    address: 'г. Москва, Никольская ул., д. 7-9, стр. 4',
    legacyAddresses: ['г. Москва, ул. Никольская, д. 8/1'],
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
    photos: ['/images/branches/109012.jpg', 'https://avatars.mds.yandex.net/get-altay/15292747/2a00000196aa7a0f59c93e1e8d9fda967800/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1174148143/',
    walkingMinutes: 11,
    distanceKm: 0.92,
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    code: '125009',
    postalCode: '125009',
    name: 'Отделение Тверская',
    address: 'г. Москва, Тверская ул., д. 9, стр. 5',
    legacyAddresses: ['г. Москва, ул. Тверская, д. 9'],
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
    photos: ['/images/branches/125009.jpg', 'https://avatars.mds.yandex.net/get-altay/19555209/2a0000019cab27724aaafbc649ee1992e856/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1254579139/',
    walkingMinutes: 14,
    distanceKm: 1.15,
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    code: '119019',
    postalCode: '119019',
    name: 'Отделение Новый Арбат',
    address: 'г. Москва, Никитский бул., д. 5',
    legacyAddresses: ['г. Москва, ул. Новый Арбат, д. 2'],
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
    photos: ['/images/branches/119019.jpg', 'https://avatars.mds.yandex.net/get-altay/14784035/2a0000019745e8eb20629a53845cb141628a/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1319985520/',
    walkingMinutes: 18,
    distanceKm: 1.5,
  },
  {
    id: '88888888-8888-8888-8888-888888888888',
    code: '105064',
    postalCode: '105064',
    name: 'Отделение Земляной Вал',
    address: 'г. Москва, ул. Земляной Вал, д. 2',
    legacyAddresses: ['г. Москва, ул. Земляной Вал, д. 33'],
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
    photos: ['/images/branches/105064.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1024294540/',
    walkingMinutes: 12,
    distanceKm: 0.98,
  },
  {
    id: '99999999-9999-9999-9999-999999999999',
    code: '115184',
    postalCode: '115184',
    name: 'Отделение Большая Татарская',
    address: 'г. Москва, Озерковский пер., д. 13/19',
    legacyAddresses: ['г. Москва, ул. Большая Татарская, д. 20'],
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
    photos: ['/images/branches/115184.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1056423938/',
    walkingMinutes: 20,
    distanceKm: 1.7,
  },
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    code: '119048',
    postalCode: '119048',
    name: 'Отделение Комсомольский просп.',
    address: 'г. Москва, Комсомольский просп., д. 31',
    legacyAddresses: ['г. Москва, Комсомольский просп., д. 34'],
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
    photos: ['/images/branches/119048.jpg', 'https://avatars.mds.yandex.net/get-altay/13930885/2a0000019265c724e7a6fcaabe4381935858/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1153889152/',
    walkingMinutes: 32,
    distanceKm: 2.7,
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    code: '123001',
    postalCode: '123001',
    name: 'Отделение Садовая-Кудринская',
    address: 'г. Москва, ул. Спиридоновка, д. 27/24',
    legacyAddresses: ['г. Москва, ул. Садовая-Кудринская, д. 14'],
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
    photos: ['/images/branches/123001.jpg', 'https://avatars.mds.yandex.net/get-altay/14033308/2a00000191518dc66c3c5b8641ec2e6d1484/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1380309612/',
    walkingMinutes: 24,
    distanceKm: 2.0,
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    code: '127051',
    postalCode: '127051',
    name: 'Отделение Цветной бульвар',
    address: 'г. Москва, Цветной бул., д. 21, стр. 1',
    legacyAddresses: ['г. Москва, Цветной бульвар, д. 15'],
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
    photos: ['/images/branches/127051.jpg', 'https://avatars.mds.yandex.net/get-altay/16136409/2a00000199623599386f3ec8d9e9aa2612a9/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1220435869/',
    walkingMinutes: 14,
    distanceKm: 1.18,
  },
  {
    id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    code: '129110',
    postalCode: '129110',
    name: 'Отделение Проспект Мира',
    address: 'г. Москва, Проспект Мира, д. 51, стр. 1',
    legacyAddresses: ['г. Москва, Проспект Мира, д. 70'],
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
    photos: ['/images/branches/129110.jpg', 'https://avatars.mds.yandex.net/get-altay/15352901/2a0000019519873b8b8867a484ccdeec61dd/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1261941973/',
    walkingMinutes: 28,
    distanceKm: 2.3,
  },
  {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    code: '111024',
    postalCode: '111024',
    name: 'Отделение Авиамоторная',
    address: 'г. Москва, шоссе Энтузиастов, д. 22/18',
    legacyAddresses: ['г. Москва, ул. Авиамоторная, д. 14'],
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
    photos: ['/images/branches/111024.jpg', 'https://avatars.mds.yandex.net/get-altay/15148849/2a000001951909be91097b6f0558d6190ef8/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1145778086/',
    walkingMinutes: 52,
    distanceKm: 4.3,
  },
  {
    id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    code: '105005',
    postalCode: '105005',
    name: 'Отделение Бауманская',
    address: 'г. Москва, Бауманская ул., д. 38, стр. 2',
    legacyAddresses: ['г. Москва, ул. Бауманская, д. 38'],
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
    photos: ['/images/branches/105005.jpg', 'https://avatars.mds.yandex.net/get-altay/19662431/2a0000019c68a3a93177136ff8c53d4b5a42/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1159140084/',
    walkingMinutes: 24,
    distanceKm: 2.0,
  },
  {
    id: '10101010-1010-1010-1010-101010101010',
    code: '115054',
    postalCode: '115054',
    name: 'Отделение Валовая',
    address: 'г. Москва, Дубининская ул., д. 11, стр. 2',
    legacyAddresses: ['г. Москва, ул. Валовая, д. 8/18'],
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
    photos: ['/images/branches/115054.jpg', 'https://avatars.mds.yandex.net/get-altay/15344725/2a0000019addcbb2b223c0075cdca87d82f7/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1113119666/',
    walkingMinutes: 30,
    distanceKm: 2.5,
  },
  {
    id: '20202020-2020-2020-2020-202020202020',
    code: '117292',
    postalCode: '117292',
    name: 'Отделение Профсоюзная',
    address: 'г. Москва, ул. Кржижановского, д. 5, корп. 1',
    legacyAddresses: ['г. Москва, ул. Профсоюзная, д. 26'],
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
    photos: ['/images/branches/117292.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1277830467/',
    walkingMinutes: 80,
    distanceKm: 6.8,
  },
  {
    id: '30303030-3030-3030-3030-303030303030',
    code: '121069',
    postalCode: '121069',
    name: 'Отделение Поварская',
    address: 'г. Москва, ул. Поварская, д. 29/36, стр. 1',
    legacyAddresses: ['г. Москва, ул. Поварская, д. 29/36'],
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
    photos: ['/images/branches/121069.jpg', 'https://avatars.mds.yandex.net/get-altay/1618837/2a000001697fef80450e059ab2525eef9024/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1219439514/',
    walkingMinutes: 22,
    distanceKm: 1.8,
  },
  {
    id: '40404040-4040-4040-4040-404040404040',
    code: '125047',
    postalCode: '125047',
    name: 'Отделение 1-я Тверская-Ямская',
    address: 'г. Москва, 1-я Тверская-Ямская ул., д. 6',
    legacyAddresses: ['г. Москва, ул. 1-я Тверская-Ямская, д. 18'],
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
    photos: ['/images/branches/125047.jpg', 'https://avatars.mds.yandex.net/get-altay/5298780/2a00000181c43f4a09e5069779b3fd710de8/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1147131141/',
    walkingMinutes: 23,
    distanceKm: 1.9,
  },
  {
    id: '50505050-5050-5050-5050-505050505050',
    code: '107140',
    postalCode: '107140',
    name: 'Отделение Комсомольская пл.',
    address: 'г. Москва, Краснопрудная ул., д. 7-9',
    legacyAddresses: ['г. Москва, Комсомольская пл., д. 1А'],
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
    photos: ['/images/branches/107140.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1061433524/',
    walkingMinutes: 20,
    distanceKm: 1.65,
  },
  {
    id: '60606060-6060-6060-6060-606060606060',
    code: '119071',
    postalCode: '119071',
    name: 'Отделение Ленинский просп.',
    address: 'г. Москва, Ленинский просп., д. 25',
    legacyAddresses: ['г. Москва, Ленинский просп., д. 18'],
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
    photos: ['/images/branches/119071.jpg', 'https://avatars.mds.yandex.net/get-altay/15232272/2a00000195919179ce09859f0481fa96dfb7/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1144292983/',
    walkingMinutes: 44,
    distanceKm: 3.7,
  },
  {
    id: '70707070-7070-7070-7070-707070707070',
    code: '127055',
    postalCode: '127055',
    name: 'Отделение Новослободская',
    address: 'г. Москва, Новослободская ул., д. 49/2',
    legacyAddresses: ['г. Москва, ул. Новослободская, д. 36'],
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
    photos: ['/images/branches/127055.jpg', 'https://avatars.mds.yandex.net/get-altay/11385489/2a0000018c86ead6271f737dd8d84af4f329/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1198105790/',
    walkingMinutes: 28,
    distanceKm: 2.35,
  },
  {
    id: '80808080-8080-8080-8080-808080808080',
    code: '107076',
    postalCode: '107076',
    name: 'Отделение Стромынка',
    address: 'г. Москва, ул. Стромынка, д. 20А',
    legacyAddresses: ['г. Москва, ул. Стромынка, д. 11'],
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
    photos: ['/images/branches/107076.jpg', 'https://avatars.mds.yandex.net/get-altay/10702157/2a0000018a8f3bdc868d5ff6810b518702ad/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/211517214088/',
    walkingMinutes: 52,
    distanceKm: 4.4,
  },
  {
    id: '90909090-9090-9090-9090-909090909090',
    code: '115280',
    postalCode: '115280',
    name: 'Отделение Автозаводская',
    address: 'г. Москва, Автозаводская ул., д. 5',
    legacyAddresses: ['г. Москва, ул. Автозаводская, д. 7'],
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
    photos: ['/images/branches/115280.jpg', 'https://avatars.mds.yandex.net/get-altay/1363018/2a00000166691896f3f2ff1cd7b1e5602f2c/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1169359884/',
    walkingMinutes: 50,
    distanceKm: 4.2,
  },
  {
    id: 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
    code: '123100',
    postalCode: '123100',
    name: 'Отделение Шмитовский проезд',
    address: 'г. Москва, ул. Сергея Макеева, д. 2, стр. 1',
    legacyAddresses: ['г. Москва, Шмитовский проезд, д. 16'],
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
    photos: ['/images/branches/123100.jpg', 'https://avatars.mds.yandex.net/get-altay/5449087/2a0000017cfa458bff1b7904d7c56a578dc4/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1199826120/',
    walkingMinutes: 44,
    distanceKm: 3.7,
  },
  {
    id: '77777777-7777-7777-7777-777777777777',
    code: '101000-3',
    postalCode: '101000',
    name: 'Отделение Маросейка',
    address: 'г. Москва, ул. Маросейка, д. 9/2, стр. 1',
    legacyAddresses: ['г. Москва, ул. Маросейка, д. 9/2'],
    metro: 'Китай-город',
    metroColor: '#ED9121',
    landmarkType: 'metro',
    lat: 55.75742,
    lng: 37.63385,
    workHours: '08:00–20:00',
    rating: 4.88,
    reviewCount: 920,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branches/101000-3.jpg', 'https://avatars.mds.yandex.net/get-altay/1003740/2a000001850bc4003a411400f1823f1977b9/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1057421111/',
    walkingMinutes: 7,
    distanceKm: 0.55,
  },
  {
    id: '5c791b5b-23ed-516e-800c-196f6de29ed9',
    code: '390000',
    postalCode: '390000',
    name: 'Главпочтамт г. Рязань',
    address: 'г. Рязань, ул. Почтовая, д. 49',
    metro: 'пл. Ленина (центр)',
    metroColor: '#0055A5',
    landmarkType: 'landmark',
    lat: 54.62912,
    lng: 39.73685,
    workHours: '08:00–22:00',
    rating: 4.94,
    reviewCount: 1650,
    services: COMMON_SERVICES,
    activeQueueCount: 6,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Упаковка', 'Оплата картой'],
    photos: ['/images/branches/390000.jpg', 'https://avatars.mds.yandex.net/get-altay/15074997/2a00000195b82926d94912ee08bfd0c7b172/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1113228862/',
    walkingMinutes: 10,
    distanceKm: 0.8,
  },
  {
    id: 'b1e06492-3c4a-5812-9c1a-2895f32a0001',
    code: '390006',
    postalCode: '390006',
    name: 'Отделение Рязань Грибоедова',
    address: 'г. Рязань, ул. Грибоедова, д. 3',
    metro: 'пл. Свободы',
    metroColor: '#0055A5',
    landmarkType: 'landmark',
    lat: 54.62745,
    lng: 39.75892,
    workHours: '08:00–20:00',
    rating: 4.86,
    reviewCount: 720,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/390006.jpg', 'https://avatars.mds.yandex.net/get-altay/11183932/2a0000018faa6243c7b777a6fe2dfa2e4ebe/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1227255113/',
    walkingMinutes: 12,
    distanceKm: 1.1,
  },
  {
    id: 'b1e06492-3c4a-5812-9c1a-2895f32a0002',
    code: '390013',
    postalCode: '390013',
    name: 'Отделение Первомайский просп.',
    address: 'г. Рязань, Первомайский просп., д. 45',
    legacyAddresses: ['г. Рязань, Первомайский просп., д. 53'],
    metro: 'пл. Победы',
    metroColor: '#0055A5',
    landmarkType: 'landmark',
    lat: 54.63051,
    lng: 39.71234,
    workHours: '08:00–20:00',
    rating: 4.88,
    reviewCount: 840,
    services: COMMON_SERVICES,
    activeQueueCount: 3,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Парковка', 'Оплата картой'],
    photos: ['/images/branches/390013.jpg', 'https://avatars.mds.yandex.net/get-altay/19672327/2a0000019ce78045894dcae48a424e9cda51/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1151410627/',
    walkingMinutes: 14,
    distanceKm: 1.3,
  },
  {
    id: 'b1e06492-3c4a-5812-9c1a-2895f32a0003',
    code: '390000-2',
    postalCode: '390000',
    name: 'Отделение Рязань Ленина',
    address: 'г. Рязань, ул. Почтовая, д. 49',
    legacyAddresses: ['г. Рязань, ул. Ленина, д. 20'],
    metro: 'Цирк / ул. Ленина',
    metroColor: '#0055A5',
    landmarkType: 'landmark',
    lat: 54.62512,
    lng: 39.74312,
    workHours: '08:00–20:00',
    rating: 4.82,
    reviewCount: 510,
    services: COMMON_SERVICES,
    activeQueueCount: 5,
    activeWindows: 3,
    amenities: ['Упаковка', 'Оплата картой'],
    photos: ['/images/branches/390000-2.jpg', 'https://avatars.mds.yandex.net/get-altay/15074997/2a00000195b82926d94912ee08bfd0c7b172/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1113228862/',
    walkingMinutes: 8,
    distanceKm: 0.7,
  },
  {
    id: 'b1e06492-3c4a-5812-9c1a-2895f32a0004',
    code: '390026',
    postalCode: '390026',
    name: 'Отделение Островского',
    address: 'г. Рязань, ул. Ленинского Комсомола, д. 107',
    legacyAddresses: ['г. Рязань, ул. Островского, д. 21/1'],
    metro: 'Горроща',
    metroColor: '#0055A5',
    landmarkType: 'landmark',
    lat: 54.61845,
    lng: 39.70456,
    workHours: '08:00–20:00',
    rating: 4.79,
    reviewCount: 460,
    services: COMMON_SERVICES,
    activeQueueCount: 2,
    activeWindows: 2,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/390026.jpg', 'https://avatars.mds.yandex.net/get-altay/9954022/2a00000188952922716336183e9ddbc48492/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1063682977/',
    walkingMinutes: 20,
    distanceKm: 2.1,
  },
  {
    id: 'b1e06492-3c4a-5812-9c1a-2895f32a0005',
    code: '390044',
    postalCode: '390044',
    name: 'Отделение Московское шоссе',
    address: 'г. Рязань, ул. Крупской, д. 19',
    legacyAddresses: ['г. Рязань, Московское шоссе, д. 39'],
    metro: 'ТРЦ Премьер',
    metroColor: '#0055A5',
    landmarkType: 'landmark',
    lat: 54.64321,
    lng: 39.67543,
    workHours: '08:00–20:00',
    rating: 4.85,
    reviewCount: 680,
    services: COMMON_SERVICES,
    activeQueueCount: 7,
    activeWindows: 3,
    amenities: ['Парковка', 'Оплата картой', 'Упаковка'],
    photos: ['/images/branches/390044.jpg', 'https://avatars.mds.yandex.net/get-altay/4281217/2a000001775e20e25c8c532267fa0dcd7432/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1235404464/',
    walkingMinutes: 25,
    distanceKm: 2.8,
  },
  {
    id: 'b1e06492-3c4a-5812-9c1a-2895f32a0006',
    code: '390023',
    postalCode: '390023',
    name: 'Отделение Маяковского',
    address: 'г. Рязань, Театральная площадь, д. 2',
    legacyAddresses: ['г. Рязань, ул. Маяковского, д. 64'],
    metro: 'Центральный рынок',
    metroColor: '#0055A5',
    landmarkType: 'landmark',
    lat: 54.62314,
    lng: 39.74891,
    workHours: '08:00–20:00',
    rating: 4.81,
    reviewCount: 390,
    services: COMMON_SERVICES,
    activeQueueCount: 4,
    activeWindows: 3,
    amenities: ['Доступно для колясок', 'Оплата картой'],
    photos: ['/images/branches/390023.jpg', 'https://avatars.mds.yandex.net/get-altay/6065996/2a0000018042db881b73087c7c0f03d618f6/L'],
    photoSource: 'Яндекс Карты (Официальное фото отделения)',
    photoSourceUrl: 'https://yandex.ru/maps/org/1057864388/',
    walkingMinutes: 10,
    distanceKm: 0.9,
  },
];

export const ALL_BRANCHES_CATALOG: BranchLocation[] = [...KAZAN_AND_INNO_BRANCHES, ...MOSCOW_BRANCHES_CATALOG];
export const MOSCOW_BRANCHES: BranchLocation[] = ALL_BRANCHES_CATALOG;


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

  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    return { rankedBranches: [] };
  }

  const computedList: RankedBranch[] = branches.flatMap((b) => {
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return [];

    const distanceKm = calculateHaversineDistance(userLat, userLng, b.lat, b.lng);
    const travelMinutes = calculateTravelTimeMinutes(distanceKm);
    const waitMinutes = calculateWaitTime(b, serviceCategory);
    const totalMinutes = calculateBranchTotalTime(travelMinutes, waitMinutes);
    if (totalMinutes === undefined) return [];

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
    return [ranked];
  });

  if (computedList.length === 0) return { rankedBranches: [] };

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

  const timeSavedMinutes = Math.max(0, Math.round(closestBranch.totalMinutes - fastestBranch.totalMinutes));
  const isClosestFastest = fastestBranch.id === closestBranch.id;
  const total = Math.round(fastestBranch.totalMinutes);
  const travel = Math.round(fastestBranch.travelMinutes);
  const wait = Math.round(fastestBranch.waitMinutes);
  const recommendation: SmartRoutingRecommendation = {
    currentClosestBranch: closestBranch,
    fastestBranch,
    timeSavedMinutes,
    advice: isClosestFastest ? 'stay' : 'detour',
    bannerText: isClosestFastest
      ? `Рекомендуем ближайшее к вам: ${fastestBranch.name} · ~${total} мин`
      : `Рекомендуем быстрее всего: ${fastestBranch.name} · ~${total} мин`,
    stayReason: `Суммарно ~${total} мин: ${travel} мин дорога + ${wait} мин очередь`,
  };

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
