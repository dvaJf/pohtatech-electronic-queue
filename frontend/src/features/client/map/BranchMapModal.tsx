import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import {
  X,
  Search,
  MapPin,
  Clock,
  Star,
  Navigation,
  ChevronUp,
  ChevronDown,
  Users,
  Accessibility,
  Package,
  Mail,
  Coins,
  CreditCard,
  Building2,
  Sparkles,
  ArrowRight,
  ExternalLink,
  Layers,
  CheckCircle2
} from 'lucide-react';
import { matchBranchLocation, liveWaitMinutes } from './liveBranches';
import { decideUserLocationUpdate, decideLocationCenterRequest } from './mapViewportPolicy';
import { useModalFocus } from '../../../hooks/useModalFocus';
import type { BranchWorkload } from '../../../api/client/clientApi';
import { Branch } from '../../../api/client/types';
import { PochtaEmblem } from '../../../components/common/PochtaBrand';
import { getLandmarkPresentation } from '../branchOptions';
import {
  MOSCOW_BRANCHES,
  BranchLocation,
  calculateWaitTime,
  getBranchWorkload,
} from './branchLocations';

/**
 * Расширенная модель отделения для отображения на карте
 */
export interface MapBranch extends Branch {
  code?: string;
  coordinates: [number, number]; // [широта (lat), долгота (lon)]
  metro?: string;
  metroColor?: string;
  landmarkType?: 'metro' | 'landmark';
  rating: number | null;
  reviewsCount?: number;
  liveWaitMinutes: number | null;
  waitingCount: number | null;
  photoUrl: string;
  amenities: ('parcels' | 'letters' | 'pensions' | 'accessible' | 'atm')[];
  phone?: string;
  address: string;
  workHours: string;
  rawLocation?: BranchLocation;
}

export type FilterCategory = 'all' | 'parcels' | 'letters' | 'pensions' | 'accessible';

export interface BranchMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches?: Branch[];
  workloads?: Record<string, BranchWorkload>;
  selectedBranchId?: string | null;
  recommendedBranchId?: string | null;
  onSelectBranch?: (branch: Branch, action?: 'walkin' | 'booking') => void;
  onTakeTicket?: (branch: Branch) => void;
  onBookAppointment?: (branch: Branch) => void;
  initialFilter?: FilterCategory;
  userCoordinates?: [number, number] | null;
  locationCenterRequest?: number;
  onRequestLocation?: () => void;
  isLocatingUser?: boolean;
  locationError?: string | null;
}

// Yandex Maps JavaScript API 2.1
export const YANDEX_MAPS_API_KEY = '97fb22de-5d60-4106-aab0-6cf5d831324c';
export const YANDEX_MAPS_SCRIPT_URL = 'https://api-maps.yandex.ru/2.1/?apikey=97fb22de-5d60-4106-aab0-6cf5d831324c&lang=ru_RU';

export function yandexBranchSearchUrl(name: string, address: string): string {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(`${name}, ${address}`)}`;
}

export function getBranchPhoto(code?: string, name?: string): string {
  if (code === '101000' || name?.includes('Мясницкая')) return '/images/branch_myasnitskaya.jpg';
  if (code === '115280' || name?.includes('Автозаводская')) return '/images/branch_avtozavodskaya.jpg';
  if (code === '125009' || name?.includes('Тверская')) return '/images/branch_tverskaya.jpg';
  if (code === '119019' || name?.includes('Арбат')) return '/images/branch_arbat.jpg';
  if (code === '101000-2' || name?.includes('Покровка')) return '/images/branch_pokrovka.jpg';
  if (code === '107031' || name?.includes('Рождественка')) return '/images/branch_kuznetsky.jpg';
  if (code === '109012' || name?.includes('Никольская')) return '/images/branch_lubyanka.jpg';
  if (code === '107140' || name?.includes('Комсомольская')) return '/images/branch_komsomolskaya.jpg';
  if (code === '127055' || name?.includes('Новослободская')) return '/images/branch_novoslobodskaya.jpg';
  if (code === '390000' || name?.includes('Рязань')) return '/images/branch_ryazan.jpg';
  return '/images/branch_city.jpg';
}

/**
 * Конвертация BranchLocation из branchLocations.ts в MapBranch
 */
export function convertLocationToMapBranch(loc: BranchLocation): MapBranch {
  const waitMin = Math.round(calculateWaitTime(loc));
  const amenitiesList: ('parcels' | 'letters' | 'pensions' | 'accessible' | 'atm')[] = [];

  if (loc.services?.some((s) => s.category === 'parcels' || s.category === 'all')) {
    amenitiesList.push('parcels');
  }
  if (loc.services?.some((s) => s.category === 'letters' || s.category === 'all')) {
    amenitiesList.push('letters');
  }
  if (loc.services?.some((s) => s.category === 'pensions' || s.category === 'all')) {
    amenitiesList.push('pensions');
  }
  if (
    loc.amenities?.some((a) =>
      /колясок|доступ|пандус|инвалид/i.test(a)
    )
  ) {
    amenitiesList.push('accessible');
  }
  if (loc.amenities?.some((a) => /карт|банкомат/i.test(a))) {
    amenitiesList.push('atm');
  }

  let photo = loc.photos?.[0] || '';
  if (!photo || photo.startsWith('data:image/svg')) {
    photo = getBranchPhoto(loc.code, loc.name);
  }

  return {
    id: loc.id,
    ratingAverage: null,
    ratingCount: 0,
    code: loc.code,
    name: loc.name,
    address: loc.address,
    workHours: loc.workHours,
    coordinates: [loc.lat, loc.lng],
    metro: loc.metro,
    metroColor: loc.metroColor,
    landmarkType: loc.landmarkType,
    rating: loc.rating > 0 ? loc.rating : null,
    reviewsCount: loc.reviewCount,
    liveWaitMinutes: waitMin,
    waitingCount: loc.activeQueueCount,
    photoUrl: photo,
    amenities: amenitiesList,
    rawLocation: loc,
  };
}

/**
 * Эталонный список отделений из базы локаций
 */
export const DEFAULT_MAP_BRANCHES: MapBranch[] = MOSCOW_BRANCHES.map(convertLocationToMapBranch);

declare global {
  interface Window {
    ymaps?: any;
    __ymapsPromise?: Promise<any>;
  }
}

/**
 * Динамический загрузчик Yandex Maps JavaScript API 2.1
 */
function loadYandexMaps(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is undefined'));
  }
  if (window.ymaps && window.ymaps.Map) {
    return new Promise((resolve) => window.ymaps.ready(() => resolve(window.ymaps)));
  }
  if (window.__ymapsPromise) {
    return window.__ymapsPromise;
  }

  window.__ymapsPromise = new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src*="api-maps.yandex.ru/2.1"]`) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.src = YANDEX_MAPS_SCRIPT_URL;
      script.type = 'text/javascript';
      script.async = true;
      script.id = 'yandex-maps-api-script';
      document.head.appendChild(script);
    }

    const timeout = setTimeout(() => {
      reject(new Error('Yandex Maps API load timeout (falling back to Carto/OSM)'));
    }, 4000);

    script.addEventListener('load', () => {
      clearTimeout(timeout);
      if (window.ymaps && window.ymaps.ready) {
        window.ymaps.ready(() => resolve(window.ymaps));
      } else {
        reject(new Error('ymaps API ready object not found'));
      }
    });

    script.addEventListener('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return window.__ymapsPromise;
}

