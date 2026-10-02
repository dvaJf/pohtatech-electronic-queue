# Visual research — цифровая очередь и карта

Дата: 30 сентября 2026. Область: product UI для поиска почтового отделения, карты, Smart Route, получения талона и мобильного выбора точки. Это исследование — набор принципов, а не библиотека макетов для копирования.

## Вывод

Рекомендуемая визуальная основа — **спокойный городской service UI**: светлый минеральный canvas, плотная информационная иерархия, глубокий postal-blue как якорный навигационный цвет и тёплый signal-yellow только для действия, выгоды и текущего статуса. Карта остаётся полноценным рабочим полотном; интерфейс не превращает её в фон за россыпью карточек.

Главная отличительная идея: **время — главный визуальный объект**. Smart Route показывает формулу «дорога + очередь = итог», а не набор одинаково важных метрик. Почтовая идентичность проявляется в маршрутных линиях, сетке адресной этикетки и модуле талона, но не в буквальных конвертах в каждом блоке.

## Карта исследований и применимость

| Источник | Что изучено | Что заимствуем для продукта | Что не переносим |
| --- | --- | --- | --- |
| [Refero Styles](https://styles.refero.design/) | Системы документируют роли цветов, типографику, spacing, компоненты и правила, а не только скриншоты. | Один выразительный visual thesis, явные токены и do/don't для каждой поверхности. | Готовую эстетику отдельного бренда или его набор токенов. |
| [shadcn/ui](https://ui.shadcn.com/docs/components) | Композиционные primitives: Dialog, Drawer, Sheet, Command, Toast, Tooltip, Tabs, Empty, Skeleton. | Технические accessible-primitives как нижний слой будущей реализации. | Стандартную shadcn-геометрию и дефолтные нейтрали как финальный визуальный язык. |
| [tweakcn](https://tweakcn.com/) | Theme-подход поверх shadcn tokens. | Проверять семантическую палитру на реальных контролах до кодинга. | Генерировать «тему» вместо проектирования semantic roles и состояний. |
| [Mobbin](https://mobbin.com/) | Каталог production screens/flows, в том числе Search, Bottom Sheet, Toast, Dialog и location-паттерны. | Исследовать сравнимые production-потоки: выбор места, поиск, маршрут, подтверждение. | Копирование отдельных экранов/текста/брендовых решений. |
| [Google Fonts / Onest](https://github.com/google/fonts/tree/main/ofl/onest) | Open-source variable sans с осью 100–900, Cyrillic и Latin. | Сохранить Onest как единственное семейство UI и display для целостной русско-латинской системы. | Смешивать второй «модный» display-font без функциональной причины. |
| [Solar Icons](https://solar-icons.vercel.app/docs/v2) | Единая библиотека: Linear, Bold, Outline, дуотонные стили; CSS variables и Figma plugin. | Solar Linear как default UI-набор; Bold — active nav/критичная CTA-пиктограмма; duotone — только hero/empty state. | Смешивать Solar с Lucide, emoji и произвольными SVG в одном интерфейсе. |
| [Iconify](https://iconify.design/docs/) | Каталог/инструменты для поиска и управления множеством наборов. | Резервный discovery-инструмент, когда Solar не покрывает редкую семантику; в продукт попадает только иконка, перерисованная/согласованная с Solar. | Импорт случайных разных icon sets напрямую в UI. |
| [3Dicons](https://3dicons.co/) | Редактируемые 3D renders, включая map pin, clock, calendar, file/mail; часть коллекции CC0. | 1 controlled 3D asset в hero или success/empty/geolocation state. | 3D внутри каждой карточки отделения, кнопки или маркера карты. |
| [21st](https://docs.21st.dev/) | Библиотека UI/hero/motion references и разбор стоимости анимированных фонов. | Малые feedback-motion и один restrained hero-background; статичный fallback и `prefers-reduced-motion`. | Непрерывные canvas/WebGL эффекты на карте или критическом LCP-экране. |

## Конкретные UX-паттерны

### 1. Главная и Smart Route

**Паттерн.** Один поисковой entry point, затем сразу recommendation surface с самой выгодной точкой. Внутри — три связанных числа в фиксированной последовательности: «12 мин дорога» + «7 мин очередь» = «19 мин всего». `19 мин` — display-level metric; исходные величины — supporting labels. Рядом одна primary CTA: «Построить маршрут» или «Взять талон», но не обе с одинаковым весом.

**Почему.** На задачах выбора отделения пользователь сравнивает итоговую стоимость времени, а не отдельные показатели. Визуальная формула устраняет необходимость самостоятельно складывать значения.

**Компоненты.** `RouteCard` с variant `recommended | comparison | compact`; slot для ETA; component property `routeMode`; statuses `loading | ready | stale | unavailable`. Не создавать отдельные HomeRouteCard и MapRouteCard.

### 2. Desktop map workspace

**Паттерн.** Full-height map + закреплённая боковая панель 400–440 px. В панели: поиск, location action, список/selected branch. На карте: один выделенный pin, спокойные cluster markers, controlled zoom/location/layers. Выбор карточки и pin синхронны; выделенная карточка прокручивается в видимую область.

**Иерархия.** Карта — primary canvas; panel — navigation/context; floating controls — tertiary. Список не должен быть вторым dashboard со всеми метриками: в compact state показывать адрес, distance/ETA, очередь и status; детали — в selected state.

### 3. Mobile map и bottom sheet

**Паттерн.** Карта занимает весь viewport за вычетом компактного header и floating search. Выбранное отделение открывается как non-destructive bottom sheet с ручкой и snap-points `~28% / ~56% / ~92%`. На первом snap видны название, итоговое время, статус и одна CTA; расширение раскрывает расписание и вторичные действия. В поиске использовать отдельный full-height sheet, не закрывающий intent случайным tap.

Это согласуется с текущими primitives shadcn: Drawer поддерживает controlled snap points, swipe handle и responsive замену dialog/drawer; Dialog делает фон неактивным, когда это действительно модальный шаг ([Drawer](https://ui.shadcn.com/docs/components/base/drawer), [Dialog](https://ui.shadcn.com/docs/components/radix/dialog)). Для карты default — sheet, допускающий осмысленное возвращение к карте, а не цепочка модалок.

### 4. Поиск и геолокация

**Паттерн.** Поле поиска работает как command/search surface: recent locations, «Рядом со мной», популярные отделения, результаты с ETA. Location permission объясняется до system prompt короткой value-framing фразой: «Покажем отделение с самым коротким общим временем». После denied — non-blocking fallback: ручной поиск и «введите адрес».

**Состояния.** `idle`, `requesting`, `granted`, `denied`, `unavailable`, `offline`. Каждое состояние имеет текстовую подпись и action — цвет не единственный носитель смысла.

### 5. Получение талона

**Паттерн.** Задача — короткий guided flow: услуга → отделение → время/очередь → подтверждение. На confirmation использовать ticket-shaped bounded module: номер, место, прогноз, QR/код только если бизнес-логика уже поддерживает. Success screen — один праздник, не парад конфетти: лёгкая route-line animation или один 3D asset допустимы.

### 6. Состояния данных

| Состояние | Поведение | Визуальная форма |
| --- | --- | --- |
| Loading | Сохраняет layout, не имитирует данные. | Skeleton только для строки/карточки; нейтральная loading-line в RouteCard. |
| Empty | Объясняет, что искали и как изменить запрос. | Небольшая address-label иллюстрация + `Изменить поиск`. |
| Error | Объясняет последствия и даёт retry. | Inline alert там, где произошла ошибка; toast не заменяет persistent error. |
| Offline | Не маскирует устаревшие очереди. | Persisted timestamp + muted warning + сохранённые данные. |
| Geolocation denied | Не блокирует продукт. | Manual address field + secondary retry action. |

## Типографика: решение по Onest

**Рекомендация: оставить Onest Variable.** Сам upstream описывает Onest как гибрид геометрического и humanist grotesk, рассчитанный на читаемость на экранах, включая UI/navigation; Google Fonts metadata подтверждает variable `wght 100–900`, Cyrillic и Latin ([upstream](https://github.com/simpals/onest), [metadata](https://github.com/google/fonts/blob/main/ofl/onest/METADATA.pb)). Это ровно сочетание, нужное русскоязычному service product: дружелюбный, не бюрократический характер и хорошая плотность мелких подписей.

Предлагаемая шкала (не финальные токены):

| Роль | Размер / line-height | Вес | Применение |
| --- | --- | --- | --- |
| Display | 48/52 desktop; 36/40 mobile | 650 | Hero total-time, ключевой тезис. |
| H1 | 36/40; 30/34 | 650 | Экран/страница. |
| H2 | 28/32; 24/28 | 600 | Секции и selected branch. |
| H3 | 20/24 | 600 | Заголовок карточки. |
| Body | 16/24 | 450 | Основной текст. |
| UI label | 14/20 | 550 | Кнопки, метки, card metadata. |
| Caption | 12/16 | 500 | Timestamp, вторичная служебная информация. |
| Numeric emphasis | inherit | 600–700, `font-variant-numeric: tabular-nums` | ETA, очередь, ticket number. |

## Иконографика

Solar v2 предоставляет 1,451 distinct icons в шести стилях и Figma plugin; Linear имеет default stroke 1.5 ([Solar documentation](https://solar-icons.vercel.app/docs/v2)). Правила:

- Default — **Linear, 1.5 px**: header, формы, map controls, metadata; 20 px desktop/mobile UI.
- Compact metadata — 16 px; navigation — 22 px; button icon — 18 px; map pin glyph — 20 px внутри маркера 36–40 px.
- **Bold** только для active bottom navigation/active map tool или осознанного primary CTA; не переключать weight только ради украшения.
- Duotone допускается в hero/empty/success, но не рядом с данными очереди, где важнее однозначность.
- Icon button имеет touch box минимум 44×44; понятная `aria-label`/tooltip. Tooltip должен открываться и по keyboard focus, что прямо поддерживает primitive ([Tooltip](https://ui.shadcn.com/docs/components/base/tooltip)).

## Motion — осмысленный минимум

| Событие | Motion | Время / easing | Ограничение |
| --- | --- | --- | --- |
| Press / selected branch | opacity + 1–2 px translate / outline | 120–160 ms, standard | Не двигать карту без причины. |
| Pin → sheet selection | sheet rises; pin gains ring | 220 ms, decelerate | Sheet не перекрывает целиком карту на initial snap. |
| Smart Route calculation | 3-step route line + numeric replace | 280–400 ms | Cancel/instant static result при reduced motion. |
| List entrance | stagger максимум 3 видимых rows | 160–200 ms | Никакого повторного entrance при scroll. |
| Ticket success | single route line resolves to check | 320 ms | Без confetti loop. |

Проверка производительности обязательна: 21st отмечает, что canvas/SVG/WebGL effects могут занимать main thread/GPU; предпочтительны CSS transform/opacity и статичный reduced-motion fallback ([21st performance guidance](https://docs.21st.dev/blog/react-animated-background-components)).

## Формообразование и density

- Внешние product surfaces: radius 16 px; panel/sheet 20–24 px только у края viewport; controls 10–12 px; badge 999 px. Не делать все элементы одинаковыми capsules.
- Использовать тонкие border + surface contrast для обычной глубины; shadow — только у floating sheet, popup и map control. Карточки не вкладываются друг в друга без изменения уровня смысла.
- Базовая сетка 4 px; стандартные gaps: 4, 8, 12, 16, 24, 32, 48, 64. Плотность ближе к mobility product, а не к marketing SaaS.
- На desktop content max-width — по функции: hero 1200–1280 px; map workspace — весь доступный viewport. На mobile shell 16 px; primary controls 48 px высотой.

## Наблюдаемые source facts

- Refero собирает более 2,000 AI-readable design systems с цветом, типографикой, spacing и components; это подтверждает формат исследования через правила, а не перенос скриншота ([Refero](https://styles.refero.design/)).
- shadcn поддерживает responsive связку Dialog на desktop / Drawer на mobile, snap points, swipe handle и focus configuration; это хороший технический фундамент, но не art direction ([Drawer](https://ui.shadcn.com/docs/components/base/drawer)).
- Mobbin индексирует реальные iOS/web apps и предоставляет исследование bottom sheets, search, toasts, dialogs и flow-level паттернов ([Mobbin](https://mobbin.com/)). Конкретные закрытые экраны не цитируются и не копируются.
- 3Dicons предлагает редактируемые 3D renders, среди которых есть map pin, clock, calendar и mail/file; v1 перечислен с CC0 лицензией, но конкретный выбранный asset нужно лицензировать повторной проверкой перед export ([3Dicons](https://3dicons.co/), [V1 collection](https://3dicons.co/collection/b68cf8-v1)).

## Checklist для следующей фазы Figma

1. Создать семантические variables: `color.brand.*`, `surface.*`, `text.*`, `border.*`, `status.*`, `queue.*`, `route.*`, `map.*`; не использовать raw hex в компонентах.
2. Собрать components в порядке: Button / IconButton / Field / Search → Badge / Status / Card → BranchCard / RouteCard / TicketCard / RecommendationCard → Sheet / Dialog / Header / Map controls.
3. Создать один BranchCard с variants `compact | default | selected`, properties `photo`, `queue-state`, `recommended`, `actions`; один RouteCard с variants, описанными выше.
4. Спроектировать mobile first в 320, 360, 375, 390 и 430 px, затем desktop 1280, 1440, 1920 px; в Figma документировать изменение sheet, panel и header, а не просто растяжение layout.
5. Перед прототипом проверить AA контраст, focus state, Escape/focus return, touch targets, reduced motion и текстовые labels для всех статусов.

