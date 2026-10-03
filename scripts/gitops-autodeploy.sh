#!/usr/bin/env bash
# =============================================================================
# gitops-autodeploy.sh — server-side GitOps CI replacement
# =============================================================================
#
# Архитектура:
#   WATCH:  origin/main  — откуда читаем новые коммиты разработчиков
#   PUSH:   origin/gitops — куда пишем Helm image tag обновления
#   ArgoCD отслеживает ветку gitops (Helm path: helm/queue-chart)
#
# Flow:
#   1. fetch origin/main
#   2. сравнить с last-deployed-sha
#   3. git diff → frontend/backend изменения?
#   4. если только Helm-only изменение → skip (loop protection)
#   5. docker build + push только изменившихся сервисов
#   6. yq → helm/queue-chart/values.yaml (ТОЛЬКО после успешного push)
#   7. git commit → push в gitops ветку
#   8. ArgoCD видит изменение → Kubernetes RollingUpdate
#
# Секреты: /etc/pointers-deploy.env (chmod 600)
# State:   /var/lib/pointers-deploy/last-deployed-sha
# Lock:    /run/lock/pointers-gitops-deploy.lock
# =============================================================================
set -Eeuo pipefail

# ─── Константы ───────────────────────────────────────────────────────────────
LOCK_FILE="/run/lock/pointers-gitops-deploy.lock"
STATE_DIR="/var/lib/pointers-deploy"
STATE_FILE="${STATE_DIR}/last-deployed-sha"
ENV_FILE="/etc/pointers-deploy.env"

# ─── Logging ─────────────────────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✅ $*"; }
warn() { echo "[$(date '+%H:%M:%S')] ⚠  $*"; }
err()  { echo "[$(date '+%H:%M:%S')] ❌ $*" >&2; }

# ─── flock: один процесс за раз ──────────────────────────────────────────────
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  log "Deploy already running, skipping tick."
  exit 0
fi

# ─── Читаем конфиг ───────────────────────────────────────────────────────────
if [[ ! -f "${ENV_FILE}" ]]; then
  err "Missing ${ENV_FILE}. Create it from scripts/pointers-deploy.env.template and chmod 600."
  exit 1
fi
source "${ENV_FILE}"

# Обязательные
: "${DOCKERHUB_USERNAME:?}"
: "${DOCKERHUB_TOKEN:?}"
: "${REPO_DIR:?}"

# Дефолты
WATCH_BRANCH="${WATCH_BRANCH:-main}"          # ветка с кодом разработчиков
GITOPS_BRANCH="${GITOPS_BRANCH:-gitops}"      # ветка куда пишем Helm теги
FRONTEND_DOCKERFILE="${FRONTEND_DOCKERFILE:-frontend/Dockerfile.prod}"
BACKEND_DOCKERFILE="${BACKEND_DOCKERFILE:-backend/Dockerfile}"
FRONTEND_CONTEXT="${FRONTEND_CONTEXT:-frontend}"
BACKEND_CONTEXT="${BACKEND_CONTEXT:-backend}"
VALUES_FILE="${VALUES_FILE:-helm/queue-chart/values.yaml}"

# Remote URL для push в gitops (может иметь токен с нужными правами)
# Если GITOPS_PUSH_URL не задан — используется origin
GITOPS_PUSH_URL="${GITOPS_PUSH_URL:-}"

# ─── Читаем Docker Hub repos из Helm values ──────────────────────────────────
cd "${REPO_DIR}"
FRONTEND_REPO="$(yq -r '.frontend.image.repository' "${VALUES_FILE}")"
BACKEND_REPO="$(yq  -r '.backend.image.repository'  "${VALUES_FILE}")"

# ─── State directory ─────────────────────────────────────────────────────────
mkdir -p "${STATE_DIR}"

# ─── Fetch main (код разработчиков) ──────────────────────────────────────────
if ! git fetch origin "${WATCH_BRANCH}" --quiet 2>/dev/null; then
  warn "git fetch failed (network?). Skipping."
  exit 0
fi

REMOTE_SHA="$(git rev-parse "origin/${WATCH_BRANCH}")"
SHORT_SHA="${REMOTE_SHA:0:7}"

# ─── Читаем last-deployed-sha ─────────────────────────────────────────────────
LAST_SHA=""
[[ -f "${STATE_FILE}" ]] && LAST_SHA="$(cat "${STATE_FILE}")"

if [[ "${REMOTE_SHA}" == "${LAST_SHA}" ]]; then
  exit 0
fi

log "New commit on ${WATCH_BRANCH}: ${SHORT_SHA} (was: ${LAST_SHA:0:7:-not set})"

# ─── Определяем изменившиеся сервисы ─────────────────────────────────────────
FRONTEND_CHANGED=false
BACKEND_CHANGED=false

if [[ -z "${LAST_SHA}" ]]; then
  warn "First run — no baseline. Rebuilding both services."
  FRONTEND_CHANGED=true
  BACKEND_CHANGED=true
