import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QueuePolicy, AdminApiError } from '../../api/admin/types';
import * as api from '../../api/admin/adminApi';
import {
  Sliders,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Scale,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { formatMoscowDateTime } from '../../utils/time';

interface QueuePolicyEditorProps {
  branchId: string;
  branchName?: string;
}

type PresetType = 'balance' | 'rush' | 'appointment';

export const QueuePolicyEditor: React.FC<QueuePolicyEditorProps> = ({
  branchId,
  branchName,
}) => {
  const [policy, setPolicy] = useState<QueuePolicy | null>(null);

  const fields = [
    'appointmentDuePriority',
    'qrPriority',
    'livePriority',
    'antiStarvationThresholdMinutes',
    'antiStarvationPointsPerMinute',
    'appointmentGraceMinutes',
    'appointmentLatePenaltyPerMinute',
    'appointmentLatePenaltyMaxPoints',
  ] as const;

  const [selectedPreset, setSelectedPreset] = useState<PresetType | null>('balance');
  const [values, setValues] = useState<Record<typeof fields[number], number>>({
    appointmentDuePriority: 100,
    qrPriority: 20,
    livePriority: 10,
    antiStarvationThresholdMinutes: 15,
    antiStarvationPointsPerMinute: 10,
    appointmentGraceMinutes: 15,
    appointmentLatePenaltyPerMinute: 5,
    appointmentLatePenaltyMaxPoints: 90,
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showExpertMode, setShowExpertMode] = useState<boolean>(false);
  const [notice, setNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const requestId = useRef(0);

  const fetchPolicy = useCallback(async () => {
    const id = ++requestId.current;
    setIsLoading(true);
    setPolicy(null);
    try {
      const data = await api.getQueuePolicy(branchId);
      if (id !== requestId.current) return;
      setPolicy(data);
      const initialInterval = data.scheduledPromotionIntervalMinutes ?? data.antiStarvationThresholdMinutes;
      const initialGrace = data.scheduledAppointmentGraceMinutes ?? data.appointmentGraceMinutes;
      setValues({
        appointmentDuePriority: data.appointmentDuePriority,
        qrPriority: data.qrPriority,
        livePriority: data.livePriority,
        antiStarvationThresholdMinutes: initialInterval,
        antiStarvationPointsPerMinute: data.antiStarvationPointsPerMinute,
        appointmentGraceMinutes: initialGrace,
        appointmentLatePenaltyPerMinute: data.appointmentLatePenaltyPerMinute,
        appointmentLatePenaltyMaxPoints: data.appointmentLatePenaltyMaxPoints,
      });
      if (
        data.appointmentDuePriority === 100 &&
        data.qrPriority === 20 &&
        data.livePriority === 10 &&
        initialInterval === 15 &&
        initialGrace === 10
      ) {
        setSelectedPreset('balance');
      } else if (data.appointmentDuePriority === 80 && data.livePriority === 20 && initialInterval === 10) {
        setSelectedPreset('rush');
      } else if (data.appointmentDuePriority >= 200 && initialInterval >= 20) {
        setSelectedPreset('appointment');
      } else {
        setSelectedPreset(null);
      }
    } catch (err) {
      if (id !== requestId.current) return;
      setNotice({
        type: 'error',
        message:
          err instanceof AdminApiError
            ? `Ошибка загрузки правил очереди: ${err.message}`
            : 'Не удалось связаться с сервером при получении правил очереди',
      });
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void fetchPolicy();
    return () => {
      requestId.current += 1;
    };
  }, [fetchPolicy]);

  // Validation
  const apptVal = values.appointmentDuePriority;
  const qrVal = values.qrPriority;
  const liveVal = values.livePriority;

  let validationError: string | null = null;
  if (
    apptVal < 0 ||
    apptVal > 1000 ||
    qrVal < 0 ||
    qrVal > 1000 ||
    liveVal < 0 ||
    liveVal > 1000 ||
    values.antiStarvationThresholdMinutes < 0 ||
    values.antiStarvationThresholdMinutes > 240 ||
    values.antiStarvationPointsPerMinute < 1 ||
    values.antiStarvationPointsPerMinute > 600 ||
    values.appointmentGraceMinutes < 0 ||
    values.appointmentGraceMinutes > 120 ||
    values.appointmentLatePenaltyPerMinute < 0 ||
    values.appointmentLatePenaltyPerMinute > 600 ||
    values.appointmentLatePenaltyMaxPoints < 0 ||
    values.appointmentLatePenaltyMaxPoints > 1000 ||
    values.appointmentLatePenaltyMaxPoints > apptVal
  ) {
    validationError = 'Приоритеты должны быть целыми числами в допустимом диапазоне';
  } else if (apptVal <= qrVal || apptVal <= liveVal) {
    validationError = 'Приоритет предварительной записи должен быть строго выше QR и живой очереди';
  }

  const isFormValid = !validationError && policy !== null;

  // Apply Presets
  const applyPreset = (preset: PresetType) => {
    setSelectedPreset(preset);
    if (preset === 'balance') {
      setValues((prev) => ({
        ...prev,
        appointmentDuePriority: 100,
        qrPriority: 20,
        livePriority: 10,
        antiStarvationThresholdMinutes: 15,
        antiStarvationPointsPerMinute: 10,
        appointmentGraceMinutes: 10,
        appointmentLatePenaltyPerMinute: 5,
        appointmentLatePenaltyMaxPoints: 90,
      }));
    } else if (preset === 'rush') {
      setValues((prev) => ({
        ...prev,
        appointmentDuePriority: 80,
        qrPriority: 10,
        livePriority: 20,
        antiStarvationThresholdMinutes: 10,
        antiStarvationPointsPerMinute: 20,
        appointmentGraceMinutes: 5,
        appointmentLatePenaltyPerMinute: 8,
        appointmentLatePenaltyMaxPoints: 75,
      }));
    } else if (preset === 'appointment') {
      setValues((prev) => ({
        ...prev,
        appointmentDuePriority: 250,
        qrPriority: 10,
        livePriority: 10,
        antiStarvationThresholdMinutes: 20,
        antiStarvationPointsPerMinute: 5,
        appointmentGraceMinutes: 15,
        appointmentLatePenaltyPerMinute: 5,
        appointmentLatePenaltyMaxPoints: 100,
      }));
    }
  };

  // Determine active levels
  const channelPriorityLevel =
    values.livePriority > values.qrPriority ? 'high' : values.qrPriority > values.livePriority ? 'medium' : 'low';

  const starvationGuardLevel =
    values.antiStarvationThresholdMinutes >= 20 ? 'low' : values.antiStarvationThresholdMinutes >= 12 ? 'medium' : 'high';

  const gracePeriodLevel =
    values.appointmentGraceMinutes <= 7 ? 'low' : values.appointmentGraceMinutes <= 12 ? 'medium' : 'high';

  const latePenaltyLevel =
    values.appointmentLatePenaltyPerMinute <= 3 ? 'low' : values.appointmentLatePenaltyPerMinute <= 7 ? 'medium' : 'high';

  const isBalanceActive =
    selectedPreset === 'balance' ||
    (!selectedPreset &&
      values.appointmentDuePriority === 100 &&
      values.qrPriority === 20 &&
      values.livePriority === 10 &&
      values.antiStarvationThresholdMinutes === 15 &&
      values.appointmentGraceMinutes === 10 &&
      latePenaltyLevel === 'medium');

  const isRushActive =
    selectedPreset === 'rush' ||
    (!selectedPreset &&
      values.appointmentDuePriority === 80 &&
      values.qrPriority === 10 &&
      values.livePriority === 20 &&
      values.antiStarvationThresholdMinutes === 10 &&
      values.appointmentGraceMinutes === 5);

  const isAppointmentActive =
    selectedPreset === 'appointment' ||
    (!selectedPreset &&
      values.appointmentDuePriority >= 200 &&
      values.qrPriority === 10 &&
      values.livePriority === 10 &&
      values.antiStarvationThresholdMinutes >= 20 &&
      values.appointmentGraceMinutes >= 15);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isFormValid || !policy || isSaving || isLoading) return;

    const id = requestId.current;
    setIsSaving(true);
    setNotice(null);

    try {
      const updated = await api.updateQueuePolicy(branchId, {
        ...values,
        expectedVersion: policy.version,
      });

      if (id !== requestId.current) return;
      setPolicy(updated);
      setValues({
        appointmentDuePriority: updated.appointmentDuePriority,
        qrPriority: updated.qrPriority,
        livePriority: updated.livePriority,
        antiStarvationThresholdMinutes: updated.scheduledPromotionIntervalMinutes ?? updated.antiStarvationThresholdMinutes,
        antiStarvationPointsPerMinute: updated.antiStarvationPointsPerMinute,
        appointmentGraceMinutes: updated.scheduledAppointmentGraceMinutes ?? updated.appointmentGraceMinutes,
        appointmentLatePenaltyPerMinute: updated.appointmentLatePenaltyPerMinute,
        appointmentLatePenaltyMaxPoints: updated.appointmentLatePenaltyMaxPoints,
      });
      setNotice({
        type: 'success',
        message: 'Правила очереди успешно сохранены и вступят в силу со следующего календарного дня!',
      });
      setTimeout(() => setNotice(null), 8000);
    } catch (err) {
      if (id !== requestId.current) return;
      if (err instanceof AdminApiError && err.status === 409 && err.code === 'POLICY_VERSION_CONFLICT') {
        setNotice({
          type: 'warning',
          message: 'Настройки были изменены другим администратором. Загружаем актуальную версию.',
        });
        await fetchPolicy();
      } else {
        setNotice({
          type: 'error',
          message:
            err instanceof AdminApiError
              ? `Ошибка сохранения: ${err.message}`
              : 'Не удалось сохранить изменения на сервере',
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-[#D2D8E2] p-5 sm:p-6 shadow-sm space-y-5">
        {/* Header & Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#003B73] flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                Конфигуратор приоритетов очереди
              </h2>
              <p className="text-xs text-slate-500">
                {branchName ? `Отделение: ${branchName}` : `ID отделения: ${branchId}`} · Простое управление логикой вызова
              </p>
            </div>
          </div>

          {/* Policy version badge removed by user request */}
        </div>

        {policy && policy.scheduledEffectiveOn && (
          <div
            role="status"
            className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3 shadow-sm"
          >
            <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                Запланировано изменение со следующего дня ({policy.scheduledEffectiveOn})
              </div>
              <div className="text-[11px] text-amber-800 mt-0.5">
                Интервал повышения: {policy.scheduledPromotionIntervalMinutes ?? policy.antiStarvationThresholdMinutes} мин,
                льготный период записи: {policy.scheduledAppointmentGraceMinutes ?? policy.appointmentGraceMinutes} мин.
                Текущие настройки активны до конца дня.
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div
            role="alert"
            className={`p-3.5 rounded-2xl text-xs flex items-center justify-between gap-2 shadow-sm animate-fadeIn ${
              notice.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold'
                : notice.type === 'warning'
                ? 'bg-amber-50 border border-amber-200 text-amber-900 font-semibold'
                : 'bg-rose-50 border border-rose-200 text-rose-800 font-bold'
            }`}
          >
            <div className="flex items-center gap-2">
              {notice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{notice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className={
                notice.type === 'success'
                  ? 'text-emerald-700 hover:text-emerald-900 px-1 font-bold'
                  : 'text-slate-400 hover:text-slate-600 px-1 font-bold'
              }
              aria-label="Закрыть уведомление"
            >
              ✕
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center text-slate-400 font-mono text-xs animate-pulse">
            Загрузка правил очереди...
          </div>
        ) : !policy ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-xs text-slate-500">Не удалось загрузить правила очереди</p>
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                void fetchPolicy();
              }}
              className="px-4 py-2 bg-[#003B73] text-white font-bold text-xs rounded-xl"
            >
              Повторить загрузку
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 1. Готовые сценарии (Пресеты в один клик) */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Готовые сценарии работы отделения
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => applyPreset('balance')}
                  className={`p-3.5 rounded-2xl border text-left transition-all relative cursor-pointer ${
                    isBalanceActive
                      ? 'bg-blue-50/90 border-[#003B73] shadow-sm ring-2 ring-[#003B73]'
                      : 'bg-slate-50/80 border-slate-200 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Scale className="w-4 h-4 text-[#003B73]" />
                      <span className="font-bold text-xs text-slate-900">Баланс (Стандарт)</span>
                    </div>
                    {isBalanceActive && (
                      <span className="w-2 h-2 rounded-full bg-[#003B73]" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Оптимальный баланс между онлайн-записью и посетителями зала. Рекомендуется для повседневной работы.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset('rush')}
                  className={`p-3.5 rounded-2xl border text-left transition-all relative cursor-pointer ${
                    isRushActive
                      ? 'bg-amber-50/90 border-amber-600 shadow-sm ring-2 ring-amber-500'
                      : 'bg-slate-50/80 border-slate-200 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-600" />
                      <span className="font-bold text-xs text-slate-900">Час пик (Борьба с очередями)</span>
                    </div>
                    {isRushActive && (
                      <span className="w-2 h-2 rounded-full bg-amber-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Ускоряет продвижение живой очереди. Жёстко защищает от ожидания дольше 10 минут при наплыве.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset('appointment')}
                  className={`p-3.5 rounded-2xl border text-left transition-all relative cursor-pointer ${
                    isAppointmentActive
                      ? 'bg-emerald-50/90 border-emerald-600 shadow-sm ring-2 ring-emerald-600'
                      : 'bg-slate-50/80 border-slate-200 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="w-4 h-4 text-emerald-600" />
                      <span className="font-bold text-xs text-slate-900">Приоритет записи</span>
                    </div>
                    {isAppointmentActive && (
                      <span className="w-2 h-2 rounded-full bg-emerald-600" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Максимальное преимущество клиентам, записавшимся ко времени через приложение.
                  </p>
                </button>
              </div>
            </div>

            {/* 2. Понятные переключатели: Низкий / Средний / Высокий */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Параметр 1: Приоритет каналов зала */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Приоритет каналов зала (QR vs Терминал)</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Запись имеет фиксированный Ранг 0. Выбор преимущества между QR-стойкой и талонами зала при равном дедлайне
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, qrPriority: 10, livePriority: 10 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      channelPriorityLevel === 'low'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Низкий (Паритет)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, qrPriority: 20, livePriority: 10 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      channelPriorityLevel === 'medium'
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Средний (QR) ★
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, qrPriority: 10, livePriority: 20 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      channelPriorityLevel === 'high'
                        ? 'bg-white text-emerald-700 shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Высокий (Зал)
                  </button>
                </div>
              </div>

              {/* Параметр 2: Повышать приоритет каждые (ступенчатое старение) */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Повышать приоритет каждые</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Интервал перехода талонов на следующий уровень (LIVE → QR → APPOINTMENT)
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, antiStarvationThresholdMinutes: 10 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      values.antiStarvationThresholdMinutes === 10
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    10 минут
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, antiStarvationThresholdMinutes: 15 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      values.antiStarvationThresholdMinutes === 15
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    15 минут ★
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, antiStarvationThresholdMinutes: 20 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      values.antiStarvationThresholdMinutes === 20
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    20 минут
                  </button>
                </div>
              </div>

              {/* Параметр 3: Льготное опоздание записи */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Льготное опоздание записи</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Время после наступления слота до понижения на уровень QR
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, appointmentGraceMinutes: 5 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      values.appointmentGraceMinutes === 5
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    5 минут
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, appointmentGraceMinutes: 10 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      values.appointmentGraceMinutes === 10
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    10 минут ★
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, appointmentGraceMinutes: 15 })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      values.appointmentGraceMinutes === 15
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    15 минут
                  </button>
                </div>
              </div>

              {/* Параметр 4: Строгость к опозданиям */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Строгость к опозданиям записи</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Как быстро снижается приоритет опоздавшего клиента по истечении льготного окна
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, appointmentLatePenaltyPerMinute: 2, appointmentLatePenaltyMaxPoints: Math.min(40, v.appointmentDuePriority) })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      latePenaltyLevel === 'low'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Мягкая
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, appointmentLatePenaltyPerMinute: 5, appointmentLatePenaltyMaxPoints: Math.min(90, v.appointmentDuePriority) })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      latePenaltyLevel === 'medium'
                        ? 'bg-white text-[#003B73] shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Стандартная ★
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedPreset(null); setValues(v => ({ ...v, appointmentLatePenaltyPerMinute: 10, appointmentLatePenaltyMaxPoints: v.appointmentDuePriority })); }}
                    className={`py-1.5 rounded-lg transition-all ${
                      latePenaltyLevel === 'high'
                        ? 'bg-white text-amber-700 shadow-sm font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Строгая
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Сворачиваемый блок «Экспертный режим (числовые веса)» */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/50">
              <button
                type="button"
                onClick={() => setShowExpertMode(s => !s)}
                className="w-full px-4 py-3 text-left flex items-center justify-between font-bold text-xs text-slate-700 hover:bg-slate-100/80 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-slate-500" />
                  <span>Экспертный режим: формулы и точные весовые коэффициенты</span>
                </div>
                {showExpertMode ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>

              {showExpertMode && (
                <div className="p-4 border-t border-slate-200 bg-white space-y-4">
                  <div className="p-3 bg-slate-100 rounded-xl space-y-1 font-mono text-[11px] text-slate-700">
                    <div className="font-bold text-[#003B73]">
                      Канонический порядок вызова (Tiered Queue Engine):
                    </div>
                    <div>ORDER BY effective_tier ASC, tier_entered_at ASC, created_at ASC, id ASC</div>
                    <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                      Ступенчатый приоритет: APPOINTMENT (0) → QR (1) → LIVE (2). Старение каждые T минут. Сохранение активируется со следующего календарного дня.
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                      Управляющие параметры очереди (влияют на дедлайн и выбор CallNext)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Порог стагнации (мин, due_at)</label>
                        <input
                          type="number"
                          min="0"
                          max="240"
                          value={values.antiStarvationThresholdMinutes}
                          onChange={e => setValues(v => ({ ...v, antiStarvationThresholdMinutes: Number(e.target.value) || 0 }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Льготный период (мин, grace)</label>
                        <input
                          type="number"
                          min="0"
                          max="120"
                          value={values.appointmentGraceMinutes}
                          onChange={e => setValues(v => ({ ...v, appointmentGraceMinutes: Number(e.target.value) || 0 }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Штраф/мин опоздания (мин)</label>
                        <input
                          type="number"
                          min="0"
                          max="600"
                          value={values.appointmentLatePenaltyPerMinute}
                          onChange={e => setValues(v => ({ ...v, appointmentLatePenaltyPerMinute: Number(e.target.value) || 0 }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Макс. штраф опоздания (мин)</label>
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          value={values.appointmentLatePenaltyMaxPoints}
                          onChange={e => setValues(v => ({ ...v, appointmentLatePenaltyMaxPoints: Number(e.target.value) || 0 }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Вес QR-кода (W_qr, source_rank)</label>
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          value={values.qrPriority}
                          onChange={e => setValues(v => ({ ...v, qrPriority: Number(e.target.value) || 0 }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Вес талона зала (W_live, source_rank)</label>
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          value={values.livePriority}
                          onChange={e => setValues(v => ({ ...v, livePriority: Number(e.target.value) || 0 }))}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 pt-2 border-t border-slate-100">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Метаданные аудита и обратной совместимости (не влияют на выбор CallNext)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-400 mb-1">Вес записи (W_apt, аудит-лог)</label>
                        <input
                          type="number"
                          readOnly
                          disabled
                          value={values.appointmentDuePriority}
                          className="w-full px-3 py-1.5 border border-slate-200 bg-slate-100 text-slate-400 rounded-xl text-xs font-mono cursor-not-allowed"
                        />
                        <p className="text-[10px] text-slate-400 mt-0.5">Фиксированный Ранг 0 в очереди. Значение пишется в аудит-лог</p>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-400 mb-1">Баллов/мин стагнации (аудит-лог)</label>
                        <input
                          type="number"
                          readOnly
                          disabled
                          value={values.antiStarvationPointsPerMinute}
                          className="w-full px-3 py-1.5 border border-slate-200 bg-slate-100 text-slate-400 rounded-xl text-xs font-mono cursor-not-allowed"
                        />
                        <p className="text-[10px] text-slate-400 mt-0.5">Используется для поля decision_priority в аудит-логе ticket_events</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Validation warning if any */}
            {validationError && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>{validationError}</span>
              </div>
            )}

            {/* Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
              <div className="text-[11px] text-slate-500 font-mono">
                {policy.updatedAt && `Последнее обновление: ${formatMoscowDateTime(policy.updatedAt)} МСК`}
              </div>

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!isFormValid || isSaving}
                className={`px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer ${
                  isFormValid && !isSaving
                    ? 'bg-[#003B73] hover:bg-[#054FA6] text-white shadow-md active:scale-98'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isSaving ? 'Сохранение...' : 'Применить настройки очереди'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
