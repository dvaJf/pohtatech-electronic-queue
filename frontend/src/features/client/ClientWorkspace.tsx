import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../../api/client/clientApi';
import { getMe } from '../../api/authApi';
import { Appointment, Branch, Service, Ticket, TicketStatus, TicketSource, QueuePosition, TicketETA } from '../../api/client/types';
import { CalendarClock, Ticket as TicketIcon, ListChecks, ChevronLeft, ChevronRight, MapPin, Clock, Check, Sparkles, Building2, AlertCircle, CheckCircle2, Navigation, X, Search, Zap, Star, Loader2, MapPinOff } from 'lucide-react';
import './client.css';
import './kiosk.css';
import { formatMoscowDateTime, parseMoscowDatetimeLocal, toMoscowDatetimeLocal } from '../../utils/time';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { BranchWorkloadCard } from './BranchWorkloadCard';
import { Appointment24hPicker } from './Appointment24hPicker';
import { useGeofencing, GeofenceSimulationMode, calculateHaversineDistanceMeters, DEFAULT_GEOFENCE_THRESHOLD_METERS } from './arrival';
import { NearbyBranchCard } from './arrival/NearbyBranchCard';
import { RouteOfferModal } from './RouteOfferModal';
import { BranchMapModal } from './map/BranchMapModal';
import { calculateBranchTotalTime, isUsableDurationMinutes, MAX_QUEUE_WAIT_MINUTES, MAX_ROUTE_TRAVEL_MINUTES, MOSCOW_BRANCHES, BranchLocation, RankedBranch } from './map/branchLocations';

import { calculatePersonalRouting, recommendationActions, matchBranchLocation, liveWaitMinutes } from './map/liveBranches';
import { useBranchWorkloads } from './map/useBranchWorkloads';
import { canShowNearbyBranchCard, updateNearbyVisits, dismissNearbyVisit, type NearbyVisitState } from './arrival/arrivalPolicy';
import { VisitRatingSheet } from './rating/VisitRatingSheet';
import { shouldOfferVisitRating } from './rating/visitRatingPolicy';
import { BRANCH_PAGE_SIZES, BranchPage, BranchPageSize, getLandmarkPresentation, paginateBranches } from './branchOptions';

const POLL_INTERVAL_MS = 2000;
const terminalStatuses = new Set<TicketStatus>(['COMPLETED', 'CANCELLED', 'NO_SHOW']);

const STORAGE_BRANCH_KEY = 'client_selected_branch_id';
const STORAGE_SERVICE_KEY = 'client_selected_service_id';
const STORAGE_TICKETS_KEY = 'client_active_ticket_ids';
const STORAGE_APPOINTMENTS_KEY = 'client.appointments';
const STORAGE_MGMT_TOKENS_KEY = 'client_management_tokens';
const STORAGE_VISIT_RATINGS_KEY = 'client_visit_ratings';
const STORAGE_PENDING_IDEMPOTENCY_KEY = 'client_pending_idempotency';
const ANON_SCOPE = 'anon';

type ClientScreen = 'home' | 'booking' | 'walkin' | 'my';

interface VisitRatingRecord {
  ticketId: string;
  rating: number;
  comment: string;
  branchId: string;
  submittedAt: string;
}

interface VisitRatingHistory {
  pending: Ticket[];
  reviewed: string[];
  dismissed: string[];
  ratings: VisitRatingRecord[];
}

function visitRatingKeyFor(scope: string): string { return `${STORAGE_VISIT_RATINGS_KEY}:${scope}`; }

function getVisitRatingHistory(scope: string): VisitRatingHistory {
  const empty: VisitRatingHistory = { pending: [], reviewed: [], dismissed: [], ratings: [] };
  try {
    const value = JSON.parse(localStorage.getItem(visitRatingKeyFor(scope)) || 'null');
    if (!value || typeof value !== 'object') return empty;
    return {
      pending: Array.isArray(value.pending) ? value.pending.filter((item: Ticket) => item?.status === 'COMPLETED' && typeof item.id === 'string') : [],
      reviewed: Array.isArray(value.reviewed) ? value.reviewed.filter((id: unknown): id is string => typeof id === 'string') : [],
      dismissed: Array.isArray(value.dismissed) ? value.dismissed.filter((id: unknown): id is string => typeof id === 'string') : [],
      ratings: Array.isArray(value.ratings) ? value.ratings : [],
    };
  } catch { return empty; }
}

function saveVisitRatingHistory(scope: string, history: VisitRatingHistory) {
  try { localStorage.setItem(visitRatingKeyFor(scope), JSON.stringify(history)); } catch { /* local feedback is optional */ }
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localDateTimeValue(date: Date): string {
  return toMoscowDatetimeLocal(date);
}

function statusMessage(status: TicketStatus, source?: TicketSource): string {
  switch (status) {
    case 'WAITING': return 'Вы в очереди';
    case 'CALLED': return 'Вас вызывают';
    case 'SERVING': return 'Идёт обслуживание';
    case 'COMPLETED': return 'Обслуживание завершено';
    case 'CANCELLED': return source === 'APPOINTMENT' ? 'Запись отменена' : 'Талон отменён';
    case 'NO_SHOW': return 'Вы не подошли к окну';
    case 'SCHEDULED': return 'Запись подтверждена';
    default: return 'Статус обновляется';
  }
}

function friendlyError(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    if (error.message.includes('NO_OPEN_WINDOW')) return 'Нет свободных или открытых окон для выбранной услуги';
    if (error.message.includes('INVALID_TIME')) return 'Выбранное время уже недоступно. Выберите другое время.';
    if (error.message.includes('PAST_TIME')) return 'Нельзя записаться на прошедшее время';
    return error.message;
  }
  return fallback;
}

function StatusBadge({ status, source }: { status: TicketStatus; source?: TicketSource }) {
  return <span className={`cx-badge cx-badge-${status.toLowerCase()}`}>{statusMessage(status, source)}</span>;
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="alert"
      className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm animate-fade-in"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
        <span className="cx-message-text">{message}</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-red-400 hover:text-red-700 p-1 rounded-lg hover:bg-red-100 transition-colors shrink-0 leading-none font-bold"
        aria-label="Закрыть ошибку"
      >
        ✕
      </button>
    </div>
  );
}

function NoticeBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm animate-fade-in"
    >
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-emerald-500 hover:text-emerald-800 p-1 rounded-lg hover:bg-emerald-100 transition-colors shrink-0 leading-none font-bold"
        aria-label="Закрыть уведомление"
      >
        ✕
      </button>
    </div>
  );
}

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="cx-steps" aria-label="Этапы оформления">
      {steps.map((label, index) => (
        <li
          key={label}
          className={`cx-step${index < current ? ' cx-step-done' : ''}${index === current ? ' cx-step-active' : ''}`}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="cx-step-dot">{index < current ? <Check size={13} strokeWidth={3} aria-hidden /> : index + 1}</span>
          <span className="cx-step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

interface BranchCardProps {
  branch: Branch;
  selected: boolean;
  onSelect: () => void;
  distanceMeters?: number;
  travelMinutes?: number;
  waitMinutes?: number;
  totalMinutes?: number;
  isFastest?: boolean;
  isClosest?: boolean;
  timeSavedMinutes?: number;
  location?: BranchLocation;
  rating?: number;
}

interface RecommendationListBranch {
  id: string;
  name: string;
  travelMinutes?: number;
  waitMinutes?: number;
  totalMinutes?: number;
}

function BranchRecommendation({
  nearestBranch,
  fastestBranch,
  savingMinutes,
}: {
  nearestBranch: RecommendationListBranch | null;
  fastestBranch: RecommendationListBranch | null;
  savingMinutes: number;
}) {
  if (!nearestBranch || !fastestBranch
      || !Number.isFinite(fastestBranch.travelMinutes)
      || !Number.isFinite(fastestBranch.waitMinutes)
      || !Number.isFinite(fastestBranch.totalMinutes)) return null;
  const isNearest = nearestBranch.id === fastestBranch.id;
  const total = Math.round(fastestBranch.totalMinutes!);
  const travel = Math.round(fastestBranch.travelMinutes!);
  const wait = Math.round(fastestBranch.waitMinutes!);
  const saving = Number.isFinite(savingMinutes) && savingMinutes > 0 ? Math.round(savingMinutes) : 0;

  return (
    <div className="p-3.5 bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs">
          <Sparkles size={16} />
        </div>
        <div className="text-left min-w-0">
          <div className="font-extrabold text-emerald-950 flex items-center gap-1.5 flex-wrap">
            <span>{isNearest ? 'Рекомендуем ближайшее к вам' : 'Рекомендуем быстрее всего'}: {fastestBranch.name} · ~{total} мин</span>
            {saving > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                Экономия ~{saving} мин относительно ближайшего
              </span>
            )}
          </div>
          <p className="text-[11px] text-emerald-800 mt-0.5">
            Суммарно ~{total} мин: {travel} мин дорога + {wait} мин очередь
          </p>
        </div>
      </div>
    </div>
  );
}

function BranchCard({
  branch,
  selected,
  onSelect,
  distanceMeters,
  travelMinutes,
  waitMinutes,
  totalMinutes,
  isFastest,
  isClosest,
  timeSavedMinutes,
  location,
  rating,
}: BranchCardProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoUrl = location?.photos?.[0];
  const landmark = getLandmarkPresentation(location);
  const distText = typeof distanceMeters === 'number'
    ? (distanceMeters < 1000 ? `${distanceMeters} м` : `${(distanceMeters / 1000).toFixed(1)} км`)
    : null;

  return (
    <button
      type="button"
      className={`cx-choice active:scale-[0.99] transition-all relative overflow-hidden ${
        selected ? ' cx-choice-selected' : ''
      } ${isFastest ? 'ring-2 ring-emerald-500/60 bg-emerald-50/20' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3 w-full min-w-0 text-left">
        {photoUrl && !photoFailed && (
          <img
            src={photoUrl}
            alt="Иллюстрация почтового отделения"
            loading="lazy"
            decoding="async"
            onError={() => setPhotoFailed(true)}
            className="w-20 h-16 sm:w-24 sm:h-20 rounded-xl object-cover shrink-0 bg-slate-100"
          />
        )}
        <div className="min-w-0 flex-1">
      {/* Бейджи статуса: Рекомендуем (минимальное общее время) или Ближайшее */}
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5 w-full">
        {isFastest && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs">
            <Zap size={11} className="fill-emerald-600 text-emerald-600" />
            <span>Рекомендуем: быстрее всего</span>
            {typeof totalMinutes === 'number' && <span className="opacity-80">· ~{totalMinutes} мин</span>}
          </span>
        )}
        {isFastest && typeof timeSavedMinutes === 'number' && timeSavedMinutes > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
            Экономия ~{timeSavedMinutes} мин vs ближайшего
          </span>
        )}
        {isClosest && !isFastest && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
            <Navigation size={10} />
            <span>Ближайшее к вам</span>
          </span>
        )}
        {rating && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
            <Star size={10} className="fill-amber-400 text-amber-400" />
            <span>{rating.toFixed(1)} · Яндекс Карты</span>
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 w-full">
        <div className="flex-1 min-w-0">
          <span className="cx-choice-title text-sm sm:text-base font-extrabold">{branch.name}</span>

          {/* Расстояние, время в пути и общее расчетное время T = T_travel + T_wait */}
          {(distText || typeof totalMinutes === 'number') && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 my-1 font-medium">
              {distText && (
                <span className="inline-flex items-center gap-1 text-[#052F85] font-bold">
                  <Navigation size={12} className="shrink-0" />
                  <span>{distText} ({travelMinutes ?? Math.round((distanceMeters! / 1000) * 12)} мин пешком)</span>
                </span>
              )}
              {typeof waitMinutes === 'number' && (
                <span className="text-slate-500">
                  Очередь: ~<strong>{waitMinutes} мин</strong>
                </span>
              )}
              {typeof totalMinutes === 'number' && (
                <span className="text-slate-700 font-semibold">
                  Дорога + очередь: <strong>~{totalMinutes} мин</strong>
                </span>
              )}
            </div>
          )}

          {landmark && (
            <span className="cx-choice-meta text-xs" data-landmark-type={landmark.isMetro ? 'metro' : 'landmark'} aria-label={landmark.isMetro ? `Метро ${landmark.label}` : landmark.label}>
              {landmark.isMetro ? (
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: landmark.color }} aria-hidden />
              ) : (
                <Navigation size={13} aria-hidden className="shrink-0 text-slate-400" />
              )}
              <span>{landmark.label}</span>
            </span>
          )}

          {branch.address ? (
            <span className="cx-choice-meta text-xs">
              <MapPin size={13} aria-hidden className="shrink-0 text-slate-400" />
              <span className="cx-message-text">{branch.address}</span>
            </span>
          ) : null}

          {branch.workHours ? (
            <span className="cx-choice-meta text-xs">
              <Clock size={13} aria-hidden className="shrink-0 text-slate-400" />
              <span>{branch.workHours}</span>
            </span>
          ) : null}
        </div>
        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-all mt-0.5 ${selected ? 'bg-[#003B73] border-[#003B73] text-white' : 'border-slate-300 bg-white'}`}>
          {selected && <Check size={12} strokeWidth={3} />}
        </div>
      </div>
        </div>
      </div>
      <div className="pt-1 w-full">
        <BranchWorkloadCard branch={branch} compact />
      </div>
    </button>
  );
}

function BranchListPageControls<T>({
  pageData,
  pageSize,
  onPageSizeChange,
  onPageChange,
}: {
  pageData: BranchPage<T>;
  pageSize: BranchPageSize;
  onPageSizeChange: (size: BranchPageSize) => void;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <label className="inline-flex items-center gap-2 font-semibold text-slate-600">
        <span>Показывать:</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value) as BranchPageSize)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-bold text-slate-800 focus:border-[#052F85] focus:outline-none focus:ring-2 focus:ring-[#052F85]/20"
          aria-label="Количество отделений на странице"
        >
          {BRANCH_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <span className="font-medium text-slate-500">{pageData.items.length} из {pageData.totalItems} отделений</span>
      {pageData.totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => onPageChange(pageData.page - 1)} disabled={pageData.page === 1}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 disabled:opacity-40" aria-label="Предыдущая страница">
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-14 text-center font-semibold text-slate-600">{pageData.page} / {pageData.totalPages}</span>
          <button type="button" onClick={() => onPageChange(pageData.page + 1)} disabled={pageData.page === pageData.totalPages}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 disabled:opacity-40" aria-label="Следующая страница">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ServiceCard({ service, selected, onSelect }: { service: Service; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`cx-choice active:scale-[0.99] transition-all${selected ? ' cx-choice-selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-3 w-full">
        <div className="flex-1 min-w-0">
          <span className="cx-choice-title text-sm sm:text-base">{service.name}</span>
          <span className="cx-choice-meta text-xs">Обслуживание в порядке электронной очереди</span>
        </div>
        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-all ${selected ? 'bg-[#003B73] border-[#003B73] text-white' : 'border-slate-300 bg-white'}`}>
          {selected && <Check size={12} strokeWidth={3} />}
        </div>
      </div>
    </button>
  );
}

function ticketsKeyFor(scope: string): string {
  return `${STORAGE_TICKETS_KEY}:${scope}`;
}

function appointmentsKeyFor(scope: string): string {
  return `${STORAGE_APPOINTMENTS_KEY}:${scope}`;
}

const STORAGE_TICKETS_CACHE_KEY = 'client_active_tickets_cache';

function ticketsCacheKeyFor(scope: string): string {
  return `${STORAGE_TICKETS_CACHE_KEY}:${scope}`;
}

function getCachedTickets(scope: string): Ticket[] {
  try {
    const val = sessionStorage.getItem(ticketsCacheKeyFor(scope)) || localStorage.getItem(ticketsCacheKeyFor(scope));
    if (!val) return [];
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is Ticket => t && typeof t.id === 'string' && !terminalStatuses.has(t.status));
  } catch {
    return [];
  }
}

function saveCachedTickets(scope: string, ticketList: Ticket[]) {
  try {
    const active = ticketList.filter(t => !terminalStatuses.has(t.status));
    const serialized = JSON.stringify(active);
    sessionStorage.setItem(ticketsCacheKeyFor(scope), serialized);
    localStorage.setItem(ticketsCacheKeyFor(scope), serialized);
  } catch {}
}

// Талоны храним строго по владельцу: ключ `client_active_ticket_ids:<userId|anon>`.
// Используем sessionStorage и localStorage для надёжного восстановления сессии
// после перезагрузки страницы, обрыва связи или закрытия вкладки (Требование 14 ТЗ).
function getSavedTicketIds(scope: string): string[] {
  try {
    const val = sessionStorage.getItem(ticketsKeyFor(scope)) || localStorage.getItem(ticketsKeyFor(scope));
    if (!val) return [];
    const parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function addSavedTicketId(id: string, scope: string) {
  const ids = getSavedTicketIds(scope);
  if (!ids.includes(id)) {
    const updated = JSON.stringify([...ids, id]);
    try { sessionStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
    try { localStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
  }
}

function removeSavedTicketId(id: string, scope: string) {
  const ids = getSavedTicketIds(scope);
  const newIds = ids.filter(i => i !== id);
  if (newIds.length === 0) {
    try { sessionStorage.removeItem(ticketsKeyFor(scope)); } catch {}
    try { localStorage.removeItem(ticketsKeyFor(scope)); } catch {}
  } else {
    const updated = JSON.stringify(newIds);
    try { sessionStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
    try { localStorage.setItem(ticketsKeyFor(scope), updated); } catch {}
  }
}

function mgmtTokensKeyFor(scope: string): string {
  return `${STORAGE_MGMT_TOKENS_KEY}:${scope}`;
}

function getSavedMgmtTokens(scope: string): Record<string, string> {
  try {
    const val = sessionStorage.getItem(mgmtTokensKeyFor(scope)) || localStorage.getItem(mgmtTokensKeyFor(scope));
    if (!val) return {};
    const parsed = JSON.parse(val);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function saveMgmtToken(id: string, token: string | undefined | null, scope: string) {
  if (!id || !token) return;
  const tokens = getSavedMgmtTokens(scope);
  tokens[id] = token;
  const updated = JSON.stringify(tokens);
  try { sessionStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
  try { localStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
}

function removeMgmtToken(id: string, scope: string) {
  const tokens = getSavedMgmtTokens(scope);
  if (!tokens[id]) return;
  delete tokens[id];
  const updated = JSON.stringify(tokens);
  try { sessionStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
  try { localStorage.setItem(mgmtTokensKeyFor(scope), updated); } catch {}
}

function getStoredIdempotencyKey(identity: string): string {
  try {
    const val = sessionStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY) || localStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
    if (val) {
      const parsed = JSON.parse(val);
      if (parsed && parsed.identity === identity && typeof parsed.key === 'string' && parsed.key.length > 0) {
        return parsed.key;
      }
    }
  } catch {}
  const key = makeIdempotencyKey();
  try {
    const data = JSON.stringify({ identity, key });
    sessionStorage.setItem(STORAGE_PENDING_IDEMPOTENCY_KEY, data);
    localStorage.setItem(STORAGE_PENDING_IDEMPOTENCY_KEY, data);
  } catch {}
  return key;
}

function clearStoredIdempotencyKey(identity?: string) {
  try {
    if (identity) {
      const val = sessionStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY) || localStorage.getItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
      if (val) {
        const parsed = JSON.parse(val);
        if (parsed?.identity !== identity) return;
      }
    }
    sessionStorage.removeItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
    localStorage.removeItem(STORAGE_PENDING_IDEMPOTENCY_KEY);
  } catch {}
}

try {
  sessionStorage.removeItem(STORAGE_TICKETS_KEY);
  sessionStorage.removeItem(STORAGE_APPOINTMENTS_KEY);
} catch {
  /* ignore legacy shared keys */
}

export function ClientWorkspace({ qrBranchId, kiosk = false, resetToken = 0 }: { qrBranchId?: string; kiosk?: boolean; resetToken?: number }) {
  const [screen, setScreen] = useState<ClientScreen>(qrBranchId ? 'walkin' : 'home');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const servicesLoadingBranchRef = useRef<string | null>(null);
  const [confirmedServicesByBranch, setConfirmedServicesByBranch] = useState<Record<string, Service[] | null>>({});
  const pendingServicesRef = useRef(new Map<string, Promise<Service[]>>());
  const loadConfirmedServices = useCallback((targetBranchId: string) => {
    const pending = pendingServicesRef.current.get(targetBranchId);
    if (pending) return pending;
    const request = api.listServices(targetBranchId).then(slist => {
      setConfirmedServicesByBranch(previous => ({ ...previous, [targetBranchId]: slist }));
      return slist;
    }, reason => {
      setConfirmedServicesByBranch(previous => ({ ...previous, [targetBranchId]: null }));
      throw reason;
    }).finally(() => { pendingServicesRef.current.delete(targetBranchId); });
    pendingServicesRef.current.set(targetBranchId, request);
    return request;
  }, []);

  const [branchId, setBranchId] = useState(() => {
    if (qrBranchId) return qrBranchId;
    const v = sessionStorage.getItem(STORAGE_BRANCH_KEY);
    return v && v !== 'undefined' && v !== 'null' ? v : '';
  });
  const [serviceId, setServiceId] = useState(() => {
    const urlServiceId = new URLSearchParams(window.location.search).get('serviceId');
    if (urlServiceId) return urlServiceId;
    const v = sessionStorage.getItem(STORAGE_SERVICE_KEY);
    return v && v !== 'undefined' && v !== 'null' ? v : '';
  });
  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [bookingStep, setBookingStep] = useState(0);
  const [walkinStep, setWalkinStep] = useState(qrBranchId ? 1 : 0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Владелец талонов. Талоны храним и показываем строго по текущему пользователю,
  // чтобы новый пользователь не видел талоны, созданные другим.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const ownerScope = currentUserId ?? ANON_SCOPE;
  const [tickets, setTickets] = useState<Ticket[]>(() => getCachedTickets(ANON_SCOPE));
  const [kioskTicket, setKioskTicket] = useState<Ticket | null>(null);

  // Держим актуальный scope доступным внутри колбэков без пересоздания pollAll.
  const ownerScopeRef = useRef(ownerScope);
  ownerScopeRef.current = ownerScope;
  const [appointments, setAppointments] = useState<Record<string, Appointment>>({});
  // Записи (appointments) тоже храним по владельцу, чтобы они не «переезжали» к другому пользователю.
  const appointmentsScopeRef = useRef<string | null>(null);
  useEffect(() => {
    appointmentsScopeRef.current = null;
    let loaded: Record<string, Appointment> = {};
    try { loaded = JSON.parse(sessionStorage.getItem(appointmentsKeyFor(ownerScope)) || localStorage.getItem(appointmentsKeyFor(ownerScope)) || '{}'); } catch { loaded = {}; }
    appointmentsScopeRef.current = ownerScope;
    setAppointments(loaded);
  }, [ownerScope]);
  useEffect(() => {
    if (appointmentsScopeRef.current !== ownerScope) return;
    try { sessionStorage.setItem(appointmentsKeyFor(ownerScope), JSON.stringify(appointments)); } catch { /* ignore */ }
    try { localStorage.setItem(appointmentsKeyFor(ownerScope), JSON.stringify(appointments)); } catch { /* ignore */ }
  }, [appointments, ownerScope]);

  useEffect(() => {
    const cached = getCachedTickets(ownerScope);
    if (cached.length > 0) {
      setTickets(prev => {
        if (prev.length === 0) return cached;
        const ids = new Set(prev.map(t => t.id));
        const added = cached.filter(t => !ids.has(t.id));
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    }
  }, [ownerScope]);

  useEffect(() => {
    saveCachedTickets(ownerScope, tickets);
  }, [tickets, ownerScope]);

  const [positions, setPositions] = useState<Record<string, QueuePosition>>({});
  const [etas, setEtas] = useState<Record<string, TicketETA>>({});
  const [pollError, setPollError] = useState<string | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [arrivalAcknowledgedTicketIds, setArrivalAcknowledgedTicketIds] = useState<Set<string>>(new Set());
  const [visitRatingQueue, setVisitRatingQueue] = useState<Ticket[]>(() => getVisitRatingHistory(ownerScope).pending);

  useEffect(() => {
    setVisitRatingQueue(getVisitRatingHistory(ownerScope).pending);
  }, [ownerScope]);

  const [creating, setCreating] = useState(false);
  const [cancellingTicketId, setCancellingTicketId] = useState<string | null>(null);
  const [arriving, setArriving] = useState(false);

  const workloads = useBranchWorkloads(branches.map(b => b.id));
  const locatedBranches = useMemo(() => {
    const list = branches.length > 0 ? branches : (MOSCOW_BRANCHES as unknown as Branch[]);
    return list.flatMap(b => {
      const loc = matchBranchLocation(b, MOSCOW_BRANCHES);
      if (!loc) return [];
      const workload = workloads[b.id];
      return [{ ...loc, ...b, address: b.address!, id: b.id,
        currentWaiting: workload?.currentWaiting,
        currentActiveWindows: workload?.activeWindows,
        serverWaitMinutes: liveWaitMinutes(workload) }];
    });
  }, [branches, workloads]);
  const routingBranches = useMemo(() => locatedBranches.flatMap(loc => {
    const workload = workloads[loc.id];
    const wait = liveWaitMinutes(workload);
    return wait === undefined ? [] : [{ ...loc, activeQueueCount: workload.currentWaiting,
      activeWindows: workload.activeWindows!, serverWaitMinutes: wait }];
  }), [locatedBranches, workloads]);
  // One location stream supplies recommendation, nearby visits and the map marker.
  const {
    currentCoordinates,
    simulationMode,
    setSimulationMode,
    hasRealGpsFix,
    hasReliableGpsFix,
    gpsPermissionStatus,
    requestGpsPermission,
    locationCenterRequest,
    gpsError,
  } = useGeofencing({
    branches: locatedBranches,
    initialMode: 'real_gps',
    thresholdMeters: DEFAULT_GEOFENCE_THRESHOLD_METERS, // 75m threshold
  });

  const [routeOfferBranch, setRouteOfferBranch] = useState<RankedBranch | null>(null);

  const [nearbyVisits, setNearbyVisits] = useState<NearbyVisitState>({ visits: {}, activeBranchId: null });
  const nearbyDistances = useMemo(() => locatedBranches.map(branch => ({
    id: branch.id,
    distanceMeters: calculateHaversineDistanceMeters(currentCoordinates.lat, currentCoordinates.lng, branch.lat, branch.lng),
  })), [locatedBranches, currentCoordinates.lat, currentCoordinates.lng]);
  useEffect(() => {
    setNearbyVisits(previous => updateNearbyVisits(previous, nearbyDistances, hasReliableGpsFix));
  }, [nearbyDistances, hasReliableGpsFix]);
  const nearbyBranch = hasReliableGpsFix ? locatedBranches.find(branch => branch.id === nearbyVisits.activeBranchId) ?? null : null;
  const nearbyDistanceMeters = nearbyDistances.find(branch => branch.id === nearbyBranch?.id)?.distanceMeters ?? 0;

  // Map Modal State
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [mapInitialFilter, setMapInitialFilter] = useState<'all' | 'parcels' | 'letters' | 'pensions' | 'accessible'>('all');
  const [mapTargetBranchId, setMapTargetBranchId] = useState<string | null>(null);

  // Check if client already took a ticket for this branch (walkin or online appointment)
  const hasActiveTicketForBranch = useMemo(() => {
    if (!nearbyBranch) return false;
    const targetBranchId = nearbyBranch.id;

    // 1. Проверяем в текущем состоянии tickets
    if (tickets.some(t => !terminalStatuses.has(t.status) && t.branchId === targetBranchId)) {
      return true;
    }

    // 2. Проверяем в синхронном кэше активных талонов (localStorage/sessionStorage)
    const cached = getCachedTickets(ownerScope);
    if (cached.some(t => !terminalStatuses.has(t.status) && t.branchId === targetBranchId)) {
      return true;
    }

    // 3. Проверяем в предварительных записях (appointments)
    if (Object.values(appointments).some(a => a.ticket && !terminalStatuses.has(a.ticket.status) && a.ticket.branchId === targetBranchId)) {
      return true;
    }

    return false;
  }, [tickets, nearbyBranch, ownerScope, appointments]);

  // Request GPS on mount and notify header
  useEffect(() => {
    const handleGeoRequest = () => requestGpsPermission();
    const handleGeoPreset = (e: Event) => {
      const custom = e as CustomEvent<{ mode: GeofenceSimulationMode }>;
      if (custom.detail?.mode) {
        handleSimulationModeChange(custom.detail.mode);
      }
    };
    window.addEventListener('pochta:request-geo', handleGeoRequest);
    window.addEventListener('pochta:geo-preset', handleGeoPreset);
    return () => {
      window.removeEventListener('pochta:request-geo', handleGeoRequest);
      window.removeEventListener('pochta:geo-preset', handleGeoPreset);
    };
  }, [requestGpsPermission]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('pochta:geo-status', {
        detail: { status: gpsPermissionStatus, granted: gpsPermissionStatus === 'granted' },
      })
    );
  }, [gpsPermissionStatus]);

  const handleSimulationModeChange = (mode: GeofenceSimulationMode) => {
    setSimulationMode(mode);
  };

  const handleOpenMap = (filter: 'all' | 'parcels' | 'letters' | 'pensions' | 'accessible' = 'all', targetBranchId: string | null = null) => {
    setMapInitialFilter(filter);
    setMapTargetBranchId(targetBranchId);
    setIsMapModalOpen(true);
  };

  const handleSelectBranchFromMap = (b: Branch, action?: 'walkin' | 'booking') => {
    handleBranchSelect(b.id);
    setIsMapModalOpen(false);
    if (action === 'booking') {
      setScreen('booking');
      setBookingStep(1);
    } else if (action === 'walkin') {
      setScreen('walkin');
      setWalkinStep(1);
    }
  };

  // Smart Routing Calculation based on current coordinates
  const smartRouting = useMemo(() => {
    return calculatePersonalRouting(currentCoordinates, routingBranches, hasReliableGpsFix, simulationMode);
  }, [currentCoordinates, routingBranches, hasReliableGpsFix, simulationMode]);

  useEffect(() => {
    if (resetToken > 0) {
      setScreen('walkin');
      setWalkinStep(qrBranchId ? 1 : 0);
      setKioskTicket(null);
      setServiceId('');
      sessionStorage.removeItem(STORAGE_SERVICE_KEY);
      setError(null);
      if (qrBranchId) void fetchServices(qrBranchId);
    }
    // Kiosk idle reset intentionally restores the first walk-in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  const pollTimer = useRef<number | null>(null);
  const pollGeneration = useRef(0);
  const createLock = useRef(false);
  const requestKey = useRef<{ identity: string; key: string } | null>(null);
  const keyFor = (identity: string) => {
    if (requestKey.current?.identity === identity) return requestKey.current.key;
    const stored = getStoredIdempotencyKey(identity);
    requestKey.current = { identity, key: stored };
    return stored;
  };

  useEffect(() => {
    let active = true;
    const refreshOwner = () => {
      getMe()
        .then((me) => { if (active) setCurrentUserId(me?.id ?? null); })
        .catch(() => { if (active) setCurrentUserId(null); });
    };
    refreshOwner();
    // Реагируем на вход/выход через шапку: «мои талоны» пересчитываются для нового владельца.
    const handleAuthChanged = () => refreshOwner();
    window.addEventListener('pochta:auth', handleAuthChanged);
    return () => {
      active = false;
      window.removeEventListener('pochta:auth', handleAuthChanged);
    };
  }, []);

  const arrivalStorageKey = (ticketId: string) => `client-arrived:${ticketId}`;
  const hasArrivalAcknowledgement = (ticketId: string): boolean => {
    try { return sessionStorage.getItem(arrivalStorageKey(ticketId)) === '1'; } catch { return false; }
  };
  const rememberArrival = (ticketId: string) => {
    try { sessionStorage.setItem(arrivalStorageKey(ticketId), '1'); } catch { /* ignore */ }
  };

  const loadBranches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const loaded = await api.listBranches();
      setBranches(loaded);
      setBranchId(current => current || loaded[0]?.id || '');
    } catch (err: any) {
      setError(friendlyError(err, 'Не удалось загрузить данные отделений'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  // Поиск и сортировка отделений по удаленности / минимальному общему времени T = дорога + очередь
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const [branchSortMode, setBranchSortMode] = useState<'distance' | 'fastest'>('distance');
  const [branchPageSize, setBranchPageSize] = useState<BranchPageSize>(5);
  const [branchPage, setBranchPage] = useState(1);

  const {
    enrichedBranches,
    fastestBranch,
    closestBranch,
    timeSavedMinutes,
  } = useMemo(() => {
    if (!branches || branches.length === 0) {
      return { enrichedBranches: [], fastestBranch: null, closestBranch: null, timeSavedMinutes: 0 };
    }

    const clientLat = currentCoordinates.lat;
    const clientLng = currentCoordinates.lng;

    const list = branches.map((b) => {
      const loc = matchBranchLocation(b, MOSCOW_BRANCHES);
      const hasPosition = hasReliableGpsFix && simulationMode === 'real_gps';
      const dMeters = loc && hasPosition ? calculateHaversineDistanceMeters(clientLat, clientLng, loc.lat, loc.lng) : undefined;
      const rawTravelMin = dMeters === undefined ? undefined : Math.round((dMeters / 1000) * 12);
      const travelMin = isUsableDurationMinutes(rawTravelMin, MAX_ROUTE_TRAVEL_MINUTES) ? rawTravelMin : undefined;
      const rawWaitMin = liveWaitMinutes(workloads[b.id]);
      const waitMin = isUsableDurationMinutes(rawWaitMin, MAX_QUEUE_WAIT_MINUTES) ? rawWaitMin : undefined;
      const totalMin = calculateBranchTotalTime(travelMin, waitMin);
      return { ...b, loc, distanceMeters: dMeters, travelMinutes: travelMin,
        waitMinutes: waitMin, totalMinutes: totalMin, metro: loc?.metro, rating: loc?.rating };
    });

    const sortedByDist = list.filter(b => b.distanceMeters !== undefined).sort((a, b) => a.distanceMeters! - b.distanceMeters!);
    const closest = sortedByDist[0] || null;

    const sortedByTotal = list.filter(b => b.totalMinutes !== undefined).sort((a, b) => a.totalMinutes! - b.totalMinutes!);
    const fastest = sortedByTotal[0] || null;

    const saved =
      closest && fastest && closest.totalMinutes !== undefined && fastest.totalMinutes !== undefined && closest.id !== fastest.id
        ? Math.max(0, closest.totalMinutes - fastest.totalMinutes)
        : 0;

    return {
      enrichedBranches: list,
      fastestBranch: fastest,
      closestBranch: closest,
      timeSavedMinutes: saved,
    };
  }, [branches, currentCoordinates, workloads, hasReliableGpsFix, simulationMode]);

  // Фильтрация по поиску и применение сортировки
  const displayBranches = useMemo(() => {
    let result = enrichedBranches;
    const q = branchSearchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          (b.address && b.address.toLowerCase().includes(q)) ||
          (b.metro && b.metro.toLowerCase().includes(q)) ||
          (b.loc?.code && b.loc.code.includes(q))
      );
    }

    if (branchSortMode === 'fastest') {
      return [...result].sort((a, b) => (a.totalMinutes ?? Infinity) - (b.totalMinutes ?? Infinity));
    } else {
      return [...result].sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
    }
  }, [enrichedBranches, branchSearchQuery, branchSortMode]);

  const branchPageData = useMemo(
    () => paginateBranches(displayBranches, branchPage, branchPageSize),
    [displayBranches, branchPage, branchPageSize]
  );

  useEffect(() => {
    setBranchPage(1);
  }, [branchSearchQuery, branchSortMode, branchPageSize, screen]);

  useEffect(() => {
    if (branchPage !== branchPageData.page) setBranchPage(branchPageData.page);
  }, [branchPage, branchPageData.page]);

  const fetchServices = useCallback(async (targetBranchId: string) => {
    if (!targetBranchId) {
      setServices([]);
      setServicesLoading(false);
      return;
    }
    servicesLoadingBranchRef.current = targetBranchId;
    setServicesLoading(true);
    try {
      const slist = await loadConfirmedServices(targetBranchId);
      if (servicesLoadingBranchRef.current === targetBranchId) {
        setServices(slist);
        const urlParams = new URLSearchParams(window.location.search);
        const urlServiceId = urlParams.get('serviceId');
        const urlServiceCode = urlParams.get('service');
        if (urlServiceId && slist.some(s => s.id === urlServiceId)) {
          setServiceId(urlServiceId);
        } else if (urlServiceCode) {
          const found = slist.find(s => s.code?.toUpperCase() === urlServiceCode.toUpperCase());
          if (found) setServiceId(found.id);
        }
      }
    } catch (err: any) {
      if (servicesLoadingBranchRef.current === targetBranchId) {
        // Fallback к стандартным услугам отделения при отсутствии отдельной бэкенд-записи
        const geoBranch = MOSCOW_BRANCHES.find(b => b.id === targetBranchId);
        if (geoBranch && geoBranch.services && geoBranch.services.length > 0) {
          const fallbackServices = geoBranch.services.map((s, idx) => ({
            id: s.id,
            branchId: targetBranchId,
            name: s.name,
            code: s.category.toUpperCase().slice(0, 3) || `SRV${idx + 1}`,
            description: s.name,
            avgServiceTimeMinutes: s.avgServiceMinutes || 5,
            slaMinutes: 15,
            windowMin: 1,
            windowMax: 4,
          }));
          setServices(fallbackServices as any);
          setError(null);
        } else {
          setError(friendlyError(err, 'Не удалось загрузить услуги'));
        }
      }
    } finally {
      if (servicesLoadingBranchRef.current === targetBranchId) {
        setServicesLoading(false);
      }
    }
  }, [kiosk, loadConfirmedServices]);

  useEffect(() => {
    if (!branchId) {
      setServices([]);
      return;
    }
    fetchServices(branchId);
  }, [branchId, fetchServices]);

  const recommendedBranchId = smartRouting.recommendation?.fastestBranch.id;
  useEffect(() => {
    if (kiosk || screen !== 'home' || !recommendedBranchId || recommendedBranchId === branchId
        || confirmedServicesByBranch[recommendedBranchId] !== undefined) return;
    void loadConfirmedServices(recommendedBranchId).catch(() => { /* Appointment stays hidden without confirmed services. */ });
  }, [kiosk, screen, recommendedBranchId, branchId, confirmedServicesByBranch, loadConfirmedServices]);

  useEffect(() => {
    if (branchId && ((screen === 'walkin' && walkinStep === 1) || (screen === 'booking' && bookingStep === 1))) {
      if (services.length === 0 && !servicesLoading && servicesLoadingBranchRef.current !== branchId) {
        fetchServices(branchId);
      }
    }
  }, [screen, walkinStep, bookingStep, branchId, services.length, servicesLoading, fetchServices]);

  useEffect(() => {
    if (kiosk) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (!action) return;

    window.history.replaceState({}, '', window.location.pathname);

    if (action === 'booking') {
      resetBooking();
      setScreen('booking');
    } else if (action === 'walkin') {
      resetWalkin();
      setScreen('walkin');
    } else if (action === 'my') {
      setScreen('my');
    }
  }, []);

  const stopPolling = useCallback(() => {
    pollGeneration.current += 1;
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const pollAll = useCallback(() => {
    const generation = pollGeneration.current;
    const scope = ownerScopeRef.current;
    const ids = getSavedTicketIds(scope);

    if (ids.length === 0) {
      setTicketsLoading(false);
      setPollError(null);
      setTickets([]);
      setAppointments({});
      setPositions({});
      setEtas({});
      return;
    }

    const fetchedTickets: Ticket[] = [];
    const fetchedPositions: Record<string, QueuePosition> = {};
    const fetchedEtas: Record<string, TicketETA> = {};
    const failedIds = new Set<string>();

    Promise.allSettled(ids.map(async id => {
      try {
        const nextTicket = await api.getTicket(id);
        if (generation !== pollGeneration.current) return;

        fetchedTickets.push(nextTicket);
        if (nextTicket.source === 'APPOINTMENT' && nextTicket.status === 'SCHEDULED') {
          setAppointments(prev => ({ ...prev, [id]: { ticket: nextTicket, scheduledAt: nextTicket.queueEnteredAt } }));
        }

        if (nextTicket.source === 'APPOINTMENT' && nextTicket.status === 'SCHEDULED') {
          if (hasArrivalAcknowledgement(nextTicket.id)) {
            setArrivalAcknowledgedTicketIds(prev => {
              const next = new Set(prev);
              next.add(nextTicket.id);
              return next;
            });
          }
        }

        if (!terminalStatuses.has(nextTicket.status)) {
          const etaRequest = api.getTicketETA(nextTicket.id).then(eta => {
            if (generation === pollGeneration.current && eta.ticketId === id) fetchedEtas[id] = eta;
          }).catch(() => {});
          try {
            const pos = await api.getQueuePosition(nextTicket.id);
            if (generation !== pollGeneration.current) return;
            fetchedPositions[id] = pos;
          } catch {}
          await etaRequest;
        } else {
          if (nextTicket.status === 'COMPLETED') {
            const history = getVisitRatingHistory(scope);
            if (shouldOfferVisitRating(nextTicket.status, nextTicket.id, history.reviewed, history.dismissed)
                && !history.pending.some(item => item.id === nextTicket.id)) {
              history.pending = [...history.pending, nextTicket];
              saveVisitRatingHistory(scope, history);
              setVisitRatingQueue(history.pending);
            }
          }
          removeSavedTicketId(id, scope);
        }
      } catch (err: any) {
        if (generation !== pollGeneration.current) return;
        if (err.status === 404 || err.message === 'NOT_FOUND') {
          removeSavedTicketId(id, scope);
        } else failedIds.add(id);
      }
    })).then(() => {
      if (generation !== pollGeneration.current) return;
      setTickets(prev => [...fetchedTickets, ...prev.filter(t => failedIds.has(t.id))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setPositions(fetchedPositions);
      setEtas(fetchedEtas);
      setPollError(failedIds.size ? 'Не удалось обновить часть талонов. Повторяем подключение…' : null);
    }).catch(reason => {
      if (generation !== pollGeneration.current) return;
      setPollError(friendlyError(reason, 'Не удалось обновить талоны'));
    }).finally(() => {
      if (generation === pollGeneration.current) setTicketsLoading(false);
      if (generation === pollGeneration.current && getSavedTicketIds(scope).length > 0) {
        pollTimer.current = window.setTimeout(pollAll, POLL_INTERVAL_MS);
      }
    });
  }, []);

  useEffect(() => {
    if (screen === 'my') {
      stopPolling();
      setTicketsLoading(true);
      pollAll();
    }
    return () => {
      stopPolling();
    };
  }, [screen, pollAll, stopPolling]);

  // При смене пользователя (вход/выход/регистрация) перезагружаем талоны
  // строго для нового владельца, чтобы чужие талоны не оставались на экране.
  useEffect(() => {
    setTickets([]);
    setPositions({});
    setEtas({});
    stopPolling();
    pollAll();
  }, [ownerScope, pollAll, stopPolling]);

  const resetBooking = () => {
    setBookingStep(0);
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    setScheduledAtInput('');
    setError(null);
  };

  const resetWalkin = () => {
    setWalkinStep(qrBranchId ? 1 : 0);
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    setError(null);
    if (qrBranchId) {
      fetchServices(qrBranchId);
    }
  };

  const createQrTicket = async () => {
    if (createLock.current || !branches.some(b => b.id === branchId) || !services.some(s => s.id === serviceId)) return;
    createLock.current = true;
    setCreating(true);
    setError(null);
    const identity = `qr:${branchId}:${serviceId}`;
    try {
      const created = await api.createQrTicket(branchId, serviceId, keyFor(identity));
      clearStoredIdempotencyKey(identity);
      requestKey.current = null;
      if (created.managementToken) {
        saveMgmtToken(created.id, created.managementToken, ownerScope);
      }
      if (kiosk) {
        setKioskTicket(created);
      } else {
        addSavedTicketId(created.id, ownerScope);
        setTickets(prev => [created, ...prev]);
        setScreen('my');
      }
    } catch (reason: unknown) {
      setError(friendlyError(reason, 'Не удалось получить талон'));
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };

  const createAppointmentData = async () => {
    if (!branchId || !serviceId || !scheduledAtInput) return;
    if (createLock.current) return;
    let scheduledAt: Date;
    try { scheduledAt = new Date(parseMoscowDatetimeLocal(scheduledAtInput)); }
    catch { setError('Укажите корректное московское время'); return; }
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setError('Выберите будущее время записи');
      return;
    }
    createLock.current = true;
    setCreating(true);
    setError(null);
    const identity = `appointment:${branchId}:${serviceId}:${scheduledAt.toISOString()}`;
    try {
      const created = await api.createAppointment(
        branchId,
        serviceId,
        scheduledAt.toISOString(),
        keyFor(identity)
      );
      clearStoredIdempotencyKey(identity);
      requestKey.current = null;

      const finalTicket = created.ticket;
      const mgmtToken = created.managementToken || finalTicket.managementToken;
      if (mgmtToken) {
        saveMgmtToken(finalTicket.id, mgmtToken, ownerScope);
      }

      addSavedTicketId(finalTicket.id, ownerScope);
      setTickets(prev => [finalTicket, ...prev]);
      setAppointments(prev => ({ ...prev, [finalTicket.id]: created }));
      setScreen('my');
    } catch (reason: unknown) {
      setError(friendlyError(reason, 'Не удалось создать запись'));
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };

  const cancel = async (ticket: Ticket) => {
    if (cancellingTicketId || (ticket.status !== 'SCHEDULED' && ticket.status !== 'WAITING')) return;
    const isAppointment = ticket.source === 'APPOINTMENT' && ticket.status === 'SCHEDULED';
    const confirmMessage = isAppointment
      ? 'Вы уверены, что хотите отменить предварительную запись?'
      : 'Вы уверены, что хотите отказаться от талона и покинуть очередь?';
    if (!window.confirm(confirmMessage)) return;

    setCancellingTicketId(ticket.id);
    try {
      let cancelledTicket: Ticket;
      const tokens = getSavedMgmtTokens(ownerScope);
      const mgmtToken = tokens[ticket.id] || ticket.managementToken || undefined;
      if (isAppointment) {
        const res = await api.cancelAppointment(ticket.id, mgmtToken);
        cancelledTicket = res.ticket;
      } else {
        cancelledTicket = await api.cancelTicket(ticket.id, mgmtToken);
      }
      removeSavedTicketId(ticket.id, ownerScope);
      removeMgmtToken(ticket.id, ownerScope);
      setTickets(prev => prev.map(t => t.id === ticket.id ? cancelledTicket : t));
      setPositions(prev => { const next = { ...prev }; delete next[ticket.id]; return next; });
      setEtas(prev => { const next = { ...prev }; delete next[ticket.id]; return next; });
      stopPolling();
      pollAll();
    } catch (reason: unknown) {
      setError(friendlyError(reason, isAppointment ? 'Не удалось отменить запись' : 'Не удалось отказаться от талона'));
    } finally {
      setCancellingTicketId(null);
    }
  };

  const arrive = async (ticket: Ticket) => {
    if (arriving || ticket.status !== 'SCHEDULED') return;
    setArriving(true);
    try {
      const arrived = await api.arriveAppointment(ticket.id);
      setArrivalAcknowledgedTicketIds(prev => {
        const next = new Set(prev);
        next.add(arrived.ticket.id);
        return next;
      });
      rememberArrival(arrived.ticket.id);
      stopPolling();
      pollAll();
    } catch (reason: unknown) {
      setError(friendlyError(reason, 'Не удалось подтвердить прибытие. Попробуйте ещё раз.'));
    } finally {
      setArriving(false);
    }
  };

  const handleBranchSelect = (id: string) => {
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    sessionStorage.setItem(STORAGE_BRANCH_KEY, id);
    if (screen === 'booking') setBookingStep(1);
    if (screen === 'walkin') setWalkinStep(1);

    if (id !== branchId) {
      setServices([]);
      setBranchId(id);
    }
  };

  const handleRepeatTicket = (targetBranchId: string) => {
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    sessionStorage.setItem(STORAGE_BRANCH_KEY, targetBranchId);
    setWalkinStep(1);
    setScreen('walkin');

    if (targetBranchId !== branchId) {
      setServices([]);
      setBranchId(targetBranchId);
    }
  };

  const handleServiceSelect = (id: string) => {
    setServiceId(id);
    sessionStorage.setItem(STORAGE_SERVICE_KEY, id);
    if (screen === 'booking') setBookingStep(2);
  };

  const resetKioskScreen = () => {
    if (!kiosk) return;
    if (kioskTicket) removeSavedTicketId(kioskTicket.id, ownerScope);
    setKioskTicket(null);
    setTickets([]);
    setServiceId('');
    sessionStorage.removeItem(STORAGE_SERVICE_KEY);
    setError(null);
    setScreen('walkin');
    setWalkinStep(1);
    if (qrBranchId) void fetchServices(qrBranchId);
  };

  useEffect(() => {
    if (!kiosk || !kioskTicket) return;
    const timer = window.setTimeout(resetKioskScreen, 30000);
    return () => window.clearTimeout(timer);
  }, [kiosk, kioskTicket]);

  const finishVisitRating = (kind: 'reviewed' | 'dismissed', rating?: number, comment = '') => {
    const ticket = visitRatingQueue[0];
    if (!ticket) return;
    const history = getVisitRatingHistory(ownerScope);
    history.pending = history.pending.filter(item => item.id !== ticket.id);
    if (kind === 'reviewed' && typeof rating === 'number') {
      if (!history.reviewed.includes(ticket.id)) history.reviewed.push(ticket.id);
      history.ratings.push({ ticketId: ticket.id, rating, comment, branchId: ticket.branchId, submittedAt: new Date().toISOString() });
    } else if (!history.dismissed.includes(ticket.id)) history.dismissed.push(ticket.id);
    saveVisitRatingHistory(ownerScope, history);
    setVisitRatingQueue(history.pending);
  };

  const savedCount = tickets.length > 0
    ? tickets.filter(t => !terminalStatuses.has(t.status)).length
    : getSavedTicketIds(ownerScope).length;

  const renderHome = () => {
    const rec = smartRouting.recommendation;
    const fastest = rec?.fastestBranch;
    const totalMin = fastest ? Math.round(fastest.totalMinutes) : 0;
    const travelMin = fastest ? Math.round(fastest.travelMinutes || 0) : 0;
    const waitMin = fastest ? Math.round(fastest.waitMinutes || 0) : 0;
    const actions = fastest ? recommendationActions(fastest.id, confirmedServicesByBranch) : [];

    return (
      <div className="max-w-5xl xl:max-w-6xl mx-auto space-y-3.5 sm:space-y-5 pb-6">
        {/* Accessible screen-reader heading (visual title is already present in header) */}
        <h1 className="sr-only">Цифровая очередь</h1>

        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
        {notice && <NoticeBanner message={notice} onClose={() => setNotice(null)} />}

        {/* Состояние поиска геолокации (Skeleton) */}
        {!hasReliableGpsFix && gpsPermissionStatus !== 'denied' && gpsPermissionStatus !== 'unavailable' && (
          <div className="rounded-2xl border border-blue-200/80 bg-blue-50/70 p-3.5 sm:p-4 animate-pulse flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-200 flex items-center justify-center text-blue-700 shrink-0">
                <Loader2 size={16} className="animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-blue-900">Определяем ваше местоположение…</p>
                <p className="text-xs text-blue-700 mt-0.5">Подберём ближайшее отделение после GPS fix.</p>
              </div>
            </div>
            <span className="text-[11px] font-mono font-bold text-blue-700 shrink-0 bg-blue-100/80 px-2.5 py-1 rounded-full border border-blue-200">
              Поиск гео…
            </span>
          </div>
        )}

        {/* Умный маршрут: Высокоинформативная карточка с чётким KUDO, SKOLKO, CHTO DELAT */}
        {rec && fastest && (
          <div role="region" aria-label="Рекомендация отделения" className="bg-gradient-to-br from-emerald-50/80 via-teal-50/40 to-white rounded-2xl border border-emerald-200/80 p-4 sm:p-5 shadow-xs space-y-3.5">
            {/* Top Row: Badge + Branch + Big Time */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider uppercase bg-emerald-100 text-emerald-800 mb-1.5 border border-emerald-200/60">
                  <Sparkles size={11} className="text-emerald-700" />
                  <span>Умный маршрут</span>
                </div>
                <h2 className="text-base sm:text-lg font-black text-[#031E56] leading-snug">
                  {fastest.name}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 mb-0 truncate">
                  {fastest.address}
                </p>
              </div>

              {/* Big Time Stat */}
              <div className="text-right shrink-0 bg-white/90 border border-emerald-200/80 rounded-2xl px-3 py-2 shadow-2xs">
                <div className="text-2xl sm:text-3xl font-black text-[#031E56] leading-none tabular-nums">
                  ≈{totalMin} мин
                </div>
                <div className="text-[10px] font-bold text-slate-500 mt-0.5 uppercase tracking-wider">
                  всего
                </div>
              </div>
            </div>

            {/* Sub-breakdown Row */}
            <div className="flex items-center justify-between text-xs text-slate-600 gap-2 flex-wrap bg-white/70 px-3 py-1.5 rounded-xl border border-emerald-100/80">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-800">{travelMin} мин дорога</span>
                <span className="text-slate-400">·</span>
                <span className="font-semibold text-emerald-700">{waitMin} мин очередь</span>
              </div>
              {rec.timeSavedMinutes > 0 && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                  Экономия ~{rec.timeSavedMinutes} мин
                </span>
              )}
            </div>

            {/* Appointment is offered only after this branch's enabled services are confirmed. */}
            <div className="flex items-center gap-2 pt-0.5 flex-wrap sm:flex-nowrap">
              <button
                type="button"
                onClick={() => handleRepeatTicket(fastest.id)}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#003B73] hover:bg-[#002D5A] active:scale-[0.98] text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <TicketIcon size={16} />
                <span>Взять талон</span>
              </button>
              <button
                type="button"
                onClick={() => setRouteOfferBranch(fastest)}
                className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 active:scale-[0.98] text-slate-700 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Navigation size={14} className="text-slate-500" />
                <span>Маршрут</span>
              </button>
              {actions.includes('appointment') && <button
                type="button"
                onClick={() => { handleBranchSelect(fastest.id); setScreen('booking'); setBookingStep(1); }}
                className="min-h-[44px] px-3.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 active:scale-[0.98] text-slate-600 hover:text-slate-900 font-semibold text-xs transition-all cursor-pointer shadow-2xs"
              >
                Записаться онлайн
              </button>}
            </div>
          </div>
        )}

        {/* Calm notice when geolocation is explicitly denied or unavailable */}
        {!hasRealGpsFix && simulationMode === 'real_gps' && (gpsPermissionStatus === 'denied' || gpsPermissionStatus === 'unavailable') && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:p-4 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                <MapPinOff size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-800">
                  Включите геолокацию, чтобы подобрать ближайшее отделение
                </p>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  Показаны отделения Москвы. Выберите ближайшее на карте или включите геопозицию.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                type="button"
                onClick={() => handleOpenMap()}
                className="flex-1 sm:flex-none min-h-[38px] px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 active:scale-95 text-slate-700 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MapPin size={13} />
                <span>Карта</span>
              </button>
              <button
                type="button"
                onClick={() => requestGpsPermission()}
                className="flex-1 sm:flex-none min-h-[38px] px-3 py-1.5 rounded-xl bg-[#003B73] hover:bg-[#002B55] active:scale-95 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Navigation size={13} />
                <span>Включить гео</span>
              </button>
            </div>
          </div>
        )}

        {routeOfferBranch && (
          <RouteOfferModal
            branch={routeOfferBranch}
            origin={hasRealGpsFix ? currentCoordinates : undefined}
            timeSavedMinutes={rec?.fastestBranch.id === routeOfferBranch.id ? rec.timeSavedMinutes : 0}
            onClose={() => setRouteOfferBranch(null)}
            onTakeTicket={handleRepeatTicket}
            onOpenMap={(id) => handleOpenMap('all', id)}
          />
        )}

        {/* 4 Action Cards - Mobile-First Layout & Prominent Hierarchy */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Взять талон (Главный сценарий) */}
          <button
            type="button"
            onClick={() => { resetWalkin(); setScreen('walkin'); }}
            className="col-span-2 sm:col-span-1 p-4 sm:p-5 min-h-[76px] sm:min-h-[175px] rounded-2xl bg-gradient-to-br from-[#003B73] via-[#00478F] to-[#054FA6] text-white shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left group flex flex-row sm:flex-col items-center sm:items-start justify-between cursor-pointer"
          >
            <div className="flex items-center sm:block min-w-0 flex-1">
              <div className="relative w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center mr-3 sm:mr-0 sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/20 absolute" />
                <TicketIcon size={20} className="relative z-10 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5 sm:mb-1 flex-wrap">
                  <h3 className="text-base sm:text-lg font-black text-white group-hover:text-blue-100 transition-colors">
                    Взять талон
                  </h3>
                  <span className="text-[9px] sm:text-[10px] font-mono font-bold bg-[#FFE600] text-black px-1.5 py-0.5 rounded-full uppercase tracking-wider shadow-2xs">
                    Сейчас
                  </span>
                </div>
                <p className="text-xs text-blue-100 leading-relaxed">
                  Получите электронный номерок прямо сейчас
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-white/70 group-hover:text-white shrink-0 sm:hidden transition-transform group-hover:translate-x-0.5 ml-2" />
          </button>

          {/* 2. Записаться онлайн (Secondary 1) */}
          <button
            type="button"
            onClick={() => { resetBooking(); setScreen('booking'); }}
            className="col-span-1 p-3.5 sm:p-5 min-h-[105px] sm:min-h-[175px] rounded-2xl bg-slate-50/80 hover:bg-white hover:shadow-sm active:scale-[0.98] transition-all text-left group flex flex-col justify-between cursor-pointer"
          >
            <div className="relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-100/70 absolute" />
              <CalendarClock size={19} className="relative z-10 text-[#003B73]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-base font-black text-slate-900 group-hover:text-[#003B73] transition-colors mb-0.5 leading-snug">
                Записаться онлайн
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 leading-snug">
                К точному времени визита
              </p>
            </div>
          </button>

          {/* 3. Карта отделений (Secondary 2) */}
          <button
            type="button"
            onClick={() => handleOpenMap()}
            className="col-span-1 p-3.5 sm:p-5 min-h-[105px] sm:min-h-[175px] rounded-2xl bg-slate-50/80 hover:bg-white hover:shadow-sm active:scale-[0.98] transition-all text-left group flex flex-col justify-between cursor-pointer"
          >
            <div className="relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-100/70 absolute" />
              <MapPin size={19} className="relative z-10 text-[#003B73]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-base font-black text-slate-900 group-hover:text-[#003B73] transition-colors mb-0.5 leading-snug">
                Карта отделений
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 leading-snug">
                26 отделений и маршруты
              </p>
            </div>
          </button>

          {/* 4. Мои талоны (Full width compact row on mobile) */}
          <button
            type="button"
            onClick={() => setScreen('my')}
            className="col-span-2 sm:col-span-1 p-3.5 sm:p-5 min-h-[56px] sm:min-h-[175px] rounded-2xl bg-slate-50/80 hover:bg-white hover:shadow-sm active:scale-[0.98] transition-all text-left group flex flex-row sm:flex-col items-center sm:items-start justify-between relative cursor-pointer"
          >
            <div className="flex items-center sm:block min-w-0 flex-1">
              <div className="relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center mr-2.5 sm:mr-0 sm:mb-3 group-hover:scale-105 transition-transform shrink-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-100/70 absolute" />
                <ListChecks size={19} className="relative z-10 text-emerald-700" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs sm:text-base font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                    Мои талоны
                  </h3>
                  {savedCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      {savedCount}
                    </span>
                  )}
                </div>
                <p className="hidden sm:block text-xs text-slate-500 leading-relaxed mt-1">
                  Текущие очереди и статус вызова к окну
                </p>
              </div>
            </div>
            {savedCount > 0 && (
              <span className="hidden sm:inline absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                {savedCount} активных
              </span>
            )}
            <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600 shrink-0 sm:hidden transition-transform group-hover:translate-x-0.5 ml-2" />
          </button>
        </div>
      </div>
    );
  };

  const renderBooking = () => {
    const steps = ['Отделение', 'Услуга', 'Время'];

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="flex items-center justify-between pb-1">
          <button
            type="button"
            className="cx-back-btn"
            onClick={() => (bookingStep === 0 ? setScreen('home') : setBookingStep(b => b - 1))}
          >
            <ChevronLeft size={18} />
            <span>Назад</span>
          </button>
          <h2 className="text-lg font-black text-slate-900">Онлайн-запись</h2>
          <div className="w-12" />
        </header>

        <div className="space-y-4">
          <StepIndicator steps={steps} current={bookingStep} />
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

          {bookingStep === 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Выберите отделение</h3>
                <button
                  type="button"
                  onClick={() => handleOpenMap()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[#052F85] text-xs font-bold hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <MapPin size={14} />
                  <span>На карте</span>
                </button>
              </div>

              {/* Поиск отделения */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={branchSearchQuery}
                  onChange={(e) => setBranchSearchQuery(e.target.value)}
                  placeholder="Поиск по названию, адресу, метро или индексу..."
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full pl-11 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#052F85]/20 focus:border-[#052F85]"
                />
                {branchSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setBranchSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    aria-label="Очистить поиск"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Переключатель сортировки */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                  <button
                    type="button"
                    onClick={() => setBranchSortMode('distance')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      branchSortMode === 'distance'
                        ? 'bg-[#052F85] text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <Navigation size={12} />
                    <span>По удалённости</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranchSortMode('fastest')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      branchSortMode === 'fastest'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <Zap size={12} />
                    <span>Быстрее всего (дорога + очередь)</span>
                  </button>
                </div>
              </div>
              <BranchListPageControls
                pageData={branchPageData}
                pageSize={branchPageSize}
                onPageSizeChange={setBranchPageSize}
                onPageChange={setBranchPage}
              />

              <BranchRecommendation nearestBranch={closestBranch} fastestBranch={fastestBranch}
                savingMinutes={timeSavedMinutes} />

              {loading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка отделений...</p>
              ) : branchPageData.items.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <p>Отделения не найдены по вашему запросу</p>
                  <button type="button" onClick={() => setBranchSearchQuery('')} className="cx-link-button mt-2 text-xs font-semibold text-[#003B73] underline cursor-pointer">Сбросить поиск</button>
                </div>
              ) : (
                branchPageData.items.map((b) => (
                  <BranchCard
                    key={b.id}
                    branch={b}
                    selected={branchId === b.id}
                    onSelect={() => handleBranchSelect(b.id)}
                    distanceMeters={b.distanceMeters}
                    travelMinutes={b.travelMinutes}
                    waitMinutes={b.waitMinutes}
                    totalMinutes={b.totalMinutes}
                    isFastest={fastestBranch?.id === b.id}
                    isClosest={closestBranch?.id === b.id}
                    timeSavedMinutes={timeSavedMinutes}
                    location={b.loc}
                    rating={b.rating}
                  />
                ))
              )}
            </div>
          )}

          {bookingStep === 1 && (
            <div className="space-y-3">
              <p className="cx-selection-summary">
                <Building2 size={18} aria-hidden />
                {branches.find(b => b.id === branchId)?.name || 'Выбранное отделение'}
              </p>
              <h3 className="text-sm font-bold text-slate-800">Выберите услугу</h3>
              {servicesLoading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка услуг...</p>
              ) : services.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-xs text-slate-500">В этом отделении пока нет доступных услуг</p>
                  {branchId && (
                    <button
                      type="button"
                      onClick={() => fetchServices(branchId)}
                      className="text-xs text-[#054FA6] hover:underline font-medium"
                    >
                      Повторить загрузку
                    </button>
                  )}
                </div>
              ) : (
                services.map(s => (
                  <ServiceCard key={s.id} service={s} selected={serviceId === s.id} onSelect={() => handleServiceSelect(s.id)} />
                ))
              )}
            </div>
          )}

          {bookingStep === 2 && (
            <div className="space-y-4">
              <div className="cx-selection-summary">
                <Building2 size={18} aria-hidden />
                <div>
                  <strong>{branches.find(b => b.id === branchId)?.name}</strong>
                  <p>{services.find(s => s.id === serviceId)?.name}</p>
                  <p>Дата и время указаны по Москве (МСК)</p>
                </div>
              </div>
              <BranchWorkloadCard branch={branches.find(b => b.id === branchId)} />
              <div className="p-4 sm:p-6 rounded-3xl bg-white border border-[#D2D8E2] shadow-sm space-y-4 max-w-full min-w-0 overflow-hidden">
              <Appointment24hPicker
                value={scheduledAtInput}
                onChange={setScheduledAtInput}
                disabled={creating}
                workHours={branches.find(b => b.id === branchId)?.workHours}
              />
              <div className="p-3.5 rounded-2xl bg-blue-50/80 border border-blue-200/80 text-xs text-[#003B73] flex items-start gap-2.5">
                <span className="text-base leading-none shrink-0 mt-0.5">🔔</span>
                <div className="space-y-0.5">
                  <strong className="block text-[#003B73] font-bold">СМС-напоминание за 30 минут</strong>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    Клиентам с подтвержденным номером в личном кабинете автоматически поступает бесплатное СМС о записи.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="w-full min-h-[48px] py-3 bg-[#003B73] hover:bg-[#054FA6] active:bg-[#00274D] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
                disabled={creating || !scheduledAtInput}
                onClick={createAppointmentData}
              >
                {creating ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    <span>Оформляем...</span>
                  </>
                ) : (
                  <span>Подтвердить запись</span>
                )}
              </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderWalkin = () => {
    const steps = ['Отделение', 'Услуга'];

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="flex items-center justify-between pb-1">
          {!kiosk ? (
            <button
              type="button"
              className="cx-back-btn"
              onClick={() => (walkinStep === 0 ? setScreen('home') : setWalkinStep(w => w - 1))}
            >
              <ChevronLeft size={18} />
              <span>Назад</span>
            </button>
          ) : <div className="w-12" />}
          <h2 className="text-lg font-black text-slate-900">Взять талон</h2>
          {!kiosk && getSavedTicketIds(ownerScope).length > 0 ? (
            <button
              type="button"
              onClick={() => setScreen('my')}
              className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[#054FA6] text-xs font-bold hover:bg-blue-100 transition-colors"
            >
              Мои талоны
            </button>
          ) : (
            <div className="w-12" />
          )}
        </header>

        <div className="space-y-4">
          <StepIndicator steps={steps} current={walkinStep} />
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
          {notice && <NoticeBanner message={notice} onClose={() => setNotice(null)} />}

          {walkinStep === 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Выберите отделение</h3>
                <button
                  type="button"
                  onClick={() => handleOpenMap()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[#052F85] text-xs font-bold hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <MapPin size={14} />
                  <span>На карте</span>
                </button>
              </div>

              {/* Поиск отделения */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={branchSearchQuery}
                  onChange={(e) => setBranchSearchQuery(e.target.value)}
                  placeholder="Поиск по названию, адресу, метро или индексу..."
                  style={{ paddingLeft: '2.75rem' }}
                  className="w-full pl-11 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#052F85]/20 focus:border-[#052F85]"
                />
                {branchSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setBranchSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    aria-label="Очистить поиск"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Переключатель сортировки */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                  <button
                    type="button"
                    onClick={() => setBranchSortMode('distance')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      branchSortMode === 'distance'
                        ? 'bg-[#052F85] text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <Navigation size={12} />
                    <span>По удалённости</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranchSortMode('fastest')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      branchSortMode === 'fastest'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    <Zap size={12} />
                    <span>Быстрее всего (дорога + очередь)</span>
                  </button>
                </div>
              </div>
              <BranchListPageControls
                pageData={branchPageData}
                pageSize={branchPageSize}
                onPageSizeChange={setBranchPageSize}
                onPageChange={setBranchPage}
              />

              <BranchRecommendation nearestBranch={closestBranch} fastestBranch={fastestBranch}
                savingMinutes={timeSavedMinutes} />

              {loading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка отделений...</p>
              ) : branchPageData.items.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <p>Отделения не найдены по вашему запросу</p>
                  <button type="button" onClick={() => setBranchSearchQuery('')} className="cx-link-button mt-2 text-xs font-semibold text-[#003B73] underline cursor-pointer">Сбросить поиск</button>
                </div>
              ) : (
                branchPageData.items.map((b) => (
                  <BranchCard
                    key={b.id}
                    branch={b}
                    selected={branchId === b.id}
                    onSelect={() => handleBranchSelect(b.id)}
                    distanceMeters={b.distanceMeters}
                    travelMinutes={b.travelMinutes}
                    waitMinutes={b.waitMinutes}
                    totalMinutes={b.totalMinutes}
                    isFastest={fastestBranch?.id === b.id}
                    isClosest={closestBranch?.id === b.id}
                    timeSavedMinutes={timeSavedMinutes}
                    location={b.loc}
                    rating={b.rating}
                  />
                ))
              )}
            </div>
          )}

          {walkinStep === 1 && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#003B73]" />
                <span>Отделение: <strong>{branches.find(b => b.id === branchId)?.name}</strong></span>
              </div>

              {!kiosk && <BranchWorkloadCard branch={branches.find(b => b.id === branchId)} />}

              <h3 className="text-sm font-bold text-slate-800">Выберите услугу</h3>
              {servicesLoading ? (
                <p className="text-xs text-slate-400 font-mono py-8 text-center animate-pulse">Загрузка услуг...</p>
              ) : services.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-xs text-slate-500">В этом отделении пока нет доступных услуг</p>
                  {branchId && (
                    <button
                      type="button"
                      onClick={() => fetchServices(branchId)}
                      className="text-xs text-[#054FA6] hover:underline font-medium"
                    >
                      Повторить загрузку
                    </button>
                  )}
                </div>
              ) : (
                <div className={kiosk ? 'kiosk-services-grid' : 'space-y-2.5'}>
                  {services.map(s => (
                    <ServiceCard key={s.id} service={s} selected={serviceId === s.id} onSelect={() => handleServiceSelect(s.id)} />
                  ))}
                </div>
              )}

              <div className="sticky bottom-3 sm:static z-20 pt-2 pb-1 bg-[#F8FAFC]/90 backdrop-blur-xs sm:bg-transparent">
                <button
                  type="button"
                  className="w-full min-h-[48px] py-3.5 bg-[#003B73] hover:bg-[#054FA6] active:bg-[#00274D] text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-lg active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  disabled={creating || !services.some(s => s.id === serviceId)}
                  onClick={createQrTicket}
                >
                  {creating ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Оформляем…</span>
                    </>
                  ) : (
                    <span>Получить талон</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMy = () => {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="flex items-center justify-between pb-1">
          <button
            type="button"
            className="cx-back-btn"
            onClick={() => setScreen('home')}
          >
            <ChevronLeft size={18} />
            <span>Главная</span>
          </button>
          <h2 className="text-lg font-black text-slate-900">Мои талоны</h2>
          <div className="w-12" />
        </header>

        <div className="space-y-4">
          {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
          {notice && <NoticeBanner message={notice} onClose={() => setNotice(null)} />}
          {pollError && <div role="status" className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-[#054FA6] text-xs font-semibold">{pollError}</div>}

          {ticketsLoading && tickets.length === 0 ? (
            <div className="cx-request-state" role="status">Загружаем ваши талоны…</div>
          ) : pollError && tickets.length === 0 ? (
            <div className="cx-request-state" role="status">Восстанавливаем соединение. Ваши талоны сохранены, повторная загрузка выполняется автоматически.</div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-16 px-4 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <TicketIcon size={32} />
              </div>
              <h3 className="text-base font-bold text-slate-800">У вас нет активных талонов</h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Оформите талон или выберите предварительную запись на главной странице
              </p>
              <button
                type="button"
                onClick={() => setScreen('home')}
                className="px-5 py-2.5 bg-[#003B73] hover:bg-[#054FA6] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm transition-colors mt-2"
              >
                Оформить талон
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {tickets.map(ticket => {
                const position = positions[ticket.id];
                const appointment = appointments[ticket.id];
                const eta = etas[ticket.id];

                return (
                  <div key={ticket.id} className="cx-active-ticket">
                    {/* Branded Ticket Header */}
                    <div className="cx-ticket-header" aria-live="polite" aria-atomic="true">
                      <span className="cx-ticket-num font-mono">{ticket.publicNumber}</span>
                      <StatusBadge status={ticket.status} source={ticket.source} />
                    </div>

                    {/* Details Body */}
                    <div className="cx-ticket-details">
                      <div className="cx-ticket-row">
                        <span>Услуга</span>
                        <strong>{services.find(s => s.id === ticket.serviceId)?.name || ticket.serviceId}</strong>
                      </div>
                      <div className="cx-ticket-row">
                        <span>Отделение</span>
                        <strong>{branches.find(b => b.id === ticket.branchId)?.name || 'Почта России'}</strong>
                      </div>
                      {appointment && (
                        <div className="cx-ticket-row">
                          <span>Время по записи</span>
                          <strong>{formatMoscowDateTime(appointment.scheduledAt)} МСК</strong>
                        </div>
                      )}
                      {ticket.status === 'CALLED' && ticket.window && (
                        <div className="cx-ticket-called-box">
                          Подойдите к окну <strong>№{ticket.window.number}</strong>
                        </div>
                      )}
                      {position?.ticketId === ticket.id && position.position !== null && position.position > 0 && (
                        <div className="cx-ticket-position">
                          <span className="cx-pos-label">Позиция в очереди</span>
                          <span className="cx-pos-val font-mono">{position.position}</span>
                        </div>
                      )}
                      {position?.reason === 'NOT_ELIGIBLE_YET' && (
                        <p className="text-xs text-slate-500 font-mono text-center">Время записи ещё не наступило</p>
                      )}
                      {position?.reason === 'NO_OPEN_COMPATIBLE_WINDOW' && (
                        <p className="text-xs text-slate-500 font-mono text-center">Ожидаем открытия подходящего окна</p>
                      )}
                      {!terminalStatuses.has(ticket.status) &&
                        eta?.ticketId === ticket.id &&
                        eta.ticketStatus === ticket.status &&
                        eta.reason === 'AVAILABLE' &&
                        eta.estimatedWaitSeconds !== null && (
                          <div className="cx-ticket-position cx-ticket-eta font-mono text-xs font-bold text-[#054FA6]">
                            <span className="cx-eta-label">Ожидание примерно{' '}<span className="cx-eta-duration">{Math.ceil(eta.estimatedWaitSeconds / 60)} мин</span></span>
                          </div>
                        )}
                      {!terminalStatuses.has(ticket.status) && (
                        <div className="pt-2 flex justify-center">
                          <BranchWorkloadCard
                            branch={branches.find(b => b.id === ticket.branchId)}
                            compact
                            overrideWaitMinutes={
                              eta?.ticketId === ticket.id && eta.estimatedWaitSeconds !== null
                                ? Math.ceil(eta.estimatedWaitSeconds / 60)
                                : undefined
                            }
                          />
                        </div>
                      )}
                    </div>

                    {ticket.status === 'SCHEDULED' && ticket.source === 'APPOINTMENT' && (
                      <div className="p-3 my-2 rounded-2xl bg-blue-50/80 border border-blue-200/70 text-xs text-[#003B73] flex items-center gap-2">
                        <span className="text-base shrink-0">🔔</span>
                        <span className="font-medium text-[11px] leading-tight">
                          За 30 минут до визита поступит СМС-напоминание на привязанный телефон.
                        </span>
                      </div>
                    )}

                    {/* Actions Footer */}
                    <div className="cx-ticket-actions">
                      {ticket.status === 'SCHEDULED' && ticket.source === 'APPOINTMENT' && (
                        (ticket.arrivedAt || arrivalAcknowledgedTicketIds.has(ticket.id)) ? (
                          <div className="cx-ticket-alert cx-ticket-alert-success">
                            Ожидайте вызова, ваше прибытие отмечено
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="cx-btn cx-btn-primary cx-btn-block"
                            onClick={() => arrive(ticket)}
                            disabled={arriving}
                          >
                            {arriving ? 'Отмечаем...' : 'Я уже в отделении'}
                          </button>
                        )
                      )}
                      {(ticket.status === 'SCHEDULED' || ticket.status === 'WAITING') && (
                        <button
                          type="button"
                          className="cx-btn cx-btn-danger cx-btn-block"
                          onClick={() => cancel(ticket)}
                          disabled={cancellingTicketId !== null}
                        >
                          {cancellingTicketId === ticket.id
                            ? 'Отменяем...'
                            : (ticket.status === 'SCHEDULED' ? 'Отменить запись' : 'Отказаться от талона')}
                        </button>
                      )}
                      {terminalStatuses.has(ticket.status) && (
                        <button
                          type="button"
                          className="cx-btn cx-btn-primary cx-btn-block"
                          onClick={() => handleRepeatTicket(ticket.branchId)}
                        >
                          Взять новый талон
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderKioskTicket = () => (
    <div className="cx-wizard kiosk-ticket-card mx-auto text-center" aria-live="polite">
      <div className="kiosk-ticket-card__top">
        <div className="kiosk-ticket-card__icon"><TicketIcon size={28} aria-hidden /></div>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#054FA6]">Талон получен</p>
        <div className="cx-ticket-num kiosk-ticket-card__number font-mono">{kioskTicket?.publicNumber}</div>
        <p className="text-lg font-black text-slate-900">
          {services.find(service => service.id === kioskTicket?.serviceId)?.name || 'Выбранная услуга'}
        </p>
      </div>
      <div className="kiosk-ticket-card__message">
        <strong>Ожидайте вызова</strong>
        <span>Следите за номером талона на информационном табло.</span>
      </div>
      <button type="button" className="kiosk-ticket-card__button" onClick={resetKioskScreen}>
        На главный экран
      </button>
      <p className="mt-4 text-xs text-slate-400">Автоматический возврат к выбору услуги через 30 секунд</p>
    </div>
  );

  return (
    <div className={kiosk ? 'w-full' : 'cx-client-flow w-full'}>
      {kiosk && kioskTicket ? renderKioskTicket() : (
        <>
          {screen === 'booking' && renderBooking()}
          {screen === 'walkin' && renderWalkin()}
          {!kiosk && screen === 'my' && renderMy()}
          {!kiosk && screen === 'home' && renderHome()}
        </>
      )}

      {/* Interactive Yandex Map Modal */}
      {!kiosk && (
        <BranchMapModal
          isOpen={isMapModalOpen}
          onClose={() => setIsMapModalOpen(false)}
          branches={branches}
          workloads={workloads}
          userCoordinates={hasReliableGpsFix ? [currentCoordinates.lat, currentCoordinates.lng] : null}
          locationCenterRequest={locationCenterRequest}
          onRequestLocation={() => requestGpsPermission({ centerMap: true })}
          isLocatingUser={gpsPermissionStatus === 'locating'}
          locationError={gpsError}
          selectedBranchId={mapTargetBranchId}
          recommendedBranchId={smartRouting.recommendation?.fastestBranch.id ?? null}
          initialFilter={mapInitialFilter}
          onSelectBranch={handleSelectBranchFromMap}
          onTakeTicket={(b) => handleSelectBranchFromMap(b, 'walkin')}
          onBookAppointment={(b) => handleSelectBranchFromMap(b, 'booking')}
        />
      )}

      {!kiosk && nearbyBranch && canShowNearbyBranchCard(ticketsLoading, hasActiveTicketForBranch) && (
        <NearbyBranchCard
          branch={nearbyBranch}
          distanceMeters={nearbyDistanceMeters}
          onTakeTicket={(id) => {
            setNearbyVisits(previous => dismissNearbyVisit(previous, id));
            handleRepeatTicket(id);
          }}
          onDetails={(id) => {
            setNearbyVisits(previous => dismissNearbyVisit(previous, id));
            handleOpenMap('all', id);
          }}
          onDismiss={(id) => setNearbyVisits(previous => dismissNearbyVisit(previous, id))}
        />
      )}

      {!kiosk && visitRatingQueue[0] && (
        <VisitRatingSheet
          ticket={visitRatingQueue[0]}
          branchName={branches.find(branch => branch.id === visitRatingQueue[0].branchId)?.name || 'Почта России'}
          onClose={() => finishVisitRating('dismissed')}
          onSubmit={(rating, comment) => finishVisitRating('reviewed', rating, comment)}
        />
      )}

    </div>
  );
}
