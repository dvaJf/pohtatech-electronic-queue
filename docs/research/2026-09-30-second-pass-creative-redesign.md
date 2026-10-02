# Второй visual research pass — creative redesign brief

**Статус:** design-only. Production-код и Figma-файл на этом этапе не меняются (Figma MCP Starter rate limit).  
**Цель:** заменить ощущение «набор аккуратных компонентов» на запоминающийся map-first сервис, в котором Smart Route — собственный продуктовый знак.

## Вывод в одном абзаце

Текущую версию стоит не полировать, а переформатировать в направление **Civic Wayfinding / Route-to-Ticket**: спокойная городская навигация, где карта — рабочая среда, а маршрут и итоговое время — главный визуальный объект. Почтовый характер должен жить не в иллюстрациях-конвертах, а в языке координат, адресных ярлыков, талона и «пути до точки». На первом экране пользователь должен увидеть не набор карточек, а один ясный ответ: **куда идти и почему это сэкономит время**.

## Что дали источники

| Источник | Наблюдение | Решение для продукта |
| --- | --- | --- |
| [Refero Styles](https://styles.refero.design/) | Каталог систем позволяет разбирать цвета, типографику, spacing и компоненты как систему, а не копировать страницу. | Исследовать по принципу «одно решение — одна причина»; не импортировать чужую эстетику целиком. |
| [Refero: Google for Education](https://styles.refero.design/style/c57ba3f8-1d76-4660-8ba4-48ddce26e759) | Лёгкий canvas → белая surface и редкие тени дают ясную и не-dashboard иерархию. | Оставить elevation только для floating map UI, sheet и critical CTA; список отделений строить линиями и ритмом. |
| [Refero: Plain](https://styles.refero.design/style/9501cfdc-3eb3-4b64-90f6-9afdded48945) | Волосные разделители вместо теней и product-first визуал уменьшают шум. | Карта, time-equation и branch selection должны быть визуальным proof, а не декоративный hero-art. |
| [Mobbin](https://mobbin.com/) | В библиотеке есть реальные flows и отдельные паттерны bottom sheet, search, home, progress и toast. | Перед финальной реализацией сверить mobile путь на уровне flow, а не отдельных красивых экранов. |
| [shadcn Drawer](https://ui.shadcn.com/docs/components/base/drawer) | Bottom sheet может иметь snap points; action footer остаётся видимым при прокрутке. | Sheet: 28% = список, 56% = выбранное отделение, 92% = detail/ticket; CTA фиксирован снизу, контент — единственная scroll область. |
| [21st: map components](https://news.21st.dev/blog/react-map-components) | Интерактивная карта оправдана для locator; при большом числе маркеров нужны clustering/canvas layer, карта тяжела и должна lazy-load; её смысл должен существовать и текстом. | Map — полноценная product surface, но не hero-decoration. Параллельный accessible branch list обязателен; lazy-load и кластеры — будущая engineering задача. |
| [Apple HIG: Maps](https://developer.apple.com/design/human-interface-guidelines/maps) | Карта остаётся интерактивной; лёгкая place-card становится детальной только для выбранной точки, а не для каждой аннотации. | На карте виден один selected branch context; рядовые точки остаются тихими pins, details появляются прогрессивно. |
| [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) | Sheet — контекстный, не обязательно блокирующий слой: действие обновляет родительский контекст. | Mobile BranchSheet не «закрывает приложение»: pin и route остаются видимыми, результат sheet меняет map selection. |
| [Mapbox Route Line](https://docs.mapbox.com/android/navigation/guides/ui-components/route-line/) и [route callouts](https://docs.mapbox.com/android/navigation/guides/ui-components/route-callout/) | Route layer и duration callouts — самостоятельные элементы map UI. | Главный маршрут: blue line с ink casing; `19` и `27` могут стоять рядом с соответствующими линиями, а hero-total остаётся отдельным. |
| [Mapbox user location](https://docs.mapbox.com/android/maps/guides/user-location/location-on-map/) | User location — отдельный puck/halo со своим режимом recenter/follow. | Рисовать user location не как branch pin: dot+puck+accuracy halo, отдельная кнопка «вернуться к себе». |
| [Solar Icons v2](https://solar-icons.vercel.app/docs/v2) | Solar содержит Linear/Bold и Figma plugin; Linear поддерживает `strokeWidth`, дефолт — 1.5. | Единственный набор: Solar Linear 1.5, 16/20/24. Bold допустим только на selected pin, ticket success и active nav. |
| [Google Fonts: Onest metadata](https://github.com/google/fonts/blob/main/ofl/onest/METADATA.pb) | Onest — variable `wght` 100–900, с кириллицей/латиницей. | Onest остаётся самым практичным выбором: не вводить вторую гарнитуру; выразительность придёт от scale, tabular numerals и композиции. |
| [tweakcn](https://tweakcn.com/) | Тема должна управлять background/text/border/radius/shadow/typography как набором взаимосвязанных решений, включая contrast check. | Сократить систему до семантических токенов, а не множить variants и hardcoded оттенки. |

## Новая арт-дирекция: Civic Wayfinding / Route-to-Ticket

### Характер

Не «Urban Mobility SaaS», а **городской сервис, который превращает неопределённость в маршрут**. Визуальная метафора: адресная наклейка + транзитная схема + талон как подтверждение действия.

- **Главный образ:** непрерывная маршрутная нить между `Вы`, `Отделение` и `Талон`.
- **Главный объект:** крупное числовое время, собранное из пути и очереди.
- **Почтовый код:** координаты, короткие служебные labels, offset-рамка адреса, perforation/serial только в ticket/success. Никаких конвертов и марок в рабочих интерфейсах.
- **Глубина:** минимальная. Карта — отдельная нейтральная среда; поверхности появляются только когда содержат объект, требующий отделения от карты.

### Палитра (предлагаемая замена, проверить контраст в Figma)

| Роль | Token | Значение | Правило |
| --- | --- | --- | --- |
| Ink | `ink/950` | `#101A31` | Текст, маршруты, numeric total. |
| Wayfinding blue | `blue/600` | `#155EEF` | Навигация, выбранный pin, основной action. |
| Signal yellow | `yellow/400` | `#FFD451` | Только выигрыш, destination marker, ticket notch. Не фон больших блоков. |
| Mineral canvas | `neutral/50` | `#F5F7FA` | Страница. |
| Surface | `neutral/0` | `#FFFFFF` | Sheet/panel/field. |
| Map ground | `map/base` | `#E8EDF0` | Самостоятельный слой с subdued road/park/water. |
| Route | `route/main` | `#155EEF` | Нить, progress и selected path. |
| Queue | `queue/calm` / `busy` / `full` | `#1B9B72` / `#D69220` / `#D04E4B` | Всегда вместе с label, не как единственный сигнал. |

### Типографический приём

Onest сохранить. Вместо нового display-font применить **wide numeric lockup**: Onest 700–750 с табличными цифрами, negative tracking только для `19`, и тихая подпись `минут до талона`. Так результат выглядит как продуктовая информация, не как рекламный заголовок.

- `Time/hero`: 72/72 desktop, 56/56 mobile, weight 700–750, `tnum`.
- `Time/metric`: 28/30 desktop, 24/26 mobile, 650–700, `tnum`.
- `Screen title`: 42/46 desktop, 30/34 mobile, 650.
- `Body`: 16/24; metadata 13/18. Не делать 12 px обычным текстом.

## Smart Route: три композиции и выбор

### 1. Time rail — **выбрать**

`Вы ── 12 мин ── Отделение ── 7 мин ── Талон` располагается на одной независимой route rail. В центре/конце — большой `19 мин`, а yellow `−8 мин быстрее` появляется только относительно ближайшего отделения. На desktop rail идёт через hero рядом с мини-картой; на mobile — горизонтально читаемая нить внутри sheet, без вложенной card.

**Почему сильнее:** формула считывается за секунду, связывает географию с очередью, даёт собственный повторяемый паттерн на home/map/branch/ticket.

### 2. Ticket timeline

Маршрут оформлен как перфорированный талон с checkpoint-ами. Использовать только в confirmation/active ticket: выразительно, но слишком тематично для core flow.

### 3. Savings comparator

Две slim rows: «ближайшее — 27 мин» и «рекомендуемое — 19 мин». Хороший supporting proof, но не hero: он требует сравнения и не объясняет структуру времени.

## Destructive review

### Удалить

- Обязательные отдельные cards для каждого блока; single surface не нужна, если достаточно heading + divider + spacing.
- Дубли маршрута в chip, status, header и card. Smart Route получает один prominent rail, остальное — короткие метрики.
- Повторяющиеся CTA «Построить» на всех уровнях. CTA остаётся в selected context; в list действует entire row/secondary affordance.
- Цветные pills для всех статусов. Pill — только filter/short state; opening and queue можно показывать inline с Solar icon + text.
- Несколько равнозначных outlined header buttons. Location — text trigger; map — nav item; account — icon action.
- Фото отделения без выбора: если не помогает различить точку, удалить. Не превращать branch list в marketplace.

### Сохранить, но переработать

- Map + 420px desktop panel: превратить в **one workspace**, panel без nested cards.
- Mobile sheet snap logic: сохранить, но route rail и fixed action жить на разных уровнях sheet.
- BranchCard: сделать листовой объект с 3 ступенями информации, а не контейнер 15 метрик.
- Current location and recommendation: сохранить как origin/destination на route rail.
- Accessibility: visible focus, keyboard list alternative, Escape/focus return, 44px targets — неприкосновенны.

## Screen-by-screen redesign specification

### Home desktop (1440/1920)

1. **Верхняя chrome-линия**: compact logo, location trigger, «Отделения»/«Карта», account. Высота 64–72; без набора button outlines.
2. **Первый viewport**: асимметричная 5/7 grid. Слева короткая точная фраза «Выберите отделение, где талон будет раньше», origin trigger и primary action. Под ними Rail с `19 мин` как title. Справа — обрезанный городской map canvas с visible route и destination label, без фальшивой marketing-иллюстрации.
3. **Ниже fold**: две плоские колонки — nearby list и active ticket/status. Один divider между ними. Не бенто-grid.
4. В 1920 расширяется canvas/route, не текстовая колонка и не card padding.

### Map desktop (1440)

- Full-height neutral map canvas; panel 420px слева — opaque white, hairline right border, no radius against viewport.
- Sticky panel chrome: search + compact filter row; после неё **one rail**. List rows: number/pin → branch name → address → two metrics → compact total; selected row получает thin blue left keyline, не giant card.
- Selected pin — blue filled destination glyph with yellow inner dot/halo; default pins neutral white/ink; cluster ink circle + count. User location — blue dot + subtle accuracy halo.
- Floating controls вертикально справа (location, zoom, layers) как один grouped control; route preview — thin blue path with directional chevrons, не толстая line.

### Smart Route desktop

- Не отдельная success card. Large `19 мин` на mineral canvas, Time rail проходит через entire view; справа compact comparator `Ближайшее 27` / `Рекомендуем 19` и yellow saving strip.
- Ниже — selected branch detail и CTA `Взять талон`; map remains peripheral evidence.

### Selected branch desktop

- Branch identity, status и address — left. Time rail/total — right. Фото только если реальная, 4:3, 112px high, как identifying thumbnail.
- Opening hours/queue in a quiet disclosure; ticket CTA stays own fixed action region.

### Mobile home (390×844)

- Header 56px. First viewport: origin label + one sentence + `19 мин` + compact Time rail. Primary CTA below thumb line; map fragment is 150–180px visual evidence, not background image.
- Nearby remains a single list entry/link, not card carousel.

### Mobile map and sheet

- Map retains at least 50% visual height in collapsed/medium states. Sheet radius only on top edge; no card margins that make it look like floating dialog.
- Collapsed: one destination/result row. Medium: selected branch + metrics + route rail. Expanded: details, then sticky ticket action.
- Map controls right-middle above sheet; user location control remains reachable. Search is a top floating bar.
- При каждом snap/state камера пересчитывает safe area, чтобы selected pin, origin и route не оказались под sheet — это обязательная interaction-spec, а не cosmetic detail.

### Ticket / active ticket

- Ticket as a singular asset: serial/branch/time plus controlled perforation notch. Use yellow once at tear edge or serial highlight.
- Active status shows route to branch / ticket number / call state in a calm ordered stack. Never animate decorative 3D endlessly.

### States

- Loading: animate route stroke and use skeleton text only where data is unknown.
- Stale: retain last route, timestamp it and provide refresh; do not replace useful information with an error canvas.
- Offline/denied: direct copy + one action, location fallback to address search. Avoid modal for initial geolocation.

## Component architecture: simplify, do not multiply

```text
AppShell
├── ServiceHeader
├── RouteRail                       # signature component
│   ├── OriginNode
│   ├── TravelSegment
│   ├── DestinationNode
│   ├── QueueSegment
│   └── TimeTotal
├── MapWorkspace
│   ├── MapCanvas
│   ├── MapPin (default|recommended|selected|cluster|user)
│   ├── MapControls
│   ├── MapSearch
│   └── BranchPanel (desktop) / BranchSheet (mobile)
├── BranchListRow                   # replaces card spam
├── BranchDetail
├── TicketSurface
└── FeedbackState
```

### Component decisions

| Component | Keep / change | Proposed variants |
| --- | --- | --- |
| Button | Simplify 72 variants. | `primary|secondary|quiet|danger` × `sm|md|lg`; state is interaction, not a showcase variant. |
| IconButton | Keep one semantic component. | `plain|map|selected`; 44px target, icon 20/24. |
| Status | Split visual tone from semantic label. | Inline `open|closed|queue`; filters are separate FilterChip. |
| BranchCard | Replace default usage with `BranchListRow`; keep a single `BranchDetail` object. | `list|selected|sheet` only. |
| RouteCard | Replace with `RouteRail` and optional `RouteSummary`. | `hero|compact|comparison`, + data state. |
| BottomSheet | Preserve exact functional variants. | `list|branch|route|ticket` × snap state; not screenshot-specific components. |

## Token refactor

Reduce token bureaucracy. Keep semantic names and eliminate tokens that only mirror a one-off component.

```text
color: bg.canvas / bg.surface / bg.map / text.primary / text.secondary /
       line.subtle / action.primary / action.primary-hover / accent.signal /
       route.primary / queue.calm|busy|full / feedback.success|warning|danger
space: 4, 8, 12, 16, 24, 32, 48, 64
radius: 8 (control), 12 (surface), 20 (sheet only), full (filter only)
shadow: floating only, overlay only
type: display, screen-title, section-title, body, meta, time-hero, time-metric
motion: fast 140, standard 220, emphasis 320; opacity/transform/path-dash only
```

## Icon strategy (implementation-ready)

Use real **Solar Linear** assets at 1.5 stroke: `Route`, `MapPoint`, `PointOnMap`, `Ticket`, `User`, `Magnifer`, `ClockCircle`, `UsersGroupRounded`, `ArrowLeft`, `AltArrowRight`, `CloseCircle`, `CheckCircle`, `DangerTriangle`. Confirm exact icon names via the Solar Figma plugin/catalog before insertion. The Solar docs specify a Figma plugin and tree-shakable packages, so the design/engineering assets can be kept identical. [Solar Icons](https://solar-icons.vercel.app/docs/v2)

`Построить маршрут` must use `Route` / `MapPoint`, never `ArrowRight`; container 20×20, 8px text gap, `currentColor`, no negative offsets.

## Figma execution when the MCP limit clears

1. **Structure pass:** create `Redesign / Civic Wayfinding` sections under existing pages; preserve first version in Archive/Exploration section. Replace screen composition first.
2. **Language pass:** migrate foundations to the shortened semantic token set; real Solar instances; Time rail; map graphic rules.
3. **Polish pass:** inspect each key frame at 100%; remove a container whenever hierarchy survives without it; test 390, 360, 430, 1440 and 1920.
4. Prototype: link rail/action transitions Home → recommendation → map → selected branch → ticket → active ticket. Motion only opacity/transform/path-dash; reduced-motion final states.

## Engineering implications (future only)

- Split monoliths into `MapWorkspace`, `RouteRail`, `BranchListRow`, `BranchDetail`, `BranchSheet`, `TicketSurface`.
- Consolidate existing CSS into semantic token layer; remove literal Tailwind colors and duplicate component styling.
- Replace Lucide/misc SVG with Solar imports; tree-shake per-icon rather than shipping an entire set.
- Lazy-load interactive map and route-heavy calculations; use a static/decorative map fragment on Home until it needs interaction.
- Cluster pins/canvas layer at high counts and preserve a keyboard-accessible textual list; both performance and accessibility requirements are supported by the 21st map analysis. [21st](https://news.21st.dev/blog/react-map-components)
