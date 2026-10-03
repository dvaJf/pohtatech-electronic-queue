import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ShieldCheck, X, AlertCircle, Loader2, User as UserIcon, Clock, Bell, ExternalLink, Building2, MapPin } from 'lucide-react';
import { User } from '../../api/authApi';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { ClientServiceRecord, getClientServiceHistory, MOCK_OPERATOR_NAMES, resolveOperatorName, STORAGE_SERVICE_HISTORY_KEY } from '../client/serviceHistory';
import { MOSCOW_BRANCHES } from '../client/map/branchLocations';
import { SearchableBranchSelect } from '../../components/common/SearchableBranchSelect';
import { matchesUserDefaultBranch } from '../client/map/liveBranches';

function TelegramIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill="#229ED9" />
      <path d="M17.67 6.99 5.93 11.52c-.8.32-.8.76-.15.96l3.01.94 1.16 3.55c.14.39.07.55.48.55.32 0 .46-.15.64-.32l1.46-1.42 3.04 2.24c.56.31.96.15 1.1-.52l2-9.42c.2-.82-.31-1.19-1-0.88Zm-8.41 6.15 6.79-4.28c.34-.2.65-.09.4.14l-5.5 4.97-.22 2.42-1.47-3.26Z" fill="white" />
    </svg>
  );
}

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUserUpdate: (updated: User) => void;
}

