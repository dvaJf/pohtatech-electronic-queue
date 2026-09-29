import os
import shutil
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from joblib import load
from train import synthetic, evaluate
from features import runtime_features

MODEL_PATH=Path(os.getenv("MODEL_PATH","/models/eta.joblib")); app=FastAPI(title="ETA ML service")
class Item(BaseModel):
    service_id:str; branch_id:str; hour:int; weekday:int; source:str; served_count:int; rolling_avg_seconds:float
class Request(BaseModel): items:list[Item]
model_data=None
def ensure_model():
    global model_data
    if model_data is None:
        if not MODEL_PATH.exists():
            MODEL_PATH.parent.mkdir(parents=True,exist_ok=True)
            seed=Path('/app/seed/eta.joblib')
            if seed.exists(): shutil.copyfile(seed, MODEL_PATH)
            else:
                model,_=evaluate(synthetic())
                from joblib import dump; dump({"model":model,"version":"eta-gbr-v1-synthetic"},MODEL_PATH)
        model_data=load(MODEL_PATH)
    return model_data
@app.get("/health")
def health(): return {"status":"ok","model_version":ensure_model()["version"]}
@app.post("/predict")
def predict(req:Request):
    if not req.items: raise HTTPException(400,"items must not be empty")
    data=ensure_model(); values=[runtime_features(i.model_dump()) for i in req.items]
    predictions=data["model"].predict(values).tolist()
    return {"predictions":[max(60.0,min(1800.0,float(x))) for x in predictions],"model_version":data["version"]}
