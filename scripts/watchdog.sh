#!/usr/bin/env bash
# High-Availability Watchdog & Auto-Healer for SUO — K3s/Kubernetes mode
# Запускается как cron каждую минуту на master-ноде:
#   * * * * * /root/tsifrovaya-ochered-novogo-pokoleniya/scripts/watchdog.sh >> /var/log/suo-watchdog.log 2>&1
set -euo pipefail

KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
NAMESPACE="queue-system"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [Watchdog]"

# ── Telegram ──────────────────────────────────────────────────────────────────
ENV_FILE="/root/tsifrovaya-ochered-novogo-pokoleniya/.env"
if [ -f "$ENV_FILE" ]; then
    # Читаем только KEY=VALUE строки, пропускаем комментарии и пустые строки
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        # Убираем ведущие/завершающие пробелы
        key="${key// /}"
        # export только нужные переменные
        case "$key" in
            TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID) export "$key"="$value" ;;
        esac
    done < "$ENV_FILE"
fi

TG_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TG_CHAT="${TELEGRAM_CHAT_ID:-}"

notify_telegram() {
    local message="$1"
    if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
        curl -s -m 5 -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
            -d chat_id="${TG_CHAT}" \
            -d text="${message}" > /dev/null 2>&1 || true
    fi
}

# ── Helpers ───────────────────────────────────────────────────────────────────
kube() { KUBECONFIG="$KUBECONFIG" kubectl "$@"; }

check_endpoint() {
    local url="$1"
    local max_time="${2:-5}"
    curl -sf -m "$max_time" "$url" > /dev/null 2>&1
}

rollout_and_wait() {
    local deploy="$1"
    kube rollout restart deployment/"$deploy" -n "$NAMESPACE" > /dev/null 2>&1 || true
    kube rollout status deployment/"$deploy" -n "$NAMESPACE" --timeout=60s > /dev/null 2>&1 || true
}

# ── 1. Nginx (host-level reverse proxy) ───────────────────────────────────────
if ! systemctl is-active --quiet nginx; then
    echo "$LOG_PREFIX Nginx is down! Restarting..."
    systemctl restart nginx || true
    sleep 3
    if systemctl is-active --quiet nginx; then
        notify_telegram "⚠️ [Watchdog] Nginx был перезапущен и успешно восстановился."
    else
        notify_telegram "🚨 [Watchdog] КРИТИЧЕСКИЙ СБОЙ: Не удалось перезапустить Nginx!"
    fi
fi

# ── 2. K3s control-plane ─────────────────────────────────────────────────────
if ! systemctl is-active --quiet k3s; then
    echo "$LOG_PREFIX k3s is down! Restarting..."
    systemctl restart k3s || true
    sleep 10
    if systemctl is-active --quiet k3s; then
        notify_telegram "⚠️ [Watchdog] k3s был перезапущен и восстановился."
    else
        notify_telegram "🚨 [Watchdog] КРИТИЧЕСКИЙ СБОЙ: k3s не запустился после перезапуска!"
    fi
fi

# ── 3. Flannel FDB — фикс маршрута к Oracle worker ─────────────────────────
# При перезагрузке flannel теряет маршрут до внешней ноды Oracle
ORACLE_MAC="92:97:69:1b:8e:f0"
ORACLE_IP="141.147.48.160"
if ip link show flannel.1 > /dev/null 2>&1; then
    CURRENT_DST=$(bridge fdb show dev flannel.1 2>/dev/null | grep "$ORACLE_MAC" | awk '{print $3}' || true)
    if [ "$CURRENT_DST" != "$ORACLE_IP" ]; then
        echo "$LOG_PREFIX Flannel FDB for Oracle is stale ($CURRENT_DST), fixing to $ORACLE_IP..."
        bridge fdb replace "$ORACLE_MAC" dev flannel.1 dst "$ORACLE_IP" self permanent || true
        notify_telegram "⚠️ [Watchdog] Flannel FDB маршрут до Oracle ($ORACLE_IP) был восстановлен."
    fi
fi

# ── 4. Backend Deployment в K8s ───────────────────────────────────────────────
BACKEND_READY=$(kube get deployment backend -n "$NAMESPACE" \
    -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
BACKEND_DESIRED=$(kube get deployment backend -n "$NAMESPACE" \
    -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")

if [ "${BACKEND_READY:-0}" -lt "${BACKEND_DESIRED:-1}" ]; then
    echo "$LOG_PREFIX Backend: $BACKEND_READY/$BACKEND_DESIRED ready. Triggering rollout..."
    rollout_and_wait backend
    sleep 5
    BACKEND_READY2=$(kube get deployment backend -n "$NAMESPACE" \
        -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    if [ "${BACKEND_READY2:-0}" -ge "${BACKEND_DESIRED:-1}" ]; then
        notify_telegram "⚠️ [Watchdog] Backend Deployment восстановился (${BACKEND_READY2}/${BACKEND_DESIRED} ready)."
    else
        notify_telegram "🚨 [Watchdog] Backend Deployment не восстановился! Проверьте: kubectl get pods -n queue-system"
    fi
fi

# ── 5. Frontend Deployment в K8s ─────────────────────────────────────────────
FRONTEND_READY=$(kube get deployment frontend -n "$NAMESPACE" \
    -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
FRONTEND_DESIRED=$(kube get deployment frontend -n "$NAMESPACE" \
    -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")

if [ "${FRONTEND_READY:-0}" -lt "${FRONTEND_DESIRED:-1}" ]; then
    echo "$LOG_PREFIX Frontend: $FRONTEND_READY/$FRONTEND_DESIRED ready. Triggering rollout..."
    rollout_and_wait frontend
    sleep 5
    FRONTEND_READY2=$(kube get deployment frontend -n "$NAMESPACE" \
        -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    if [ "${FRONTEND_READY2:-0}" -ge "${FRONTEND_DESIRED:-1}" ]; then
        notify_telegram "⚠️ [Watchdog] Frontend Deployment восстановился (${FRONTEND_READY2}/${FRONTEND_DESIRED} ready)."
    else
        notify_telegram "🚨 [Watchdog] Frontend Deployment не восстановился! Проверьте: kubectl get pods -n queue-system"
    fi
fi

# ── 6. Внешний health-check (prod URL) ───────────────────────────────────────
if ! check_endpoint "https://pointers-team.tech/health" 10; then
    sleep 5
    if ! check_endpoint "https://pointers-team.tech/health" 15; then
        echo "$LOG_PREFIX Production /health unavailable twice!"
        notify_telegram "🚨 [Watchdog] Продакшн https://pointers-team.tech/health недоступен! Требуется ручная проверка."
    fi
fi

# ── 7. Дисковое пространство ─────────────────────────────────────────────────
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 88 ]; then
    echo "$LOG_PREFIX Disk usage high (${DISK_USAGE}%). Pruning k3s images..."
    # Очистка неиспользуемых образов в containerd (k3s)
    k3s ctr images ls -q | grep -v 'rancher\|k3s\|traefik\|coredns\|metrics-server' | \
        xargs -r k3s ctr images rm 2>/dev/null || true
    # Старые Docker-образы (если Docker ещё установлен)
    docker image prune -af --filter "until=24h" > /dev/null 2>&1 || true
    DISK_AFTER=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
    notify_telegram "⚠️ [Watchdog] Высокая заполненность диска (${DISK_USAGE}% → ${DISK_AFTER}% после очистки)."
fi
