import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { changeUserBranch, changeUserRole, getMe, listUsers, User, UserPage } from '../../api/authApi';
import { listBranches } from '../../api/operator/operatorApi';
import { Branch } from '../../api/operator/types';
import { SearchableBranchSelect } from '../../components/common/SearchableBranchSelect';
import { Users, RefreshCw, Search, X, Building2, Pencil, Plus, Check } from 'lucide-react';
import { Pagination } from '../../components/common/Pagination';

const roles: Record<string, string> = {
  client: 'Клиент',
  employee: 'Оператор',
  opc_chief: 'Начальник ОПС',
};

const roleLabels: Record<string, string> = {
  ...roles,
  terminal: 'Терминал',
};

type RoleFilter = 'ALL' | 'opc_chief' | 'employee' | 'client';

export function UsersManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [chief, setChief] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [counts, setCounts] = useState<UserPage['counts']>({ all: 0, employee: 0, opc_chief: 0, client: 0, terminal: 0 });
  const [total, setTotal] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [userBranches, setUserBranches] = useState<Record<string, string>>({});
  const [savedBranchUserId, setSavedBranchUserId] = useState<string | null>(null);
  const [assigningUser, setAssigningUser] = useState<User | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    listBranches().then(setBranches).catch(() => {});
  }, []);

  const loadUsers = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      setError('');
      setPending(true);
      const result = await listUsers({ page, limit: pageSize, search: searchQuery, role: roleFilter });
      if (currentRequest !== requestId.current) return;
      setUsers(result.items);
      setTotal(result.total);
      setCounts(result.counts);
      setPage(current => Math.min(current, Math.max(1, Math.ceil(result.total / pageSize))));
    } catch {
      if (currentRequest === requestId.current) setError('Не удалось загрузить пользователей');
    } finally {
      if (currentRequest === requestId.current) setPending(false);
    }
  }, [page, pageSize, roleFilter, searchQuery]);

  useEffect(() => {
    let active = true;
    getMe()
      .then(async user => {
        if (!active || user?.role !== 'opc_chief') return;
        setChief(true);
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить пользователей');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!chief) return;
    const timer = window.setTimeout(() => void loadUsers(), 250);
    return () => { window.clearTimeout(timer); requestId.current += 1; };
  }, [chief, loadUsers]);

  const handleBranchChange = async (user: User, branchId: string) => {
    setUserBranches(prev => {
      const next = { ...prev };
      if (!branchId) {
        delete next[user.id];
      } else {
        next[user.id] = branchId;
      }
      return next;
    });
    if (user.id) {
      if (!branchId) localStorage.removeItem(`operator_branch:${user.id}`);
      else localStorage.setItem(`operator_branch:${user.id}`, branchId);
    }
    if (user.email) {
      if (!branchId) localStorage.removeItem(`operator_branch:${user.email}`);
      else localStorage.setItem(`operator_branch:${user.email}`, branchId);
    }
    window.dispatchEvent(
      new CustomEvent('operator_branch_updated', {
        detail: { userId: user.id, email: user.email, branchId: branchId || '' },
      })
    );
    try {
      await changeUserBranch(user.id, branchId || '');
    } catch {}
    setSavedBranchUserId(user.id);
    setTimeout(() => setSavedBranchUserId(null), 2500);
    if (!branchId) {
      setNotice(`Привязка к отделению для ${user.email} снята`);
    } else {
      const branchName = branches.find(b => b.id === branchId)?.name || 'Выбранное отделение';
      setNotice(`Почтовое отделение для ${user.email} установлено: ${branchName}`);
    }
  };

  if (!chief) return null;

  return (
    <section className="bg-white rounded-3xl border border-[#D2D8E2] p-5 sm:p-6 shadow-sm space-y-4">
      {/* Шапка раздела */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <Users className="w-5 h-5 text-[#003B73]" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                Управление доступом сотрудников (IAM)
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 text-[#003B73] border border-blue-100">
                {counts.all} всего
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Поиск, фильтрация и назначение ролей операторов и начальников отделений
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadUsers}
          disabled={pending}
          className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#003B73] ${pending ? 'animate-spin' : ''}`} />
          <span>Обновить список</span>
        </button>
      </div>

      {/* Панель поиска и фильтрации */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Поле поиска */}
          <div className="field-with-icon relative flex-1">
            <Search className="field-with-icon__icon w-4 h-4 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Поиск по email, роли (клиент, оператор)..."
              className="field-with-icon__input w-full py-2 rounded-xl border border-slate-300 text-xs font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#003B73] focus:border-transparent bg-slate-50/50 hover:bg-white transition-colors"
              aria-label="Поиск по пользователям"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setPage(1); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                title="Очистить поиск"
                aria-label="Очистить поиск"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Индикатор результатов */}
          {searchQuery && (
            <span className="text-xs font-medium text-slate-500 self-center px-1">
              Найдено: <strong className="text-slate-900 font-mono">{total}</strong>
            </span>
          )}
        </div>

        {/* Быстрые фильтры по ролям */}
        <div className="flex flex-wrap items-center gap-1.5 select-none pt-0.5">
          <button
            type="button"
            onClick={() => { setRoleFilter('ALL'); setPage(1); }}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              roleFilter === 'ALL'
                ? 'bg-[#003B73] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span>Все</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${roleFilter === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {counts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setRoleFilter('employee'); setPage(1); }}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              roleFilter === 'employee'
                ? 'bg-[#003B73] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span>Операторы</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${roleFilter === 'employee' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {counts.employee}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setRoleFilter('opc_chief'); setPage(1); }}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              roleFilter === 'opc_chief'
                ? 'bg-[#D92534] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span>Начальники ОПС</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${roleFilter === 'opc_chief' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {counts.opc_chief}
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setRoleFilter('client'); setPage(1); }}
            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              roleFilter === 'client'
                ? 'bg-[#003B73] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span>Клиенты</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${roleFilter === 'client' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {counts.client}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
          {notice}
        </div>
      )}

      <div className="overflow-x-auto min-h-[320px]">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] rounded-t-xl">
            <tr>
              <th className="p-3">Email</th>
              <th className="p-3">Текущая роль</th>
              <th className="p-3">Почтовое отделение</th>
              <th className="p-3 text-right">Назначить роль</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Search className="w-8 h-8 text-slate-300" />
                    <p className="text-xs font-bold text-slate-700">
                      Пользователи не найдены
                    </p>
                    <p className="text-[11px] text-slate-400 max-w-sm">
                      {searchQuery
                        ? `По запросу «${searchQuery}» совпадений не обнаружено`
                        : 'В выбранной категории нет пользователей'}
                    </p>
                    {(searchQuery || roleFilter !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setRoleFilter('ALL');
                          setPage(1);
                        }}
                        className="mt-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                      >
                        Сбросить фильтры
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              users.map(user => (
                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-semibold text-slate-900">{user.email}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        user.role === 'opc_chief'
                          ? 'bg-[#D92534]/10 text-[#D92534] border border-[#D92534]/20'
                          : user.role === 'employee'
                          ? 'bg-[#003B73]/10 text-[#003B73] border border-[#003B73]/20'
                          : 'bg-slate-200 text-slate-600 border border-slate-300'
                      }`}
                    >
                      {roleLabels[user.role] || user.role}
                    </span>
                  </td>
                  <td className="p-3">
                    {user.role === 'employee' || user.role === 'opc_chief' ? (
                      <div className="flex items-center gap-2">
                        {(() => {
                          const assignedId =
                            userBranches[user.id] ??
                            user.branchId ??
                            (typeof localStorage !== 'undefined'
                              ? localStorage.getItem(`operator_branch:${user.id}`) ||
                                localStorage.getItem(`operator_branch:${user.email}`) ||
                                ''
                              : '');
                          const branch = branches.find(b => b.id === assignedId);

                          if (branch) {
                            return (
                              <button
                                type="button"
                                onClick={() => setAssigningUser(user)}
                                className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50/80 hover:bg-blue-100/90 text-[#003B73] text-xs font-sans font-medium transition-all max-w-[240px] shadow-xs cursor-pointer"
                                title="Нажмите, чтобы изменить привязанное отделение"
                              >
                                <Building2 className="w-3.5 h-3.5 text-[#003B73] shrink-0" />
                                <span className="truncate font-sans font-semibold">{branch.name}</span>
                                <Pencil className="w-3 h-3 text-blue-400 group-hover:text-[#003B73] shrink-0 ml-1" />
                              </button>
                            );
                          }

                          return (
                            <button
                              type="button"
                              onClick={() => setAssigningUser(user)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-slate-300 hover:border-[#003B73] hover:bg-blue-50/50 text-slate-500 hover:text-[#003B73] text-xs font-sans font-medium transition-all cursor-pointer"
                              title="Нажмите, чтобы прикрепить оператора к отделению"
                            >
                              <Plus className="w-3.5 h-3.5 shrink-0" />
                              <span className="font-sans">Назначить отделение...</span>
                            </button>
                          );
                        })()}
                        {savedBranchUserId === user.id && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0 font-sans">
                            Сохранено ✓
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <form
                      onSubmit={async event => {
                        event.preventDefault();
                        const role = String(new FormData(event.currentTarget).get('role'));
                        setPending(true);
                        setError('');
                        setNotice('');
                        try {
                          await changeUserRole(user.id, role);
                          setNotice(`Роль пользователя ${user.email} обновлена`);
                          await loadUsers();
                        } catch {
                          setError('Не удалось изменить роль. Проверьте сессию и права доступа.');
                        } finally {
                          setPending(false);
                        }
                      }}
                      className="inline-flex items-center gap-2"
                    >
                      <select
                        name="role"
                        defaultValue={user.role}
                        disabled={pending || user.email === 'admin@pochta.local'}
                        className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs"
                      >
                        {Object.entries(roles).map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={pending || user.email === 'admin@pochta.local'}
                        className="px-3 py-1 bg-[#003B73] hover:bg-[#054FA6] text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-40"
                      >
                        Сохранить роль
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} pageSize={pageSize} disabled={pending}
        onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} itemLabel="пользователям" />

      {/* Модальное окно выбора отделения (поверх разметки таблицы) */}
      {assigningUser && (
        <AssignBranchModal
          user={assigningUser}
          branches={branches}
          currentBranchId={userBranches[assigningUser.id] || assigningUser.branchId || ''}
          onClose={() => setAssigningUser(null)}
          onSave={async (branchId) => {
            await handleBranchChange(assigningUser, branchId);
            setAssigningUser(null);
          }}
        />
      )}
    </section>
  );
}

interface AssignBranchModalProps {
  user: User;
  branches: Branch[];
  currentBranchId: string;
  onClose: () => void;
  onSave: (branchId: string) => Promise<void> | void;
}

function AssignBranchModal({
  user,
  branches,
  currentBranchId,
  onClose,
  onSave,
}: AssignBranchModalProps) {
  const [selectedId, setSelectedId] = useState(currentBranchId);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Prevent background page scrolling when modal is open
  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const preventBackdropScroll = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.modal-scrollable-content')) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', preventBackdropScroll, { passive: false });

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.removeEventListener('touchmove', preventBackdropScroll);
    };
  }, []);

  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(b => {
      const anyB = b as { address?: string; code?: string; postalCode?: string; index?: string };
      const nameMatch = b.name.toLowerCase().includes(q);
      const addressMatch = anyB.address?.toLowerCase().includes(q);
      const codeMatch = anyB.code?.toLowerCase().includes(q);
      const postalCodeMatch = anyB.postalCode?.toLowerCase().includes(q);
      const indexMatch = anyB.index?.toLowerCase().includes(q);
      return Boolean(nameMatch || addressMatch || codeMatch || postalCodeMatch || indexMatch);
    });
  }, [branches, searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150 font-sans overscroll-contain"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      onWheel={e => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#003B73] flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Назначение почтового отделения
              </h3>
              <p className="text-xs text-slate-500">
                Сотрудник: <span className="font-semibold text-slate-800">{user.fio || user.email}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-3 overflow-hidden flex flex-col">
          {/* Search Box */}
          <div
            className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:bg-white focus-within:border-[#003B73] focus-within:ring-2 focus-within:ring-[#003B73]/20 transition-all"
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <Search className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" style={{ minWidth: '16px', width: '16px', height: '16px' }} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск отделения по названию, адресу или индексу..."
              className="w-full bg-transparent text-xs text-slate-800 placeholder:text-slate-400 outline-none"
              style={{
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                padding: 0,
                margin: 0,
                background: 'transparent',
              }}
              aria-label="Поиск отделения"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-0.5 text-slate-400 hover:text-slate-600 rounded-md transition-colors shrink-0"
                title="Очистить поиск"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {searchQuery && (
            <div className="text-[11px] text-slate-400 px-1 font-mono">
              Найдено отделений: {filteredBranches.length}
            </div>
          )}

          {/* List of branches (strictly 5 items visible, rest scrollable) */}
          <div
            style={{ maxHeight: '270px', overflowY: 'auto', overscrollBehavior: 'contain' }}
            className="modal-scrollable-content border border-slate-100 rounded-2xl overflow-y-auto divide-y divide-slate-100 scrollbar-thin overscroll-contain"
          >
            {filteredBranches.length === 0 ? (
              <div className="py-6 px-4 text-center text-xs text-slate-400">
                <Search className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                <span>Отделения не найдены</span>
              </div>
            ) : (
              filteredBranches.map((branch: Branch) => {
                const isSelected = branch.id === selectedId;
                const anyB = branch as { address?: string; code?: string; postalCode?: string; index?: string };
                const extraInfo = [anyB.code || anyB.postalCode || anyB.index, anyB.address].filter(Boolean).join(' · ');

                return (
                  <div
                    key={branch.id}
                    onClick={() => setSelectedId(branch.id)}
                    className={`p-3 text-xs cursor-pointer flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-[#003B73]'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`truncate font-medium text-xs ${isSelected ? 'font-bold text-[#003B73]' : 'text-slate-900'}`}>
                        {branch.name}
                      </span>
                      {extraInfo && (
                        <span className="text-[11px] text-slate-400 truncate mt-0.5">
                          {extraInfo}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-[#003B73] text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Check className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between p-4 px-5 border-t border-slate-100 bg-slate-50/60">
          <div>
            {currentBranchId && (
              <button
                type="button"
                onClick={() => onSave('')}
                className="text-xs text-red-600 hover:text-red-700 font-semibold hover:underline cursor-pointer"
              >
                Снять привязку
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-white hover:border-slate-300 transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => onSave(selectedId)}
              disabled={!selectedId}
              className="px-4 py-2 rounded-xl bg-[#003B73] hover:bg-[#054FA6] text-white text-xs font-bold transition-colors disabled:opacity-40 shadow-xs cursor-pointer"
            >
              Сохранить отделение
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
