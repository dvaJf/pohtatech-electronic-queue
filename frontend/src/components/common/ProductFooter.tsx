import React from 'react';
import { PochtaEmblem, PochtaWordmark } from './PochtaBrand';
import { Phone } from 'lucide-react';

interface ProductFooterProps {
  currentPath?: string;
  onNavigate?: (path: string) => void;
}

export function ProductFooter({ currentPath = '/', onNavigate }: ProductFooterProps) {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (path.startsWith('http') || path.startsWith('mailto:') || path.startsWith('tel:')) return;

    e.preventDefault();
    if (onNavigate) {
      onNavigate(path);
    } else {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  return (
    <footer className="mt-auto bg-[#002D5A] text-slate-300 border-t border-blue-950/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3.5">
            <PochtaEmblem className="w-7 h-7 shrink-0 shadow-sm" bg="#FFFFFF" fg="#003B73" />
            <div className="flex items-center gap-2.5">
              <PochtaWordmark className="h-4 w-auto text-white" color="#FFFFFF" />
              <span className="hidden sm:inline text-blue-400/70 text-xs">|</span>
              <span className="text-[11px] font-medium text-blue-200/90 hidden sm:inline">
                Цифровая очередь
              </span>
            </div>
          </div>

          {/* Quick Navigation Links: только Главная и Вопросы и ответы */}
          <nav className="flex items-center justify-center gap-6 text-xs font-medium">
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className={`hover:text-white transition-colors ${currentPath === '/' ? 'text-white font-bold' : 'text-slate-300'}`}
            >
              Главная
            </a>
            <a
              href="/faq"
              onClick={(e) => handleLinkClick(e, '/faq')}
              className={`hover:text-white transition-colors ${currentPath === '/faq' ? 'text-white font-bold' : 'text-slate-300'}`}
            >
              Вопросы и ответы
            </a>
          </nav>

          {/* Support Phone & Team */}
          <div className="flex items-center gap-4 text-xs text-slate-300 shrink-0">
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-blue-400" />
              <a
                href="tel:8000000000"
                className="font-bold text-white hover:text-blue-300 transition-colors"
              >
                8 000 000 000
              </a>
            </div>
            <span className="text-slate-500">•</span>
            <span className="text-xs text-slate-300 font-medium">
              Команда 5 указателей
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
