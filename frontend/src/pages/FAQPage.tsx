import { useEffect, useMemo, useState } from 'react';
import { Bell, Building2, ChevronDown, CircleHelp, Clock3, QrCode, Search, Ticket, UserRoundCheck, X } from 'lucide-react';
import './faq.css';

type Category = 'queue' | 'tickets' | 'appointment' | 'notifications' | 'history';
type FAQ = { category: Category; question: string; answer: string; keywords: string[] };

const categories: Array<{ id: 'all' | Category; label: string }> = [
  { id: 'all', label: 'Все' }, { id: 'queue', label: 'Очередь' }, { id: 'tickets', label: 'Талоны' },
  { id: 'appointment', label: 'Запись' }, { id: 'notifications', label: 'Уведомления' }, { id: 'history', label: 'История' },
];

const sectionTitles: Record<Category, string> = {
  queue: 'Цифровая очередь', tickets: 'Талоны', appointment: 'Предварительная запись', notifications: 'Уведомления', history: 'История и отзывы',
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
  { category: 'notifications', question: 'Какие уведомления доступны?', answer: 'Поддерживаются Telegram и уведомления браузера. SMS напоминает о предварительной записи, а Email подтверждает детали визита.', keywords: ['Telegram', 'Web Push', 'SMS', 'Email'] },
  { category: 'notifications', question: 'Как подключить Telegram?', answer: 'На странице талона выберите Telegram и откройте ссылку на бота. Он сообщит, когда ваша очередь близко и когда вас вызвали.', keywords: ['бот', 'подключить'] },
  { category: 'notifications', question: 'Что такое уведомления браузера?', answer: 'Это системные сообщения браузера. Разрешите их в браузере на странице талона, чтобы получать важные обновления.', keywords: ['Web Push', 'разрешение', 'push'] },
  { category: 'notifications', question: 'Когда приходит SMS?', answer: 'SMS используется для напоминания о предварительной записи. Доступность зависит от текущего режима SMS-провайдера.', keywords: ['смс', 'напоминание'] },
  { category: 'notifications', question: 'Для чего используется Email?', answer: 'Email используется для подтверждения предварительной записи. Текущий режим почтового провайдера показан ниже.', keywords: ['почта', 'подтверждение'] },
  { category: 'notifications', question: 'Можно ли отключить уведомления?', answer: 'Да. Подключённые уведомления можно отключить в настройках на странице талона; браузерные — также в настройках браузера.', keywords: ['выключить', 'отписаться'] },
  { category: 'history', question: 'Где посмотреть прошлые визиты?', answer: 'Последние талоны и завершённые визиты доступны в личном кабинете, если вы вошли в него.', keywords: ['история', 'талон'] },
  { category: 'history', question: 'Когда можно оставить отзыв?', answer: 'После завершения обслуживания для талона, который имеет право на отзыв.', keywords: ['оценка', 'завершён'] },
  { category: 'history', question: 'Как отзыв влияет на рейтинг отделения?', answer: 'Оценка завершённого визита учитывается в рейтинге соответствующего отделения.', keywords: ['рейтинг', 'оценка'] },
];

export function filterFaq(items: FAQ[], query: string, category: 'all' | Category) {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  return items.filter(item => (category === 'all' || item.category === category) && (!needle || [item.question, item.answer, ...item.keywords].join(' ').toLocaleLowerCase('ru-RU').includes(needle)));
}

export function FAQPage() {
  const [query, setQuery] = useState(''); const [category, setCategory] = useState<'all' | Category>('all'); const [open, setOpen] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => filterFaq(faqItems, query, category), [query, category]);
  useEffect(() => { const selectHash = () => { const hash = window.location.hash.slice(1) as Category; if (sectionTitles[hash]) { setCategory(hash); window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }), 0); } }; selectHash(); window.addEventListener('hashchange', selectHash); return () => window.removeEventListener('hashchange', selectHash); }, []);
  const toggle = (question: string) => setOpen(previous => { const next = new Set(previous); next.has(question) ? next.delete(question) : next.add(question); return next; });
  return <div className="faq-page client-typography">
    <section className="faq-hero"><p className="faq-eyebrow">Помощь</p><h1>Помощь и FAQ</h1><p>Ответы о цифровой очереди, талонах, записи и уведомлениях.</p></section>
    <section id="queue" className="faq-how" aria-labelledby="faq-how-title"><div><p className="faq-eyebrow">Просто о главном</p><h2 id="faq-how-title">Как работает цифровая очередь</h2></div><div className="faq-flow"><div><Ticket /><strong>Получите талон</strong><span>Онлайн или по QR</span></div><div><Clock3 /><strong>Следите за очередью</strong><span>Статус и ожидание</span></div><div><Bell /><strong>Получите уведомление</strong><span>Когда очередь близко</span></div><div><Building2 /><strong>Подойдите к окну</strong><span>После вызова</span></div></div><div className="faq-scenarios"><div><Ticket /> <strong>Взять талон онлайн</strong><span>Электронный талон на сайте</span></div><div><QrCode /> <strong>QR-код в отделении</strong><span>Сканируйте QR и выберите услугу</span></div><div><Clock3 /> <strong>Предварительная запись</strong><span>Выберите отделение, услугу и время</span></div><div><UserRoundCheck /> <strong>Через сотрудника</strong><span>Оператор добавит LIVE-клиента</span></div></div></section>
    <section className="faq-search-panel" aria-label="Поиск по FAQ"><label className="faq-search flex"><Search size={20} aria-hidden="true" /><span className="sr-only">Поиск по вопросам и ответам</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти ответ..." type="search" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={18} /></button>}</label></section>
    <nav className="faq-chips" aria-label="Категории FAQ">{categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav>
    <section className="faq-list" aria-label="Частые вопросы">{visible.length === 0 ? <div className="faq-empty"><CircleHelp size={28} /><strong>Ничего не найдено</strong><span>Попробуйте другой запрос или очистите поиск.</span><button type="button" onClick={() => { setQuery(''); setCategory('all'); }}>Очистить поиск</button></div> : visible.map(item => <article id={item.category} key={item.question} className="faq-item"><button type="button" aria-expanded={open.has(item.question)} aria-controls={`faq-answer-${faqItems.indexOf(item)}`} onClick={() => toggle(item.question)}><span><small>{sectionTitles[item.category]}</small>{item.question}</span><ChevronDown aria-hidden="true" /></button>{open.has(item.question) && <div id={`faq-answer-${faqItems.indexOf(item)}`} className="faq-answer">{item.answer}</div>}</article>)}</section>
  </div>;
}
