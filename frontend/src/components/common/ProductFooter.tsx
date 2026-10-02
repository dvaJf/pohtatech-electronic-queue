import React from 'react';
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
    <footer className="mt-auto bg-[#002D5A] text-slate-300 border-t border-blue-950/60 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          {/* Navigation Links: Главная, Вопросы и ответы */}
          <nav className="flex items-center gap-6 font-medium text-xs">
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className={`hover:text-white transition-colors cursor-pointer ${
                currentPath === '/' ? 'text-white font-bold underline underline-offset-4 decoration-blue-400' : 'text-slate-300'
              }`}
            >
              Главная
            </a>
            <a
              href="/faq"
              onClick={(e) => handleLinkClick(e, '/faq')}
              className={`hover:text-white transition-colors cursor-pointer ${
                currentPath === '/faq' ? 'text-white font-bold underline underline-offset-4 decoration-blue-400' : 'text-slate-300'
              }`}
            >
              Вопросы и ответы
            </a>
          </nav>

          {/* Phone & Team */}
          <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-xs text-slate-300 sm:flex-nowrap sm:justify-end">
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <a
                href="tel:8000000000"
                className="whitespace-nowrap font-bold text-white hover:text-blue-300 transition-colors"
              >
                8 000 000 000
              </a>
            </div>
            <span aria-hidden="true" className="hidden text-slate-500 sm:inline">•</span>
            <span className="whitespace-nowrap text-slate-300 font-medium">
              Команда 5 указателей
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
