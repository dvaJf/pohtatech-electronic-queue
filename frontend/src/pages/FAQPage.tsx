import { useEffect, useMemo, useState } from 'react';
import { Bell, Building2, CheckCircle2, ChevronDown, CircleHelp, Clock3, Mail, MessageCircle, QrCode, RefreshCw, Search, Ticket, UserRoundCheck, X } from 'lucide-react';
import { checkHealth } from '../api/health';
import { getNotificationCapabilities } from '../api/client/clientApi';
import type { NotificationCapabilities } from '../api/client/types';
import './faq.css';

type Category = 'queue' | 'tickets' | 'appointment' | 'notifications' | 'history' | 'stand';
type FAQ = { category: Category; question: string; answer: string; keywords: string[] };

const categories: Array<{ id: 'all' | Category; label: string }> = [
  { id: 'all', label: 'Все' }, { id: 'queue', label: 'Очередь' }, { id: 'tickets', label: 'Талоны' },
  { id: 'appointment', label: 'Запись' }, { id: 'notifications', label: 'Уведомления' }, { id: 'history', label: 'История' }, { id: 'stand', label: 'О стенде' },
];

const sectionTitles: Record<Category, string> = {
  queue: 'Цифровая очередь', tickets: 'Талоны', appointment: 'Предварительная запись', notifications: 'Уведомления', history: 'История и отзывы', stand: 'О демонстрационном стенде',
};

export const faqItems: FAQ[] = [
  { category: 'queue', question: 'Что такое цифровая очередь?', answer: 'Это электронный способ получить талон, следить за его статусом и узнать, когда подойти к окну.', keywords: ['электронная', 'как работает'] },
  { category: 'queue', question: 'Нужно ли устанавливать приложение?', answer: 'Нет. Талон и информация об очереди доступны в браузере на сайте.', keywords: ['приложение', 'сайт'] },
  { category: 'queue', question: 'Нужно ли всё время находиться в отделении?', answer: 'Нет, но приходите заранее, когда очередь подходит. Точное время зависит от работы окон и посетителей перед вами.', keywords: ['ожидание', 'отделение'] },
  { category: 'queue', question: 'Как определяется порядок очереди?', answer: 'Порядок учитывает тип талона, время входа в очередь, доступные услуги и рабочие окна. Для записи действует выбранное время визита.', keywords: ['порядок', 'приоритет'] },
  { category: 'queue', question: 'Почему примерное время ожидания может меняться?', answer: 'Оно пересчитывается, когда обслуживание завершается быстрее или дольше, открываются окна и меняется состав очереди.', keywords: ['ETA', 'ожидание', 'время'] },
  { category: 'tickets', question: 'Как получить электронный талон?', answer: 'Выберите отделение и услугу на сайте — электронный талон появится сразу после подтверждения.', keywords: ['онлайн', 'получить'] },
  { category: 'tickets', question: 'Как получить талон по QR-коду?', answer: 'Отсканируйте QR-код в отделении камерой телефона, выберите услугу и подтвердите получение талона.', keywords: ['QR', 'сканировать', 'камера'] },
  { category: 'tickets', question: 'Где посмотреть статус талона?', answer: 'Статус, номер очереди и окно отображаются на странице талона после его получения.', keywords: ['номер', 'очередь'] },
  { category: 'tickets', question: 'Можно ли закрыть страницу после получения талона?', answer: 'Да, но сохраните ссылку на талон. По ней можно снова открыть его статус.', keywords: ['закрыть', 'ссылка'] },
  { category: 'tickets', question: 'Можно ли отменить талон?', answer: 'Да, пока талон ожидает вызова, его можно отменить на странице управления талоном.', keywords: ['отказаться', 'отмена'] },
  { category: 'appointment', question: 'Чем предварительная запись отличается от обычного талона?', answer: 'При записи вы заранее выбираете отделение, услугу и время визита. Обычный талон ставит вас в текущую очередь.', keywords: ['время', 'заранее'] },
  { category: 'appointment', question: 'Когда нужно приходить по записи?', answer: 'Приходите к выбранному времени. После прибытия отметьтесь в отделении, чтобы запись стала активной.', keywords: ['приход', 'время визита'] },
  { category: 'appointment', question: 'Что происходит после прибытия в отделение?', answer: 'Вы отмечаете прибытие, и система учитывает запись при вызове к подходящему окну.', keywords: ['отметиться', 'check-in'] },
  { category: 'notifications', question: 'Какие уведомления доступны?', answer: 'В стенде поддерживаются Telegram и уведомления браузера. SMS напоминает о записи, Email подтверждает запись — их режим виден в статусе стенда.', keywords: ['Telegram', 'Web Push', 'SMS', 'Email'] },
  { category: 'notifications', question: 'Как подключить Telegram?', answer: 'На странице талона выберите Telegram и откройте ссылку на бота. Он сообщит, когда ваша очередь близко и когда вас вызвали.', keywords: ['бот', 'подключить'] },
  { category: 'notifications', question: 'Что такое уведомления браузера?', answer: 'Это системные сообщения браузера. Разрешите их в браузере на странице талона, чтобы получать важные обновления.', keywords: ['Web Push', 'разрешение', 'push'] },
  { category: 'notifications', question: 'Когда приходит SMS?', answer: 'SMS используется для напоминания о предварительной записи. Доступность зависит от текущего режима SMS-провайдера.', keywords: ['смс', 'напоминание'] },
  { category: 'notifications', question: 'Для чего используется Email?', answer: 'Email используется для подтверждения предварительной записи. Текущий режим почтового провайдера показан ниже.', keywords: ['почта', 'подтверждение'] },
  { category: 'notifications', question: 'Можно ли отключить уведомления?', answer: 'Да. Подключённые уведомления можно отключить в настройках на странице талона; браузерные — также в настройках браузера.', keywords: ['выключить', 'отписаться'] },
  { category: 'history', question: 'Где посмотреть прошлые визиты?', answer: 'Последние талоны и завершённые визиты доступны в личном кабинете, если вы вошли в него.', keywords: ['история', 'талон'] },
  { category: 'history', question: 'Когда можно оставить отзыв?', answer: 'После завершения обслуживания для талона, который имеет право на отзыв.', keywords: ['оценка', 'завершён'] },
  { category: 'history', question: 'Как отзыв влияет на рейтинг отделения?', answer: 'Оценка завершённого визита учитывается в рейтинге соответствующего отделения.', keywords: ['рейтинг', 'оценка'] },
  { category: 'stand', question: 'Что представляет собой демонстрационный стенд?', answer: 'Это рабочая версия цифровой очереди для показа клиентского, операторского и руководительского сценариев.', keywords: ['демо', 'версия'] },
  { category: 'stand', question: 'Какие функции реально работают?', answer: 'В стенде реализованы электронная очередь, предварительная запись, рабочее место оператора, кабинет руководителя, история визитов, отзывы и рейтинг отделений.', keywords: ['функции', 'реализовано'] },
  { category: 'stand', question: 'Какие интеграции работают в демонстрационном режиме?', answer: 'Режим каждого уведомления указан в блоке статуса: он может быть доступен, демонстрационный или временно недоступен.', keywords: ['интеграции', 'SMS', 'Email'] },
  { category: 'stand', question: 'Как проверить текущий статус?', answer: 'Откройте блок «Демонстрационный стенд» ниже. Там отдельно показаны доступность стенда и состояние каждого уведомления.', keywords: ['health', 'проверка'] },
];