else
  CHANGED_FILES="$(git diff --name-only "${LAST_SHA}" "${REMOTE_SHA}" 2>/dev/null || true)"

  log "Changed files:"
  echo "${CHANGED_FILES}" | sed 's/^/    /'

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
      frontend/*) FRONTEND_CHANGED=true ;;
      backend/*|cmd/*|internal/*|pkg/*|go.mod|go.sum|queue_policy.yaml)
        BACKEND_CHANGED=true ;;
    esac
  done <<< "${CHANGED_FILES}"

  # Loop protection: если изменился только Helm/docs/scripts — не пересобираем
  if [[ "${FRONTEND_CHANGED}" == false && "${BACKEND_CHANGED}" == false ]]; then
    log "No service code changed (Helm-only / docs / scripts). Skipping build."
    echo "${REMOTE_SHA}" > "${STATE_FILE}"
    exit 0
  fi
fi

log "Frontend changed: ${FRONTEND_CHANGED} | Backend changed: ${BACKEND_CHANGED}"

# ─── Docker login ─────────────────────────────────────────────────────────────
log "Docker Hub login (${DOCKERHUB_USERNAME})..."
printf '%s' "${DOCKERHUB_TOKEN}" | \
  docker login --username "${DOCKERHUB_USERNAME}" --password-stdin 2>&1 | \
  grep -iv "token\|password" || true

TAG="v-${SHORT_SHA}"

# ─── Build & push frontend ────────────────────────────────────────────────────
FRONTEND_PUSHED=false
if [[ "${FRONTEND_CHANGED}" == true ]]; then
  FULL_FRONTEND="${FRONTEND_REPO}:${TAG}"
  log "Building frontend: ${FULL_FRONTEND}..."
  DOCKER_BUILDKIT=1 docker build --pull \
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
  DOCKER_BUILDKIT=1 docker build --pull \
    -f "${REPO_DIR}/${BACKEND_DOCKERFILE}" \
    -t "${FULL_BACKEND}" \
    "${REPO_DIR}/${BACKEND_CONTEXT}"
  log "Pushing ${FULL_BACKEND}..."
  docker push "${FULL_BACKEND}"
  ok "Backend pushed: ${FULL_BACKEND}"
  BACKEND_PUSHED=true
fi

# ─── Race condition check ─────────────────────────────────────────────────────
git fetch origin "${WATCH_BRANCH}" --quiet 2>/dev/null || true
LATEST_SHA="$(git rev-parse "origin/${WATCH_BRANCH}")"
if [[ "${LATEST_SHA}" != "${REMOTE_SHA}" ]]; then
  warn "main moved during build (${SHORT_SHA} → ${LATEST_SHA:0:7}). Skipping Helm update."
  warn "Images are in Docker Hub but Helm NOT updated. Next run will handle new SHA."
  docker logout 2>/dev/null || true
  exit 0
fi

# ─── Helm update в gitops ветке ───────────────────────────────────────────────
# Синхронизируем gitops ветку с main (code base идентична, только Helm теги будут другими)
git fetch origin "${GITOPS_BRANCH}" --quiet 2>/dev/null || {
  warn "gitops branch not found remotely, creating from ${WATCH_BRANCH}"
}

# Checkout gitops, rebase на свежий main
git checkout -B "${GITOPS_BRANCH}" "origin/${WATCH_BRANCH}" 2>/dev/null || \
  git checkout -B "${GITOPS_BRANCH}" "origin/${GITOPS_BRANCH}" 2>/dev/null || \
  git checkout -B "${GITOPS_BRANCH}" "${REMOTE_SHA}"

UPDATED_SERVICES=""

if [[ "${FRONTEND_PUSHED}" == true ]]; then
  log "Helm: frontend.image.tag → ${TAG}"
  IMAGE_TAG="${TAG}" yq -i '.frontend.image.tag = strenv(IMAGE_TAG)' "${REPO_DIR}/${VALUES_FILE}"
  UPDATED_SERVICES="${UPDATED_SERVICES} frontend:${TAG}"
fi

if [[ "${BACKEND_PUSHED}" == true ]]; then
  log "Helm: backend.image.tag → ${TAG}"
  IMAGE_TAG="${TAG}" yq -i '.backend.image.tag  = strenv(IMAGE_TAG)' "${REPO_DIR}/${VALUES_FILE}"
  UPDATED_SERVICES="${UPDATED_SERVICES} backend:${TAG}"
fi

if git diff --quiet "${REPO_DIR}/${VALUES_FILE}"; then
  log "values.yaml unchanged. Updating state and exiting."
  echo "${REMOTE_SHA}" > "${STATE_FILE}"
  docker logout 2>/dev/null || true
  exit 0
fi

# ─── GitOps commit ────────────────────────────────────────────────────────────
git config user.name  "deploy-bot"
git config user.email "deploy-bot@pointers-team.tech"
git add "${REPO_DIR}/${VALUES_FILE}"
git commit -m "chore(gitops): deploy${UPDATED_SERVICES} [skip ci]"

# Push в gitops ветку
if [[ -n "${GITOPS_PUSH_URL}" ]]; then
  git push "${GITOPS_PUSH_URL}" "HEAD:${GITOPS_BRANCH}"
else
  git push origin "HEAD:${GITOPS_BRANCH}"
fi

ok "GitOps commit pushed to ${GITOPS_BRANCH} → ArgoCD will sync"

# ─── Обновляем state ─────────────────────────────────────────────────────────
echo "${REMOTE_SHA}" > "${STATE_FILE}"

# Возвращаемся на main
git checkout "${WATCH_BRANCH}" 2>/dev/null || true
git reset --hard "origin/${WATCH_BRANCH}" 2>/dev/null || true

# Cleanup
docker logout 2>/dev/null || true
docker image prune -f --filter "until=24h" >/dev/null 2>&1 || true

ok "Done. Deployed${UPDATED_SERVICES} as ${TAG}"
log "ArgoCD → Kubernetes RollingUpdate in progress."
