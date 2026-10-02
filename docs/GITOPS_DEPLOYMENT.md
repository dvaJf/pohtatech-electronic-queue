# Автоматический GitOps-деплой (GitLab CI + ArgoCD + Helm)

В проекте настроен полностью автоматический непрерывный GitOps-пайплайн доставки изменений в production Kubernetes-кластер.

---

## 🚀 Что происходит после `git push`

```text
Разработчик:
       git push origin main
               │
               ▼
GitLab CI Pipeline (.gitlab-ci.yml):
   ├── stage: test
   │     ├── frontend:test (typecheck, tests, build)
   │     └── backend:test (go test, go build)
   │
   ├── stage: image (параллельно только для изменившихся сервисов)
   │     ├── frontend:image (docker build/push с тегом $CI_COMMIT_SHORT_SHA)
   │     └── backend:image (docker build/push с тегом $CI_COMMIT_SHORT_SHA)
   │
   └── stage: gitops (централизованное атомарное обновление)
         └── gitops:update:
               - обновляет теги в helm/queue-chart/values.yaml через yq
               - фиксирует коммит "chore(gitops): update Helm image tags [skip ci]"
               - пушит в ветку main c флагом -o ci.skip (исключая CI loop)
               │
               ▼
ArgoCD (Application: queue-system):
   - обнаруживает коммит в ветке main (path: helm/queue-chart)
   - автоматический Sync (automated: selfHeal: true)
               │
               ▼
Kubernetes (K3s кластер, namespace: queue-system):
   - RollingUpdate Deployments (maxSurge: 1, maxUnavailable: 0)
   - проверка readinessProbe (/healthz для frontend, /ready для backend)
   - переключение трафика на новые Pods без downtime
               │
               ▼
Сайт https://pointers-team.tech обновлен!
```

---

## 📍 Основные компоненты и пути

| Компонент | Расположение / Значение |
|---|---|
| **Helm Source of Truth** | `helm/queue-chart/` (`values.yaml`, `templates/`) |
| **ArgoCD Application** | `queue-system` в namespace `argocd`, отслеживает `main` |
| **Frontend Production Dockerfile** | `frontend/Dockerfile.prod` (Node build -> Nginx runtime) |
| **Backend Production Dockerfile** | `backend/Dockerfile` (Go multi-stage -> Alpine) |
| **Реестр образов** | GitLab Container Registry (`$CI_REGISTRY_IMAGE/frontend`, `$CI_REGISTRY_IMAGE/backend`) или Docker Hub (`vacuumxvx/queue-frontend`, `vacuumxvx/queue-backend`) |
| **Теги образов** | Immutable Short Commit SHA: `${CI_COMMIT_SHORT_SHA}` (например: `1aba560`) |

---

## 🔑 Необходимые CI/CD Variables в GitLab

В настройках репозитория GitLab (**Settings → CI/CD → Variables**) должны быть заданы следующие переменные (Masked):

1. **`GITOPS_PUSH_TOKEN`** *(или `GITLAB_TOKEN`)*:
   - Personal Access Token / Project Access Token с правами `write_repository`.
   - Используется на этапе `gitops:update` для фиксации обновленных тегов в `helm/queue-chart/values.yaml`.

2. *(Опционально, если используется внешний Docker Hub вместо встроенного GitLab Registry)*:
   - **`DOCKERHUB_USERNAME`**: имя пользователя Docker Hub (например, `vacuumxvx`).
   - **`DOCKERHUB_TOKEN`**: токен доступа Docker Hub (Personal Access Token).

> 💡 **Примечание**: При использовании встроенного GitLab Container Registry переменные `CI_REGISTRY`, `CI_REGISTRY_IMAGE`, `CI_REGISTRY_USER` и `CI_REGISTRY_PASSWORD` инжектируются самим GitLab CI автоматически.

---

## 🔍 Как проверить текущую версию и статус деплоя

### 1. Текущие теги в Git:
```bash
# Тег фронтенда
yq '.frontend.image.tag' helm/queue-chart/values.yaml

# Тег бэкенда
yq '.backend.image.tag' helm/queue-chart/values.yaml
```

### 2. Текущие образы в запущенных Pods Kubernetes:
```bash
# Pods и их образы в namespace queue-system
kubectl get pods -n queue-system -o custom-columns='NAME:.metadata.name,IMAGE:.spec.containers[*].image,STATUS:.status.phase'
```

### 3. Статус синхронизации в ArgoCD:
```bash
kubectl get application -n argocd queue-system
```

---

## 🔄 Процедура отката (Rollback)

Благодаря неизменяемым (immutable) тегам на базе коммитов, откат выполняется тривиально:

### Способ 1: Git Revert (рекомендуемый GitOps-способ)
```bash
# 1. Откатить коммит обновления тегов в Git:
git revert HEAD

# 2. Отправить изменения в ветку main:
git push origin main
```
ArgoCD сразу обнаружит предыдущую версию тега в `helm/queue-chart/values.yaml` и выполнит обратный RollingUpdate.

### Способ 2: Ручное указание стабильного тега
Отредактируйте `helm/queue-chart/values.yaml`:
```bash
yq -i '.frontend.image.tag = "previous-stable-sha"' helm/queue-chart/values.yaml
git commit -am "chore(rollback): rollback frontend to previous-stable-sha"
git push origin main
```
