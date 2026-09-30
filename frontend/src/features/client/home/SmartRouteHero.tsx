import { useEffect, useMemo } from 'react';
import { Loader2, MapPinOff, Navigation, Sparkles, Ticket as TicketIcon } from 'lucide-react';
import type { Branch, Service } from '../../../api/client/types';
import type { GeoCoordinates, GeofenceSimulationMode, GpsPermissionState } from '../arrival/useGeofencing';
import { calculatePersonalRouting, recommendationActions, matchBranchLocation, liveWaitMinutes } from '../map/liveBranches';
import { MOSCOW_BRANCHES } from '../map/branchLocations';
import { useBranchWorkloads } from '../map/useBranchWorkloads';

export function SmartRouteHero({
  branches,
  currentCoordinates,
  hasReliableGpsFix,
  hasRealGpsFix,
  simulationMode,
  gpsPermissionStatus,
  requestGpsPermission,
  confirmedServicesByBranch,
  onNeedServices,
  onTakeTicket,
  onOpenRoute,
  onOpenMap,
  onBook,
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
  onTakeTicket: (branchId: string) => void;
  onOpenRoute: (branch: { id: string; name: string; address: string; totalMinutes: number; travelMinutes: number; waitMinutes: number }, timeSavedMinutes: number) => void;
  onOpenMap: () => void;
  onBook: (branchId: string) => void;
}) {
  const workloads = useBranchWorkloads(branches.map(branch => branch.id));
  const routingBranches = useMemo(() => branches.flatMap(branch => {
    const location = matchBranchLocation(branch, MOSCOW_BRANCHES);
    const wait = liveWaitMinutes(workloads[branch.id]);
    return location && wait !== undefined ? [{ ...location, activeQueueCount: workloads[branch.id].currentWaiting, activeWindows: workloads[branch.id].activeWindows!, serverWaitMinutes: wait }] : [];
  }), [branches, workloads]);
  const smartRouting = useMemo(() => calculatePersonalRouting(currentCoordinates, routingBranches, hasReliableGpsFix, simulationMode), [currentCoordinates, routingBranches, hasReliableGpsFix, simulationMode]);
  const fastest = smartRouting.recommendation?.fastestBranch;
  const actions = fastest ? recommendationActions(fastest.id, confirmedServicesByBranch) : [];

  useEffect(() => {
    if (fastest && confirmedServicesByBranch[fastest.id] === undefined) onNeedServices(fastest.id);
  }, [fastest, confirmedServicesByBranch, onNeedServices]);

  return <>
    {!hasReliableGpsFix && gpsPermissionStatus !== 'denied' && gpsPermissionStatus !== 'unavailable' && <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200/80 bg-blue-50/70 p-3.5 shadow-2xs"><div className="flex min-w-0 items-center gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-200 text-blue-700"><Loader2 size={16} className="animate-spin" /></div><div className="min-w-0"><p className="text-sm font-bold text-blue-900">Определяем ваше местоположение…</p><p className="mt-0.5 text-xs text-blue-700">Подберём ближайшее отделение после GPS fix.</p></div></div></div>}
    {fastest && <section role="region" aria-label="Рекомендация отделения" className="space-y-3.5 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 via-teal-50/40 to-white p-4 shadow-xs sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-100 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-800"><Sparkles size={11} />Умный маршрут</div><h2 className="text-base font-black leading-snug text-[#031E56] sm:text-lg">{fastest.name}</h2><p className="mt-0.5 truncate text-xs text-slate-500">{fastest.address}</p></div><div className="shrink-0 rounded-2xl border border-emerald-200/80 bg-white/90 px-3 py-2 text-right shadow-2xs"><div className="text-2xl font-black leading-none tabular-nums text-[#031E56] sm:text-3xl">≈{Math.round(fastest.totalMinutes)} мин</div><div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">всего</div></div></div><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100/80 bg-white/70 px-3 py-1.5 text-xs text-slate-600"><span><strong className="text-slate-800">{Math.round(fastest.travelMinutes || 0)} мин дорога</strong> · <strong className="text-emerald-700">{Math.round(fastest.waitMinutes || 0)} мин очередь</strong></span>{smartRouting.recommendation!.timeSavedMinutes > 0 && <span className="rounded-full bg-emerald-100/70 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Экономия ~{smartRouting.recommendation!.timeSavedMinutes} мин</span>}</div><div className="flex flex-wrap items-center gap-2 pt-0.5 sm:flex-nowrap"><button type="button" onClick={() => onTakeTicket(fastest.id)} className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#003B73] px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#002D5A]"><TicketIcon size={16} />Взять талон</button><button type="button" onClick={() => onOpenRoute(fastest, smartRouting.recommendation!.timeSavedMinutes)} className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50"><Navigation size={14} />Маршрут</button>{actions.includes('appointment') && <button type="button" onClick={() => onBook(fastest.id)} className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-50">Записаться онлайн</button>}</div></section>}
    {!hasRealGpsFix && simulationMode === 'real_gps' && (gpsPermissionStatus === 'denied' || gpsPermissionStatus === 'unavailable') && <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 shadow-2xs sm:flex-row sm:items-center"><div className="flex min-w-0 items-center gap-3"><MapPinOff size={16} className="shrink-0 text-slate-600" /><p className="text-xs font-bold text-slate-800">Включите геолокацию, чтобы подобрать ближайшее отделение</p></div><div className="flex w-full gap-2 sm:w-auto"><button type="button" onClick={onOpenMap} className="min-h-[38px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">Карта</button><button type="button" onClick={requestGpsPermission} className="min-h-[38px] flex-1 rounded-xl bg-[#003B73] px-3 text-xs font-bold text-white">Включить гео</button></div></div>}
  </>;
}
