import React from 'react';
import { formatMoscowTime } from '../../utils/time';
import { Ticket, OperatorWindow } from '../../api/operator/types';
import { Service } from '../../api/client/types';
import { UserX, Clock, Calendar, QrCode, Users, Tag } from 'lucide-react';

interface TicketCardProps {
  ticket: Ticket | null;
  selectedWindow: OperatorWindow;
  services?: Service[];
}

function getTicketSourceConfig(source: Ticket['source']): { label: string; icon: React.ReactNode; badgeClass: string } {
  switch (source) {
    case 'APPOINTMENT':
      return {
        label: 'Предварительная запись',
        icon: <Calendar className="w-3.5 h-3.5 shrink-0 text-indigo-600" />,
        badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200 shadow-2xs',
      };
    case 'QR':
      return {
        label: 'QR-код (смартфон)',
        icon: <QrCode className="w-3.5 h-3.5 shrink-0 text-[#054FA6]" />,
        badgeClass: 'bg-sky-50 text-[#054FA6] border-sky-200 shadow-2xs',
      };
    case 'LIVE':
      return {
        label: 'Живая очередь (терминал)',
        icon: <Users className="w-3.5 h-3.5 shrink-0 text-amber-700" />,
        badgeClass: 'bg-amber-50 text-amber-900 border-amber-200 shadow-2xs',
      };
    default:
      return {
        label: source || 'Очередь',
        icon: <Tag className="w-3.5 h-3.5 shrink-0" />,
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      };
  }
}

import { getTicketStatusLabel } from '../../utils/statusMapper';

export const TicketCard: React.FC<TicketCardProps> = ({ ticket, selectedWindow, services }) => {
  if (!ticket) {
    return (
      <div className="text-center py-10 px-4 space-y-3 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400 shadow-inner">
          <UserX className="w-7 h-7" />
        </div>
        <h3 className="text-sm font-black text-slate-800 tracking-tight">Нет активного талона</h3>
        <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
          Окно №{selectedWindow.number} свободно. Нажмите кнопку «Вызвать следующего», чтобы
          пригласить клиента из очереди.
        </p>
      </div>
    );
  }

  const isCalled = ticket.status === 'CALLED';
  const isServing = ticket.status === 'SERVING';
  const sourceConfig = getTicketSourceConfig(ticket.source);

  // Тип услуги: сначала поле из талона, затем каталог услуг отделения, затем услуги выбранного окна
  const serviceName =
    ticket.serviceName ||
    services?.find(s => s.id === ticket.serviceId)?.name ||
    selectedWindow.services.find(s => s.id === ticket.serviceId)?.name ||
    'Услуга не определена';

  return (
    <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm space-y-4">
      {/* Meta Top Line */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono border flex items-center gap-1.5 ${sourceConfig.badgeClass}`}>
            {sourceConfig.icon}
            <span>{sourceConfig.label}</span>
          </span>
          <span
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono border ${
              isCalled
                ? 'bg-amber-100 text-amber-900 border-amber-300'
                : isServing
                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                : 'bg-slate-200 text-slate-800 border-slate-300'
            }`}
          >
            {getTicketStatusLabel(ticket.status)}
          </span>
        </div>

        <div className="text-xs font-mono text-slate-600 font-bold">
          Окно <strong>№{ticket.window?.number ?? selectedWindow.number}</strong>
        </div>
      </div>

      {/* Main Ticket Number and Service */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-bold">
            Талон клиента
          </div>
          <div className="ticket-number text-5xl sm:text-6xl font-black font-mono text-[#003B73] tracking-tight my-1">
            {ticket.publicNumber}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">Услуга:</span>
            <span className="text-sm font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
              {serviceName}
            </span>
          </div>
        </div>

        <div className="space-y-1.5 text-xs font-mono sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200 text-slate-600">
          {ticket.calledAt && (
            <div className="flex items-center sm:justify-end gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>Вызов: <strong>{formatMoscowTime(ticket.calledAt)}</strong></span>
            </div>
          )}
          {ticket.serviceStartedAt && (
            <div className="flex items-center sm:justify-end gap-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Приём: <strong>{formatMoscowTime(ticket.serviceStartedAt)}</strong></span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
