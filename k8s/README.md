# Kubernetes & GitOps Architecture

## Production Source of Truth

Основным и единственным источником истины для всех основных сервисов системы (Frontend, Backend, PostgreSQL, Swagger, Ingress) является **Helm-чарт**:
📁 `helm/queue-chart/`

ArgoCD отслеживает:
- **Application Name**: `queue-system` (namespace: `argocd`)
- **Repo URL**: `https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/5-ukazateley/tsifrovaya-ochered-novogo-pokoleniya.git`
- **Target Revision**: `infra/k8s-gitops`
- **Path**: `helm/queue-chart`
- **Target Namespace**: `queue-system`
- **Sync Policy**: Automated (`selfHeal: true`, `prune: false`)

---

## Структура каталога `k8s/`

- `argocd-app.yaml` — Декларативный манифест ArgoCD Application `queue-system` (для первоначального бутстрапа).
- `argocd-ingress.yaml` — Ingress-маршрут для веб-интерфейса ArgoCD (`/argocd`).
- `notification-demo-deployment.yaml` — Демонстрационный мок-провайдер уведомлений.
- `rag-agent-deployment.yaml`, `rag-secret.yaml` — AI/RAG микросервис.
- `observability/` — Манифесты системы мониторинга (Prometheus, Grafana, Loki, Promtail, Jaeger).
- `legacy/` — **Архивные сырые манифесты**. Перенесены в архив во избежание конфликтов с Helm. Не применять в проде!
