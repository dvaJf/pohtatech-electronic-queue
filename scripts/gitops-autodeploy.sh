#!/usr/bin/env bash
# =============================================================================
# gitops-autodeploy.sh — server-side GitOps CI replacement
# =============================================================================
# Запускается systemd timer каждые 30s.
# Логика:
#   1. fetch origin/main
#   2. сравнить SHA с last-deployed-sha
#   3. git diff → определить frontend/backend изменения
#   4. пропустить если изменился только Helm (чтобы не было бесконечного loop)
#   5. docker build + push только изменившихся сервисов
#   6. yq → обновить helm/queue-chart/values.yaml ТОЛЬКО после успешного push
#   7. git commit + push GitOps коммит
#   8. ArgoCD сам подхватит изменение → Kubernetes RollingUpdate
#
# Секреты читаются из /etc/pointers-deploy.env (chmod 600)
# State хранится в /var/lib/pointers-deploy/last-deployed-sha
# =============================================================================
set -Eeuo pipefail

# ─── Константы ───────────────────────────────────────────────────────────────
LOCK_FILE="/run/lock/pointers-gitops-deploy.lock"
STATE_DIR="/var/lib/pointers-deploy"
STATE_FILE="${STATE_DIR}/last-deployed-sha"
ENV_FILE="/etc/pointers-deploy.env"
LOG_PREFIX="[$(date '+%H:%M:%S')]"

# ─── Logging ─────────────────────────────────────────────────────────────────
log()  { echo "${LOG_PREFIX} $*"; }
info() { echo "${LOG_PREFIX} ℹ  $*"; }
ok()   { echo "${LOG_PREFIX} ✅ $*"; }
warn() { echo "${LOG_PREFIX} ⚠  $*"; }
err()  { echo "${LOG_PREFIX} ❌ $*" >&2; }

# ─── flock: не запускать два процесса одновременно ───────────────────────────
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  info "Deploy already running, skipping this tick."
  exit 0
fi

# ─── Читаем конфиг ───────────────────────────────────────────────────────────
if [[ ! -f "${ENV_FILE}" ]]; then
  err "Missing ${ENV_FILE}. Create it from the template and chmod 600."
  exit 1
fi
# shellcheck source=/etc/pointers-deploy.env
source "${ENV_FILE}"

# Обязательные переменные
: "${DOCKERHUB_USERNAME:?DOCKERHUB_USERNAME must be set in ${ENV_FILE}}"
: "${DOCKERHUB_TOKEN:?DOCKERHUB_TOKEN must be set in ${ENV_FILE}}"
: "${REPO_DIR:?REPO_DIR must be set in ${ENV_FILE}}"
: "${BRANCH:=main}"
: "${FRONTEND_DOCKERFILE:=frontend/Dockerfile.prod}"
: "${BACKEND_DOCKERFILE:=backend/Dockerfile}"
: "${FRONTEND_CONTEXT:=frontend}"
: "${BACKEND_CONTEXT:=backend}"
: "${VALUES_FILE:=helm/queue-chart/values.yaml}"

# ─── Читаем Docker Hub repos из Helm values (избегаем hardcode) ──────────────
cd "${REPO_DIR}"

_yq_read() { yq -r "$1" "${VALUES_FILE}"; }

FRONTEND_REPO="$(_yq_read '.frontend.image.repository')"
BACKEND_REPO="$(_yq_read '.backend.image.repository')"

# ─── State directory ──────────────────────────────────────────────────────────
mkdir -p "${STATE_DIR}"

# ─── Fetch remote ─────────────────────────────────────────────────────────────
log "Fetching origin/${BRANCH}..."
if ! git fetch origin "${BRANCH}" --quiet 2>/dev/null; then
  warn "git fetch failed (network?). Skipping."
  exit 0
fi

REMOTE_SHA="$(git rev-parse "origin/${BRANCH}")"
SHORT_SHA="${REMOTE_SHA:0:7}"