/**
 * Получение параметров бейджа ожидания (ПВЗ стиль):
 * - Green badge: wait <= 5 min (bg-emerald-500)
 * - Amber badge: wait 5-15 min (bg-amber-500)
 * - Red badge: wait > 15 min (bg-red-500)
 * - Star rating badge (★ 4.92)
 */
export function getWaitBadgeInfo(waitMinutes: number | null) {
  if (waitMinutes === null || !Number.isFinite(waitMinutes)) return {
    colorClass: 'bg-slate-500', textClass: 'text-slate-600', bgLightClass: 'bg-slate-100',
    hex: '#64748b', label: 'Нет оценки', statusText: 'Ожидание пока неизвестно',
  };
  if (waitMinutes <= 5) {
    return {
      colorClass: 'bg-emerald-500',
      textClass: 'text-emerald-700',
      bgLightClass: 'bg-emerald-50',
      hex: '#10B981',
      label: `~${waitMinutes} мин`,
      statusText: 'Быстрое обслуживание (до 5 мин)'
    };
  } else if (waitMinutes <= 15) {
    return {
      colorClass: 'bg-amber-500',
      textClass: 'text-amber-700',
      bgLightClass: 'bg-amber-50',
      hex: '#F59E0B',
      label: `~${waitMinutes} мин`,
      statusText: 'Умеренная очередь (5-15 мин)'
    };
  } else {
    return {
      colorClass: 'bg-red-500',
      textClass: 'text-red-700',
      bgLightClass: 'bg-red-50',
      hex: '#EF4444',
      label: `~${waitMinutes} мин`,
      statusText: 'Высокая нагрузка (> 15 мин)'
    };
  }
}

/**
 * Главный компонент модального окна карты отделений
 */
