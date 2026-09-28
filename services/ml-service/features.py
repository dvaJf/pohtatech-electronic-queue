from datetime import datetime
from zoneinfo import ZoneInfo

MOSCOW = ZoneInfo("Europe/Moscow")
DEFAULT_ROLLING = 300.0

def runtime_features(item: dict) -> dict:
    rolling = float(item.get("rolling_avg_seconds", DEFAULT_ROLLING))
    if int(item.get("served_count", 0)) < 3:
        rolling = DEFAULT_ROLLING
    return {
        "service_id": str(item.get("service_id", "")),
        "branch_id": str(item.get("branch_id", "")),
        "source": str(item.get("source", "")),
        "hour": int(item.get("hour", 0)),
        "weekday": int(item.get("weekday", 0)),
        "served_count": int(item.get("served_count", 0)),
        "rolling_avg_seconds": rolling,
    }

def time_features(timestamp: datetime) -> tuple[int, int]:
    local = timestamp.astimezone(MOSCOW)
    return local.hour, local.weekday()

def export_features(row: dict) -> dict:
    hour, weekday = time_features(row["service_started_at"])
    return runtime_features({**row, "hour": hour, "weekday": weekday})
