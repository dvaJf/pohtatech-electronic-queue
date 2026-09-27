import React, { useState } from 'react';
import { X, ShieldCheck, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { LEGAL_DOCUMENTS, LegalDocument } from './legalTexts';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDoc?: LegalDocument['id'];
}

export function LegalModal({ isOpen, onClose, initialDoc = 'privacy' }: LegalModalProps) {
  const [activeTab, setActiveTab] = useState<LegalDocument['id']>(initialDoc);

  if (!isOpen) return null;

  const currentDoc = LEGAL_DOCUMENTS[activeTab] || LEGAL_DOCUMENTS.privacy;

  const tabs: Array<{ id: LegalDocument['id']; label: string; icon: React.ReactNode }> = [
    { id: 'privacy', label: 'Политика 152-ФЗ', icon: <ShieldCheck className="w-4 h-4 shrink-0" /> },
    { id: 'terms', label: 'Соглашение', icon: <FileText className="w-4 h-4 shrink-0" /> },
    { id: 'consent', label: 'Согласие на ПДн', icon: <CheckCircle2 className="w-4 h-4 shrink-0" /> },
    { id: 'disclaimer', label: 'О проекте / Дисклеймер', icon: <AlertTriangle className="w-4 h-4 shrink-0" /> },
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-[#003B73] flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight">Правовая информация</h2>
              <p className="text-[11px] text-slate-500 font-medium">pointers-team.tech • Соответствие 152-ФЗ РФ</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Закрыть"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 pb-2 border-b border-slate-100 bg-white flex gap-2 overflow-x-auto shrink-0 scrollbar-none">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === tab.id
                  ? 'bg-[#003B73] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Document Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-6 flex-1 text-slate-700 leading-relaxed text-xs sm:text-sm">
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
              {currentDoc.title}
            </h1>
            <p className="text-[11px] font-semibold text-slate-400 mt-1">
              Действует с: {currentDoc.effectiveDate} • Редакция 1.0
            </p>
          </div>

          <div className="space-y-5">
            {currentDoc.sections.map((section, idx) => (
              <div key={idx} className="space-y-2">
                <h3 className="font-bold text-slate-900 text-xs sm:text-sm">
                  {section.heading}
                </h3>
                {section.paragraphs.map((p, pIdx) => (
                  <p key={pIdx} className="text-slate-600 leading-relaxed text-xs">
                    {p}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between shrink-0 text-xs">
          <span className="text-[11px] text-slate-500 font-medium">
            Служба правового соответствия: <strong className="text-slate-700">support@pointers-team.tech</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-all"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
