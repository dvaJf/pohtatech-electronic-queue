import { useEffect, useMemo, useState } from 'react';
import { MapPinOff, Navigation, Ticket as TicketIcon, Clock, RefreshCw, Calendar, MapPin } from 'lucide-react';
import { StreetsNavigationIcon } from '@solar-icons/react/linear';
import type { Branch, Service } from '../../../api/client/types';
import type { GeoCoordinates, GeofenceSimulationMode, GpsPermissionState } from '../arrival/useGeofencing';
import { calculatePersonalRouting, recommendationActions, matchBranchLocation, liveWaitMinutes } from '../map/liveBranches';
import { MOSCOW_BRANCHES, calculateHaversineDistance, calculateTravelTimeMinutes } from '../map/branchLocations';
import { useBranchWorkloads } from '../map/useBranchWorkloads';
import { isBranchEligibleForWalkIn } from '../map/branchSchedule';
import { HomeHeroSkeleton } from './ActiveTicketHero';

type RouteBranch = { id: string; name: string; address: string; totalMinutes: number; travelMinutes: number; waitMinutes: number };

export function SmartRouteHero({
  branches, currentCoordinates, hasReliableGpsFix, hasRealGpsFix, simulationMode, gpsPermissionStatus,
  requestGpsPermission, confirmedServicesByBranch, onNeedServices, onChooseBranch, onOpenRoute, onOpenMap, onBook,
}: {
  branches: Branch[];
  currentCoordinates: GeoCoordinates;
  hasReliableGpsFix: boolean;
  hasRealGpsFix: boolean;
  simulationMode: GeofenceSimulationMode;
  gpsPermissionStatus: GpsPermissionState;
  requestGpsPermission: () => void;
  confirmedServicesByBranch: Record<string, Service[] | null>;
  onNeedServices: (branchId: string) => void;
  onChooseBranch: (branchId: string) => void;
  onOpenRoute: (branch: RouteBranch, timeSavedMinutes: number) => void;
  onOpenMap: () => void;
  onBook: (branchId: string) => void;
}) {
  const { workloads, isInitialLoading: isWorkloadLoading, retry: retryWorkloads } = useBranchWorkloads(branches.map(branch => branch.id));
  const [geoWaitExpired, setGeoWaitExpired] = useState(false);
  const operationallyEligibleBranches = useMemo(
    () => branches.filter(branch => isBranchEligibleForWalkIn(branch, workloads[branch.id]).eligible),
    [branches, workloads],
  );

  const routingBranches = useMemo(() => branches.flatMap(branch => {
    // 1. Walk-in eligibility check: branch must be open and able to serve client before closing
    const eligibility = isBranchEligibleForWalkIn(branch, workloads[branch.id]);
    if (!eligibility.eligible) return [];

    const location = matchBranchLocation(branch, MOSCOW_BRANCHES);
    const wait = liveWaitMinutes(workloads[branch.id]);
    return location && wait !== undefined
      ? [{ ...location, activeQueueCount: workloads[branch.id].currentWaiting, activeWindows: workloads[branch.id].activeWindows!, serverWaitMinutes: wait }]
      : [];
  }), [branches, workloads]);
  const smartRouting = useMemo(
    () => calculatePersonalRouting(currentCoordinates, routingBranches, hasReliableGpsFix, simulationMode),
    [currentCoordinates, routingBranches, hasReliableGpsFix, simulationMode],
  );
  const fastest = smartRouting.recommendation?.fastestBranch;
  const actions = fastest ? recommendationActions(fastest.id, confirmedServicesByBranch) : [];

  // Nearest located branch to user regardless of walk-in eligibility (for "Не успеем" card)
  const closestBranch = useMemo(() => {
    if (!branches.length) return null;
    const located = branches.flatMap(b => {
      const loc = matchBranchLocation(b, MOSCOW_BRANCHES);
      if (!loc) return [];
      const dist = calculateHaversineDistance(currentCoordinates.lat, currentCoordinates.lng, loc.lat, loc.lng);
      const travel = calculateTravelTimeMinutes(dist);
      const wait = liveWaitMinutes(workloads[b.id]) ?? 0;
      return [{ ...loc, branch: b, distanceKm: dist, travelMinutes: travel, waitMinutes: wait }];
    });
    if (!located.length) return null;
    return located.sort((a, b) => a.distanceKm - b.distanceKm)[0];
  }, [branches, currentCoordinates, workloads]);

  const closestBranchWalkInCheck = useMemo(() => {
    if (!closestBranch) return null;
    return isBranchEligibleForWalkIn(
      closestBranch.branch,
      workloads[closestBranch.id],
      closestBranch.travelMinutes,
    );
  }, [closestBranch, workloads]);

  const isGeoPending = !hasReliableGpsFix
    && gpsPermissionStatus !== 'denied'
    && gpsPermissionStatus !== 'unavailable'
    && !geoWaitExpired;
  const isRouteDataPending = isGeoPending || (
    hasReliableGpsFix
    && !fastest
    && branches.length > 0
    && operationallyEligibleBranches.length > 0
    && isWorkloadLoading
  );
  const isRouteDataUnavailable = hasReliableGpsFix
    && !fastest
    && !closestBranch
    && !isWorkloadLoading
    && branches.length === 0;
  const hasNoReachableBranch = hasReliableGpsFix
    && !fastest
    && !isWorkloadLoading
    && routingBranches.length > 0;

  useEffect(() => {
    if (hasReliableGpsFix || gpsPermissionStatus === 'denied' || gpsPermissionStatus === 'unavailable') {
      setGeoWaitExpired(false);
      return;
    }
    const timeout = window.setTimeout(() => setGeoWaitExpired(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [hasReliableGpsFix, gpsPermissionStatus]);

  useEffect(() => {
    if (fastest && confirmedServicesByBranch[fastest.id] === undefined) onNeedServices(fastest.id);
  }, [fastest, confirmedServicesByBranch, onNeedServices]);

  return (
    <>
      {fastest && (
        <section role="region" aria-label="Умный маршрут" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_14px_rgb(13_37_61_/_5%)] sm:p-5">
          <div className="min-w-0">
            <p className="cx-route-symbol mb-1.5 flex items-center gap-2 text-xs font-semibold text-[#003B73]"><StreetsNavigationIcon className="h-5 w-5" aria-hidden="true" />Умный маршрут</p>
            <h2 className="text-lg font-semibold leading-snug text-slate-950">{fastest.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{fastest.address}</p>
          </div>

          <div key={`${fastest.id}-${Math.round(fastest.travelMinutes || 0)}-${Math.round(fastest.waitMinutes || 0)}-${Math.round(fastest.totalMinutes)}`} className="cx-route-flow mx-auto mt-7 max-w-[760px]">
            <div className="grid grid-cols-3 text-center">
              <div className="cx-route-metric cx-route-metric-travel"><strong className="block text-xl font-semibold leading-none tabular-nums text-slate-950 sm:text-2xl">{Math.round(fastest.travelMinutes || 0)} мин</strong><span className="mt-2 block text-xs font-medium text-slate-600">Дорога</span></div>
              <div className="cx-route-metric cx-route-metric-queue"><strong className="block text-xl font-semibold leading-none tabular-nums text-slate-950 sm:text-2xl">{Math.round(fastest.waitMinutes || 0)} мин</strong><span className="mt-2 block text-xs font-medium text-slate-600">В очереди</span></div>
              <div className="cx-route-metric cx-route-metric-total"><strong className="block text-2xl font-bold leading-none tabular-nums tracking-[-0.02em] text-[#003B73] sm:text-3xl">{Math.round(fastest.totalMinutes)} мин</strong><span className="mt-2 block text-xs font-semibold text-[#003B73]">Всего</span></div>
            </div>
            <div className="cx-route-line" aria-hidden="true">
              <div className="cx-route-line-track">
                <div className="cx-route-line-draw" />
              </div>
              <div className="cx-route-node cx-route-node-start" />
              <div className="cx-route-node cx-route-node-middle" />
              <div className="cx-route-node cx-route-node-end">
                <div className="cx-route-node-end-core" />
              </div>
              <div className="cx-route-pulse" />
            </div>
          </div>

          <div className="cx-route-actions mt-6 flex flex-wrap items-center gap-2.5 sm:gap-3">
            <button type="button" onClick={() => onChooseBranch(fastest.id)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#003B73] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#00519B] active:bg-[#002C57] sm:w-auto"><TicketIcon size={17} />Выбрать услуги и взять талон</button>
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              {actions.includes('appointment') && <button type="button" onClick={() => onBook(fastest.id)} className="min-h-11 flex-1 rounded-lg border border-blue-200 bg-[#F5F9FD] px-3.5 text-sm font-semibold text-[#003B73] transition-colors hover:bg-[#EAF2FB] sm:flex-none">Записаться</button>}
              <button type="button" onClick={() => onOpenRoute(fastest, smartRouting.recommendation!.timeSavedMinutes)} className="min-h-11 flex-1 rounded-lg px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#003B73] sm:flex-none"><Navigation size={16} className="mr-1 inline" />Маршрут</button>
            </div>
          </div>
        </section>
      )}

      {isRouteDataPending && (
        <HomeHeroSkeleton />
      )}

      {isRouteDataUnavailable && (
        <section role="status" className="min-h-[230px] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_14px_rgb(13_37_61_/_5%)] sm:p-5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#003B73]">
              <RefreshCw size={21} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-950">Не удалось обновить умный маршрут</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">Актуальные данные очереди пока недоступны. Можно повторить расчёт или выбрать отделение на карте.</p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button type="button" onClick={retryWorkloads} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#003B73] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#00519B]"><RefreshCw size={16} aria-hidden="true" />Повторить</button>
                <button type="button" onClick={onOpenMap} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">Открыть карту</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {hasReliableGpsFix && !fastest && !isRouteDataPending && !isRouteDataUnavailable && (routingBranches.length === 0 || hasNoReachableBranch) && (
        <section role="region" aria-label="Отделения закрыты или вы не успеете" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_14px_rgb(13_37_61_/_5%)] sm:p-5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#003B73]">
              <Clock size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-950">
                Отделения закрыты или вы не успеете
              </h2>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                С учётом дороги и очереди сегодня обслужиться не выйдет. Запишитесь онлайн на завтра или откройте карту отделений.
              </p>
              <div className="mt-4 flex flex-col sm:flex-row flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onBook('')}
                  className="flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-[#003B73] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#00519B] active:bg-[#002C57]"
                >
                  <Calendar size={16} />
                  <span>Записаться на завтра</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenMap}
                  className="flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100"
                >
                  <MapPin size={16} />
                  <span>Карта отделений</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {!hasRealGpsFix && simulationMode === 'real_gps' && (gpsPermissionStatus === 'denied' || gpsPermissionStatus === 'unavailable' || geoWaitExpired) && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3"><MapPinOff size={18} className="shrink-0 text-slate-600" /><p className="text-sm font-medium text-slate-800">Включите геолокацию, чтобы подобрать ближайшее отделение</p></div>
          <div className="flex w-full gap-2 sm:w-auto"><button type="button" onClick={onOpenMap} className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 sm:flex-none">Карта</button><button type="button" onClick={() => { setGeoWaitExpired(false); requestGpsPermission(); }} className="min-h-11 flex-1 rounded-lg bg-[#003B73] px-3 text-sm font-semibold text-white sm:flex-none">Включить гео</button></div>
        </div>
      )}
    </>
  );
}
