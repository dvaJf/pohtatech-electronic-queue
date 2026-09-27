#!/usr/bin/env bash
# High-Availability Watchdog & Auto-Healer for SUO Hackathon Deployment
set -euo pipefail

ENV_FILE="/root/tsifrovaya-ochered-novogo-pokoleniya/.env"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a
    source "$ENV_FILE"
    set +a
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

check_endpoint() {
    local url="$1"
    local max_time="${2:-3}"
    curl -s -f -m "$max_time" "$url" > /dev/null 2>&1
}

# 1. Check Nginx
if ! systemctl is-active --quiet nginx; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nginx is down! Restarting..."
    systemctl restart nginx || true
    if systemctl is-active --quiet nginx; then
        notify_telegram "⚠️ [Watchdog] Nginx был перезапущен и успешно восстановился."
    else
        notify_telegram "🚨 [Watchdog] КРИТИЧЕСКИЙ СБОЙ: Не удалось перезапустить Nginx!"
    fi
fi

# 2. Check Backend API
if ! check_endpoint "http://127.0.0.1:8080/health" 10; then
    sleep 5
    if ! check_endpoint "http://127.0.0.1:8080/health" 15; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backend /health failed twice! Restarting backend container..."
        docker restart tsifrovaya-ochered-novogo-pokoleniya-backend-1 || true
        sleep 5
        if check_endpoint "http://127.0.0.1:8080/health" 15; then
            notify_telegram "⚠️ [Watchdog] Контейнер Backend перестал отвечать на /health, был перезапущен и восстановился."
        else
            notify_telegram "🚨 [Watchdog] ВНИМАНИЕ: Бэкенд не восстановился после перезапуска!"
        fi
    fi
fi

# 3. Check Frontend
if ! check_endpoint "http://127.0.0.1:5173" 10; then
    sleep 5
    if ! check_endpoint "http://127.0.0.1:5173" 15; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Frontend failed twice! Restarting frontend container..."
        docker restart tsifrovaya-ochered-novogo-pokoleniya-frontend-1 || true
        sleep 5
        if check_endpoint "http://127.0.0.1:5173" 15; then
            notify_telegram "⚠️ [Watchdog] Контейнер Frontend был перезапущен сторожевым процессом и восстановился."
        else
            notify_telegram "🚨 [Watchdog] ВНИМАНИЕ: Фронтенд не восстановился после перезапуска!"
        fi
    fi
fi

# 4. Check Disk Space
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 88 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Disk usage high ($DISK_USAGE%). Pruning docker unused images and build cache..."
    docker image prune -af --filter "until=24h" > /dev/null 2>&1 || true
    docker builder prune -af > /dev/null 2>&1 || true
fi
