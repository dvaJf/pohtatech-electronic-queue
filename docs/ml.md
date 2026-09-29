# ML ETA

ML ETA is an optional layer. `ml.eta.enabled` is `false` by default. The deterministic queue ranking and ETA simulation remain authoritative; ML only supplies an estimated service duration. Timeout, invalid response, circuit breaker, or unavailable service automatically use the existing `eta.go` baseline.

The service uses a fixed `Europe/Moscow` timezone for hour and weekday. Backend and exporter use explicit PostgreSQL expressions with `AT TIME ZONE 'Europe/Moscow'`. With fewer than three completed tickets, `rolling_avg_seconds` is exactly `300` in SQL, exporter, Python serving, and backend fallback.

## Run and demo

```bash
docker compose up --build -d
sed -i 's/enabled: false/enabled: true/' queue_policy.yaml
# wait for policy hot-reload, then request /tickets/{id}/eta
docker compose stop ml-service
# the same ETA endpoint remains available and reports source=baseline
```

The model is initially trained on deterministic synthetic data. This demonstrates the architecture and is not a claim of accuracy on Russian Post production data. The active model is stored in the named Docker volume `ml_model_data`; rebuilding the image does not replace a retrained model. A new empty volume receives the synthetic bootstrap model.

## Real-data retraining

```bash
python3 scripts/ml/export_completed.py --dsn "$DATABASE_URL" --output ml-data/completed.csv
docker compose run --rm ml-service python train.py --input /app/ml-data/completed.csv --output /models/eta.joblib --min-completed 200
```

Retraining uses a time-based validation split. It refuses to save when completed history is below the configurable minimum (default 200) or when MAE does not beat the median-per-service baseline. Use `python train.py --help` for options.

## Tests and metrics

`pytest services/ml-service` covers deterministic generation, Moscow midnight boundaries, cold-start fallback, train/serve parity, and batch ordering. Prometheus exposes `ml_requests_total`, `ml_latency_seconds`, `ml_fallback_total`, and `ml_prediction_error`. Synthetic and real-data metrics are reported separately.

## Future work: no-show shadow mode

The optional APPOINTMENT no-show classifier is intentionally not implemented; future work should run it in shadow mode, report calibrated recommendations and validation metrics to the branch manager, and never affect the deterministic call order until separately approved.

## Known issues

The existing frontend dependency import `@solar-icons/react/linear` is not changed by this task.
