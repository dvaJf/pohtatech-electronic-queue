import React from 'react';
import { OperatorWindow } from '../../api/operator/types';

interface WindowSelectorProps {
  windows: OperatorWindow[];
  selectedWindowId: string | null;
  isLoading: boolean;
  branchSelected: boolean;
  onSelectWindow: (window: OperatorWindow) => void;
}

export const WindowSelector: React.FC<WindowSelectorProps> = ({
  windows,
  selectedWindowId,
  isLoading,
  branchSelected,
  onSelectWindow,
}) => {
  if (!branchSelected) {
    return (
      <div className="operator-card">
        <h2>2. Выберите окно</h2>
        <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>
          Сначала выберите отделение выше
        </p>
      </div>
    );
  }

  return (
    <div className="operator-card">
      <h2>2. Выберите окно</h2>
      {isLoading ? (
        <p style={{ color: '#64748b', fontSize: '14px' }}>Загрузка окон...</p>
      ) : windows.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '14px' }}>В данном отделении нет окон</p>
      ) : (
        <div className="window-list">
          {windows.map((w) => {
            const isSelected = selectedWindowId === w.id;
            const statusClass =
              w.status === 'OPEN'
                ? 'badge-open'
                : w.status === 'CLOSING'
                ? 'badge-closing'
                : 'badge-closed';
            const statusText =
              w.status === 'OPEN'
                ? 'Открыто'
                : w.status === 'CLOSING'
                ? 'Закрывается'
                : 'Закрыто';

            return (
              <button
                key={w.id}
                type="button"
                className={`window-item ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectWindow(w)}
                aria-pressed={isSelected}
              >
                <div className="window-item-header">
                  <span className="window-title">Окно №{w.number}</span>
                  <span className={`window-badge ${statusClass}`}>{statusText}</span>
                </div>
                <div className="window-services-label">Услуги:</div>
                {w.services && w.services.length > 0 ? (
                  <ul className="window-services-list">
                    {w.services.map((svc) => (
                      <li key={svc.id}>{svc.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Нет услуг</p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
