import React, { useState } from 'react';
import { CheckCircle2, Star, X } from 'lucide-react';
import type { Ticket } from '../../../api/client/types';

export interface VisitRatingSheetProps {
  ticket: Ticket;
  branchName: string;
  onClose: () => void;
  onSubmit: (rating: number, comment: string) => void | Promise<void>;
}

export function VisitRatingSheet({ ticket, branchName, onClose, onSubmit }: VisitRatingSheetProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [hoveredRating, setHoveredRating] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activeRating = hoveredRating || rating;

  const handleSubmit = async () => {
    if (!rating || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(rating, comment.trim());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Закрыть оценку визита" onClick={onClose} />
      <section className="relative z-10 w-full max-w-md rounded-t-[28px] border border-slate-200 bg-white p-6 shadow-2xl sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="visit-rating-title">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Закрыть">
          <X size={20} />
        </button>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#052F85]"><CheckCircle2 size={26} /></div>
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">Визит завершён · талон {ticket.publicNumber}</p>
        <h2 id="visit-rating-title" className="mt-2 text-2xl font-extrabold text-slate-950">Оцените визит</h2>
        <p className="mt-1 text-sm text-slate-600">Как прошло обслуживание в отделении «{branchName}»?</p>
        <div className="mt-5 flex justify-center gap-2" role="group" aria-label="Оценка от 1 до 5 звёзд">
          {[1, 2, 3, 4, 5].map(value => (
            <button key={value} type="button" aria-label={`${value} ${value === 1 ? 'звезда' : 'звезды'}`} aria-pressed={rating === value}
              onMouseEnter={() => setHoveredRating(value)} onMouseLeave={() => setHoveredRating(0)} onFocus={() => setHoveredRating(value)} onBlur={() => setHoveredRating(0)} onClick={() => setRating(value)}
              className="rounded-xl p-2 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
              <Star size={34} className={value <= activeRating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'} />
            </button>
          ))}
        </div>
        <p className="mt-1 min-h-5 text-center text-sm font-semibold text-slate-600" aria-live="polite">
          {['', 'Плохо', 'Не очень', 'Нормально', 'Хорошо', 'Отлично'][activeRating] || 'Выберите оценку'}
        </p>
        <label className="mt-4 block text-sm font-semibold text-slate-800" htmlFor="visit-rating-comment">Комментарий <span className="font-normal text-slate-500">(необязательно)</span></label>
        <textarea id="visit-rating-comment" value={comment} onChange={event => setComment(event.target.value)} maxLength={500} rows={3} placeholder="Что понравилось или что можно улучшить?"
          className="mt-2 w-full resize-none rounded-2xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100" />
        <button type="button" disabled={!rating || isSubmitting} onClick={handleSubmit}
          className="mt-4 w-full rounded-2xl bg-[#052F85] px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#031E56] disabled:cursor-not-allowed disabled:bg-slate-300">
          {isSubmitting ? 'Отправка...' : 'Отправить оценку'}
        </button>
        <button type="button" onClick={onClose} disabled={isSubmitting} className="mt-3 w-full rounded-xl py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50">Не сейчас</button>
      </section>
    </div>
  );
}
