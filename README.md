<div align="center">

# Цифровая очередь нового поколения
### Хакатон PostCode Challenge 2026 • Кейс «Электронная очередь для Почты России»
**Команда «5 указателей»**

[![Live Demo](https://img.shields.io/badge/Live_Demo-pointers--team.tech-003B73?style=for-the-badge&logo=nginx&logoColor=white)](https://pointers-team.tech/)
[![Backup Demo](https://img.shields.io/badge/Backup-post--queue.duckdns.org-054FA6?style=for-the-badge)](https://post-queue.duckdns.org/)
[![Frontend Tests](https://img.shields.io/badge/Frontend_Tests-node--test-10B981?style=for-the-badge)](#тестирование-и-верификация)
[![Jury Gate](https://img.shields.io/badge/Jury_Gate-T1--T10-10B981?style=for-the-badge)](#соответствие-тз-и-сценарии-жюри)
[![Slides](https://img.shields.io/badge/Slides-PPTX-E11D48?style=for-the-badge&logo=microsoftpowerpoint&logoColor=white)](docs/presentation/postcode_queue_presentation.pptx)

<br/>

![Go](https://img.shields.io/badge/Go-1.25-00ADD8?style=flat-square&logo=go&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v3-38BDF8?style=flat-square&logo=tailwindcss&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-K3s-326CE5?style=flat-square&logo=kubernetes&logoColor=white)
![ArgoCD](https://img.shields.io/badge/GitOps-ArgoCD-EF7B4D?style=flat-square&logo=argo&logoColor=white)
![TLS 1.3](https://img.shields.io/badge/TLS_1.3-Let's_Encrypt-10B981?style=flat-square&logo=letsencrypt&logoColor=white)

<br/>

**«Меньше неопределённости. Больше времени для людей.»**
Система управления электронной очередью для почтовых отделений: предварительная запись, QR-талон со смартфона и живая очередь с единым детерминированным механизмом вызова на базе срока обслуживания (`due_at`).
Включает персональный «Умный маршрут», подтверждение онлайн-записи по OTP-коду или одноразовой email-ссылке, динамический расчет времени ожидания (ETA), надежную доставку операционных уведомлений через Transactional Outbox, рабочие места оператора и начальника ОПС, а также табло зала с речевым вызовом.

---

</div>

## Содержание

1. [Быстрый запуск](#быстрый-запуск)
2. [Состав локального окружения](#состав-локального-окружения)
3. [Структура репозитория](#структура-репозитория)
4. [Конфигурация](#конфигурация)
5. [Возможности системы](#возможности-системы)
6. [Умный маршрут и геосервисы](#умный-маршрут-и-геосервисы)
7. [Онлайн-запись и подтверждение](#онлайн-запись-и-подтверждение)
8. [Соответствие ТЗ и сценарии жюри](#соответствие-тз-и-сценарии-жюри)
9. [Алгоритм очереди](#алгоритм-очереди)
10. [Надежность и уведомления](#надежность-и-уведомления)
11. [Архитектура системы](#архитектура-системы)
12. [CI/CD и GitOps-деплой](#cicd-и-gitops-деплой)
13. [API](#api)
14. [Локальная разработка](#локальная-разработка)
15. [Тестирование и верификация](#тестирование-и-верификация)
16. [Эксплуатация и диагностика](#эксплуатация-и-диагностика)
17. [Российский технологический контур](#российский-технологический-контур)
18. [Масштабирование](#масштабирование)
19. [Дополнительные материалы](#дополнительные-материалы)

---

## Быстрый запуск

### Требования

* Linux, macOS или Windows с Docker Engine и Docker Compose v2;
* для запуска без Docker: Go 1.25+, Node.js 22.12+, npm и PostgreSQL 17;
* рекомендуется от 4 ГБ оперативной памяти для полного Compose-стека;
* свободные порты хоста: 5173 (Frontend), 8080 (Backend API), 8081 (Swagger), 3001 (Grafana). Остальные инфраструктурные сервисы публикуются только на `127.0.0.1`.

### Запуск

```bash
# 1. Клонирование репозитория и переход в директорию
git clone https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/5-ukazateley/tsifrovaya-ochered-novogo-pokoleniya.git
cd tsifrovaya-ochered-novogo-pokoleniya

# 2. Создание файла конфигурации окружения
cp .env.example .env

# 3. Сборка и запуск контейнеров
docker compose up --build -d

# 4. Проверка готовности ядра сервиса
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/ready

# 5. Состояние контейнеров и последние логи
docker compose ps
docker compose logs --tail=100 backend frontend
```

`/health` подтверждает, что HTTP-процесс работает. `/ready` дополнительно проверяет подключение к PostgreSQL; только ответ `200` от `/ready` означает готовность API обслуживать запросы.

Остановить окружение без удаления данных:

```bash
docker compose down
```

> [!CAUTION]
> `docker compose down -v` удаляет именованные volumes, включая локальную базу данных и состояние мониторинга. Используйте эту команду только для полного сброса demo-окружения.

### Интерфейсы

#### Локальный запуск

* Клиентский портал: [http://localhost:5173/](http://localhost:5173/)
* Стойка входа (QR-скан): [http://localhost:5173/q/11111111-1111-1111-1111-111111111111](http://localhost:5173/q/11111111-1111-1111-1111-111111111111)
* Табло вызова зала (TV Board): [http://localhost:5173/tv?branchId=11111111-1111-1111-1111-111111111111](http://localhost:5173/tv?branchId=11111111-1111-1111-1111-111111111111)
* Пульт оператора: [http://localhost:5173/operator](http://localhost:5173/operator)
* Панель начальника ОПС: [http://localhost:5173/admin](http://localhost:5173/admin)
* Терминал зала (Kiosk): [http://localhost:5173/kiosk/11111111-1111-1111-1111-111111111111](http://localhost:5173/kiosk/11111111-1111-1111-1111-111111111111)
* Swagger UI: [http://localhost:8081](http://localhost:8081)
* Дашборд Grafana: [http://localhost:3001/grafana/](http://localhost:3001/grafana/)

#### Публичный стенд

* Клиентский портал: [https://pointers-team.tech/](https://pointers-team.tech/)
* Стойка входа (QR-скан): [https://pointers-team.tech/q/11111111-1111-1111-1111-111111111111](https://pointers-team.tech/q/11111111-1111-1111-1111-111111111111)
* Табло вызова зала (TV Board): [https://pointers-team.tech/tv?branchId=11111111-1111-1111-1111-111111111111](https://pointers-team.tech/tv?branchId=11111111-1111-1111-1111-111111111111)
* Пульт оператора: [https://pointers-team.tech/operator](https://pointers-team.tech/operator)
* Панель начальника ОПС: [https://pointers-team.tech/admin](https://pointers-team.tech/admin)
* Терминал зала (Kiosk): [https://pointers-team.tech/kiosk/11111111-1111-1111-1111-111111111111](https://pointers-team.tech/kiosk/11111111-1111-1111-1111-111111111111)
* Swagger UI: [https://pointers-team.tech/docs/](https://pointers-team.tech/docs/)
* Дашборд Grafana: [https://pointers-team.tech/grafana/](https://pointers-team.tech/grafana/)

### Тестовые учетные записи

> [!NOTE]
> Тестовые учетные записи предназначены исключительно для намеренно открытого demo-окружения и стенда хакатона. Учетные записи оператора и начальника имеют повышенные права: не переносите эти пароли в другое окружение и отключите demo-доступ после показа. Перед внешним развертыванием замените все demo-пароли, токены и ключи, исключите их из Git и передавайте секреты через Kubernetes Secret или внешний Secret Manager.

| Роль | Email | Пароль | Назначение |
|---|---|---|---|
| Начальник ОПС (`opc_chief`) | `admin@pochta.local` | `admin1234` | Управление окнами, сменами, политикой весов, пользователями, аналитикой, печатью А4 |
| Оператор окна (`employee`) | `operator@pochta.local` | `operator1234` | Выбор окна, вызов следующего талона (`CallNext`), вызов по номеру, завершение, перенаправление, инциденты |
| Клиент (`client`) | *Без авторизации* | *Свободный* | Выбор услуги, запись на слот 24ч, получение талона QR/терминала, отслеживание ETA, отмена |

---

## Состав локального окружения

`docker-compose.yml` поднимает не только приложение, но и инфраструктуру разработки:

| Сервис | Назначение | Адрес с хоста |
|---|---|---|
| `frontend` | React 19 SPA под Vite dev server | `http://localhost:5173` |
| `backend` | Go REST API, миграции, outbox worker | `http://localhost:8080` |
| `postgres` | Основное транзакционное хранилище | `127.0.0.1:5432` |
| `swagger` | OpenAPI UI | `http://localhost:8081` |
| `notification-demo` | Локальный приемник уведомлений | `127.0.0.1:8082` |
| `ml-service` | Опциональная модель прогноза ETA | `127.0.0.1:8090` |
| `rag-agent` | AI-консультант и инструменты очереди | `127.0.0.1:8095` |
| `prometheus` / `postgres-exporter` | Метрики приложения и PostgreSQL | `127.0.0.1:9090` |
| `alertmanager` | Маршрутизация алертов | `127.0.0.1:9093` |
| `loki` / `promtail` | Сбор и хранение логов | `127.0.0.1:3100` |
| `grafana` | Дашборды наблюдаемости | `http://localhost:3001/grafana/` |
| `postgres-backup` | Резервная копия PostgreSQL каждые 6 часов | каталог `./backups` |

Основной пользовательский сценарий требует `postgres`, `backend` и `frontend`. SMTP, SMS, Telegram, Web Push, ML и RAG являются опциональными интеграциями: при отсутствии их ключей ядро очереди продолжает работать, а недоступный ML должен откатываться на детерминированный ETA.

---

## Структура репозитория

```text
.
├── backend/                 # Go API, domain/application/persistence, SQL-миграции
│   ├── cmd/api/             # entrypoint API и notification-demo
│   ├── internal/            # домен, HTTP, PostgreSQL, auth, уведомления, Alice
│   └── migrations/          # versioned golang-migrate SQL
├── frontend/                # React 19 + TypeScript + Vite + Tailwind
│   ├── src/api/             # типизированные HTTP-клиенты
│   ├── src/features/        # client, operator, admin, auth, chat
│   ├── src/components/ui/   # UI primitives
│   └── tests/               # Node test runner и browser harnesses
├── services/
│   ├── ml-service/          # Python ETA model service
│   └── rag-agent/           # Python AI-консультант
├── helm/queue-chart/        # production source of truth для Kubernetes
├── k8s/                     # ArgoCD и legacy manifests
├── monitoring/              # Prometheus, Alertmanager, Loki, Grafana, Promtail
├── qa/                      # jury gate и sprint/release проверки
├── tests/                   # cross-service E2E и audit scripts
├── scripts/                 # GitOps deploy, seed, backup/restore, load test
└── docs/                    # OpenAPI, алгоритмы, эксплуатация, масштабирование
```

Backend — модульный монолит: HTTP-слой не содержит SQL, бизнес-контракты находятся в `internal/application`, модели и правила — в `internal/domain`, транзакционная реализация — в `internal/persistence`.

---

## Конфигурация

Локальные значения берутся из `.env`; исходный шаблон — `.env.example`. Обязательные для backend параметры валидируются при старте.

| Группа | Переменные | Назначение |
|---|---|---|
| Runtime | `APP_ENV`, `LOG_LEVEL`, `HTTP_PORT`, `TZ` | Режим, логирование, порт API и business timezone |
| PostgreSQL | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Подключение к основному хранилищу |
| Browser/API | `CORS_ALLOWED_ORIGIN`, `VITE_API_BASE_URL`, `FRONTEND_PORT` | Origin, API base URL и порт Vite |
| Confirmation | `SMTP_*`, `ALLOW_TEST_APPOINTMENT_CONFIRM` | Email OTP/one-click и строго dev/test подтверждение |
| Notifications | `TELEGRAM_*`, `WEB_PUSH_*`, `SMSAERO_*`, `SMSRU_API_KEY` | Каналы доставки уведомлений |
| AI | `OPENAI_*`, `GIGACHAT_*`, `RAG_AGENT_URL` | RAG-консультант; ключи необязательны |
| Observability | `GRAFANA_USER`, `GRAFANA_PASSWORD`, `TELEGRAM_CHAT_ID` | Grafana и доставка алертов |

Правила безопасности:

* не коммитьте заполненный `.env`;
* `ALLOW_TEST_APPOINTMENT_CONFIRM` должен быть выключен в production;
* CORS принимает список полных `http(s)` origins без wildcard и path;
* после публикации случайно раскрытый токен необходимо отозвать и выпустить заново, а не только удалить из Git;
* production-секреты не должны храниться в обычном Helm values-файле.

---

## Возможности системы

| Область | Функциональность | Описание реализации |
|---|---|---|
| Источники талонов | Предварительная запись (`APPOINTMENT`), QR-код стойки (`QR`), терминал зала (`LIVE`) | Запись с email сначала создается в `PENDING_CONFIRMATION`, после подтверждения переходит в `SCHEDULED` (`due_at = scheduled_at`, `source_rank = 0`). `/arrive` фиксирует ранний приход и переводит запись в `WAITING`; без ручного arrival подтвержденная запись становится доступной `CallNext` при наступлении слота. Мобильный талон `Q-XXXXXX`, талон терминала `L-XXXXXX`. |
| Умный маршрут | Расчет наилучшего отделения | Анализ расстояния (Haversine), времени пешего пути, загрузки залов и реальных графиков работы. Исключение отделений, куда клиент не успеет до закрытия. |
| Онлайн-запись | Календарь на 14 дней с OTP-подтверждением | Выбор даты и слота в 24-часовом формате, отправка 6-значного OTP-кода на почту, однократная ссылка подтверждения, защита слота на 15 минут. |
| Экспорт в календарь | Поддержка .ics (iCalendar) | Экспорт записи в календарь (Apple, Google, Outlook). Доступен до визита в отделение, автоматически скрывается после отметки о прибытии. |
| Управление приемом | Бесконфликтный вызов (`CallNext`) | Назначение талона с учетом набора услуг окна (`window_services`), атомарная защита транзакцией PostgreSQL с `FOR UPDATE SKIP LOCKED`. |
| Жизненный цикл | Конечный автомат состояний (FSM) | `SCHEDULED` -> `WAITING` -> `CALLED` -> `SERVING` -> `COMPLETED` (а также прямой вызов `SCHEDULED` -> `CALLED` по наступлению времени слота). |
| Исключения и маневры | Неявка, возврат, перенаправление | Фиксация неявки (`NO_SHOW`), возврат отошедшего клиента в начало очереди (`RETURNED`), перевод талона на другую услугу или окно (`REDIRECTED`). |
| Окна и смены | Жизненный цикл окон | Смена статусов (`OPEN`, `PAUSED`, `CLOSING`, `CLOSED`), корректное завершение активного обслуживания перед закрытием окна. |
| Политика очередей | Динамический `QueuePolicy` | Настройка начальником ОПС весов источников, льготного окна и лимитов ожидания с немедленным пересчетом очереди. |
| Прогноз ожидания | Динамический ETA | Расчет оставшегося времени на базе скользящей выборки длительностей завершенных талонов с отсечением аномалий (>7200с). |
| Оповещения | Multi-Channel Transactional Outbox | Асинхронная доставка через Telegram-бота, Web Push, SMS (SMS Aero / SMS.RU) и SMTP (Яндекс.Почта TLS). |
| Зал и табло | TV Board и синтез речи | Отображение вызванных талонов на табло с воспроизведением 2-тонального гонга и голосового вызова (Web Audio и Web Speech API). |
| Стойка отделения | Печать плаката А4 | Экран предпросмотра плаката стойки для планшетов и поддержка `@media print` с заполнением 100% листа А4 для печати на принтере. |
| Аудит и аналитика | Неизменяемый журнал и инциденты | Защита от модификации истории аудита триггером БД (`ticket_events`), регистрация операционных инцидентов (`operator_incidents`), дашборд аномалий. |
| Безопасность | Аутентификация и RBAC | Серверные сессионные куки в PostgreSQL, хеширование паролей, разграничение прав доступа по ролям (`employee`, `opc_chief`). |

---

## Умный маршрут и геосервисы

Модуль «Умный маршрут» анализирует физическую доступность отделений в реальном времени. Immediate flow и будущая запись используют разные правила eligibility:

1. **Каталог 53 отделений:** Демонстрационный frontend-каталог содержит отделения Москвы и региональные узлы с координатами, графиками и фотографиями; API-данные и координаты из БД имеют приоритет при сопоставлении.
2. **Формула суммарного времени:**
   $$\text{Время всего} = \text{Время в пути (Haversine/пешком)} + \text{Время ожидания в очереди}$$
   Базовая оценка пути — расстояние по прямой Haversine, преобразованное из расчета 5 км/ч (`12 мин/км`). Это ориентир, а не маршрут по дорожной сети; UI не должен называть его точным временем навигации.
3. **Талон прямо сейчас:** в рейтинг попадают только открытые отделения с нужной услугой, работающей очередью и достаточным временем до закрытия с учетом дороги и ожидания. Сначала применяется eligibility-фильтр, затем сортировка по `travel + queue`.
4. **Предварительная запись:** закрытое сейчас отделение не исключается автоматически. Важны услуга, расписание выбранного дня, доступные слоты и окно записи `today ... today + 14` включительно.
5. **Геопозиция и сортировка:** расстояние считается по Haversine от свежей GPS-точки или явно выбранной пользователем точки. Без координат интерфейс не должен выдавать фиктивную сортировку «по удаленности» от центра города.
6. **Fallback:** если подходящих отделений для живого талона нет, интерфейс сообщает об этом и предлагает будущую запись вместо рекомендации закрытого отделения.
7. **Мобильная оптимизация:**
   - Адаптивные состояния рассчитаны на ширины iPhone 390/393/430px; автоматический audit использует Chromium с мобильными viewport и Safari User-Agent, поэтому перед релизом требуется отдельная ручная проверка в реальном iOS Safari.
   - Минимальный размер интерактивных элементов 44px (`min-h-11`).
   - Использование `100dvh` и учет системных отступов (`env(safe-area-inset-bottom)`).
   - Компактные подписи кнопок, исключающие обрезание текста на узких экранах (360–393px).

---

## Онлайн-запись и подтверждение

Процесс предварительной записи исключает фиктивные бронирования и гарантирует доступность слотов:

```
[Выбор отделения и услуги]
            │
            ▼
[Выбор даты и времени слота (24ч)]
            │
            ▼
[Ввод email клиента] ──► Создание талона в статусе PENDING_CONFIRMATION
            │            (слот заблокирован на 15 минут)
            ├────────────────────────────────────────┐
            ▼                                        ▼
[Ввод 6-значного OTP-кода]              [Переход по ссылке из письма]
            │                                        │
            └───────────────────┬────────────────────┘
                                ▼
                   Подтверждение бронирования:
                   статус переходит в SCHEDULED
                                │
                                ▼
         Отображение в «Моих талонах» + Экспорт в календарь (.ics)
```

* **Асинхронная отправка:** Письмо с кодом отправляется в фоновой горутине с таймаутом 25 секунд, не задерживая отклик интерфейса. Этот initial confirmation-email не проходит через transactional outbox и может потребовать resend после аварийного завершения backend.
* **Backend — источник истины:** UI не считает запись подтвержденной по local storage. После OTP или email-ссылки он повторно получает состояние талона с API и только при `SCHEDULED` открывает «Мои талоны».
* **Восстановление после reload:** локально сохраняется только идентификатор незавершенного flow. Диалог восстанавливается, если backend по-прежнему возвращает `PENDING_CONFIRMATION` и `confirmationExpiresAt > now`.
* **Повторная отправка:** resend меняет код/токен той же записи, но не продлевает исходный 15-минутный срок удержания слота.
* **Синхронизация вкладок:** если ссылка из письма открыта на другом устройстве или во второй вкладке, диалог периодически запрашивает backend и закрывается после подтвержденного серверного перехода.
* **«Мои талоны»:** незавершенный `PENDING_CONFIRMATION` не отображается обычной карточкой; пользователь попадает в раздел только после успешного подтверждения.
* **Календарный файл (.ics):** Доступен для скачивания до момента прибытия в отделение; после нажатия кнопки «Я уже в отделении» скрывается как неактуальный.

Календарное ограничение и срок подтверждения — независимые правила:

| Правило | Значение | Где контролируется |
|---|---:|---|
| Максимальная дата новой записи | сегодня + 14 календарных дней включительно | frontend calendar и backend validation |
| Срок подтверждения созданной записи | 15 минут от первоначального создания | `confirmationExpiresAt` backend |

Границы календаря вычисляются в business timezone проекта `Europe/Moscow`, а не через слепое преобразование локальной даты браузера в UTC.

---

## Соответствие ТЗ и сценарии жюри

Все 10 обязательных сценариев ТЗ проверяются автоматизированным тестом:

```bash
python3 qa/jury_gate.py
```

Для запуска gate нужен уже поднятый Compose/QA-стенд с demo-данными и доступным API (`BASE_URL`, по умолчанию `http://localhost:8080`). Скрипт изменяет состояние очереди, окон и талонов — не запускайте его на production.

| # | Сценарий ТЗ | Проверяемый инвариант |
|---|---|---|
| 1 | Appointment creation | После email-confirmation запись находится в `SCHEDULED` с `due_at = scheduled_at`; прибытие переводит ее в живую очередь. |
| 2 | Physical QR ticket | QR-flow создает `Q-XXXXXX` в `WAITING` для выбранного отделения и услуги. |
| 3 | Free Window CallNext | Свободное совместимое окно вызывает допустимого кандидата, фиксируя `CALLED` и событие аудита. |
| 4 | Concurrent two-Window CallNext | При двух параллельных вызовах один талон назначается ровно одному окну благодаря `FOR UPDATE SKIP LOCKED`. |
| 5 | Close active Window | Окно в `SERVING` переходит через `CLOSING` и завершает текущего клиента до `CLOSED`. |
| 6 | Redirect | Перенаправление создает `REDIRECTED`, возвращает талон в очередь и сохраняет историю. |
| 7 | Restart recovery | После рестарта состояние талонов, сессий и политик восстанавливается из PostgreSQL. |
| 8 | Notification service unavailable | Ошибка внешнего шлюза не откатывает `CallNext`; outbox повторяет доставку независимо. |
| 9 | Concurrent Ticket creation | Один `Idempotency-Key` при конкурентных запросах создает ровно один талон. |
| 10 | Manager analytics | Начальник ОПС получает агрегаты очереди и зарегистрированные инциденты из реальных данных. |

---

## Алгоритм очереди

Логика распределения талонов исключает субъективность при вызове клиентов.

### Канонический вектор ранжирования

```text
ORDER BY t.due_at ASC, t.source_rank ASC, t.checkin_at ASC, t.id ASC
```

* `due_at ASC`: Защита от долгого ожидания и голодания (Aging & Wait Protection). Расчетный дедлайн обслуживания формируется с учетом порога ожидания (`anti_starvation_threshold_minutes`). По мере ожидания расчетный срок приближается, продвигая заждавшихся клиентов вперед.
* `source_rank ASC`: При совпадении дедлайнов действует ранг из `queue_policy.yaml`; значения по умолчанию — `APPOINTMENT` = 0, `QR` = 1, `LIVE` = 2.
* `checkin_at ASC`: При равном дедлайне и ранге источника первым вызывается клиент, зарегистрировавшийся в отделении раньше.
* `id ASC`: Финальное устранение неоднозначности при полном совпадении временных меток.

### Конкурентность

Вызов талона выполняется SQL-запросом с конструкцией `FOR UPDATE OF t SKIP LOCKED`. Параллельные вызовы операторов разных окон мгновенно пропускают уже захваченные строки без взаимных блокировок (Deadlocks) и без риска двойного вызова.

---

## Надежность и уведомления

1. **Transactional Outbox:** Вызов оператором фиксируется в базе атомарно вместе с записью в таблицу `notification_outbox`. Ошибки внешних шлюзов не влияют на скорость работы оператора. Отправка первоначального appointment confirmation-email описана отдельно и не обладает этой гарантией.
2. **Telegram Bot (`@poiters_inno_bot`):** Привязка чата по одноразовому токену с 15-минутным сроком действия. Мгновенные уведомления о статусе («Ваш талон вызван в окно №3»).
3. **Web Push:** Интеграция по стандарту VAPID. Честное определение поддержки push-уведомлений браузером.
4. **SMTP (Яндекс.Почта TLS):** Отправка кодов подтверждения с экспоненциальным backoff.
5. **SMS-шлюзы:** Поддержка провайдеров SMS Aero и SMS.RU.

---

## Архитектура системы

```text
[ Пользователь / Браузер ]
            │
            ▼
[ Cloudflare Edge ] (DNS, WAF, Edge SSL)
            │
            ▼
[ Host Nginx ] (Порты 80 / 443, SSL Let's Encrypt Certbot, WebSocket Proxy)
            │
            ▼
[ Traefik Ingress Controller ] (Внутри K3s кластера, L7 Routing)
            ├── / ────► [ Frontend Pods ] (2 реплики, Nginx 1.27 + React 19 SPA)
            ├── /api ─► [ Backend Pods ]  (2 реплики, Go 1.25 Modular Monolith)
            ├── /docs ► [ Swagger UI ]
            └── /grafana ► [ Grafana Monitor ]
                              │
                              ▼
                  [ PostgreSQL 17 ] (Persistent Volume, Outbox, Events)
```

API stateless относительно процесса: талоны, сессии, аудит, политики и outbox хранятся в PostgreSQL. Это позволяет запускать несколько backend-реплик; конкурентный выбор следующего талона сериализуется транзакцией БД. Периодические клиенты используют повторное чтение server state, поэтому перезагрузка страницы не должна становиться источником нового статуса.

Дополнительные контуры:

* `ml-service` подключается через адаптер ETA; недоступность сервиса не должна останавливать основную очередь;
* `rag-agent` проксируется backend через `/api/v1/agent/*` и не имеет прямого доступа из браузера к внутренним сервисам;
* outbox worker работает внутри backend и изолирует бизнес-транзакцию от SMTP/SMS/Telegram/Web Push;
* Prometheus собирает метрики `/metrics`, Loki принимает контейнерные логи, Grafana объединяет их в операционные дашборды.

---

## CI/CD и GitOps-деплой

В проекте реализована полностью автоматизированная GitOps-доставка без ручного доступа на сервер:

```text
Разработчик делает git push в feature-ветку
                │
                ▼
GitLab Merge Request ──► Merge в ветку main
                               │
                               ▼
    Серверный systemd-таймер (pointers-deploy.timer, раз в 30 секунд)
                               │
                               ▼
        Запуск скрипта scripts/gitops-autodeploy.sh:
        1. Проверка изменений в origin/main по отношению к last-deployed-sha
        2. Сборка Docker-образов только изменившихся сервисов:
           • vacuumxvx/queue-frontend:v-<sha>
           • vacuumxvx/queue-backend:v-<sha>
        3. Публикация образов в Docker Hub
        4. Обновление тегов в helm/queue-chart/values.yaml
        5. Коммит и push в GitOps-ветку origin/infra/k8s-gitops
                               │
                               ▼
        ArgoCD отслеживает ветку infra/k8s-gitops
                               │
                               ▼
        Применение Kubernetes manifests в кластере
                               │
                               ▼
                    Проверка health/readiness
```

Backend обновляется rolling-стратегией. Frontend использует `Recreate`: каждый Vite build имеет собственный набор content-hashed assets, поэтому одновременная раздача старого и нового `index.html` разными pod может создать несовместимую пару HTML/JS. В nginx `/assets/` не использует SPA fallback, отсутствующий asset возвращает `404`, успешные hashed assets кэшируются как immutable, а `index.html` — с `no-cache/no-store`.

Source of truth для production — `helm/queue-chart/` в ветке `infra/k8s-gitops`. Изменение кода в `main` само по себе еще не означает завершенный deploy: необходимо дождаться сборки image, обновления GitOps-ветки и состояния ArgoCD `Synced/Healthy`. Подробная процедура находится в [docs/GITOPS_DEPLOYMENT.md](docs/GITOPS_DEPLOYMENT.md).

Первичная установка K3s/ArgoCD, repository credentials и systemd timer не выполняется из README: используйте [docs/DEVOPS_GUIDE_RU.md](docs/DEVOPS_GUIDE_RU.md), Ansible playbooks из `ansible/` и шаблон `scripts/pointers-deploy.env.template`. Штатный rollback делается revert-коммитом в GitOps-ветке, чтобы желаемое состояние оставалось зафиксировано в Git, а не только вручную в кластере.

---

## API

Целевой HTTP-контракт описывается в формате OpenAPI 3.0. При изменении runtime-маршрутов спецификацию необходимо обновлять в том же merge request; команда parity-check ниже обнаруживает расхождения между кодом и YAML.

* Интерактивный интерфейс Swagger UI: [https://pointers-team.tech/docs/](https://pointers-team.tech/docs/)
* Спецификация OpenAPI 3.0: [docs/openapi.yaml](docs/openapi.yaml)

### Группы маршрутов API

| Префикс | Доступ | Назначение |
|---|---|---|
| `/health`, `/ready`, `/metrics` | служебный | liveness, readiness PostgreSQL и Prometheus metrics |
| `/api/v1/auth` | публичный / сессия | регистрация, email/phone confirmation, login/logout, OAuth, профиль |
| `/api/v1/branches` | публичный | каталог отделений, услуги, workload, отзывы и создание талона |
| `/api/v1/appointments` | публичный + management token | создание, OTP/one-click confirmation, resend, cancel, arrival |
| `/api/v1/tickets` | публичный + ownership/token | состояние талона, позиция, ETA, отмена, feedback, уведомления |
| `/api/v1/operator` | `employee`, `opc_chief` | вызов, начало/завершение обслуживания, неявка, возврат, redirect |
| `/api/v1/admin` | преимущественно `opc_chief` | окна, смены, пользователи, расписание, политика очереди, аудит |
| `/api/v1/terminal` | terminal session | создание живого талона и получение услуг отделения |
| `/api/v1/integrations` | webhook | Telegram и Алиса |
| `/api/v1/agent` | proxy | RAG-консультант |

Изменяющие запросы создания талона требуют заголовок `Idempotency-Key`. Для управления гостевым талоном backend возвращает `managementToken`; его нельзя логировать или передавать другому клиенту. Ошибки API имеют стабильную форму `error.code`, `error.message`, `error.requestId`; UI не должен показывать пользователю необработанный текст SQL или `Internal Server Error`.

---

## Локальная разработка

### Frontend

```bash
cd frontend
npm ci
npm run dev       # Vite на :5173, /api проксируется в backend
npm test          # node:test
npm run typecheck
npm run build     # typecheck + production bundle
```

Основные feature-модули находятся в `frontend/src/features`, API-клиенты — в `frontend/src/api`, общие primitives — в `frontend/src/components/ui`. Не храните авторитетный статус талона в local storage: после mutation требуется refetch соответствующего server state.

### Backend

```bash
cd backend
go test ./...
go vet ./...
go run ./cmd/api
```

При запуске напрямую backend читает `.env` из текущего или родительского каталога. PostgreSQL должен быть доступен по указанным параметрам; миграции применяются автоматически при старте. Явные команды мигратора:

```bash
cd backend
go run ./cmd/api migrate version
go run ./cmd/api migrate up
```

### Демо-каталог отделений

Дополнительный каталог загружается идемпотентным SQL-скриптом. Он не должен выполняться против рабочей базы без проверки содержимого:

```bash
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < scripts/seed_demo_branches.sql
```

---

## Тестирование и верификация

README не фиксирует вечный счетчик «N/N PASS»: набор тестов меняется, а достоверный результат дает только свежий запуск на текущем commit.

| Уровень | Что проверяет | Команда |
|---|---|---|
| Frontend unit/source | модели UI, календарь, Smart Route, accessibility contracts | `cd frontend && npm test` |
| Frontend type/build | TypeScript и production Vite bundle | `cd frontend && npm run build` |
| Backend unit | domain, HTTP, adapters и тесты без внешней БД | `cd backend && go test -count=1 ./...` |
| Backend race | конкурентная безопасность; DB-тестам нужен отдельный PostgreSQL | `cd backend && go test -race -count=1 ./...` |
| OpenAPI parity | внутренние ссылки и drift между YAML и runtime-маршрутами | `python3 qa/sprint4/openapi.py` |
| Jury gate | десять сквозных сценариев ТЗ | `python3 qa/jury_gate.py` |
| Confirmation browser smoke | открытие booking dialog и dev force-confirm переход | `python3 tests/e2e_appointment_confirmation.py` |
| Mobile emulation audit | viewport 390/393/430/768px в Chromium с mobile/Safari UA | `python3 tests/mobile_safari_audit.py` |

HTTP/E2E/release-наборы могут создавать и изменять данные. Запускайте их на отдельной QA-базе, а не на рабочей очереди. Инструкции по PostgreSQL integration suite, Playwright и release-проверкам собраны в [docs/testing.md](docs/testing.md).

Если OpenAPI parity сообщает `undocumented`, runtime-маршрут уже существует в `backend/internal/httpapi/handlers.go`, но контракт еще не синхронизирован. До исправления такого drift проверяйте фактический handler и не генерируйте клиент только по неполному YAML.

---

## Эксплуатация и диагностика

### Локальный Compose

```bash
docker compose ps
docker compose logs --tail=200 backend frontend postgres
docker compose restart backend frontend
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/ready
```

Если после изменения `package-lock.json` frontend продолжает видеть старые зависимости:

```bash
docker compose up -d --build --force-recreate --renew-anon-volumes frontend
```

### Production / ArgoCD

```bash
kubectl get application -n argocd queue-system
kubectl get pods -n queue-system -o wide
kubectl get deploy -n queue-system
kubectl logs -n queue-system deploy/backend --tail=200
```

Ожидаемое состояние ArgoCD — `Synced` и `Healthy`. Ошибка `unable to resolve '<revision>' to a commit SHA` означает, что `targetRevision` указывает на несуществующую ветку или ref; проверьте `k8s/argocd-app.yaml`, наличие `origin/infra/k8s-gitops` и права repository credential.

### Белый экран frontend

Проверяйте не только HTTP-код страницы, но и MIME type hashed assets:

```bash
curl -I https://pointers-team.tech/
# Скопируйте фактическое имя script из index.html, например:
curl -I https://pointers-team.tech/assets/ACTUAL_HASH.js
```

JS должен отвечать `200` и `Content-Type: application/javascript`. Ответ `text/html` для `/assets/*.js` означает ошибочный SPA fallback или CDN-кэш. В production nginx отсутствующий `/assets/*` обязан возвращать `404`, `index.html` — `no-cache/no-store`, а hashed assets — `immutable` только при успешном ответе.

### Backup и восстановление

Compose-сервис `postgres-backup` сохраняет архивы в `./backups` каждые 6 часов. Перед восстановлением остановите запись новых данных и следуйте проверяемой процедуре из [scripts/restore_backup.sh](scripts/restore_backup.sh); сначала восстанавливайте в отдельную БД и выполняйте smoke-тесты.

---

## Российский технологический контур

* **Автономное ядро:** Очередь, API, БД, UI и наблюдаемость можно развернуть в собственном контуре без AWS, Azure или GCP. Внешние карты, OAuth, AI и каналы уведомлений являются заменяемыми интеграциями.
* **СУБД:** PostgreSQL 17 (совместимо с Postgres Pro).
* **Серверная часть:** Go 1.25 (статический скомпилированный бинарный файл без внешних runtime-зависимостей).
* **Клиентская часть:** React 19 + TypeScript; production bundle обслуживается собственным Nginx. При недоступности карт основной список отделений и работа с талонами остаются отдельным UI-flow.
* **Стек наблюдаемости:** Prometheus, Alertmanager, Grafana, Loki (открытый контур мониторинга и сбора логов).

---

## Масштабирование

Архитектурное предложение для филиальной сети из 40 000+ отделений:

1. **Изоляция по отделениям (`branch_id` Partitioning):** Очереди отделений независимы. Вызовы операторов и блокировки строк не пересекаются между ОПС. Таблицы `tickets`, `ticket_events` и `notification_outbox` секционируются по хешу `branch_id`.
2. **Stateless-бэкенд:** Узлы Go-бэкенда не хранят разделяемого состояния в оперативной памяти — синхронизация гарантируется базой данных. Экземпляры бэкенда масштабируются горизонтально в Kubernetes за балансировщиком нагрузки.
3. **Централизованная дистрибуция политик:** Центральный офис управляет нормативами времени и весами очередей через версионируемый `QueuePolicy` с репликацией на отделения.
4. **Асинхронная аналитика:** Батчевая передача событий в аналитическое DWH через Transactional Outbox исключает просадки производительности локальных ОПС.

Подробное описание архитектурного предложения масштабирования доступно в [docs/scaling-40k.md](docs/scaling-40k.md).

---

## Дополнительные материалы

| Документ | Содержание |
|---|---|
| [docs/openapi.yaml](docs/openapi.yaml) | Машиночитаемый контракт OpenAPI 3.0 |
| [docs/queue-algorithm.md](docs/queue-algorithm.md) | FSM, ранжирование и расчет ETA |
| [docs/testing.md](docs/testing.md) | Локальные, интеграционные, browser и release-проверки |
| [docs/GITOPS_DEPLOYMENT.md](docs/GITOPS_DEPLOYMENT.md) | Устройство GitOps, проверка версии и rollback |
| [docs/DEVOPS_GUIDE_RU.md](docs/DEVOPS_GUIDE_RU.md) | Развертывание и эксплуатация инфраструктуры |
| [docs/ml.md](docs/ml.md) | Опциональный ML-контур ETA и fallback |
| [docs/scaling-40k.md](docs/scaling-40k.md) | Проект масштабирования на филиальную сеть |
| [frontend/DESIGN_SYSTEM.md](frontend/DESIGN_SYSTEM.md) | Токены, компоненты и правила интерфейса |
| [DESIGN.md](DESIGN.md) | Продуктовая и визуальная концепция |

Перед изменением API обновляйте реализацию и `docs/openapi.yaml` в одном merge request. Перед изменением схемы добавляйте новую пару миграций `*.up.sql` / `*.down.sql`; уже примененные миграции не редактируются задним числом.
