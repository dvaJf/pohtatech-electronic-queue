#!/usr/bin/env bash
set -euo pipefail

# ── Release & GitOps Trigger Script via Docker Hub ────────────────────────
# Использование: ./scripts/release.sh [backend|frontend|all] [commit_message]
# ─────────────────────────────────────────────────────────────────────────

COMPONENT="${1:-backend}"
MSG="${2:-"chore(release): update $COMPONENT"}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

REGISTRY_USER="vacuumxvx"
SHORT_SHA="$(git rev-parse --short HEAD)"
TAG="v-${SHORT_SHA}-$(date +%s | tail -c 5)"

echo "========================================================"
echo "🚀 Подготовка релиза: $COMPONENT (тег: $TAG)"
echo "📦 Реестр: Docker Hub ($REGISTRY_USER)"
echo "========================================================"

# 1. Прогон тестов (CI этап на стороне разработчика)
if [ "$COMPONENT" = "backend" ] || [ "$COMPONENT" = "all" ]; then
  echo "🧪 1/4 Запуск тестов бэкенда (Go)..."
  (cd backend && go test ./...)
  echo "✅ Тесты пройдены!"
fi

# 2. Сборка и push в Docker Hub
if [ "$COMPONENT" = "backend" ] || [ "$COMPONENT" = "all" ]; then
  echo "🐳 2/4 Сборка Docker-образа ${REGISTRY_USER}/queue-backend:$TAG..."
  docker build -t "${REGISTRY_USER}/queue-backend:$TAG" ./backend
  
  echo "📤 Отправка образа в Docker Hub..."
  docker push "${REGISTRY_USER}/queue-backend:$TAG"
  
  echo "📝 Обновление тега бэкенда в Helm values..."
  python3 -c "
with open('helm/queue-chart/values.yaml', 'r') as f:
    c = f.read()
import re
c = re.sub(r'(repository: vacuumxvx/queue-backend\s*\n\s*tag: )\"[^\"]*\"', r'\g<1>\"$TAG\"', c)
with open('helm/queue-chart/values.yaml', 'w') as f:
    f.write(c)
"
fi

if [ "$COMPONENT" = "frontend" ] || [ "$COMPONENT" = "all" ]; then
  echo "🐳 Сборка Docker-образа ${REGISTRY_USER}/queue-frontend:$TAG..."
  docker build -t "${REGISTRY_USER}/queue-frontend:$TAG" -f frontend/Dockerfile.prod ./frontend
  
  echo "📤 Отправка образа в Docker Hub..."
  docker push "${REGISTRY_USER}/queue-frontend:$TAG"
  
  echo "📝 Обновление тега фронтенда в Helm values..."
  python3 -c "
with open('helm/queue-chart/values.yaml', 'r') as f:
    c = f.read()
import re
c = re.sub(r'(repository: vacuumxvx/queue-frontend\s*\n\s*tag: )\"[^\"]*\"', r'\g<1>\"$TAG\"', c)
with open('helm/queue-chart/values.yaml', 'w') as f:
    f.write(c)
"
fi

# 3. Фиксация нового тега в Git (GitOps Single Source of Truth)
echo "📦 3/4 Коммит новой версии в Git..."
git add helm/queue-chart/values.yaml
if ! git diff --cached --quiet; then
  git commit -m "$MSG [tag: $TAG]"
fi

# 4. Передача управления ArgoCD
echo "🔄 4/4 Отправка изменений в ветку GitOps (infra/k8s-gitops)..."
git push origin main:infra/k8s-gitops

echo ""
echo "========================================================"
echo "✨ ГОТОВО! Дальше всё делает ArgoCD:"
echo "1. ArgoCD заметил новый коммит в ветке infra/k8s-gitops с тегом $TAG."
echo "2. Обе ноды (Master + Oracle) автоматически скачивают образ из Docker Hub."
echo "3. Выполняется плавный RollingUpdate в Kubernetes без простоя."
echo "4. Статус можно наблюдать вживую: https://pointers-team.tech/argocd/"
echo "========================================================"
