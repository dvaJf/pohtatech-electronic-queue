import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ShieldCheck, X, Loader2, User as UserIcon, Clock, Building2, MapPin } from 'lucide-react';
import { User } from '../../api/authApi';
import { PochtaEmblem } from '../../components/common/PochtaBrand';
import { ClientServiceRecord, getClientServiceHistory, MOCK_OPERATOR_NAMES, resolveOperatorName, STORAGE_SERVICE_HISTORY_KEY } from '../client/serviceHistory';
import { MOSCOW_BRANCHES } from '../client/map/branchLocations';
import { SearchableBranchSelect } from '../../components/common/SearchableBranchSelect';
import { matchesUserDefaultBranch } from '../client/map/liveBranches';

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



  if (!isOpen) return null;



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-md max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto border-0 ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#003B73] px-4 sm:px-6 py-4 sm:py-5 text-white flex items-center justify-between shrink-0">
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
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/15 active:bg-white/25 text-white/90 hover:text-white transition-all border-0 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 cursor-pointer"
            aria-label="Закрыть профиль"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          className="p-4 sm:p-6 space-y-5 sm:space-y-6 flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
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
                <div className="p-3 bg-slate-100/60 border border-slate-200/60 rounded-xl flex items-start gap-2.5 text-xs">
                  <MapPin className="w-4 h-4 text-[#003B73] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      <span>{selectedDefaultBranch.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-700">
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
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-800 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
