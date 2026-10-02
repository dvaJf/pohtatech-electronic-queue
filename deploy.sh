#!/usr/bin/env bash
# deploy.sh — ручной деплой когда CI не работает
# Схема: build image → push Docker Hub → update helm/values.yaml → push → ArgoCD sync
#
# Использование:
#   chmod +x deploy.sh  (один раз)
#   ./deploy.sh
#
# Переменные окружения (опционально):
#   DOCKERHUB_USERNAME  — по умолчанию vacuumxvx
#   DOCKERHUB_TOKEN     — Personal Access Token (если не залогинен)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-vacuumxvx}"
FRONTEND_REPO="${DOCKERHUB_USERNAME}/queue-frontend"
COMMIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
FRONTEND_TAG="v-${COMMIT_SHA}"
FULL_IMAGE="${FRONTEND_REPO}:${FRONTEND_TAG}"
VALUES_FILE="$REPO_DIR/helm/queue-chart/values.yaml"
BRANCH="${DEPLOY_BRANCH:-dw/ui-fixes-calendar}"

echo "╔══════════════════════════════════════════════════════╗"
echo "║         Ручной деплой в Kubernetes (ArgoCD)          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  Образ   : $FULL_IMAGE"
echo "  values  : $VALUES_FILE"
echo ""

cd "$REPO_DIR"

# 1. Docker login (если передан токен)
if [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  echo "==> [1/5] Docker Hub login..."
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
else
  echo "==> [1/5] Пропускаем docker login (используем существующую сессию)"
fi

# 2. Сборка продакшн-образа
echo "==> [2/5] Сборка образа $FULL_IMAGE..."
DOCKER_BUILDKIT=1 docker build --pull \
  -t "$FULL_IMAGE" \
  -f frontend/Dockerfile.prod \
  frontend/

# 3. Push в Docker Hub
echo "==> [3/5] Push $FULL_IMAGE → Docker Hub..."
docker push "$FULL_IMAGE"

# 4. Обновить helm/queue-chart/values.yaml
echo "==> [4/5] Обновление helm/queue-chart/values.yaml (tag → $FRONTEND_TAG)..."
if command -v yq &>/dev/null; then
  FRONTEND_IMAGE_TAG="$FRONTEND_TAG" yq -i '.frontend.image.tag = strenv(FRONTEND_IMAGE_TAG)' "$VALUES_FILE"
else
  # fallback: sed
  sed -i "s|tag: \"v-[a-f0-9]*\"|tag: \"$FRONTEND_TAG\"|" "$VALUES_FILE"
fi
echo "   Новый тег: $(grep 'tag:' "$VALUES_FILE" | head -1)"

# 5. Закоммитить и запушить
echo "==> [5/5] Коммит и push в ветку $BRANCH..."
git add helm/queue-chart/values.yaml
git diff --cached --quiet && echo "   values.yaml не изменился — уже актуален" && exit 0
git commit -m "chore(gitops): update frontend image tag to $FRONTEND_TAG [skip ci]"
git push origin "HEAD:$BRANCH"

echo ""
echo "✅ Готово!"
echo "   ArgoCD увидит изменение в values.yaml и автоматически задеплоит образ."
echo "   Проверить: kubectl -n queue-system get pods -w"
echo "   Или в UI ArgoCD: https://поinters-team.tech/argocd (если настроен)"
