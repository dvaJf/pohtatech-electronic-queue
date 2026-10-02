# 📘 Полное руководство по DevOps и серверной инфраструктуре
## Проект «Цифровая очередь нового поколения»
**Дата актуализации:** Октябрь 2026  
**Домен проекта:** [https://pointers-team.tech](https://pointers-team.tech)

---

## 📑 Содержание
1. [Архитектура инфраструктуры и серверов](#1-архитектура-инфраструктуры-и-серверов)
2. [Сетевой стек и маршрутизация (Cloudflare + Ingress)](#2-сетевой-стек-и-маршрутизация)
3. [Безопасность (SSH, Firewall, Fail2ban)](#3-безопасность-серверов)
4. [Кластер Kubernetes (K3s Multi-Cloud)](#4-кластер-kubernetes-k3s)
5. [Управление релизами и GitOps (Helm + ArgoCD)](#5-управление-релизами-и-gitops)
6. [Система наблюдаемости (Observability: Loki, Promtail, Jaeger, Grafana)](#6-система-наблюдаемости-observability)
7. [Жизненный цикл запроса «Взять талон» (Request Lifecycle)](#7-жизненный-цикл-запроса-взять-талон)
8. [Шпаргалка инженера (Команды на каждый день)](#8-шпаргалка-инженера-cheat-sheet)
9. [Сводная таблица доступов и паролей](#9-сводная-таблица-доступов-и-сервисов)

---

## 1. Архитектура инфраструктуры и серверов

Проект развернут в отказоустойчивой гибридной архитектуре, объединяющей две физические локации разных провайдеров в единый кластер Kubernetes.

```
                      ┌────────────────────────────┐
                      │    Cloudflare Edge DNS     │
                      │ HTTPS SSL / DDoS Shield   │
                      └─────────────┬──────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
   ┌─────────────────────────────┐     ┌─────────────────────────────┐
   │         MASTER NODE         │     │         WORKER NODE         │
   │      IT-Garage (РФ)         │     │     Oracle Cloud (Франкфурт) │
   │ 144.31.181.192              │     │ 141.147.48.160              │
   │ 2 vCPU / 4 GB RAM / 80 GB   │     │ 1 vCPU / 1 GB RAM + 2GB Swap│
   ├─────────────────────────────┤     ├─────────────────────────────┤
   │ • K3s Control-Plane Server  │     │ • K3s Worker Node           │
   │ • Traefik Ingress           │     │ • Frontend Replica (SPA)    │
   │ • Backend API (2 реплики)   │     │ • Promtail Log Collector    │
   │ • PostgreSQL Database       │     └─────────────────────────────┘
   │ • Jaeger Tracing            │                    ▲
   │ • Loki Log Store            │                    │
   │ • Grafana Dashboard         │                    │ Flannel VXLAN Overlay
   │ • ArgoCD GitOps Engine      │◄───────────────────┘ (10.42.0.0/16)
   └─────────────────────────────┘
```

### 1.1. Спецификация узлов
- **Master Node (`vm289265`):**
  - **Провайдер:** IT-Garage
  - **IP:** `144.31.181.192`
  - **ОС:** Ubuntu 24.04 LTS
  - **Ресурсы:** 2 ядра vCPU, 4 ГБ RAM, 80 ГБ NVMe SSD
  - **Роль:** Control-plane кластера K3s, запуск базы данных, бэкенда и компонентов мониторинга.
- **Worker Node (`instance-20260927-1520`):**
  - **Провайдер:** Oracle Cloud Infrastructure (OCI)
  - **IP:** `141.147.48.160`
  - **ОС:** Ubuntu 24.04 LTS
  - **Ресурсы:** 1 ядро vCPU, 1 ГБ RAM + 2 ГБ SWAP
  - **Роль:** Расширение вычислительных мощностей, запуск реплик фронтенда.

---

## 2. Сетевой стек и маршрутизация

1. **Cloudflare:**
   - Принимает весь трафик на `https://pointers-team.tech` (порт 443).
   - Выполняет терминацию публичного SSL-сертификата.
   - Защищает от DDoS-атак, фильтрует ботов и кэширует статику.
   - Проксирует трафик на публичный IP Master-узла `144.31.181.192`.
2. **Traefik Ingress Controller (внутри K3s):**
   - Слушает порты 80 и 443 на нодах.
   - На основе правил маршрутизирует URL-пути в нужные внутренние сервисы:
     - `/api/*` ➔ `service/backend:8080` (Go Chi API)
     - `/` ➔ `service/frontend:80` (React SPA на Nginx)
     - `/jaeger/*` ➔ `service/jaeger:16686` (Трейсинг UI)
     - `/grafana/*` ➔ `service/grafana:3000` (Дашборды UI)
     - `/argocd/*` ➔ `service/argocd-server:80` (GitOps UI)
3. **Flannel CNI (Межсерверная сеть):**
   - Создает виртуальную плоскую сеть подов `10.42.0.0/16`. Поды на сервере в Oracle Cloud общаются с базой данных на Master-сервере напрямую по внутренним IP без открытия портов наружу.

---

## 3. Безопасность серверов

### 3.1. Защита от брутфорса (Fail2ban)
На обоих серверах настроен сервис **Fail2ban**:
- **Конфигурация:** `/etc/fail2ban/jail.local`
- **Параметры джейла `sshd`:**
  - `bantime = 1h` (блокировка IP атакующего на 1 час).
  - `findtime = 10m` (окно анализа — 10 минут).
  - `maxretry = 4` (максимум 4 неудачных попытки входа).
  - `mode = aggressive` (усиленное детектирование сканеров).
  - `backend = systemd` (прямой анализ журнала journald).

### 3.2. SSH-доступ
- Авторизация по паролю отключена или строго ограничена.
- Вход осуществляется только по закрытым ключам RSA/Ed25519.

---

## 4. Кластер Kubernetes (K3s)

### 4.1. Почему выбран K3s, а не чистый k8s?
K3s — сертифицированный CNCF дистрибутив Kubernetes, оптимизированный под production с минимальным потреблением памяти (master требует всего ~500 МБ RAM против 2 ГБ у kubeadm).

### 4.2. Изоляция и распределение нагрузки (NodeSelector)
Так как Worker-узел в Oracle Cloud имеет 1 ГБ RAM, а Master — 4 ГБ RAM:
- Stateful-сервисы и тяжелые приложения (`PostgreSQL`, `backend`, `Loki`, `Jaeger`, `Grafana`, `ArgoCD`) зафиксированы на Master-узле через:
  ```yaml
  nodeSelector:
    node-role.kubernetes.io/control-plane: "true"
  ```
- Легковесные stateless-поды (`frontend` на базе Nginx) размазаны по обоим узлам кластера для отказоустойчивости.

### 4.3. Хранилище данных (Persistent Storage)
- Используется встроенный `local-path` StorageClass.
- Данные PostgreSQL хранятся в постоянном томе PVC `postgres-pvc` (2 GiB) на SSD Master-узла и сохраняются при любых перезапусках подов.

---

## 5. Управление релизами и GitOps

### 5.1. Что такое GitOps и зачем мы используем ArgoCD?
В классическом CI/CD (например, GitLab CI) внешний сервер подключается к проду и накатывает контейнеры (Push-модель). Без прав администратора на GitLab такой пайплайн настроить невозможно.

**ArgoCD реализует Pull-модель GitOps:**
1. Агент внутри кластера сам периодически опрашивает Git-репозиторий.
2. При изменении `values.yaml` в Helm-чарте ArgoCD видит расхождение (`OutOfSync`).
3. Кластер автоматически выкатывает обновление с помощью механизма **RollingUpdate** (без простоя системы).

### 5.2. Скрипт релиза для разработчика (`scripts/release.sh`)
Разработчику не нужно заходить по SSH на сервер. Выпуск новой версии выполняется одной командой с локального компьютера:

```bash
./scripts/release.sh backend "feat: добавлена скидка по промокодам"
```
**Что делает скрипт:**
1. Прогоняет автотесты `go test ./...`.
2. Собирает Docker-образ с уникальным тегом `queue-backend:v-<hash>`.
3. Доставляет образ в кластер.
4. Обновляет тег в `helm/queue-chart/values.yaml` и коммитит изменение.
5. После `git push` ArgoCD автоматически применяет обновление в проде!

---

## 6. Система наблюдаемости (Observability)

Современная трехуровневая система мониторинга (Метрики, Логи, Трейсинг) объединена в единую экосистему.

```
       ┌─────────────────┐       ┌─────────────────┐
       │   Prometheus    │       │    OpenTelemetry│
       │    (Metrics)    │       │    (Jaeger Traces)
       └────────┬────────┘       └────────┬────────┘
                │                         │
                └───────────┬─────────────┘
                            ▼
                  ┌───────────────────┐       ┌─────────────────┐
                  │      GRAFANA      │◄──────┤      LOKI       │
                  │ (Единый дашборд)  │       │ (Умные логи)    │
                  └───────────────────┘       └────────▲────────┘
                                                       │ Promtail
                                              ┌────────┴────────┐
                                              │   Pod Logs CRI  │
                                              └─────────────────┘
```

### 6.1. Логирование (Loki + Promtail + slog)
- Бэкенд пишет структурированные логи в формате JSON через стандартный пакет `log/slog`.
- **Автоматическая корреляция:** кастомный обработчик `traceHandler` внедряет поля `trace_id` и `span_id` в каждую запись. По ошибке из лога можно сразу найти трейс в Jaeger!
- **Умная фильтрация Promtail (защита от мусора):**
  - Отбрасывает тысячи регулярных вызовов `/health`, `/ready`, `/metrics`.
  - Отбрасывает рутинные запросы чтения интерфейса.
  - **Индексирует в Loki только:**
    - Ошибки уровня `ERROR` (5xx).
    - Предупреждения уровня `WARN` (4xx, валидация).
    - Бизнес-транзакции `event="business_action"` (создание талона, вызов клиента, закрытие смены).

### 6.2. Распределенный трейсинг (OpenTelemetry + Jaeger)
- В роутер Chi встроен `traceMiddleware`.
- При вызове API создается корневой спан, который затем дробится на дочерние спаны (Child Spans) бизнес-логики и базы данных.
- Поддерживает стандарт W3C TraceContext (`traceparent`).

### 6.3. Визуализация в Grafana
- Доступна по адресу: `https://pointers-team.tech/grafana/`
- Автоматически подключены источники данных:
  - **Loki** — поиск и анализ структурированных логов через язык LogQL.
  - **Jaeger** — поиск и детальный просмотр графов трассировки запросов.

---

## 7. Жизненный цикл запроса «Взять талон»

Детальная последовательность шагов при нажатии кнопки «Взять талон» в интерфейсе:

```
[Пользователь] ── Нажатие кнопки ──► [React UI]
                                         │
 ┌───────────────────────────────────────┘
 ▼ POST /api/v1/branches/{id}/tickets/live (Idempotency-Key: ...)
[Cloudflare Edge] ── WAF / SSL Termination ──► [Traefik Ingress Controller]
                                                         │
 ┌───────────────────────────────────────────────────────┘
 ▼ Внутренний роутинг :8080
[Backend: Chi Router]
 │
 ├── 1. traceMiddleware ➔ Создание OpenTelemetry Span (Trace ID)
 ├── 2. requestLog ➔ Запуск таймера и генерация Request-ID
 ├── 3. cors / recoverPanic ➔ Защита от сбоев
 ├── 4. handler.CreateLiveTicket ➔ Валидация входного JSON и UUID
 │
 └── 5. usecases.CreateLiveTicket (Слой бизнес-логики)
       │
       ├── db.BeginTx ➔ Открытие транзакции PostgreSQL
       ├── db.AcquireAdvisoryLock ➔ Защита от гонок по Idempotency-Key
       ├── db.CheckIdempotency ➔ Проверка повторного вызова
       ├── db.ValidateBranchService ➔ Проверка доступности услуги в отделении
       ├── domain.ComputeSchedule ➔ Расчет расписания и приоритета очереди
       ├── db.SQL_InsertTicket ➔ INSERT INTO tickets (...) RETURNING id
       ├── db.ScanCreatedTicket ➔ Чтение созданного талона
       ├── db.InsertAuditEvent ➔ Запись события в журнал аудита
       └── db.CommitTx ➔ Фиксация транзакции в БД
 │
 ├── 6. Формирование HTTP 201 Created + JSON талона
 └── 7. Отправка ответа ➔ Traefik ➔ Cloudflare ➔ Браузер
                                                     │
[Пользователь] ◄── Обновление экрана (Номер талона L-000002)
```

---

## 8. Шпаргалка инженера (Cheat Sheet)

### 8.1. Работа с подами и сервисами (Kubernetes)
```bash
# Проверить статус всех подов в системе
k3s kubectl get pods -n queue-system -o wide

# Посмотреть логи бэкенда в реальном времени
k3s kubectl logs -n queue-system deployment/backend -f --tail=50

# Перезапустить бэкенд без простоя
k3s kubectl rollout restart deployment/backend -n queue-system

# Посмотреть события кластера (ошибки, перезапуски)
k3s kubectl get events -n queue-system --sort-by='.metadata.creationTimestamp'
```

### 8.2. Работа с базой данных PostgreSQL
```bash
# Подключиться к интерактивной консоли psql
k3s kubectl exec -it -n queue-system deployment/postgres -- psql -U postcode -d postcode

# Применить sql-скрипт или сид в базу данных
cat scripts/seed_demo_branches.sql | k3s kubectl exec -i -n queue-system deployment/postgres -- psql -U postcode -d postcode
```

### 8.3. Безопасность и Fail2ban
```bash
# Проверить статус защиты SSH
fail2ban-client status sshd

# Посмотреть список заблокированных IP
fail2ban-client get sshd banip

# Разблокировать ошибочно забаненный IP
fail2ban-client set sshd unbanip <IP_АДРЕС>
```

### 8.4. Диагностика узлов кластера
```bash
# Посмотреть свободную оперативную память и диск
free -m
df -h /

# Список контейнеров containerd
k3s crictl ps
```

---

## 9. Сводная таблица доступов и сервисов

| Сервис | Назначение | URL / Доступ | Учетные данные |
| :--- | :--- | :--- | :--- |
| **Веб-приложение** | Клиентский интерфейс очереди | `https://pointers-team.tech` | Публичный доступ |
| **Grafana** | Мониторинг, дашборды и поиск логов | `https://pointers-team.tech/grafana/` | `admin` / `admin` |
| **Jaeger UI** | Распределенный трейсинг запросов | `https://pointers-team.tech/jaeger/` | Свободный доступ |
| **ArgoCD** | GitOps-панель управления деплоем | `https://pointers-team.tech/argocd/` | `admin` / `gWwmbfS2Zf6ig6op` |
| **Master Node** | Основной сервер (IT-Garage) | `ssh root@144.31.181.192` | SSH-ключ |
| **Worker Node** | Рабочий узел (Oracle Cloud) | `ssh -i ~/.ssh/oracle_worker_rsa ubuntu@141.147.48.160` | SSH-ключ |
| **PostgreSQL** | База данных (внутри K8s) | `host=postgres:5432`, `db=postcode` | `postcode` / `local-development-only` |