export function UserProfileModal({ isOpen, onClose, user, onUserUpdate }: UserProfileModalProps) {
  const [fio, setFio] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return (
        localStorage.getItem(`user_fio:${user.id || user.email}`) ||
        localStorage.getItem(`user_fio:${user.email}`) ||
        user.fio ||
        ''
      );
    }
    return user.fio || '';
  });
  const [fioSaved, setFioSaved] = useState(false);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      const saved =
        localStorage.getItem(`user_fio:${user.id || user.email}`) ||
        localStorage.getItem(`user_fio:${user.email}`) ||
        user.fio ||
        '';
      setFio(saved);
    }
  }, [user.id, user.email, user.fio]);

  const history = useMemo<ClientServiceRecord[]>(() => {
    const fromEmail = user.email ? getClientServiceHistory(user.email) : [];
    const fromId = user.id ? getClientServiceHistory(user.id) : [];
    const fromAnon = getClientServiceHistory('anon');
    const merged = [...fromEmail];
    for (const item of [...fromId, ...fromAnon]) {
      if (!merged.some(r => r.id === item.id)) {
        merged.push(item);
      }
    }
    return merged.sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
  }, [user.id, user.email, user.role, isOpen, fioSaved]);

  const handleSaveFio = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = fio.trim();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`user_fio:${user.email}`, trimmed);
      if (user.id) localStorage.setItem(`user_fio:${user.id}`, trimmed);
      localStorage.setItem('user_fio', trimmed);
      const isStaff = user.role === 'employee' || user.role === 'opc_chief' || user.role === 'admin';
      if (isStaff) {
        localStorage.setItem('operator_fio', trimmed);
        if (user.role === 'opc_chief' || user.role === 'admin') {
          localStorage.setItem('admin_fio', trimmed);
        }
        if (user.id) localStorage.setItem(`operator_fio:${user.id}`, trimmed);
        localStorage.setItem(`operator_fio:${user.email}`, trimmed);
        const branch = localStorage.getItem('operator.branch');
        if (branch) {
          const win = localStorage.getItem('operator.window:' + branch);
          if (win) {
            localStorage.setItem(`window_operator_name:${win}`, trimmed);
          }
        }
        // Обновляем имена оператора во всех завершённых талонах в истории обслуживаний
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(STORAGE_SERVICE_HISTORY_KEY)) {
              const raw = localStorage.getItem(key);
              if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                  let changed = false;
                  const updated = list.map((rec: ClientServiceRecord) => {
                    if (rec && (!rec.operatorName || MOCK_OPERATOR_NAMES.has(rec.operatorName.trim()) || rec.operatorName.startsWith('Оператор'))) {
                      rec.operatorName = trimmed;
                      changed = true;
                    }
                    return rec;
                  });
                  if (changed) {
                    localStorage.setItem(key, JSON.stringify(updated));
                  }
                }
              }
            }
          }
        } catch {}
      }
      window.dispatchEvent(
        new CustomEvent('auth_fio_updated', {
          detail: { userId: user.id, email: user.email, fio: trimmed, role: user.role }
        })
      );
    }
    onUserUpdate({ ...user, fio: trimmed });
    setFioSaved(true);
    setTimeout(() => setFioSaved(false), 2500);
  };

  // Почтовое отделение по умолчанию
  const branchStorageKey = `user_default_branch_id:${user.id || user.email}`;
  const [defaultBranchId, setDefaultBranchId] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      return (
        localStorage.getItem(branchStorageKey) ||
        localStorage.getItem('user_default_branch_id') ||
        localStorage.getItem('client_selected_branch_id') ||
        MOSCOW_BRANCHES[0]?.id ||
        '11111111-1111-1111-1111-111111111111'
      );
    }
    return MOSCOW_BRANCHES[0]?.id || '11111111-1111-1111-1111-111111111111';
  });
  const [defaultBranchSaved, setDefaultBranchSaved] = useState(false);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      const saved =
        localStorage.getItem(branchStorageKey) ||
        localStorage.getItem('user_default_branch_id') ||
        localStorage.getItem('client_selected_branch_id');
      if (saved) {
        setDefaultBranchId(saved);
      }
    }
  }, [user.id, user.email, branchStorageKey]);

  const selectedDefaultBranch = useMemo(() => {
    return MOSCOW_BRANCHES.find(b => matchesUserDefaultBranch(b, defaultBranchId)) || MOSCOW_BRANCHES[0];
  }, [defaultBranchId]);

  const handleSelectDefaultBranch = (branchIdToSave: string) => {
    setDefaultBranchId(branchIdToSave);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(branchStorageKey, branchIdToSave);
      if (user.id) localStorage.setItem(`user_default_branch_id:${user.id}`, branchIdToSave);
      if (user.email) localStorage.setItem(`user_default_branch_id:${user.email}`, branchIdToSave);
      localStorage.setItem('user_default_branch_id', branchIdToSave);
      localStorage.setItem('client_selected_branch_id', branchIdToSave);
      try {
        sessionStorage.setItem('client_selected_branch_id', branchIdToSave);
      } catch {}
      window.dispatchEvent(
        new CustomEvent('client_default_branch_updated', {
          detail: { branchId: branchIdToSave, userId: user.id, email: user.email }
        })
      );
    }
    setDefaultBranchSaved(true);
    setTimeout(() => setDefaultBranchSaved(false), 2500);
  };



  // Telegram state & preferences
  const tgStorageKey = `user_telegram:${user.id || user.email}`;
  const [telegramConnected, setTelegramConnected] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(tgStorageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return Boolean(parsed.connected);
        } catch {
          return saved === 'true';
        }
      }
    }
    return false;
  });
  const [telegramUsername, setTelegramUsername] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(tgStorageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return parsed.username || '';
        } catch {
          return '';
        }
      }
    }
    return '';
  });
  const [tgInputVal, setTgInputVal] = useState('');
  const [showTgInput, setShowTgInput] = useState(false);
  const [tgNotice, setTgNotice] = useState<string | null>(null);

  // Browser push notification state
  const pushStorageKey = `user_browser_push:${user.id || user.email}`;
  const [browserPermission, setBrowserPermission] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  });
  const [browserPushEnabled, setBrowserPushEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        const saved = localStorage.getItem(pushStorageKey);
        return saved !== 'false';
      }
    }
    return false;
  });
  const [pushNotice, setPushNotice] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const handleConnectTelegram = (username?: string) => {
    const uname = (username || tgInputVal).trim().replace(/^@/, '');
    const data = { connected: true, username: uname || undefined, connectedAt: new Date().toISOString() };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(tgStorageKey, JSON.stringify(data));
      localStorage.setItem('user_telegram_connected', 'true');
    }
    setTelegramConnected(true);
    if (uname) setTelegramUsername(uname);
    setShowTgInput(false);
    setTgNotice('Telegram успешно подключен! Бот будет присылать уведомления.');
    setTimeout(() => setTgNotice(null), 3500);

    // Open Telegram bot link
    window.open(`https://t.me/poiters_inno_bot?start=profile_${user.id || 'client'}`, '_blank', 'noopener,noreferrer');
  };

  const handleDisconnectTelegram = () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(tgStorageKey);
      localStorage.removeItem('user_telegram_connected');
    }
    setTelegramConnected(false);
    setTelegramUsername('');
    setTgNotice('Telegram отключен.');
    setTimeout(() => setTgNotice(null), 2500);
  };

  const handleEnableBrowserPush = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushNotice({ text: 'Ваш браузер не поддерживает системные уведомления.', type: 'error' });
      setTimeout(() => setPushNotice(null), 4000);
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setBrowserPermission(perm);
      if (perm === 'granted') {
        setBrowserPushEnabled(true);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(pushStorageKey, 'true');
          localStorage.setItem('user_browser_push_enabled', 'true');
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('pochta:notifications_changed'));
        }
        if ('serviceWorker' in navigator) {
          try {
            await navigator.serviceWorker.register('/sw.js');
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification('Почта России — Цифровая очередь', {
              body: 'Уведомления в браузере успешно активированы!',
              icon: '/favicon.svg',
            });
          } catch {
            try {
              new Notification('Почта России — Цифровая очередь', {
                body: 'Уведомления в браузере успешно активированы!',
                icon: '/favicon.svg',
              });
            } catch {}
          }
        }
        setPushNotice({ text: 'Уведомления в браузере успешно включены!', type: 'success' });
        setTimeout(() => setPushNotice(null), 3500);
      } else if (perm === 'denied') {
        setPushNotice({ text: 'Уведомления заблокированы в браузере. Разрешите их в настройках сайта.', type: 'error' });
        setTimeout(() => setPushNotice(null), 4000);
      }
    } catch {
      setPushNotice({ text: 'Не удалось запросить разрешение на уведомления.', type: 'error' });
      setTimeout(() => setPushNotice(null), 3500);
    }
  };

  const handleDisableBrowserPush = async () => {
    setBrowserPushEnabled(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(pushStorageKey, 'false');
      localStorage.setItem('user_browser_push_enabled', 'false');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('pochta:notifications_changed'));
    }
    // Отписываемся от PushManager в браузере, чтобы push-сервер не слал уведомления
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
        }
      } catch {}
    }
    setPushNotice({ text: 'Уведомления в браузере отключены.', type: 'info' });
    setTimeout(() => setPushNotice(null), 2500);
  };

  if (!isOpen) return null;



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#003B73] px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PochtaEmblem className="w-8 h-8 shrink-0" bg="#FFFFFF" fg="#003B73" />
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                {fio ? fio : 'Профиль пользователя'}
              </h2>
              <p className="text-xs text-blue-200 truncate max-w-[240px]">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 max-h-[82vh] overflow-y-auto scrollbar-none" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {/* User Info Card */}
          <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Роль в системе</span>
                <span className="text-sm font-black text-slate-800">
                  {user.role === 'opc_chief' ? 'Начальник отделения (ОПС)' : user.role === 'employee' ? 'Оператор' : 'Клиент'}
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-blue-100 text-[#003B73] text-[11px] font-bold whitespace-nowrap shrink-0">
                Аккаунт активен
              </span>
            </div>

            {/* FIO Field */}
            <div className="pt-3 border-t border-slate-200/70 space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-[#054FA6]" />
                  <span>Фамилия, Имя и Отчество</span>
                </div>
                {fioSaved && (
                  <span className="text-[11px] text-emerald-600 font-semibold animate-fade-in">
                    Сохранено ✓
                  </span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fio}
                  onChange={(e) => {
                    setFio(e.target.value);
                    setFioSaved(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveFio();
                    }
                  }}
                  placeholder="Фамилия Имя Отчество"
                  className="flex-1 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#054FA6] focus:border-transparent transition-all placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => handleSaveFio()}
                  className="px-3.5 py-2 bg-[#003B73] hover:bg-[#054FA6] text-white text-xs font-bold rounded-xl transition-all shadow-sm shrink-0"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>

          {/* Отделение по умолчанию */}
          <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#054FA6]" />
                <span className="text-xs font-bold text-slate-800">Почтовое отделение по умолчанию</span>
              </div>
              {defaultBranchSaved && (
                <span className="text-[11px] text-emerald-600 font-semibold animate-fade-in">
                  Сохранено ✓
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Выбранное отделение будет автоматически предлагаться при записи, открытии талонов и онлайн-маршрутах.
            </p>

            <div className="space-y-2">
              <SearchableBranchSelect
                branches={MOSCOW_BRANCHES as any}
                selectedId={selectedDefaultBranch ? selectedDefaultBranch.id : defaultBranchId}
                onSelect={(id) => handleSelectDefaultBranch(id)}
                placeholder="Выберите отделение..."
                compact
                className="w-full"
              />

              {selectedDefaultBranch && (
                <div className="p-3 bg-white border border-slate-200/80 rounded-xl flex items-start gap-2.5 text-xs shadow-xs">
                  <MapPin className="w-4 h-4 text-[#003B73] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      <span>{selectedDefaultBranch.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {selectedDefaultBranch.code}
                      </span>
                    </div>
                    <div className="text-slate-500 text-[11px] truncate mt-0.5">
                      {selectedDefaultBranch.address}
                    </div>
                    {selectedDefaultBranch.metro && (
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600">
                        <span
                          className="w-2 h-2 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: selectedDefaultBranch.metroColor || '#003B73' }}
                        />
                        <span>м. {selectedDefaultBranch.metro}</span>
                        {selectedDefaultBranch.workHours && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-500">{selectedDefaultBranch.workHours}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* История обслуживаний */}
          {(user.role === 'client' || history.length > 0) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-slate-900 font-bold text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#054FA6]" />
                  <span>История обслуживаний</span>
                </div>
                <span className="text-[11px] font-bold text-[#003B73] bg-blue-50 border border-blue-200/60 px-2 py-0.5 rounded-full">
                  {history.length} {history.length === 1 ? 'визит' : history.length < 5 ? 'визита' : 'визитов'}
                </span>
              </div>

              {history.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-center text-xs text-slate-500">
                  У вас пока нет завершённых визитов. Обслуженные талоны будут автоматически сохраняться здесь.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1 scrollbar-none" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-50 hover:bg-slate-100/90 border border-slate-200/90 rounded-2xl transition-all space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-[#003B73]">{item.publicNumber}</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Обслуживание завершено
                        </span>
                      </div>

                      <div className="font-bold text-slate-800">
                        {item.serviceName}
                      </div>

                      <div className="text-[11px] text-slate-500 truncate" title={item.branchName}>
                        {item.branchName}
                      </div>

                      <div className="pt-2 border-t border-slate-200/70 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Окно и оператор</span>
                          <span className="font-semibold text-slate-800">
                            {item.windowText} • {item.operatorName}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-400 block text-[10px]">Дата и время</span>
                          <span className="font-semibold text-slate-800">
                            {item.date} • {item.timeRange}
                          </span>
                          {item.duration && (
                            <span className="block text-[10px] text-slate-400">
                              Длительность: {item.duration}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Каналы уведомлений: Telegram и Браузерные уведомления */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-900 font-bold text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <Bell className="w-4 h-4 text-[#054FA6] shrink-0" />
                <span className="leading-snug">Уведомления и оповещения</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-[#003B73] border border-blue-200/60 text-[11px] font-bold whitespace-nowrap shrink-0">
                Telegram • Push • SMS
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Подключите удобные каналы, чтобы не пропустить вызов к окну и получать актуальный статус талонов.
            </p>

            {tgNotice && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-[#003B73] font-medium flex items-center gap-2 animate-fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{tgNotice}</span>
              </div>
            )}

            {pushNotice && (
              <div
                className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 animate-fade-in ${
                  pushNotice.type === 'error'
                    ? 'bg-rose-50 border border-rose-200 text-rose-800'
                    : pushNotice.type === 'info'
                    ? 'bg-blue-50 border border-blue-200 text-[#003B73]'
                    : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                }`}
              >
                {pushNotice.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                ) : pushNotice.type === 'info' ? (
                  <Bell className="w-4 h-4 shrink-0 text-[#054FA6]" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                )}
                <span>{pushNotice.text}</span>
              </div>
            )}

            {/* Telegram Channel Card */}
            <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-2xl space-y-3">
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <TelegramIcon size={28} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-slate-900">Telegram-уведомления</span>
                    {telegramConnected ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold whitespace-nowrap shrink-0">
                        ✓ Подключено
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold whitespace-nowrap shrink-0">
                        Не подключено
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                    Мгновенные сообщения о приближении очереди и вызове в Telegram.
                  </p>
                </div>
              </div>

              {telegramConnected ? (
                <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-emerald-700 font-semibold leading-tight">
                    ✓ Telegram-уведомления активны
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnectTelegram}
                    className="px-3 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-bold transition-colors border border-rose-200/80 shrink-0"
                  >
                    Отключить
                  </button>
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-200/70 space-y-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleConnectTelegram()}
                      className="flex-1 px-3.5 py-2 bg-[#229ED9] hover:bg-[#1D8BC0] text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <span>Подключить Telegram</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTgInput(!showTgInput)}
                      className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                    >
                      {showTgInput ? 'Отмена' : 'Указать @юзернейм'}
                    </button>
                  </div>

                  {showTgInput && (
                    <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 animate-fade-in">
                      <label className="text-[11px] font-bold text-slate-700 block">
                        Ваш Telegram username (без @)
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-2 text-slate-400 text-xs font-bold">@</span>
                          <input
                            type="text"
                            value={tgInputVal}
                            onChange={e => setTgInputVal(e.target.value)}
                            placeholder="username"
                            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#229ED9]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleConnectTelegram(tgInputVal)}
                          disabled={!tgInputVal.trim()}
                          className="px-3 py-1.5 bg-[#003B73] hover:bg-[#054FA6] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shrink-0"
                        >
                          Сохранить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Browser Push Channel Card */}
            <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-2xl space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${browserPermission === 'granted' && browserPushEnabled ? 'bg-blue-100 text-[#003B73]' : 'bg-slate-200 text-slate-500'}`}>
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-slate-900 block truncate">Уведомления в браузере</span>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Всплывающие уведомления на компьютере или телефоне даже при свёрнутой вкладке.
                    </p>
                  </div>
                </div>

                {browserPermission === 'unsupported' ? (
                  <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold shrink-0">
                    Недоступно
                  </span>
                ) : (
                  <label className="relative inline-flex items-center cursor-pointer select-none shrink-0" title={browserPermission === 'granted' && browserPushEnabled ? 'Отключить уведомления' : 'Включить уведомления'}>
                    <input
                      type="checkbox"
                      checked={browserPermission === 'granted' && browserPushEnabled}
                      onChange={(e) => {
                        if (e.target.checked) {
                          handleEnableBrowserPush();
                        } else {
                          handleDisableBrowserPush();
                        }
                      }}
                      disabled={browserPermission === 'denied'}
                      className="sr-only peer"
                      aria-label="Включить или отключить уведомления в браузере"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#003B73]" />
                  </label>
                )}
              </div>

              {browserPermission === 'denied' && (
                <div className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200 leading-relaxed mt-2">
                  Уведомления запрещены в настройках браузера. Чтобы включить, нажмите на значок настроек сайта в левой части адресной строки браузера и выберите «Разрешить уведомления».
                </div>
              )}
              {browserPermission === 'unsupported' && (
                <div className="text-[11px] text-rose-800 bg-rose-50 p-2.5 rounded-xl border border-rose-200 leading-relaxed flex items-center gap-2 mt-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>Ваш браузер не поддерживает системные уведомления.</span>
                </div>
              )}
            </div>


          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
