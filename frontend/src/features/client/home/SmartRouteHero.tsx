import { useEffect, useMemo } from 'react';
import { Loader2, MapPinOff, Navigation, Ticket as TicketIcon, Clock } from 'lucide-react';
import { StreetsNavigationIcon } from '@solar-icons/react/linear';
import type { Branch, Service } from '../../../api/client/types';
import type { GeoCoordinates, GeofenceSimulationMode, GpsPermissionState } from '../arrival/useGeofencing';
import { calculatePersonalRouting, recommendationActions, matchBranchLocation, liveWaitMinutes } from '../map/liveBranches';
import { MOSCOW_BRANCHES } from '../map/branchLocations';
import { useBranchWorkloads } from '../map/useBranchWorkloads';
import { isBranchEligibleForWalkIn } from '../map/branchSchedule';

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
  const workloads = useBranchWorkloads(branches.map(branch => branch.id));
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
  const isRouteDataPending = hasReliableGpsFix
    && !fastest
    && (branches.length === 0 || operationallyEligibleBranches.length > 0);

  useEffect(() => {
    if (fastest && confirmedServicesByBranch[fastest.id] === undefined) onNeedServices(fastest.id);
  }, [fastest, confirmedServicesByBranch, onNeedServices]);

  return (
    <>
      {!hasReliableGpsFix && gpsPermissionStatus !== 'denied' && gpsPermissionStatus !== 'unavailable' && (
        <div className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Loader2 size={16} className="animate-spin" /></div>
          <div><p className="text-sm font-semibold text-blue-950">Определяем местоположение…</p><p className="mt-0.5 text-xs text-blue-800">Скоро покажем удобное отделение.</p></div>
        </div>
      )}

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
        <section
          role="status"
          aria-live="polite"
          aria-label="Подбираем умный маршрут"
          className="min-h-[220px] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_14px_rgb(13_37_61_/_5%)] sm:p-5"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#003B73]">
              <Loader2 size={20} className="animate-spin" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#003B73]">Умный маршрут</p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">Подбираем лучшее отделение…</h2>
              <p className="mt-1 text-sm text-slate-600">Проверяем дорогу и актуальную очередь. Рекомендация появится здесь.</p>
            </div>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-3" aria-hidden="true">
            {[0, 1, 2].map(item => (
              <div key={item} className="space-y-2 text-center">
                <div className="mx-auto h-7 w-16 animate-pulse rounded-md bg-slate-200" />
                <div className="mx-auto h-3 w-12 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </section>
      )}

      {hasReliableGpsFix && !fastest && !isRouteDataPending && routingBranches.length === 0 && (
        <section role="region" aria-label="Ближайшие отделения закрыты" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_4px_14px_rgb(13_37_61_/_5%)] sm:p-5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#003B73]">
              <Clock size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-950">Ближайшие отделения сейчас закрыты</h2>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                Живая очередь откроется в соответствии с расписанием отделений. Вы можете предварительно записаться онлайн на удобную дату и время.
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={onOpenMap}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#003B73] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#00519B]"
                >
                  Посмотреть отделения на карте
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {!hasRealGpsFix && simulationMode === 'real_gps' && (gpsPermissionStatus === 'denied' || gpsPermissionStatus === 'unavailable') && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3"><MapPinOff size={18} className="shrink-0 text-slate-600" /><p className="text-sm font-medium text-slate-800">Включите геолокацию, чтобы подобрать ближайшее отделение</p></div>
          <div className="flex w-full gap-2 sm:w-auto"><button type="button" onClick={onOpenMap} className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 sm:flex-none">Карта</button><button type="button" onClick={requestGpsPermission} className="min-h-11 flex-1 rounded-lg bg-[#003B73] px-3 text-sm font-semibold text-white sm:flex-none">Включить гео</button></div>
        </div>
      )}
    </>
  );
}
