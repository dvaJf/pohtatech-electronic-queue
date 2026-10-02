import React from 'react';

interface NearbyBranchCardProps {
  branch: { id: string; name: string };
  distanceMeters: number;
  onTakeTicket: (branchId: string) => void;
  onDetails: (branchId: string) => void;
  onDismiss: (branchId: string) => void;
}

export function NearbyBranchCard({ branch, distanceMeters, onTakeTicket, onDetails, onDismiss }: NearbyBranchCardProps) {
  return (
    <aside aria-label="Отделение рядом" data-testid="nearby-branch-card"
      className="fixed bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] left-4 right-4 z-[60] mx-auto max-w-md rounded-xl border border-blue-200 bg-white p-4 text-slate-900 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#052F85]">Отделение рядом</p>
          <p className="mt-1 text-sm font-bold break-words">{branch.name}</p>
          <p className="mt-1 text-xs text-slate-500">{Math.round(distanceMeters)} м · около {Math.max(1, Math.ceil(distanceMeters / 80))} мин пешком</p>
        </div>
        <button type="button" aria-label="Закрыть предложение отделения рядом" onClick={() => onDismiss(branch.id)}
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-xl hover:bg-slate-100">×</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onTakeTicket(branch.id)}
          className="min-h-[44px] flex-1 rounded-xl bg-[#052F85] px-3 py-2 text-sm font-bold text-white hover:bg-[#031E56]">Взять талон</button>
        <button type="button" onClick={() => onDetails(branch.id)}
          className="min-h-[44px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Подробнее</button>
      </div>
    </aside>
  );
}