# ─── Читаем последний задеплоенный SHA ───────────────────────────────────────
LAST_SHA=""
if [[ -f "${STATE_FILE}" ]]; then
  LAST_SHA="$(cat "${STATE_FILE}")"
fi

if [[ "${REMOTE_SHA}" == "${LAST_SHA}" ]]; then
  # Ничего не изменилось
  exit 0
fi

log "Detected new commit on ${BRANCH}: ${SHORT_SHA}"
log "Last deployed: ${LAST_SHA:0:7:-${LAST_SHA:0:7}+none}"

# Если state пустой (первый запуск) — используем пустой SHA для diff
if [[ -z "${LAST_SHA}" ]]; then
  warn "First run — no previous SHA. Will rebuild both services as baseline."
  FRONTEND_CHANGED=true
  BACKEND_CHANGED=true
  HELM_ONLY=false
else
  # ─── Определяем что изменилось ─────────────────────────────────────────────
  CHANGED_FILES="$(git diff --name-only "${LAST_SHA}" "${REMOTE_SHA}" 2>/dev/null || echo "")"

  log "Changed files since ${LAST_SHA:0:7}:"
  echo "${CHANGED_FILES}" | sed 's/^/    /'

  FRONTEND_CHANGED=false
  BACKEND_CHANGED=false
  HELM_ONLY=false

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
      frontend/*) FRONTEND_CHANGED=true ;;
      backend/*|cmd/*|internal/*|pkg/*|go.mod|go.sum|queue_policy.yaml)
        BACKEND_CHANGED=true ;;
      helm/*) : ;; # изменение Helm само по себе не триггерит build
      # GitOps коммит самого скрипта — Helm-only, игнорируем
      scripts/gitops-autodeploy.sh) : ;;
    esac
  done <<< "${CHANGED_FILES}"

  # Если изменился только Helm (GitOps loop protection) — записываем SHA и выходим
  if [[ "${FRONTEND_CHANGED}" == false && "${BACKEND_CHANGED}" == false ]]; then
    log "Helm-only or docs-only change — no Docker build needed."
    log "ArgoCD will pick up Helm changes automatically."
    echo "${REMOTE_SHA}" > "${STATE_FILE}"
    exit 0
  fi
fi

log "Frontend changed: ${FRONTEND_CHANGED}"
log "Backend  changed: ${BACKEND_CHANGED}"

# ─── Docker login ─────────────────────────────────────────────────────────────
log "Authenticating to Docker Hub (${DOCKERHUB_USERNAME})..."
printf '%s' "${DOCKERHUB_TOKEN}" | \
  docker login --username "${DOCKERHUB_USERNAME}" --password-stdin 2>&1 | \
  grep -v "token\|password\|secret" || true
ok "Docker Hub authenticated"

# ─── Tag: immutable v-<sha> ───────────────────────────────────────────────────
TAG="v-${SHORT_SHA}"

# ─── Build & push frontend ────────────────────────────────────────────────────
FRONTEND_PUSHED=false
if [[ "${FRONTEND_CHANGED}" == true ]]; then
  FULL_FRONTEND="${FRONTEND_REPO}:${TAG}"
  log "Building frontend: ${FULL_FRONTEND}..."

  DOCKER_BUILDKIT=1 docker build \
    --pull \
    -f "${REPO_DIR}/${FRONTEND_DOCKERFILE}" \
    -t "${FULL_FRONTEND}" \
    "${REPO_DIR}/${FRONTEND_CONTEXT}"

  log "Pushing ${FULL_FRONTEND}..."
  docker push "${FULL_FRONTEND}"
  ok "Frontend pushed: ${FULL_FRONTEND}"
  FRONTEND_PUSHED=true
fi

# ─── Build & push backend ─────────────────────────────────────────────────────
BACKEND_PUSHED=false
if [[ "${BACKEND_CHANGED}" == true ]]; then
  FULL_BACKEND="${BACKEND_REPO}:${TAG}"
  log "Building backend: ${FULL_BACKEND}..."

  DOCKER_BUILDKIT=1 docker build \
    --pull \
    -f "${REPO_DIR}/${BACKEND_DOCKERFILE}" \
    -t "${FULL_BACKEND}" \
    "${REPO_DIR}/${BACKEND_CONTEXT}"

  log "Pushing ${FULL_BACKEND}..."
  docker push "${FULL_BACKEND}"
  ok "Backend pushed: ${FULL_BACKEND}"
  BACKEND_PUSHED=true
fi

# ─── Race condition check ─────────────────────────────────────────────────────
# Docker build может занять несколько минут. Проверяем, не ушёл ли main вперёд.
log "Race condition check: re-fetching origin/${BRANCH}..."
git fetch origin "${BRANCH}" --quiet 2>/dev/null || true
LATEST_REMOTE_SHA="$(git rev-parse "origin/${BRANCH}")"

if [[ "${LATEST_REMOTE_SHA}" != "${REMOTE_SHA}" ]]; then
  warn "main moved during build (${REMOTE_SHA:0:7} → ${LATEST_REMOTE_SHA:0:7})."
  warn "Images pushed but Helm NOT updated. Next run will process ${LATEST_REMOTE_SHA:0:7}."
  # НЕ обновляем state file — следующий тик подхватит новый SHA
  docker logout 2>/dev/null || true
  exit 0
fi

# ─── Helm update через yq ────────────────────────────────────────────────────
# Сначала checkout свежего main, чтобы не было конфликтов
git checkout -B "${BRANCH}" "origin/${BRANCH}"

UPDATED_SERVICES=""

if [[ "${FRONTEND_PUSHED}" == true ]]; then
  log "Helm: frontend.image.tag → ${TAG}"
  IMAGE_TAG="${TAG}" yq -i '.frontend.image.tag = strenv(IMAGE_TAG)' "${REPO_DIR}/${VALUES_FILE}"
  UPDATED_SERVICES="${UPDATED_SERVICES} frontend:${TAG}"
fi

if [[ "${BACKEND_PUSHED}" == true ]]; then
  log "Helm: backend.image.tag  → ${TAG}"
  IMAGE_TAG="${TAG}" yq -i '.backend.image.tag = strenv(IMAGE_TAG)' "${REPO_DIR}/${VALUES_FILE}"
  UPDATED_SERVICES="${UPDATED_SERVICES} backend:${TAG}"
fi

# Проверяем, реально ли values.yaml изменился
if git diff --quiet "${REPO_DIR}/${VALUES_FILE}"; then
  info "values.yaml already up to date. Skipping GitOps commit."
  echo "${REMOTE_SHA}" > "${STATE_FILE}"
  docker logout 2>/dev/null || true
  exit 0
fi

# ─── GitOps commit ───────────────────────────────────────────────────────────
git config user.name  "deploy-bot"
git config user.email "deploy-bot@pointers-team.tech"

git add "${REPO_DIR}/${VALUES_FILE}"
git commit -m "chore(gitops): deploy${UPDATED_SERVICES} [skip ci]"

log "Pushing GitOps commit to ${BRANCH}..."
git push origin "HEAD:${BRANCH}"
ok "GitOps commit pushed → ArgoCD will sync"

# ─── Обновляем state ─────────────────────────────────────────────────────────
echo "${REMOTE_SHA}" > "${STATE_FILE}"

# ─── Cleanup ─────────────────────────────────────────────────────────────────
docker logout 2>/dev/null || true
docker image prune -f --filter "until=24h" >/dev/null 2>&1 || true

log "Waiting for ArgoCD → Kubernetes RollingUpdate."
log "Check: kubectl get pods -n queue-system"
ok "Done. Deployed${UPDATED_SERVICES} as ${TAG}"
