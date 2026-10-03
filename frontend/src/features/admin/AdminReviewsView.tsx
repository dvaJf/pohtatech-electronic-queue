import React, { useState, useEffect, useCallback } from 'react';
import { Star, MessageSquare, Filter, RefreshCw, Building2, Calendar, ThumbsUp } from 'lucide-react';
import { Branch } from '../../api/operator/types';
import {
  getAdminReviews,
  AdminReviewItem,
  AdminReviewSummary,
  AdminReviewsResult,
  GetAdminReviewsParams,
} from '../../api/admin/adminApi';
import { Pagination } from '../../components/common/Pagination';
import { formatMoscowDateTime } from '../../utils/time';

interface AdminReviewsViewProps {
  branches: Branch[];
  initialBranchId?: string;
}

export const AdminReviewsView: React.FC<AdminReviewsViewProps> = ({
  branches,
  initialBranchId = '',
}) => {
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
  const [selectedRating, setSelectedRating] = useState<number | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<string>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (initialBranchId) {
      setSelectedBranchId(initialBranchId);
    }
  }, [initialBranchId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminReviewsResult | null>(null);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: GetAdminReviewsParams = {
        branchId: selectedBranchId || undefined,
        rating: selectedRating,
        sort: sortOrder,
        page,
        pageSize,
      };
      const res = await getAdminReviews(params);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить отзывы');
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, selectedRating, sortOrder, page, pageSize]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const summary = data?.summary || {
    averageRating: null,
    totalReviews: 0,
    distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
  };

  const totalReviews = summary.totalReviews || 0;
  const avg = summary.averageRating ? summary.averageRating.toFixed(1) : '—';

  return (
    <div className="space-y-6">
      {/* Заголовок и кнопка обновления */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#003B73]" />
            Отзывы клиентов
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Оценки обслуживания и обратная связь посетителей отделений
          </p>
        </div>
        <button
          type="button"
          onClick={loadReviews}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-[#003B73] bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {/* c-rating-6 Visual Summary Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Слева: Крупный средний балл и звёзды */}
          <div className="md:col-span-4 flex flex-col items-center justify-center p-4 border-b md:border-b-0 md:border-r border-slate-100 text-center">
            <span className="text-5xl font-black text-slate-900 tracking-tight font-mono">
              {avg}
            </span>
            <div className="flex items-center gap-1 my-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const numAvg = summary.averageRating || 0;
                const isFilled = star <= Math.round(numAvg);
                return (
                  <Star
                    key={star}
                    className={`w-5 h-5 ${
                      isFilled ? 'text-amber-400 fill-amber-400' : 'text-slate-200'
                    }`}
                  />
                );
              })}
            </div>
            <p className="text-xs text-slate-500 font-medium">
              {totalReviews > 0
                ? `На основе ${totalReviews} ${
                    totalReviews === 1
                      ? 'отзыва'
                      : totalReviews >= 2 && totalReviews <= 4
                      ? 'отзывов'
                      : 'отзывов'
                  }`
                : 'Пока нет отзывов'}
            </p>
          </div>

          {/* Справа: График распределения 5 -> 1 звезд */}
          <div className="md:col-span-8 space-y-2.5 px-2">
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = summary.distribution[String(stars)] || 0;
              const percent = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
              return (
                <div key={stars} className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1 w-14 shrink-0 font-medium text-slate-700">
                    <span>{stars}</span>
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  </div>
                  <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="w-20 text-right shrink-0 text-slate-500 font-mono text-[11px]">
                    <span className="font-semibold text-slate-800">{count}</span> ({percent}%)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Панель фильтров */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-wrap items-center gap-4 text-xs">
        {/* Фильтр по отделению */}
        <div className="flex items-center gap-2 min-w-[240px] flex-1">
          <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
          <select
            value={selectedBranchId}
            onChange={(e) => {
              setSelectedBranchId(e.target.value);
              setPage(1);
            }}
            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          >
            <option value="">Все отделения</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Фильтр по оценке */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500 shrink-0" />
          <select
            value={selectedRating !== undefined ? selectedRating : ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              setSelectedRating(val);
              setPage(1);
            }}
            className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          >
            <option value="">Все оценки</option>
            <option value="5">5 звёзд</option>
            <option value="4">4 звезды</option>
            <option value="3">3 звезды</option>
            <option value="2">2 звезды</option>
            <option value="1">1 звезда</option>
          </select>
        </div>

        {/* Сортировка */}
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Сортировка:</span>
          <select
            value={sortOrder}
            onChange={(e) => {
              setSortOrder(e.target.value);
              setPage(1);
            }}
            className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
            <option value="highest">Сначала высокий балл</option>
            <option value="lowest">Сначала низкий балл</option>
          </select>
        </div>
      </div>

      {/* Ошибка или состояние загрузки */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs">
          {error}
        </div>
      )}

      {/* Список отзывов */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-white border border-slate-200 rounded-2xl p-5 animate-pulse space-y-3"
              >
                <div className="flex justify-between items-center">
                  <div className="h-4 bg-slate-200 rounded w-1/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/6" />
                </div>
                <div className="h-4 bg-slate-100 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : !data?.items || data.items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-500 space-y-3">
            <MessageSquare className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-700">Отзывов не найдено</p>
            <p className="text-xs text-slate-400">
              Попробуйте сбросить фильтры или выбрать другое отделение
            </p>
          </div>
        ) : (
          data.items.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs hover:border-slate-300 transition-all space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  {/* Звёзды */}
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`w-4 h-4 ${
                          star <= item.rating
                            ? 'text-amber-400 fill-amber-400'
                            : 'text-slate-200'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Отделение */}
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-blue-50 border border-blue-200/60 text-[#003B73] font-bold text-[11px]">
                    <Building2 className="w-3 h-3 text-[#003B73]" />
                    {item.branchName || branches.find((b) => b.id === item.branchId)?.name || 'Отделение'}
                  </span>
                </div>

                {/* Дата создания */}
                <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{formatMoscowDateTime(item.createdAt)}</span>
                </div>
              </div>

              {/* Текст отзыва */}
              <div className="text-sm text-slate-800 leading-relaxed font-normal bg-slate-50/70 p-3.5 rounded-xl border border-slate-100">
                {item.comment ? (
                  <p className="whitespace-pre-line">{item.comment}</p>
                ) : (
                  <p className="text-slate-400 italic text-xs">
                    Пользователь оставил оценку без комментария
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Пагинация */}
      {data && data.totalPages > 1 && (
        <Pagination
          page={page}
          total={data.total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          itemLabel="отзывам"
        />
      )}
    </div>
  );
};
