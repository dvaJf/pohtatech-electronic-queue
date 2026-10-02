import React from 'react';
import { PochtaEmblem, PochtaWordmark } from './PochtaBrand';
import { Phone, Mail, Clock, ShieldCheck, MapPin, ExternalLink, HelpCircle, Monitor, Users, Building2, CheckCircle2 } from 'lucide-react';

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
    <footer className="mt-auto bg-[#002D5A] text-slate-300 border-t border-blue-950/60 transition-colors">
      {/* Top Banner / Stats Strip */}
      <div className="bg-[#002244] border-b border-blue-900/40 py-3 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-medium text-slate-300">
              Цифровые сервисы электронной очереди доступны в штатном режиме
            </span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              <span>Защита данных ГОСТ Р</span>
            </span>
            <span className="hidden sm:inline text-slate-600">•</span>
            <span className="hidden sm:flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Время МСК (UTC+3)</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-10">
          {/* Brand & About */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <PochtaEmblem className="w-9 h-9 shrink-0 shadow-md" bg="#FFFFFF" fg="#003B73" />
              <PochtaWordmark className="h-5 w-auto text-white" color="#FFFFFF" />
            </div>

            <p className="text-xs text-slate-300/90 leading-relaxed max-w-sm">
              Интеллектуальная система управления очередями АО «Почта России».
              Бесшовное обслуживание клиентов, онлайн-запись по QR-коду,
              прогнозирование времени ожидания и геофенсинг отделений.
            </p>

            <div className="pt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="px-2.5 py-1 rounded-lg bg-blue-900/50 border border-blue-700/40 text-blue-200 font-semibold">
                AI-ассистент 24/7
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-blue-900/50 border border-blue-700/40 text-blue-200 font-semibold">
                Электронные талоны
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-blue-900/50 border border-blue-700/40 text-blue-200 font-semibold">
                Push & Telegram
              </span>
            </div>
          </div>

          {/* Column 1: Client Services */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-blue-400" />
              <span>Клиентам</span>
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <a
                  href="/"
                  onClick={(e) => handleLinkClick(e, '/')}
                  className={`hover:text-white transition-colors ${currentPath === '/' ? 'text-white font-bold' : 'text-slate-300'}`}
                >
                  Главная (Взять талон / Запись)
                </a>
              </li>
              <li>
                <a
                  href="/board"
                  onClick={(e) => handleLinkClick(e, '/board')}
                  className={`hover:text-white transition-colors ${currentPath === '/board' ? 'text-white font-bold' : 'text-slate-300'}`}
                >
                  Электронное табло очереди
                </a>
              </li>
              <li>
                <a
                  href="/faq"
                  onClick={(e) => handleLinkClick(e, '/faq')}
                  className={`hover:text-white transition-colors ${currentPath === '/faq' ? 'text-white font-bold' : 'text-slate-300'}`}
                >
                  Вопросы и ответы (FAQ)
                </a>
              </li>
              <li>
                <a
                  href="/tv"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white transition-colors flex items-center gap-1 text-slate-300"
                >
                  <span>Большое ТВ-табло отделения</span>
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              </li>
            </ul>
          </div>

          {/* Column 2: Staff & Administration */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Сотрудникам ОПС</span>
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <a
                  href="/operator"
                  onClick={(e) => handleLinkClick(e, '/operator')}
                  className={`hover:text-white transition-colors ${currentPath.startsWith('/operator') ? 'text-white font-bold' : 'text-slate-300'}`}
                >
                  Рабочее место оператора
                </a>
              </li>
              <li>
                <a
                  href="/admin"
                  onClick={(e) => handleLinkClick(e, '/admin')}
                  className={`hover:text-white transition-colors ${currentPath.startsWith('/admin') ? 'text-white font-bold' : 'text-slate-300'}`}
                >
                  Панель начальника ОПС
                </a>
              </li>
              <li>
                <a
                  href="/demo"
                  onClick={(e) => handleLinkClick(e, '/demo')}
                  className="hover:text-white transition-colors text-slate-300"
                >
                  Демонстрационный стенд
                </a>
              </li>
            </ul>
          </div>

          {/* Column 3: Contact & Support */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-blue-400" />
              <span>Поддержка</span>
            </h4>
            <div className="space-y-2 text-xs text-slate-300">
              <div>
                <a
                  href="tel:88001000000"
                  className="text-sm font-bold text-white hover:text-blue-300 transition-colors block"
                >
                  8-800-1-000-000
                </a>
                <span className="text-[11px] text-slate-400">Бесплатно по всей России</span>
              </div>
              <div className="pt-1">
                <a
                  href="mailto:support@russianpost.ru"
                  className="text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>support@russianpost.ru</span>
                </a>
              </div>
              <div className="pt-1 text-[11px] text-slate-400 leading-tight">
                Контакт-центр работает круглосуточно 24/7 без выходных и перерывов.
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 pt-6 border-t border-blue-900/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="text-center sm:text-left">
            <span>© {new Date().getFullYear()} АО «Почта России». Цифровая очередь нового поколения.</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px]">
            <span className="hover:text-slate-200 transition-colors cursor-pointer">
              Политика конфиденциальности
            </span>
            <span>•</span>
            <span className="hover:text-slate-200 transition-colors cursor-pointer">
              Условия обслуживания
            </span>
            <span>•</span>
            <span className="hover:text-slate-200 transition-colors cursor-pointer">
              Безопасность персональных данных
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