export function filterFaq(items: FAQ[], query: string, category: 'all' | Category) {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  return items.filter(item => (category === 'all' || item.category === category) && (!needle || [item.question, item.answer, ...item.keywords].join(' ').toLocaleLowerCase('ru-RU').includes(needle)));
}

function ProviderRow({ name, capability }: { name: string; capability?: { enabled: boolean; mode: string } }) {
  const label = !capability || !capability.enabled ? 'Временно недоступен' : capability.mode === 'demo' ? 'Демонстрационный режим' : 'Доступен';
  const available = !!capability?.enabled;
  return <li className="faq-status-row"><span aria-hidden="true" className={available ? 'faq-status-dot faq-status-dot--ok' : 'faq-status-dot'} /> <span><strong>{name}</strong> — {label}</span></li>;
}

function StandStatus() {
  const [health, setHealth] = useState<'loading' | 'success' | 'error'>('loading');
  const [capabilities, setCapabilities] = useState<NotificationCapabilities | null>(null);
  const [capError, setCapError] = useState(false);
  const [checked, setChecked] = useState<Date | null>(null);
  const check = async () => {
    setHealth('loading'); setCapError(false);
    const [healthResult, capabilityResult] = await Promise.allSettled([checkHealth(new AbortController().signal), getNotificationCapabilities()]);
    setHealth(healthResult.status === 'fulfilled' ? 'success' : 'error');
    if (capabilityResult.status === 'fulfilled') setCapabilities(capabilityResult.value); else { setCapabilities(null); setCapError(true); }
    setChecked(new Date());
  };
  useEffect(() => { void check(); }, []);
  const checkedText = checked ? `Проверено ${checked.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Проверяем…';
  const bothUnavailable = health === 'error' && capError;
  return <section id="stand" className="faq-stand" aria-labelledby="faq-stand-title">
    <div className="faq-section-heading"><div><p className="faq-eyebrow">Статус</p><h2 id="faq-stand-title">Демонстрационный стенд</h2></div><button type="button" onClick={() => void check()} className="faq-retry"><RefreshCw size={17} /> Проверить снова</button></div>
    {bothUnavailable ? <p className="faq-status-message" role="status">Не удалось проверить состояние стенда. Попробуйте ещё раз.</p> : <>
      <div className="faq-health" aria-live="polite"><span aria-hidden="true" className={health === 'success' ? 'faq-status-dot faq-status-dot--ok' : 'faq-status-dot'} /><div><strong>{health === 'loading' ? 'Проверяем состояние…' : health === 'success' ? 'Работает' : 'Статус временно недоступен'}</strong><span>{checkedText}</span></div></div>
      <div className="faq-stand-grid"><div><h3>Реализовано в стенде</h3><ul className="faq-check-list"><li><CheckCircle2 /> Электронная очередь</li><li><CheckCircle2 /> Предварительная запись</li><li><CheckCircle2 /> Рабочее место оператора</li><li><CheckCircle2 /> Кабинет руководителя</li><li><CheckCircle2 /> История визитов, отзывы и рейтинг</li></ul></div><div><h3>Уведомления</h3>{capError ? <p className="faq-status-message">Статус уведомлений временно недоступен.</p> : !capabilities ? <p className="faq-status-message">Загружаем статусы уведомлений…</p> : <ul className="faq-provider-list"><ProviderRow name="Telegram" capability={capabilities.telegram} /><ProviderRow name="Web Push" capability={capabilities.webPush} /><ProviderRow name="SMS" capability={capabilities.sms} /><ProviderRow name="Email" capability={capabilities.email} /></ul>}</div></div>
    </>}
  </section>;
}

export function FAQPage() {
  const [query, setQuery] = useState(''); const [category, setCategory] = useState<'all' | Category>('all'); const [open, setOpen] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => filterFaq(faqItems, query, category), [query, category]);
  useEffect(() => { const selectHash = () => { const hash = window.location.hash.slice(1) as Category; if (sectionTitles[hash]) { setCategory(hash); window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }), 0); } }; selectHash(); window.addEventListener('hashchange', selectHash); return () => window.removeEventListener('hashchange', selectHash); }, []);
  const toggle = (question: string) => setOpen(previous => { const next = new Set(previous); next.has(question) ? next.delete(question) : next.add(question); return next; });
  return <div className="faq-page">
    <section className="faq-hero"><p className="faq-eyebrow">Помощь</p><h1>Помощь и FAQ</h1><p>Ответы о цифровой очереди, талонах, записи и уведомлениях.</p></section>
    <section id="queue" className="faq-how" aria-labelledby="faq-how-title"><div><p className="faq-eyebrow">Просто о главном</p><h2 id="faq-how-title">Как работает цифровая очередь</h2></div><div className="faq-flow"><div><Ticket /><strong>Получите талон</strong><span>Онлайн или по QR</span></div><div><Clock3 /><strong>Следите за очередью</strong><span>Статус и ожидание</span></div><div><Bell /><strong>Получите уведомление</strong><span>Когда очередь близко</span></div><div><Building2 /><strong>Подойдите к окну</strong><span>После вызова</span></div></div><div className="faq-scenarios"><div><Ticket /> <strong>Взять талон онлайн</strong><span>Электронный талон на сайте</span></div><div><QrCode /> <strong>QR-код в отделении</strong><span>Сканируйте QR и выберите услугу</span></div><div><Clock3 /> <strong>Предварительная запись</strong><span>Выберите отделение, услугу и время</span></div><div><UserRoundCheck /> <strong>Через сотрудника</strong><span>Оператор добавит LIVE-клиента</span></div></div></section>
    <section className="faq-search-panel" aria-label="Поиск по FAQ"><label className="faq-search flex"><Search size={20} aria-hidden="true" /><span className="sr-only">Поиск по вопросам и ответам</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти ответ..." type="search" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={18} /></button>}</label></section>
    <nav className="faq-chips" aria-label="Категории FAQ">{categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav>
    <section className="faq-list" aria-label="Частые вопросы">{visible.length === 0 ? <div className="faq-empty"><CircleHelp size={28} /><strong>Ничего не найдено</strong><span>Попробуйте другой запрос или очистите поиск.</span><button type="button" onClick={() => { setQuery(''); setCategory('all'); }}>Очистить поиск</button></div> : visible.map(item => <article id={item.category} key={item.question} className="faq-item"><button type="button" aria-expanded={open.has(item.question)} aria-controls={`faq-answer-${faqItems.indexOf(item)}`} onClick={() => toggle(item.question)}><span><small>{sectionTitles[item.category]}</small>{item.question}</span><ChevronDown aria-hidden="true" /></button>{open.has(item.question) && <div id={`faq-answer-${faqItems.indexOf(item)}`} className="faq-answer">{item.answer}</div>}</article>)}</section>
    <StandStatus />
  </div>;
}
