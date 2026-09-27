import { useState } from 'react';
import { ShieldCheck, FileText, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { LegalModal } from './LegalModal';
import { LegalDocument } from './legalTexts';

export function LegalFooter() {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<LegalDocument['id']>('privacy');

  const openDoc = (doc: LegalDocument['id']) => {
    setActiveDoc(doc);
    setModalOpen(true);
  };

  return (
    <footer className="w-full border-t border-slate-200/80 bg-white/90 backdrop-blur-sm text-slate-500 py-6 px-4 mt-auto text-xs">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Hackathon Project & Legal Notice */}
        <div className="space-y-1 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 font-bold text-slate-800">
            <ShieldCheck className="w-4 h-4 text-[#054FA6]" />
            <span>Цифровая очередь нового поколения • 152-ФЗ РФ</span>
          </div>
          <p className="text-[11px] text-slate-500 max-w-xl leading-relaxed">
            Демонстрационный инженерный прототип разработан командой «5 указателей» в рамках Всероссийского хакатона «Postcode Challenge». Товарные знаки и элементы айдентики принадлежат АО «Почта России».
          </p>
        </div>

        {/* Right: Legal Documents Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-semibold text-slate-600">
          <button
            type="button"
            onClick={() => openDoc('privacy')}
            className="hover:text-[#054FA6] hover:underline transition-colors flex items-center gap-1"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#054FA6]" />
            <span>Политика 152-ФЗ</span>
          </button>

          <span className="text-slate-300 hidden sm:inline">•</span>

          <button
            type="button"
            onClick={() => openDoc('terms')}
            className="hover:text-[#054FA6] hover:underline transition-colors flex items-center gap-1"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>Соглашение</span>
          </button>

          <span className="text-slate-300 hidden sm:inline">•</span>

          <button
            type="button"
            onClick={() => openDoc('consent')}
            className="hover:text-[#054FA6] hover:underline transition-colors flex items-center gap-1"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Согласие на ПДн</span>
          </button>

          <span className="text-slate-300 hidden sm:inline">•</span>

          <button
            type="button"
            onClick={() => openDoc('disclaimer')}
            className="hover:text-[#054FA6] hover:underline transition-colors flex items-center gap-1"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span>Отказ от ответственности</span>
          </button>

          <span className="text-slate-300 hidden sm:inline">•</span>

          <a
            href="mailto:support@pointers-team.tech"
            className="hover:text-[#054FA6] hover:underline transition-colors text-slate-500"
          >
            support@pointers-team.tech
          </a>
        </div>
      </div>

      <LegalModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initialDoc={activeDoc}
      />
    </footer>
  );
}
