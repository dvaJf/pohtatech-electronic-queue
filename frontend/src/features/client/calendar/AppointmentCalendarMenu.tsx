import { useId, useRef, useState } from 'react';
import { CloseCircleIcon, DownloadMinimalisticIcon } from '@solar-icons/react/linear';
import { Calendar } from 'lucide-react';
import type { Appointment, Branch } from '../../../api/client/types';
import { useModalFocus } from '../../../hooks/useModalFocus';
import {
  createAppointmentCalendarEvent,
  downloadAppointmentIcs,
  isAppointmentCalendarEventAvailable,
} from './appointmentCalendar';

type AppointmentCalendarMenuProps = {
  appointment: Appointment;
  branch: Branch;
};

export function AppointmentCalendarMenu({ appointment, branch }: AppointmentCalendarMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(isOpen, dialogRef, () => setIsOpen(false));

  if (!isAppointmentCalendarEventAvailable(appointment, branch)) return null;

  const exportIcs = () => {
    try {
      const calendarEvent = createAppointmentCalendarEvent(appointment, branch);
      downloadAppointmentIcs(calendarEvent);
      setError(null);
      setIsOpen(false);
    } catch {
      setError('Не удалось подготовить файл календаря. Попробуйте ещё раз.');
    }
  };

  return (
    <>
      <button
        type="button"
        className="cx-btn cx-btn-calendar cx-btn-block"
        onClick={() => { setError(null); setIsOpen(true); }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <Calendar size={18} aria-hidden />
        Добавить в календарь
      </button>

      {isOpen && (
        <div
          className="cx-calendar-dialog-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="cx-calendar-dialog"
          >
            <div className="cx-calendar-dialog-handle" aria-hidden="true" />
            <header className="cx-calendar-dialog-header">
              <div>
                <p className="cx-calendar-dialog-eyebrow">Подтверждённая запись</p>
                <h3 id={titleId}>Добавить в календарь</h3>
              </div>
              <button type="button" className="cx-calendar-close" onClick={() => setIsOpen(false)} aria-label="Закрыть меню календаря">
                <CloseCircleIcon size={22} aria-hidden />
              </button>
            </header>

            <p className="cx-calendar-dialog-copy">Скачаем календарный файл с напоминанием за 30 минут до визита.</p>
            {error && <p role="alert" className="cx-calendar-dialog-error">{error}</p>}

            <div className="cx-calendar-options">
              <button type="button" className="cx-calendar-option" onClick={exportIcs}>
                <span className="cx-calendar-option-icon"><DownloadMinimalisticIcon size={19} aria-hidden /></span>
                <span><strong>Скачать .ics</strong><small>Открывается в Apple Calendar и других календарях</small></span>
                <DownloadMinimalisticIcon size={19} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
