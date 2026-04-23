# -*- coding: utf-8 -*-
"""FinOps Anomaly Detection Dashboard App — FastAPI backend."""
import os, io, sys, json
import numpy as np, pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import LabelEncoder
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except: pass

@asynccontextmanager
async def lifespan(app):
    train_model()
    yield

app = FastAPI(title="FinOps Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MODEL = None
ENCODERS = {}
FEAT_COLS = []
DASH_DATA = {}
CAT_COLS = ["provider","service","category","team","environment","region"]

def assign_severity(costs, is_anom):
    mu, sigma = costs.mean(), costs.std()
    out = []
    for c, a in zip(costs, is_anom):
        if not a: out.append("NORMAL"); continue
        if c > mu+3*sigma: out.append("CRITICAL")
        elif c > mu+2*sigma: out.append("HIGH")
        elif c > mu+1.5*sigma: out.append("MEDIUM")
        else: out.append("LOW")
    return out

def train_model():
    global MODEL, ENCODERS, FEAT_COLS, DASH_DATA
    print("[1/3] Loading data...")
    df = pd.read_csv("data/processed/daily_billing.csv", parse_dates=["date"])
    for col in CAT_COLS:
        le = LabelEncoder(); df[f"{col}_enc"] = le.fit_transform(df[col]); ENCODERS[col] = le
    FEAT_COLS = ["cost_usd"] + [f"{c}_enc" for c in CAT_COLS]
    X = df[FEAT_COLS].values
    print("[2/3] Training Isolation Forest...")
    MODEL = IsolationForest(n_estimators=100, contamination=0.05, random_state=42, n_jobs=-1)
    MODEL.fit(X)
    df["score"] = -MODEL.decision_function(X)
    df["is_anomaly"] = MODEL.predict(X) == -1
    df["severity"] = assign_severity(df["cost_usd"].values, df["is_anomaly"].values)
    print(f"       {df['is_anomaly'].sum()} anomalies detected")
    print("[3/3] Computing dashboard data...")
    build_data(df)

def build_data(df):
    global DASH_DATA
    ts = df.groupby("date").agg(cost=("cost_usd","sum"), anom_count=("is_anomaly","sum")).reset_index().sort_values("date")
    ts["rolling_avg"] = ts["cost"].rolling(7, min_periods=1).mean()
    ts["forecast"] = ts["cost"].rolling(14, min_periods=1).mean()
    anom_ts = ts[ts["anom_count"]>0]
    # Spend by dimension
    spend_by, anom_by = {}, {}
    for col in ["provider","service","team","environment","region"]:
        g = df.groupby(col)["cost_usd"].sum().sort_values(ascending=False)
        spend_by[col] = {"labels": g.index.tolist(), "values": [round(v,2) for v in g.values]}
    for col in ["provider","service","team","region"]:
        g = df[df["is_anomaly"]].groupby(col).size().sort_values(ascending=False)
        anom_by[col] = {"labels": g.index.tolist(), "values": g.values.tolist()}
    # Box plot data (sampled)
    box = {}
    for col in ["provider","service"]:
        traces = []
        for name in df[col].unique():
            vals = df[df[col]==name]["cost_usd"]
            if len(vals) > 800: vals = vals.sample(800, random_state=42)
            traces.append({"name": name, "values": [round(v,2) for v in vals.tolist()]})
        box[col] = traces
    # Severity
    sev_counts = df[df["is_anomaly"]]["severity"].value_counts()
    sev_order = ["LOW","MEDIUM","HIGH","CRITICAL"]
    severity = {"labels": sev_order, "values": [int(sev_counts.get(s,0)) for s in sev_order]}
    # Provider-wise anomaly breakdown by severity
    breakdowns = {}
    for dim in ["provider","service"]:
        pvt = df[df["is_anomaly"]].groupby([dim,"severity"]).size().unstack(fill_value=0)
        for s in sev_order:
            if s not in pvt.columns: pvt[s] = 0
        breakdowns[dim] = {"labels": pvt.index.tolist(), "series": {s: pvt[s].tolist() for s in sev_order}}
    # Anomaly table (top 150)
    top = df[df["is_anomaly"]].nlargest(150,"score")
    table = []
    for _, r in top.iterrows():
        table.append({"date":str(r["date"].date()),"provider":r["provider"],"service":r["service"],
            "team":r["team"],"environment":r["environment"],"region":r["region"],
            "cost":round(r["cost_usd"],2),"score":round(r["score"],4),"severity":r["severity"]})
    # Weekly averages for forecast chart 2
    wk = df.set_index("date").resample("W")["cost_usd"].agg(["sum","mean"]).reset_index()
    wk["predicted"] = wk["mean"].rolling(4, min_periods=1).mean()
    # KPIs
    total_spend = float(df["cost_usd"].sum())
    anom_spend = float(df[df["is_anomaly"]]["cost_usd"].sum())
    DASH_DATA = {
        "kpis": {"total_rows": len(df), "total_spend": round(total_spend,2),
            "anomaly_count": int(df["is_anomaly"].sum()), "anomaly_spend": round(anom_spend,2),
            "savings_pct": round(anom_spend/total_spend*100,1),
            "date_range": f"{df['date'].min().strftime('%b %d, %Y')} — {df['date'].max().strftime('%b %d, %Y')}",
            "providers": sorted(df["provider"].unique().tolist()),
            "avg_daily": round(ts["cost"].mean(),2), "peak_daily": round(ts["cost"].max(),2)},
        "timeseries": {"dates": ts["date"].dt.strftime("%Y-%m-%d").tolist(),
            "costs": [round(v,2) for v in ts["cost"].tolist()],
            "rolling_avg": [round(v,2) for v in ts["rolling_avg"].tolist()],
            "anom_dates": anom_ts["date"].dt.strftime("%Y-%m-%d").tolist(),
            "anom_costs": [round(v,2) for v in anom_ts["cost"].tolist()]},
        "spend_by": spend_by, "anomaly_by": anom_by, "box": box,
        "severity": severity, "breakdowns": breakdowns, "table": table,
        "forecast": {"dates": ts["date"].dt.strftime("%Y-%m-%d").tolist(),
            "actual": [round(v,2) for v in ts["cost"].tolist()],
            "forecast": [round(v,2) for v in ts["forecast"].tolist()],
            "wk_dates": wk["date"].dt.strftime("%Y-%m-%d").tolist(),
            "wk_avg": [round(v,2) for v in wk["mean"].tolist()],
            "wk_pred": [round(v,2) for v in wk["predicted"].tolist()]},
    }


@app.get("/", response_class=HTMLResponse)
def serve_dashboard():
    with open(os.path.join(os.path.dirname(__file__),"static","finops_dashboard.html"),"r",encoding="utf-8") as f:
        return f.read()

@app.get("/api/data")
def get_data(): return DASH_DATA

@app.post("/api/predict")
async def predict(file: UploadFile = File(...)):
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content), parse_dates=["date"])
        for col in CAT_COLS:
            if col in df.columns:
                le = ENCODERS[col]
                df[f"{col}_enc"] = df[col].apply(lambda x: le.transform([x])[0] if x in le.classes_ else -1)
            else:
                df[f"{col}_enc"] = 0
        X = df[FEAT_COLS].fillna(0).values
        df["score"] = -MODEL.decision_function(X)
        df["is_anomaly"] = MODEL.predict(X) == -1
        df["severity"] = assign_severity(df["cost_usd"].values, df["is_anomaly"].values)
        # Build response
        ts = df.sort_values("date")
        anom = ts[ts["is_anomaly"]]
        dist = {"normal": int((~df["is_anomaly"]).sum()), "anomaly": int(df["is_anomaly"].sum())}
        sev_order = ["LOW","MEDIUM","HIGH","CRITICAL"]
        sc = df[df["is_anomaly"]]["severity"].value_counts()
        sev = {"labels": sev_order, "values": [int(sc.get(s,0)) for s in sev_order]}
        rows = []
        for _, r in df.iterrows():
            rows.append({"date":str(r["date"].date()) if hasattr(r["date"],"date") else str(r["date"]),
                "provider":r.get("provider",""),"service":r.get("service",""),"team":r.get("team",""),
                "environment":r.get("environment",""),"region":r.get("region",""),
                "cost":round(float(r["cost_usd"]),2),"score":round(float(r["score"]),4),
                "severity":r["severity"],"is_anomaly":bool(r["is_anomaly"])})
        return {"status":"ok","filename":file.filename,"total":len(df),
            "anomalies":int(df["is_anomaly"].sum()),
            "timeseries":{"dates":ts["date"].dt.strftime("%Y-%m-%d").tolist(),
                "costs":[round(v,2) for v in ts["cost_usd"].tolist()],
                "anom_dates":anom["date"].dt.strftime("%Y-%m-%d").tolist() if len(anom)>0 else [],
                "anom_costs":[round(v,2) for v in anom["cost_usd"].tolist()] if len(anom)>0 else []},
            "distribution":dist,"severity":sev,"rows":rows}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error":str(e)})

if __name__ == "__main__":
    uvicorn.run("dashboard_app:app", host="0.0.0.0", port=8050, reload=False)
