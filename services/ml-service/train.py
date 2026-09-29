import argparse, csv, json, math, os, random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from features import DEFAULT_ROLLING, export_features
from joblib import dump
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.feature_extraction import DictVectorizer
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline

SEED = 20260928
MODEL_VERSION = "eta-gbr-v1"

def synthetic(n=1200, seed=SEED):
    rng=random.Random(seed); rows=[]
    services=["letters","parcels","payments","retail"]; sources=["QR","LIVE","APPOINTMENT"]
    bases={"letters":180,"parcels":360,"payments":240,"retail":300}
    start=datetime(2025,1,1,tzinfo=timezone.utc)
    for i in range(n):
        ts=start+timedelta(minutes=i*13)
        service=rng.choice(services); hour=(ts.hour+3)%24; weekday=((ts.weekday()))
        served=i%35; rolling=float(bases[service])
        effect=1.0 + (0.18 if hour in (12,13,18) else 0) + (0.10 if weekday in (5,6) else 0)
        duration=max(30, rng.gauss(bases[service]*effect, bases[service]*0.15))
        if rng.random()<0.02: duration*=rng.uniform(2,4)
        rows.append({"service_id":service,"branch_id":f"branch-{i%4}","source":rng.choice(sources),"hour":hour,"weekday":weekday,"served_count":served,"rolling_avg_seconds":rolling,"target":duration,"completed_at":ts,"service_started_at":ts})
    return rows

def build_model():
    return Pipeline([("vectorizer",DictVectorizer()),("model",GradientBoostingRegressor(random_state=SEED, loss="huber", n_estimators=80, max_depth=2))])

def evaluate(rows):
    rows=sorted(rows,key=lambda r:r["service_started_at"]); cut=max(1,int(len(rows)*0.8)); train_rows,valid=rows[:cut],rows[cut:]
    model=build_model(); model.fit([export_features(r) for r in train_rows],[r["target"] for r in train_rows])
    pred=model.predict([export_features(r) for r in valid]); baseline=[median([r["target"] for r in train_rows if r["service_id"]==v["service_id"]]) if any(r["service_id"]==v["service_id"] for r in train_rows) else DEFAULT_ROLLING for v in valid]
    y=[r["target"] for r in valid]
    return model, {"model_mae":mean_absolute_error(y,pred),"model_rmse":math.sqrt(mean_squared_error(y,pred)),"baseline_mae":mean_absolute_error(y,baseline),"baseline_rmse":math.sqrt(mean_squared_error(y,baseline)),"train_count":len(train_rows),"validation_count":len(valid)}

def read_csv(path):
    rows=[]
    with open(path,newline="") as f:
        for r in csv.DictReader(f):
            for k in ("served_count",): r[k]=int(r[k])
            r["rolling_avg_seconds"]=float(r["rolling_avg_seconds"]); r["target"]=float(r["target"])
            r["service_started_at"]=datetime.fromisoformat(r["service_started_at"].replace("Z","+00:00")); rows.append(r)
    return rows

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--input"); ap.add_argument("--output",default=os.getenv("MODEL_PATH","/models/eta.joblib")); ap.add_argument("--min-completed",type=int,default=200); ap.add_argument("--seed",type=int,default=SEED); args=ap.parse_args()
    rows=read_csv(args.input) if args.input else synthetic(seed=args.seed)
    if args.input and len(rows)<args.min_completed:
        print(json.dumps({"saved":False,"reason":f"completed tickets {len(rows)} < minimum {args.min_completed}"})); return 2
    model,metrics=evaluate(rows)
    if args.input and metrics["model_mae"] >= metrics["baseline_mae"]:
        print(json.dumps({"saved":False,"reason":"model did not beat baseline","metrics":metrics})); return 3
    Path(args.output).parent.mkdir(parents=True,exist_ok=True); dump({"model":model,"version":MODEL_VERSION,"metrics":metrics},args.output); print(json.dumps({"saved":True,"version":MODEL_VERSION,"metrics":metrics})); return 0

if __name__=="__main__": raise SystemExit(main())
