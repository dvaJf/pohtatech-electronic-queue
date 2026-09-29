from datetime import datetime, timezone
from math import isclose
from features import DEFAULT_ROLLING, export_features, runtime_features
from train import synthetic, build_model
import numpy as np

def test_cold_start_is_shared_default():
    got=runtime_features({"service_id":"s","branch_id":"b","served_count":2,"rolling_avg_seconds":999})
    assert got["rolling_avg_seconds"] == DEFAULT_ROLLING == 300.0

def test_moscow_boundary():
    row={"service_id":"s","branch_id":"b","source":"QR","served_count":3,"rolling_avg_seconds":300.0,
         "service_started_at":datetime(2026,1,1,21,30,tzinfo=timezone.utc)}
    got=export_features(row)
    assert got["hour"] == 0 and got["weekday"] == 4

def test_train_serve_float_parity():
    row={"service_id":"s","branch_id":"b","source":"QR","served_count":4,"rolling_avg_seconds":301.25,
         "service_started_at":datetime(2026,1,2,9,0,tzinfo=timezone.utc)}
    train=export_features(row)
    serve=runtime_features({**row,"hour":train["hour"],"weekday":train["weekday"]})
    for key in ("rolling_avg_seconds",): assert isclose(train[key],serve[key],rel_tol=1e-9,abs_tol=1e-9)
    assert [train["service_id"],train["branch_id"],train["source"],train["hour"],train["weekday"]] == [serve["service_id"],serve["branch_id"],serve["source"],serve["hour"],serve["weekday"]]

def test_synthetic_and_prediction_parity_and_batch_order():
    rows=synthetic(40, seed=77)
    assert synthetic(40, seed=77) == rows
    model=build_model(); train_rows=rows[:30]
    model.fit([export_features(r) for r in train_rows],[r["target"] for r in train_rows])
    train_pred=model.predict([export_features(r) for r in rows[30:]])
    serve_pred=model.predict([runtime_features({**r,"hour":export_features(r)["hour"],"weekday":export_features(r)["weekday"]}) for r in rows[30:]])
    assert np.allclose(train_pred, serve_pred, rtol=1e-9, atol=1e-9)
    assert len(serve_pred)==10