export function BranchMapModal({
  isOpen,
  onClose,
  branches: incomingBranches = [],
  workloads = {},
  selectedBranchId: targetBranchId = null,
  recommendedBranchId = null,
  onSelectBranch,
  onTakeTicket,
  onBookAppointment,
  initialFilter = 'all',
  userCoordinates = null,
  locationCenterRequest = 0,
  onRequestLocation,
  isLocatingUser = false,
  locationError = null,
}: BranchMapModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(isOpen, dialogRef, onClose);
  // Быстрые фильтр-чипы: «Все», «Посылки», «Письма», «Пенсии», «Доступная среда»
  const [selectedFilter, setSelectedFilter] = useState<FilterCategory>(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const selectedBranchIdRef = useRef<string | null>(null);
  selectedBranchIdRef.current = selectedBranchId;
  const recommendedBranchIdRef = useRef<string | null>(null);
  recommendedBranchIdRef.current = recommendedBranchId;

  // Режим карты и Leaflet/Carto/OSM fallback
  const [useFallbackMap, setUseFallbackMap] = useState<boolean>(false);
  const [isYmapsLoading, setIsYmapsLoading] = useState<boolean>(true);
  const [ymapsError, setYmapsError] = useState<string | null>(null);

  // Мобильный bottom sheet: 'collapsed' | 'half' | 'expanded'
  const [bottomSheetState, setBottomSheetState] = useState<'collapsed' | 'half' | 'expanded'>('collapsed');
  const touchStartYRef = useRef<number | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopBranchCardRef = useRef<HTMLDivElement | null>(null);
  const mobileBottomSheetRef = useRef<HTMLDivElement | null>(null);
  const ymapsInstanceRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const mapMarginAreaRef = useRef<any>(null);
  const focusSequenceRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState<{ branchId: string; sequence: number } | null>(null);
  const [fallbackCenter, setFallbackCenter] = useState<[number, number]>([55.7618, 37.6385]);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const consumedCenterRequestRef = useRef(locationCenterRequest);
  const seenCenterRequestRef = useRef(locationCenterRequest);
  const focusedTargetRef = useRef<string | null>(null);

  const cancelViewportWork = useCallback(() => {
    focusSequenceRef.current += 1;
    ymapsInstanceRef.current?.action?.stop?.();
  }, []);

  // Only server branches with an address-matched location are eligible for map pins.
  const allBranches = useMemo<MapBranch[]>(() => incomingBranches.flatMap(b => {
    const loc = matchBranchLocation(b, MOSCOW_BRANCHES);
    if (!loc) return [];
    const workload = workloads[b.id];
    return [{ ...convertLocationToMapBranch(loc), ...b, id: b.id,
      address: b.address || loc.address, workHours: b.workHours || loc.workHours,
      rating: b.ratingAverage, reviewsCount: b.ratingCount,
      liveWaitMinutes: liveWaitMinutes(workload) ?? null,
      waitingCount: workload?.currentWaiting ?? null }];
  }), [incomingBranches, workloads]);
  const allBranchesRef = useRef(allBranches);
  const targetBranchIdRef = useRef(targetBranchId);
  allBranchesRef.current = allBranches;
  targetBranchIdRef.current = targetBranchId;

  // Фильтрация списка отделений
  const filteredBranches = useMemo(() => {
    return allBranches.filter((b) => {
      // Фильтр-чипы: «Все», «Посылки», «Письма», «Пенсии», «Доступная среда»
      if (selectedFilter !== 'all') {
        if (!b.amenities.includes(selectedFilter)) {
          return false;
        }
      }
      // Поисковый запрос
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesCode = b.code ? b.code.toLowerCase().includes(q) : false;
        const matchesName = b.name.toLowerCase().includes(q);
        const matchesAddress = b.address.toLowerCase().includes(q);
        const matchesMetro = b.metro ? b.metro.toLowerCase().includes(q) : false;
        if (!matchesCode && !matchesName && !matchesAddress && !matchesMetro) {
          return false;
        }
      }
      return true;
    });
  }, [allBranches, selectedFilter, searchQuery]);

  // Выбранное активное отделение (null если ничего не выбрано или свернуто)
  const selectedBranch = useMemo(() => {
    if (!selectedBranchId) return null;
    return (
      filteredBranches.find((b) => b.id === selectedBranchId) ||
      allBranches.find((b) => b.id === selectedBranchId) ||
      null
    );
  }, [filteredBranches, allBranches, selectedBranchId]);

  // Состояние и логика кнопки геолокации
  const userLocation = userCoordinates && Number.isFinite(userCoordinates[0]) && Math.abs(userCoordinates[0]) <= 90
    && Number.isFinite(userCoordinates[1]) && Math.abs(userCoordinates[1]) <= 180 ? userCoordinates : null;
  const userPlacemarkRef = useRef<any>(null);
  const userLocationRef = useRef<[number, number] | null>(null);
  const hasAutoCenteredRef = useRef(false);
  userLocationRef.current = userLocation;
  const filteredBranchesRef = useRef(filteredBranches);
  filteredBranchesRef.current = filteredBranches;

  useLayoutEffect(() => {
    cancelViewportWork();
    setFocusRequest(null);
    focusedTargetRef.current = null;
    consumedCenterRequestRef.current = locationCenterRequest;
    seenCenterRequestRef.current = locationCenterRequest;
    if (isOpen) {
      setSelectedFilter(initialFilter);
      setSearchQuery('');
      setSelectedBranchId(null);
      setBottomSheetState('collapsed');
      hasAutoCenteredRef.current = Boolean(targetBranchId);
      const target = allBranchesRef.current.find(branch => branch.id === targetBranchId);
      setFallbackCenter(target?.coordinates ?? userLocationRef.current ?? [55.7618, 37.6385]);
    }
    return cancelViewportWork;
  }, [isOpen, cancelViewportWork]);

  const handleManualMapInteraction = useCallback(() => {
    hasAutoCenteredRef.current = true;
    focusedTargetRef.current = targetBranchIdRef.current;
    consumedCenterRequestRef.current = seenCenterRequestRef.current;
    cancelViewportWork();
    setFocusRequest(null);
  }, [cancelViewportWork]);

  const updateUserPlacemark = useCallback((coords: [number, number]) => {
    const ymaps = (window as any).ymaps;
    const map = ymapsInstanceRef.current;
    if (!map || !ymaps?.Placemark) return;

    if (!userPlacemarkRef.current) {
      const userPulseLayout = ymaps.templateLayoutFactory.createClass(
        `<div style="display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%);width:34px;height:34px;position:relative;">
          <div style="position:absolute;width:34px;height:34px;border-radius:50%;background:rgba(5,47,133,0.28);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
          <div style="width:18px;height:18px;border-radius:50%;background:#052F85;border:3px solid white;box-shadow:0 2px 10px rgba(5,47,133,0.5);"></div>
        </div>`
      );
      userPlacemarkRef.current = new ymaps.Placemark(coords, {
        hintContent: 'Вы находитесь здесь',
        iconCaption: 'Вы здесь',
      }, { iconLayout: userPulseLayout, zIndex: 9999 });
      map.geoObjects.add(userPlacemarkRef.current);
    } else {
      userPlacemarkRef.current.geometry.setCoordinates(coords);
    }
  }, []);

  const centerMapOnUser = useCallback((coords: [number, number]) => {
    setFallbackCenter(coords);
    const map = ymapsInstanceRef.current;
    if (!map) return;
    cancelViewportWork();
    setFocusRequest(null);
    const sequence = focusSequenceRef.current;
    Promise.resolve(map.panTo(coords, { flying: true, duration: 800 })).then(() => {
      if (isOpenRef.current && sequence === focusSequenceRef.current && ymapsInstanceRef.current === map) {
        return map.setZoom(15, { duration: 400 });
      }
    }).catch(() => { /* A cancelled animation has no follow-up work. */ });
  }, [cancelViewportWork]);

  useEffect(() => {
    if (!isOpen) return;
    if (seenCenterRequestRef.current !== locationCenterRequest) {
      seenCenterRequestRef.current = locationCenterRequest;
      focusedTargetRef.current = targetBranchIdRef.current;
      hasAutoCenteredRef.current = true;
      cancelViewportWork();
      setFocusRequest(null);
    }
    const map = ymapsInstanceRef.current;
    if (!userLocation) {
      if (userPlacemarkRef.current) map?.geoObjects.remove?.(userPlacemarkRef.current);
      userPlacemarkRef.current = null;
      return;
    }
    if (!map && !useFallbackMap) return;
    updateUserPlacemark(userLocation);
    const explicit = decideLocationCenterRequest(consumedCenterRequestRef.current, locationCenterRequest, true);
    consumedCenterRequestRef.current = explicit.consumedSequence;
    const automatic = decideUserLocationUpdate(hasAutoCenteredRef.current, 'automatic');
    hasAutoCenteredRef.current = automatic.hasAutoCentered;
    if (explicit.shouldCenter || automatic.shouldCenter) centerMapOnUser(userLocation);
  }, [isOpen, userLocation?.[0], userLocation?.[1], locationCenterRequest, isYmapsLoading, useFallbackMap,
    updateUserPlacemark, centerMapOnUser, cancelViewportWork]);

  const updateMapOccupiedArea = useCallback(() => {
    const map = ymapsInstanceRef.current;
    const mapElement = mapContainerRef.current;
    if (!map?.margin || !mapElement) return;

    const overlay = [desktopBranchCardRef.current, mobileBottomSheetRef.current]
      .find((element) => element && element.offsetParent !== null);
    if (!overlay || !selectedBranchIdRef.current) {
      mapMarginAreaRef.current?.remove?.();
      mapMarginAreaRef.current = null;
      return;
    }

    const mapRect = mapElement.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const gutter = 16;
    const area = {
      top: Math.max(0, overlayRect.top - mapRect.top - gutter),
      left: Math.max(0, overlayRect.left - mapRect.left - gutter),
      width: Math.min(mapRect.width, overlayRect.width + gutter * 2),
      height: Math.min(mapRect.height, overlayRect.height + gutter * 2),
    };
    if (mapMarginAreaRef.current?.setArea) mapMarginAreaRef.current.setArea(area);
    else mapMarginAreaRef.current = map.margin.addArea(area);
  }, []);

  const panBranchIntoVisibleArea = useCallback((branchId: string, sequence: number, animate = true) => {
    const branch = allBranchesRef.current.find((item) => item.id === branchId);
    const map = ymapsInstanceRef.current;
    if (!branch || !map || sequence !== focusSequenceRef.current || !isOpenRef.current) return false;
    updateMapOccupiedArea();
    const currentZoom = Number(map.getZoom?.());
    const desiredZoom = Number.isFinite(currentZoom) && currentZoom >= 14 && currentZoom <= 17
      ? currentZoom
      : 15;
    const adjustZoom = desiredZoom !== currentZoom
      ? map.setZoom(desiredZoom, { duration: animate ? 250 : 0 })
      : Promise.resolve();
    Promise.resolve(adjustZoom).then(() => {
      if (isOpenRef.current && sequence === focusSequenceRef.current && ymapsInstanceRef.current === map) {
        return map.panTo(branch.coordinates, { flying: animate, duration: animate ? 550 : 0, useMapMargin: true });
      }
    }).catch(() => { /* A cancelled animation has no follow-up work. */ });
    return true;
  }, [updateMapOccupiedArea]);

  const focusBranchOnMap = useCallback((branchId: string) => {
    const branch = allBranchesRef.current.find((item) => item.id === branchId);
    if (!branch) return false;
    cancelViewportWork();
    focusedTargetRef.current = targetBranchIdRef.current;
    consumedCenterRequestRef.current = seenCenterRequestRef.current;
    setFallbackCenter(branch.coordinates);
    hasAutoCenteredRef.current = true;
    setSelectedBranchId(branch.id);
    setBottomSheetState('half');
    setFocusRequest({ branchId, sequence: focusSequenceRef.current });
    return true;
  }, [cancelViewportWork]);

  const clearBranchSelection = useCallback(() => {
    cancelViewportWork();
    setFocusRequest(null);
    setSelectedBranchId(null);
  }, [cancelViewportWork]);

  useLayoutEffect(() => {
    if (!isOpen || !focusRequest || (!useFallbackMap && !ymapsInstanceRef.current)) return;
    updateMapOccupiedArea();
    panBranchIntoVisibleArea(focusRequest.branchId, focusRequest.sequence, true);
  }, [isOpen, focusRequest, useFallbackMap, isYmapsLoading, updateMapOccupiedArea, panBranchIntoVisibleArea]);

  useEffect(() => {
    if (!isOpen || !selectedBranchId || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateMapOccupiedArea();
    });
    if (desktopBranchCardRef.current) observer.observe(desktopBranchCardRef.current);
    if (mobileBottomSheetRef.current) observer.observe(mobileBottomSheetRef.current);
    return () => observer.disconnect();
  }, [isOpen, selectedBranchId, updateMapOccupiedArea]);

  useEffect(() => {
    if (!selectedBranchId) updateMapOccupiedArea();
  }, [selectedBranchId, updateMapOccupiedArea]);

  const syncBranchPlacemarks = useCallback((branchesToRender: MapBranch[]) => {
    const ymaps = (window as any).ymaps;
    const map = ymapsInstanceRef.current;
    const clusterer = clustererRef.current;
    if (!ymaps?.Placemark || !map || !clusterer) return;

    clusterer.removeAll();
    branchesToRender.forEach((b) => {
      const isSelected = selectedBranchIdRef.current === b.id;
      const isRecommended = recommendedBranchIdRef.current === b.id && !isSelected;
      const waitInfo = getWaitBadgeInfo(b.liveWaitMinutes);
      const hasRating = b.rating !== null && Number.isFinite(b.rating) && b.rating > 0;
      const hasWait = b.liveWaitMinutes !== null && Number.isFinite(b.liveWaitMinutes);
      const ratingText = hasRating ? b.rating!.toFixed(2) : '—';

      let border = '2px solid #FFFFFF';
      let boxShadow = '0 4px 14px rgba(5,47,133,0.35)';
      if (isSelected) {
        border = '3px solid #FACC15';
        boxShadow = '0 0 0 5px rgba(250,204,21,.25), 0 5px 18px rgba(5,47,133,.45)';
      } else if (isRecommended) {
        border = '2.5px solid #10B981';
        boxShadow = '0 0 0 3px rgba(16,185,129,.35), 0 4px 14px rgba(5,47,133,0.35)';
      }

      let content = `<span style="color:#FEF08A;">★</span><span>${ratingText}</span><span style="opacity:.6;">•</span><span>${waitInfo.label}</span>`;
      if (!hasRating && hasWait) {
        content = `<span>${waitInfo.label}</span>`;
      } else if (hasRating && !hasWait) {
        content = `<span style="color:#FEF08A;">★</span><span>${ratingText}</span>`;
      } else if (!hasRating && !hasWait) {
        content = `<span style="color:#FEF08A;">★</span><span>Почта</span>`;
      }

      const pinLayout = ymaps.templateLayoutFactory.createClass(
        `<div class="pvz-pin-marker cursor-pointer select-none group" style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
          <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:9999px;background-color:${waitInfo.hex};border:${border};color:#FFFFFF;font-family:'Manrope',sans-serif;font-size:11px;font-weight:800;white-space:nowrap;line-height:1.2;box-shadow:${boxShadow};">
            ${content}
          </div>
          <div style="width:8px;height:8px;transform:rotate(45deg);margin-top:-4px;background-color:${waitInfo.hex};border-right:${border};border-bottom:${border};"></div>
        </div>`
      );
      const placemark = new ymaps.Placemark(b.coordinates, {
        name: b.name,
        address: b.address,
        rating: ratingText,
        waitLabel: waitInfo.label,
        badgeHex: waitInfo.hex,
        hintContent: `${b.name} (★ ${ratingText})`,
      }, {
        iconLayout: pinLayout,
        iconShape: { type: 'Rectangle', coordinates: [[-70, -36], [70, 4]] },
      });
      placemark.events.add('click', () => {
        focusBranchOnMap(b.id);
      });
      clusterer.add(placemark);
    });
  }, [focusBranchOnMap]);

  // Интеграция Yandex Maps JavaScript API 2.1 и ymaps.Clusterer
  useEffect(() => {
    if (!isOpen || useFallbackMap) return;

    let isMounted = true;
    setIsYmapsLoading(true);
    setYmapsError(null);

    loadYandexMaps()
      .then((ymaps) => {
        if (!isMounted || !mapContainerRef.current) return;

        // Удаление предыдущей карты перед инициализацией
        if (ymapsInstanceRef.current) {
          ymapsInstanceRef.current.destroy();
          ymapsInstanceRef.current = null;
        }

        const initialUserLocation = userLocationRef.current;
        const initialTargetBranchId = targetBranchIdRef.current;
        const targetBranch = initialTargetBranchId
          ? allBranchesRef.current.find((branch) => branch.id === initialTargetBranchId)
          : null;
        const centerCoords = targetBranch?.coordinates || initialUserLocation || [55.7618, 37.6385];
        if (targetBranch || initialUserLocation) hasAutoCenteredRef.current = true;

        const map = new ymaps.Map(
          mapContainerRef.current,
          {
            center: centerCoords,
            zoom: targetBranch ? 16 : initialUserLocation ? 15 : 13,
            controls: ['zoomControl'],
          },
          {
            searchControlProvider: 'yandex#search',
            suppressMapOpenBlock: true,
          }
        );
        ymapsInstanceRef.current = map;
        map.events.add('actionbegin', (event: any) => {
          if (event?.get?.('originalEvent') || event?.get?.('action')?.originalEvent) handleManualMapInteraction();
        });
        if (initialUserLocation) updateUserPlacemark(initialUserLocation);

        // Кастомный макет балуна для кластеров ymaps.Clusterer
        const customClusterBalloonLayout = ymaps.templateLayoutFactory.createClass(
          `<div class="p-3 font-['Manrope']" style="font-family: 'Manrope', sans-serif; min-width: 240px;">
            <div style="font-size: 13px; font-weight: 800; color: #052F85;">$[properties.name]</div>
            <div style="font-size: 11px; color: #64748B; margin-top: 3px;">$[properties.address]</div>
            <div style="margin-top: 8px; display: inline-flex; align-items: center; gap: 6px;">
              <span style="font-size: 11px; font-weight: 700; color: #031E56;">★ $[properties.rating]</span>
              <span style="padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; color: white; background-color: $[properties.badgeHex];">
                $[properties.waitLabel]
              </span>
            </div>
          </div>`
        );

        // Инициализация ymaps.Clusterer с кастомным оформлением
        const clusterer = new ymaps.Clusterer({
          preset: 'islands#invertedDarkBlueClusterIcons',
          groupByCoordinates: false,
          clusterDisableClickZoom: false,
          clusterHideIconOnBalloonOpen: false,
          geoObjectHideIconOnBalloonOpen: false,
          clusterBalloonContentLayout: 'cluster#balloonCarousel',
          clusterBalloonItemContentLayout: customClusterBalloonLayout,
          clusterBalloonPanelMaxMapArea: 0,
          clusterOpenBalloonOnClick: true,
          gridSize: 64,
        });
        clustererRef.current = clusterer;

        map.geoObjects.add(clusterer);
        syncBranchPlacemarks(filteredBranchesRef.current);
        const handleResize = () => map.container.fitToViewport();
        window.addEventListener('resize', handleResize);
        (map as any).__queueResizeHandler = handleResize;
        setIsYmapsLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Yandex Maps API load fallback to Leaflet / Carto / OSM:', err);
        setYmapsError(err.message || 'Ошибка загрузки Яндекс.Карт');
        setUseFallbackMap(true);
        setIsYmapsLoading(false);
      });

    return () => {
      isMounted = false;
      cancelViewportWork();
      if (ymapsInstanceRef.current) {
        const resizeHandler = (ymapsInstanceRef.current as any).__queueResizeHandler;
        if (resizeHandler) window.removeEventListener('resize', resizeHandler);
        ymapsInstanceRef.current.destroy();
        ymapsInstanceRef.current = null;
      }
      clustererRef.current = null;
      mapMarginAreaRef.current?.remove?.();
      mapMarginAreaRef.current = null;
      userPlacemarkRef.current = null;
      hasAutoCenteredRef.current = false;
    };
  }, [isOpen, useFallbackMap, syncBranchPlacemarks, updateUserPlacemark, cancelViewportWork, handleManualMapInteraction]);

  useEffect(() => {
    syncBranchPlacemarks(filteredBranches);
  }, [filteredBranches, selectedBranchId, syncBranchPlacemarks]);

  // Плавный переход при выборе карточки
  const handleSelectBranch = useCallback((branch: MapBranch) => {
    focusBranchOnMap(branch.id);
  }, [focusBranchOnMap]);

  const targetBranchAvailable = Boolean(targetBranchId && allBranches.some((branch) => branch.id === targetBranchId));

  useEffect(() => {
    if (!isOpen || !targetBranchId || focusedTargetRef.current === targetBranchId || (!useFallbackMap && !ymapsInstanceRef.current)) return;
    if (focusBranchOnMap(targetBranchId)) focusedTargetRef.current = targetBranchId;
  }, [isOpen, targetBranchId, targetBranchAvailable, useFallbackMap, isYmapsLoading, focusBranchOnMap]);

  // Кнопка «Взять талон»
  const handleTakeTicket = (branch: MapBranch) => {
    if (onTakeTicket) {
      onTakeTicket(branch);
    } else if (onSelectBranch) {
      onSelectBranch(branch, 'walkin');
    }
    onClose();
  };

  // Кнопка «Записаться»
  const handleBookAppointment = (branch: MapBranch) => {
    if (onBookAppointment) {
      onBookAppointment(branch);
    } else if (onSelectBranch) {
      onSelectBranch(branch, 'booking');
    }
    onClose();
  };

  // Жесты для мобильного Bottom Sheet
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    if (deltaY < -40) {
      setBottomSheetState((prev) => (prev === 'collapsed' ? 'half' : 'expanded'));
    } else if (deltaY > 40) {
      setBottomSheetState((prev) => (prev === 'expanded' ? 'half' : 'collapsed'));
    }
    touchStartYRef.current = null;
  };

  if (!isOpen) return null;

  return (
    <div
      className="client-typography fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-0 md:p-4 lg:p-6 font-['Manrope',sans-serif]"
      role="dialog"
      ref={dialogRef}
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="branch-map-title"
    >

      <div className="relative w-full h-full md:max-w-6xl md:h-[90vh] bg-[#F8FAFC] md:rounded-3xl border border-[#E2E8F0] shadow-2xl flex flex-col overflow-hidden">
        {/* === ШАПКА МОДАЛЬНОГО ОКНА === */}
        <header className="flex items-center justify-between px-4 md:px-5 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] bg-white border-b border-[#E2E8F0] shrink-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden md:flex w-9 h-9 rounded-xl bg-[#052F85] items-center justify-center text-white">
              <MapPin size={19} className="text-white" />
            </div>
            <h2 id="branch-map-title" className="text-base md:text-lg font-extrabold text-[#031E56] leading-tight">
              Карта отделений
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Кнопка закрытия */}
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
              aria-label="Закрыть карту"
            >
              <X size={20} />
            </button>
          </div>
        </header>
        {locationError && (
          <div role="alert" className="shrink-0 bg-amber-50 text-xs text-amber-900 px-4 py-2 border-b border-amber-200">
            {locationError}
          </div>
        )}

        {/* === СПЛИТ-ЛЕЙАУТ ===
            Desktop (md:flex): 35% левый сайдбар со скроллируемым списком и фильтрами; 65% контейнер карты.
            Mobile (flex-col): Полноэкранная карта с collapsible Bottom Sheet.
        */}
        <div className="flex-1 flex flex-col md:flex-row relative overflow-hidden">
          {/* ======================================================== */}
          {/* ЛЕВЫЙ САЙДБАР (DESKTOP 35%): Список и фильтры            */}
          {/* ======================================================== */}
          <aside className="hidden md:flex md:w-[35%] flex-col h-full bg-[#F8FAFC] border-r border-[#E2E8F0] z-20 overflow-hidden">
            {/* Поиск и быстрые фильтры */}
            <div className="p-4 bg-white border-b border-[#E2E8F0] space-y-3">
              {/* Поле поиска */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={17} />
                <input
                  type="text"
                  aria-label="Поиск отделения"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по адресу, метро, индексу..."
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full pl-11 pr-4 py-2.5 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#052F85] focus:bg-white transition-all placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Очистить поиск"
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Быстрые фильтр-чипы: «Все», «Посылки», «Письма», «Пенсии», «Доступная среда» */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <FilterChip
                  active={selectedFilter === 'all'}
                  onClick={() => setSelectedFilter('all')}
                  label="Все"
                />
                <FilterChip
                  active={selectedFilter === 'parcels'}
                  onClick={() => setSelectedFilter('parcels')}
                  icon={<Package size={13} />}
                  label="Посылки"
                />
                <FilterChip
                  active={selectedFilter === 'letters'}
                  onClick={() => setSelectedFilter('letters')}
                  icon={<Mail size={13} />}
                  label="Письма"
                />
                <FilterChip
                  active={selectedFilter === 'pensions'}
                  onClick={() => setSelectedFilter('pensions')}
                  icon={<Coins size={13} />}
                  label="Пенсии"
                />
                <FilterChip
                  active={selectedFilter === 'accessible'}
                  onClick={() => setSelectedFilter('accessible')}
                  icon={<Accessibility size={13} />}
                  label="Доступная среда"
                />
              </div>
            </div>

            {/* Прокручиваемый список отделений */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filteredBranches.length === 0 ? (
                <div className="p-8 text-center text-slate-400 space-y-2">
                  <MapPin size={32} className="mx-auto text-slate-300" />
                  <p className="text-xs font-semibold">По вашему запросу отделений не найдено</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFilter('all');
                      setSearchQuery('');
                    }}
                    className="text-xs text-[#052F85] font-bold underline"
                  >
                    Сбросить фильтры
                  </button>
                </div>
              ) : (
                filteredBranches.map((branch) => {
                  const isSelected = branch.id === selectedBranch?.id;
                  const wait = getWaitBadgeInfo(branch.liveWaitMinutes);
                  const landmark = getLandmarkPresentation(branch.rawLocation);

                  return (
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      key={branch.id}
                      onClick={() => {
                        if (selectedBranchId === branch.id) {
                          clearBranchSelection();
                        } else {
                          handleSelectBranch(branch);
                        }
                      }}
                      className={`w-full min-h-11 p-3.5 rounded-2xl border transition-all cursor-pointer text-left ${
                        isSelected
                          ? 'bg-blue-50/70 border-[#052F85] ring-2 ring-[#052F85]/15 shadow-sm'
                          : 'bg-white border-[#E2E8F0] hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        {branch.photoUrl && (
                          <img src={branch.photoUrl} alt="Иллюстрация почтового отделения" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none'; }}
                            className="h-14 w-16 rounded-xl object-cover shrink-0 bg-slate-100" />
                        )}
                        <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-[#031E56] leading-snug">
                            {branch.name}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                            {branch.address}
                          </div>
                        </div>

                        {/* Бейдж ожидания (ПВЗ стиль) */}
                        <div
                          className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-xs ${wait.colorClass}`}
                        >
                          {wait.label}
                        </div>
                      </div>

                      {/* Метро и рейтинг (★ 4.92) */}
                      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1.5 truncate" data-landmark-type={landmark?.isMetro ? 'metro' : 'landmark'}>
                          {landmark?.isMetro ? (
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: landmark.color }} aria-hidden />
                          ) : (
                            <Navigation size={12} className="text-[#052F85] shrink-0" />
                          )}
                          <span className="truncate">{landmark?.label || 'Рядом с остановкой'}</span>
                        </div>
                        <div className="flex items-center gap-1 font-bold text-amber-500 shrink-0">
                          <Star size={12} className="fill-amber-400 text-amber-400" />
                          <span>{(branch.rating === null ? '—' : branch.rating.toFixed(2))}</span>
                        </div>
                      </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Карточка выбранного отделения внизу сайдбара с кнопками действий */}
            {selectedBranch && (
              <div className="p-3 bg-white border-t border-[#E2E8F0] shadow-lg animate-in slide-in-from-bottom-2 duration-200">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider font-extrabold text-slate-400">
                    Выбранное отделение
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-[#052F85]">
                      {selectedBranch.workHours}
                    </span>
                    <button
                      type="button"
                      onClick={clearBranchSelection}
                      className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      title="Снять выбор отделения"
                      aria-label="Снять выбор отделения"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <div className="text-xs font-bold text-[#031E56] mb-2 truncate">
                  {selectedBranch.name} • {selectedBranch.address}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleTakeTicket(selectedBranch)}
                    className="w-full py-2.5 px-3 rounded-xl bg-[#052F85] hover:bg-[#031E56] text-white text-xs font-bold transition-all shadow-md shadow-[#052F85]/20 flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                  >
                    <span>Взять талон</span>
                    <ArrowRight size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBookAppointment(selectedBranch)}
                    className="w-full py-2.5 px-3 rounded-xl border-2 border-[#052F85] text-[#052F85] hover:bg-blue-50 text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                  >
                    <Clock size={13} />
                    <span>Записаться</span>
                  </button>
                </div>
              </div>
            )}
          </aside>

          {/* ======================================================== */}
          {/* ПРАВАЯ ОБЛАСТЬ КАРТЫ (DESKTOP 65% / MOBILE 100%)         */}
          {/* ======================================================== */}
          <main className="flex-1 md:w-[65%] h-full relative overflow-hidden bg-slate-100 flex flex-col">
            {/* Плавающая кнопка «Моё местоположение» (геолокация) */}
            <button
              type="button"
              onClick={onRequestLocation}
              disabled={isLocatingUser}
              aria-busy={isLocatingUser}
              className="absolute top-4 left-4 z-20 w-11 h-11 bg-white hover:bg-slate-50 text-slate-700 rounded-xl shadow-lg border border-slate-200/90 flex items-center justify-center transition-all active:scale-95 cursor-pointer group"
              title="Моё местоположение"
              aria-label="Определить моё местоположение"
            >
              {isLocatingUser ? (
                <div className="w-5 h-5 border-2 border-[#052F85] border-t-transparent rounded-full animate-spin" />
              ) : (
                <Navigation
                  size={18}
                  className="text-slate-700 group-hover:text-[#052F85] transition-colors fill-slate-700/80"
                />
              )}
            </button>

            {/* Отображение карты */}
            {useFallbackMap ? (
              // Резервный режим карты (Leaflet / Carto / OSM)
              <LeafletCartoOsmFallbackMap
                branches={filteredBranches}
                selectedBranch={selectedBranch}
                userLocation={userLocation}
                mapCenter={fallbackCenter}
                onSelectBranch={handleSelectBranch}
                onManualInteraction={handleManualMapInteraction}
              />
            ) : (
              // Яндекс.Карты 2.1
              <div className="relative w-full h-full">
                <div ref={mapContainerRef} data-testid="branch-map-canvas" className="w-full h-full"
                  onPointerDownCapture={handleManualMapInteraction}
                  onTouchStartCapture={handleManualMapInteraction}
                  onWheelCapture={handleManualMapInteraction}
                  onKeyDownCapture={(event) => {
                    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-'].includes(event.key)) handleManualMapInteraction();
                  }} />
                {isYmapsLoading && (
                  <div className="absolute inset-0 bg-slate-100/80 backdrop-blur-xs flex items-center justify-center z-10">
                    <div className="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl shadow-xl border border-slate-200">
                      <div className="w-6 h-6 border-3 border-[#052F85] border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-bold text-[#031E56]">
                        Загрузка Яндекс.Карт...
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Всплывающая подробная карточка отделения над картой на десктопе */}
            {selectedBranch && (
              <div ref={desktopBranchCardRef} data-testid="desktop-branch-card-overlay" className="hidden lg:block absolute bottom-5 right-5 w-[34%] min-w-[256px] max-w-[320px] max-h-[calc(100%-2.5rem)] overflow-y-auto rounded-3xl z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <DetailedBranchCard
                  branch={selectedBranch}
                  compact
                  informationalOnly
                  userLocation={userLocation}
                  onClose={clearBranchSelection}
                  onTakeTicket={() => handleTakeTicket(selectedBranch)}
                  onBookAppointment={() => handleBookAppointment(selectedBranch)}
                />
              </div>
            )}

            {/* ======================================================== */}
            {/* МОБИЛЬНЫЙ DRAGGABLE / COLLAPSIBLE BOTTOM SHEET           */}
            {/* ======================================================== */}
            <div
              ref={mobileBottomSheetRef}
              data-testid="mobile-branch-bottom-sheet"
              className={`md:hidden absolute bottom-0 inset-x-0 bg-white rounded-t-3xl shadow-2xl border-t border-[#E2E8F0] transition-all duration-300 z-30 flex flex-col ${
                bottomSheetState === 'collapsed'
                  ? 'h-20'
                  : bottomSheetState === 'half'
                  ? 'h-[48dvh] landscape:h-[42dvh]'
                  : 'h-[78dvh] landscape:h-[62dvh]'
              }`}
            >
              {/* Полоса свайпа (Drag Handle) */}
              <button
                type="button"
                aria-label="Размер списка отделений"
                aria-expanded={bottomSheetState !== 'collapsed'}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={() =>
                  setBottomSheetState((prev) =>
                    prev === 'collapsed' ? 'half' : prev === 'half' ? 'expanded' : 'collapsed'
                  )
                }
                className="w-full min-h-11 pt-3 pb-2 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing border-b border-slate-100"
              >
                <div className="w-12 h-1.5 rounded-full bg-slate-300 mb-1" />
                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                  <span>Отделения</span>
                  {bottomSheetState === 'collapsed' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {bottomSheetState === 'expanded' && <><div className="px-3 py-2 bg-slate-50 border-b border-[#E2E8F0] flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <FilterChip
                  active={selectedFilter === 'all'}
                  onClick={() => setSelectedFilter('all')}
                  label="Все"
                />
                <FilterChip
                  active={selectedFilter === 'parcels'}
                  onClick={() => setSelectedFilter('parcels')}
                  label="Посылки"
                />
                <FilterChip
                  active={selectedFilter === 'letters'}
                  onClick={() => setSelectedFilter('letters')}
                  label="Письма"
                />
                <FilterChip
                  active={selectedFilter === 'pensions'}
                  onClick={() => setSelectedFilter('pensions')}
                  label="Пенсии"
                />
                <FilterChip
                  active={selectedFilter === 'accessible'}
                  onClick={() => setSelectedFilter('accessible')}
                  label="Доступная среда"
                />
              </div></>}

              {/* Мобильное поле поиска */}
              {bottomSheetState !== 'collapsed' && <div className="px-3 pt-2 pb-1 bg-white">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
                  <input
                    type="text"
                    aria-label="Поиск отделения"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск по адресу, метро, индексу..."
                    style={{ paddingLeft: '2.75rem' }}
                    className="w-full pl-11 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#052F85] focus:bg-white transition-all placeholder:text-slate-400"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Очистить поиск"
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>}

              {/* Содержимое Bottom Sheet: детальная карточка выбранного отделения или список */}
              {bottomSheetState !== 'collapsed' && <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {selectedBranch ? (
                  <DetailedBranchCard
                    branch={selectedBranch}
                    userLocation={userLocation}
                    onClose={clearBranchSelection}
                    onTakeTicket={() => handleTakeTicket(selectedBranch)}
                    onBookAppointment={() => handleBookAppointment(selectedBranch)}
                  />
                ) : (
                  <div className="space-y-2">
                    {filteredBranches.map((b) => {
                      const landmark = getLandmarkPresentation(b.rawLocation);
                      return (
                      <button
                        type="button"
                        key={b.id}
                        onClick={() => handleSelectBranch(b)}
                        className="w-full min-h-11 text-left p-3 rounded-2xl bg-slate-50 hover:bg-blue-50/50 border border-slate-200 hover:border-blue-200 transition-colors flex items-start gap-2.5 cursor-pointer min-w-0"
                      >
                        {b.photoUrl && (
                          <img src={b.photoUrl} alt="Иллюстрация почтового отделения" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none'; }}
                            className="h-14 w-16 rounded-xl object-cover shrink-0 bg-slate-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-[#031E56] break-words">{b.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 break-words">{b.address}</div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                            <span>★ {(b.rating === null ? '—' : b.rating.toFixed(2))}</span>
                            <span>•</span>
                            <span className="inline-flex min-w-0 items-center gap-1" data-landmark-type={landmark?.isMetro ? 'metro' : 'landmark'}>
                              {landmark?.isMetro ? (
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: landmark.color }} aria-hidden />
                              ) : (
                                <Navigation size={10} className="shrink-0" aria-hidden />
                              )}
                              <span className="truncate">{landmark?.label || 'Рядом с остановкой'}</span>
                            </span>
                          </div>
                        </div>
                        <div
                          className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-xs ${
                            getWaitBadgeInfo(b.liveWaitMinutes).colorClass
                          }`}
                        >
                          {getWaitBadgeInfo(b.liveWaitMinutes).label}
                        </div>
                      </button>
                    );})}
                  </div>
                )}
              </div>}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * Быстрый фильтр-чип
 */
function FilterChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
        active
          ? 'bg-[#052F85] text-white shadow-sm shadow-[#052F85]/20'
          : 'bg-white text-slate-600 border border-[#E2E8F0] hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Детальная карточка отделения (Photo of entrance, address, metro, working hours, live queue wait, amenities badges, buttons)
 */
export function DetailedBranchCard({
  branch,
  onTakeTicket,
  onBookAppointment,
  onClose,
  compact = false,
  informationalOnly = false,
  userLocation,
}: {
  branch: MapBranch;
  onTakeTicket: () => void;
  onBookAppointment: () => void;
  onClose?: () => void;
  compact?: boolean;
  informationalOnly?: boolean;
  userLocation?: [number, number] | null;
}) {
  const [imgError, setImgError] = useState(false);
  const wait = getWaitBadgeInfo(branch.liveWaitMinutes);
  const landmark = getLandmarkPresentation(branch.rawLocation);

  const displayPhoto = useMemo(() => {
    if (branch.photoUrl && !branch.photoUrl.startsWith('data:image/svg')) {
      return branch.photoUrl;
    }
    return getBranchPhoto(branch.code, branch.name);
  }, [branch.photoUrl, branch.code, branch.name]);

  return (
    <div className="bg-white rounded-3xl border border-[#E2E8F0] shadow-xl overflow-hidden font-['Manrope']">
      {/* Фото входа отделения / фирменный фасад Почты России */}
      <div className={`branch-card-photo relative ${compact ? 'h-28' : 'h-36 sm:h-44'} w-full bg-gradient-to-br from-[#052F85] via-[#004B93] to-[#031E56] overflow-hidden flex items-center justify-center`}>
        {!imgError && displayPhoto ? (
          <img
            src={displayPhoto}
            alt="Иллюстрация почтового отделения"
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src="/images/branch_city.jpg"
            alt="Иллюстрация почтового отделения"
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        )}

        {/* Затемняющий градиент для контрастности бейджей */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/30 pointer-events-none" />

        {(branch.rating !== null || branch.liveWaitMinutes !== null) && (
          <div className={`branch-photo-badges absolute top-3 left-3 ${onClose ? 'right-16' : 'right-3'} z-20`}>
            {branch.rating !== null && (
              <div
                aria-label={`Рейтинг отделения: ${branch.rating.toFixed(2)}`}
                className="branch-rating-badge px-2.5 py-1 rounded-full bg-slate-900/75 backdrop-blur-md text-white text-[11px] font-bold border border-white/15">
                <Star size={12} className="fill-amber-400 text-amber-400 shrink-0" />
                <span>{branch.rating.toFixed(2)}</span>
              </div>
            )}
            {branch.liveWaitMinutes !== null && (
              <div className={`branch-queue-badge px-2.5 py-1 rounded-full text-white text-[11px] font-bold shadow-md ${wait.colorClass}`}>
                <span>{wait.label}</span><span className="branch-queue-suffix"> в очереди</span>
              </div>
            )}
          </div>
        )}

        {/* Кнопка закрытия / сворачивания отделения (X) */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 z-30 w-11 h-11 rounded-full bg-slate-900/65 hover:bg-slate-900/85 text-white flex items-center justify-center backdrop-blur-md border border-white/20 transition-all active:scale-95 shadow-md cursor-pointer"
            aria-label="Свернуть карточку отделения"
            title="Свернуть"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Информация об отделении */}
      <div className={`${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'}`}>
        <div>
          <h3 className="text-sm font-extrabold text-[#031E56] leading-snug">
            {branch.name}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">{branch.address}</p>
        </div>

        {/* Метро, часы работы и текущая очередь */}
        <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-2" data-landmark-type={landmark?.isMetro ? 'metro' : 'landmark'}>
            {landmark?.isMetro ? (
              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: landmark.color }} aria-hidden />
            ) : (
              <Navigation size={14} className="text-[#052F85] shrink-0" />
            )}
            <span className="font-semibold text-slate-800">{landmark?.label || 'Ближайшая остановка транспорта'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-slate-400 shrink-0" />
            <span>Часы работы: <strong>{branch.workHours}</strong></span>
          </div>
          {(() => {
            const workload = branch.liveWaitMinutes === null
              ? { colorClass: 'border-slate-200 text-slate-500', label: 'Нет оценки' }
              : { colorClass: wait.textClass, label: wait.label };
            return (
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-slate-400 shrink-0" />
                  <span>В зале: <strong>{branch.waitingCount ?? '—'} чел.</strong></span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${workload.colorClass}`}>
                  {workload.label}
                </span>
              </div>
            );
          })()}
        </div>

        {/* Удобства и доступная среда (Amenities badges) */}
        {!compact && <div>
          <div className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 mb-1.5">
            Услуги и доступность
          </div>
          <div className="flex flex-wrap gap-1.5">
            {branch.amenities.includes('accessible') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-50 text-[#052F85] text-[11px] font-bold border border-blue-200">
                <Accessibility size={12} />
                <span>Доступная среда</span>
              </span>
            )}
            {branch.amenities.includes('parcels') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-semibold">
                <Package size={12} />
                <span>Посылки</span>
              </span>
            )}
            {branch.amenities.includes('letters') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-semibold">
                <Mail size={12} />
                <span>Письма</span>
              </span>
            )}
            {branch.amenities.includes('pensions') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-semibold">
                <Coins size={12} />
                <span>Пенсии</span>
              </span>
            )}
            {branch.amenities.includes('atm') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-semibold">
                <CreditCard size={12} />
                <span>Почта Банк</span>
              </span>
            )}
          </div>
        </div>}

        {/* Кнопка прокладки пешего маршрута в Яндекс.Картах */}
        <a
          href={
            userLocation
              ? `https://yandex.ru/maps/?rtext=${userLocation[0]},${userLocation[1]}~${branch.coordinates[0]},${branch.coordinates[1]}&rtt=pd`
              : `https://yandex.ru/maps/?rtext=~${branch.coordinates[0]},${branch.coordinates[1]}&rtt=pd`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-2 px-3 rounded-2xl bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200/70 text-[#052F85] text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
        >
          <Navigation size={13} />
          <span>{compact ? 'Маршрут' : 'Проложить маршрут в Яндекс.Картах'}</span>
        </a>

        {/* Кнопки действий: «Взять талон» / «Записаться» */}
        {!informationalOnly && <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onTakeTicket}
            className={`w-full min-h-11 ${compact ? 'py-2' : 'py-2.5'} px-4 rounded-2xl bg-[#052F85] hover:bg-[#031E56] text-white text-xs font-extrabold transition-all shadow-md shadow-[#052F85]/20 flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer`}
          >
            <span>Взять талон</span>
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            onClick={onBookAppointment}
            className={`w-full min-h-11 ${compact ? 'py-2' : 'py-2.5'} px-4 rounded-2xl border-2 border-[#052F85] text-[#052F85] hover:bg-blue-50 text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer`}
          >
            <Clock size={14} />
            <span>Записаться</span>
          </button>
        </div>}

        {/* Ссылка на сворачивание карточки */}
        {onClose && !informationalOnly && (
          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer py-1"
            >
              ← Свернуть отделение и показать все
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Резервный легковесный компонент карты (Leaflet / Carto / OSM fallback)
 * для оффлайн-режима, тестирования и среды без доступа к API Яндекс.Карт.
 * Показывает схему по координатам без картографических тайлов.
 */
export function LeafletCartoOsmFallbackMap({
  branches,
  selectedBranch,
  userLocation,
  mapCenter,
  onSelectBranch,
  onManualInteraction,
}: {
  branches: MapBranch[];
  selectedBranch: MapBranch | null;
  userLocation: [number, number] | null;
  mapCenter?: [number, number];
  onSelectBranch: (branch: MapBranch) => void;
  onManualInteraction?: () => void;
}) {
  const [zoomLevel, setZoomLevel] = useState(13);

  // Вычисление относительных координат на резервной карте (Carto / OSM)
  const centerLat = mapCenter?.[0] ?? selectedBranch?.coordinates[0] ?? userLocation?.[0] ?? 55.7618;
  const centerLon = mapCenter?.[1] ?? selectedBranch?.coordinates[1] ?? userLocation?.[1] ?? 37.6385;
  const scale = 2600 * (zoomLevel / 13);

  return (
    <div
      data-testid="leaflet-carto-osm-fallback"
      className="relative w-full h-full bg-[#f2f4f8] overflow-hidden flex flex-col select-none"
    >
      {/* Картографическая сетка Carto Voyager / OpenStreetMap (OSM) */}
      <div className="absolute inset-0 opacity-80 pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="carto-osm-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#carto-osm-grid)" />
        </svg>
      </div>

      {/* Верхний бейдж Leaflet / Carto / OSM */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <div className="px-3 py-1.5 rounded-2xl bg-white/95 backdrop-blur-md border border-[#E2E8F0] shadow-sm text-xs font-semibold text-[#031E56] flex items-center gap-2">
          <Layers size={14} className="text-[#052F85]" />
          <span>Схема отделений · карта недоступна</span>
        </div>
      </div>

      {/* Кнопки управления масштабом карты (Leaflet zoom controls) */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            onManualInteraction?.();
            setZoomLevel((z) => Math.min(18, z + 1));
          }}
          className="w-11 h-11 rounded-xl bg-white shadow-md border border-[#E2E8F0] text-slate-700 font-bold flex items-center justify-center hover:bg-slate-50 transition-colors"
          aria-label="Приблизить карту"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            onManualInteraction?.();
            setZoomLevel((z) => Math.max(10, z - 1));
          }}
          className="w-11 h-11 rounded-xl bg-white shadow-md border border-[#E2E8F0] text-slate-700 font-bold flex items-center justify-center hover:bg-slate-50 transition-colors"
          aria-label="Отдалить карту"
        >
          −
        </button>
      </div>

      {/* Отрисовка интерактивных ПВЗ-меток */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center">
        {userLocation && (
          <div
            data-testid="client-location-marker"
            role="img"
            aria-label="Вы находитесь здесь"
            style={{ left: `calc(50% + ${(userLocation[1] - centerLon) * scale}px)`, top: `calc(50% + ${-(userLocation[0] - centerLat) * scale}px)` }}
            className="absolute left-1/2 top-1/2 z-30 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          >
            <span className="absolute h-9 w-9 animate-ping rounded-full bg-blue-500/30" />
            <span className="relative h-5 w-5 rounded-full border-[3px] border-white bg-[#052F85] shadow-lg shadow-blue-950/40" />
          </div>
        )}
        {branches.map((b) => {
          const isSelected = b.id === selectedBranch?.id;
          const wait = getWaitBadgeInfo(b.liveWaitMinutes);

          // Проекция координат относительно центра карты
          const xOffset = (b.coordinates[1] - centerLon) * scale;
          const yOffset = -(b.coordinates[0] - centerLat) * scale;

          return (
            <button
              type="button"
              aria-label={`Выбрать отделение: ${b.name}`}
              aria-pressed={isSelected}
              key={b.id}
              onClick={() => onSelectBranch(b)}
              style={{
                position: 'absolute',
                left: `calc(50% + ${xOffset}px)`,
                top: `calc(50% + ${yOffset}px)`,
                transform: 'translate(-50%, -100%)',
              }}
              className={`min-w-11 min-h-11 cursor-pointer transition-transform duration-200 z-10 ${
                isSelected ? 'scale-110 z-20' : 'hover:scale-105'
              }`}
            >
              {/* ПВЗ-бейдж: Компактный горизонтальный маркер [ ★ 4.94 • ~0 мин ] */}
              <div
                className={`pvz-pin-marker shadow-lg px-2.5 py-1 rounded-full text-white text-[11px] font-extrabold flex items-center gap-1.5 whitespace-nowrap leading-none ${
                  isSelected
                    ? 'border-[3px] border-[#FACC15] ring-4 ring-yellow-400/25'
                    : 'border-2 border-white'
                } ${wait.colorClass}`}
              >
                {b.rating !== null && <span className="text-yellow-200">★</span>}
                {b.rating !== null && <span>{b.rating.toFixed(2)}</span>}
                {b.rating !== null && b.liveWaitMinutes !== null && <span className="opacity-60">•</span>}
                {b.liveWaitMinutes !== null && <span>{wait.label}</span>}
                {b.rating === null && b.liveWaitMinutes === null && <span>Почта</span>}
              </div>
              <div
                className={`w-2 h-2 rotate-45 mx-auto -mt-1 border-r-2 border-b-2 ${
                  isSelected ? 'border-[#FACC15]' : 'border-white'
                } ${wait.colorClass}`}
              />
            </button>
          );
        })}
      </div>

      {/* Атрибуция Carto / OpenStreetMap (OSM) / Leaflet */}
      <div className="absolute bottom-2 right-4 text-[10px] text-slate-400 bg-white/80 px-2 py-0.5 rounded backdrop-blur-xs border border-slate-200 z-10">
        Схема расположения отделений. Дорожная карта недоступна.
      </div>
    </div>
  );
}
