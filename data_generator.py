"""
Phase 1 — Synthetic Multi-Cloud Billing Data Generator
Generates 6 months of realistic billing data for AWS, Azure, GCP
with injected anomalies (spikes, gradual drift, seasonal deviations)
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
import json
import os

# ── Seed for reproducibility ──────────────────────────────────────────────────
np.random.seed(42)
random.seed(42)

# ── Config ────────────────────────────────────────────────────────────────────
START_DATE = datetime.now() - timedelta(days=180)
END_DATE   = datetime.now()
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data", "raw")

TEAMS        = ["platform", "data-eng", "ml-team", "frontend", "backend"]
ENVIRONMENTS = ["production", "staging", "development"]


# ══════════════════════════════════════════════════════════════════════════════
#  AWS CUR (Cost and Usage Report) Generator
# ══════════════════════════════════════════════════════════════════════════════
AWS_SERVICES = {
    "Amazon EC2":        {"base_cost": 4200, "unit": "Hrs",        "category": "compute"},
    "Amazon S3":         {"base_cost": 820,  "unit": "GB-Mo",      "category": "storage"},
    "Amazon RDS":        {"base_cost": 1500, "unit": "Hrs",        "category": "database"},
    "AWS Lambda":        {"base_cost": 340,  "unit": "Requests",   "category": "compute"},
    "Amazon CloudFront": {"base_cost": 280,  "unit": "GB",         "category": "networking"},
    "Amazon EKS":        {"base_cost": 900,  "unit": "Hrs",        "category": "compute"},
    "AWS Data Transfer": {"base_cost": 450,  "unit": "GB",         "category": "networking"},
    "Amazon DynamoDB":   {"base_cost": 310,  "unit": "RCU",        "category": "database"},
}

def generate_aws_cur(anomalies_config):
    rows = []
    current = START_DATE

    while current <= END_DATE:
        for service, meta in AWS_SERVICES.items():
            for team in TEAMS:
                for env in ENVIRONMENTS:
                    base = meta["base_cost"] / (len(TEAMS) * len(ENVIRONMENTS))

                    # Weekday pattern: higher on weekdays
                    weekday_factor = 1.0 if current.weekday() < 5 else 0.65

                    # Monthly growth trend (~2% per month)
                    months_elapsed = (current - START_DATE).days / 30
                    trend_factor = 1 + (0.02 * months_elapsed)

                    # Random daily noise
                    noise = np.random.normal(1.0, 0.08)

                    cost = base * weekday_factor * trend_factor * noise

                    # Inject anomalies
                    cost = _apply_aws_anomaly(cost, current, service, team, env, anomalies_config)

                    rows.append({
                        "line_item_usage_start_date": current.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "line_item_usage_end_date":   (current + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "line_item_product_code":     service,
                        "line_item_usage_type":       meta["unit"],
                        "line_item_unblended_cost":   round(max(cost, 0), 4),
                        "resource_tags_user_team":    team,
                        "resource_tags_user_env":     env,
                        "product_region":             random.choice(["us-east-1", "us-west-2", "eu-west-1"]),
                        "line_item_usage_account_id": f"aws-{team}-{env}",
                    })
        current += timedelta(days=1)

    return pd.DataFrame(rows)


def _apply_aws_anomaly(cost, date, service, team, env, cfg):
    for anomaly in cfg:
        if anomaly["provider"] != "aws":
            continue
        start = datetime.strptime(anomaly["start"], "%Y-%m-%d")
        end   = datetime.strptime(anomaly["end"],   "%Y-%m-%d")
        if not (start <= date <= end):
            continue
        if anomaly.get("service") and anomaly["service"] != service:
            continue
        if anomaly.get("team") and anomaly["team"] != team:
            continue

        atype = anomaly["type"]
        if atype == "spike":
            cost *= anomaly["multiplier"]
        elif atype == "gradual_drift":
            days_in = (date - start).days
            total   = (end - start).days or 1
            cost   *= 1 + (anomaly["max_multiplier"] - 1) * (days_in / total)
        elif atype == "drop":
            cost *= anomaly["multiplier"]

    return cost


# ══════════════════════════════════════════════════════════════════════════════
#  Azure Cost Management Export Generator
# ══════════════════════════════════════════════════════════════════════════════
AZURE_SERVICES = {
    "Virtual Machines":        {"base_cost": 3800, "meter": "Compute Hours",    "category": "compute"},
    "Azure Blob Storage":      {"base_cost": 610,  "meter": "GRS Data Stored",  "category": "storage"},
    "Azure SQL Database":      {"base_cost": 1200, "meter": "vCore Hours",      "category": "database"},
    "Azure Kubernetes Service": {"base_cost": 780,  "meter": "Node Hours",      "category": "compute"},
    "Azure CDN":               {"base_cost": 190,  "meter": "GB Transferred",   "category": "networking"},
    "Azure Functions":         {"base_cost": 220,  "meter": "Executions",       "category": "compute"},
    "Azure Bandwidth":         {"base_cost": 380,  "meter": "GB Egress",        "category": "networking"},
}

def generate_azure_cost(anomalies_config):
    rows = []
    current = START_DATE

    while current <= END_DATE:
        for service, meta in AZURE_SERVICES.items():
            for team in TEAMS:
                for env in ENVIRONMENTS:
                    base = meta["base_cost"] / (len(TEAMS) * len(ENVIRONMENTS))
                    weekday_factor = 1.0 if current.weekday() < 5 else 0.60
                    months_elapsed = (current - START_DATE).days / 30
                    trend_factor = 1 + (0.018 * months_elapsed)
                    noise = np.random.normal(1.0, 0.09)
                    cost  = base * weekday_factor * trend_factor * noise
                    cost  = _apply_azure_anomaly(cost, current, service, team, env, anomalies_config)

                    rows.append({
                        "Date":             current.strftime("%Y-%m-%d"),
                        "ServiceName":      service,
                        "MeterCategory":    meta["meter"],
                        "CostUSD":          round(max(cost, 0), 4),
                        "ResourceGroup":    f"{team}-rg",
                        "Tags":             json.dumps({"team": team, "env": env}),
                        "SubscriptionName": f"azure-{team}",
                        "Location":         random.choice(["eastus", "westeurope", "southeastasia"]),
                    })
        current += timedelta(days=1)

    return pd.DataFrame(rows)


def _apply_azure_anomaly(cost, date, service, team, env, cfg):
    for anomaly in cfg:
        if anomaly["provider"] != "azure":
            continue
        start = datetime.strptime(anomaly["start"], "%Y-%m-%d")
        end   = datetime.strptime(anomaly["end"],   "%Y-%m-%d")
        if not (start <= date <= end):
            continue
        if anomaly.get("service") and anomaly["service"] != service:
            continue

        atype = anomaly["type"]
        if atype == "spike":
            cost *= anomaly["multiplier"]
        elif atype == "gradual_drift":
            days_in = (date - start).days
            total   = (end - start).days or 1
            cost   *= 1 + (anomaly["max_multiplier"] - 1) * (days_in / total)
        elif atype == "correlated":
            # Simulate correlated multi-service anomaly
            cost *= anomaly["multiplier"]

    return cost


# ══════════════════════════════════════════════════════════════════════════════
#  GCP Billing Export Generator
# ══════════════════════════════════════════════════════════════════════════════
GCP_SERVICES = {
    "Compute Engine":    {"base_cost": 3500, "sku": "N2 Instance Core",     "category": "compute"},
    "Cloud Storage":     {"base_cost": 540,  "sku": "Standard Storage",     "category": "storage"},
    "BigQuery":          {"base_cost": 960,  "sku": "Analysis",             "category": "analytics"},
    "Cloud Run":         {"base_cost": 290,  "sku": "CPU Allocation Time",  "category": "compute"},
    "Cloud SQL":         {"base_cost": 880,  "sku": "DB Custom Core",       "category": "database"},
    "Networking":        {"base_cost": 320,  "sku": "Network Egress",       "category": "networking"},
    "Kubernetes Engine": {"base_cost": 720,  "sku": "Cluster Management",   "category": "compute"},
}

def generate_gcp_billing(anomalies_config):
    rows = []
    current = START_DATE

    while current <= END_DATE:
        for service, meta in GCP_SERVICES.items():
            for team in TEAMS:
                for env in ENVIRONMENTS:
                    base = meta["base_cost"] / (len(TEAMS) * len(ENVIRONMENTS))
                    weekday_factor = 1.0 if current.weekday() < 5 else 0.55
                    months_elapsed = (current - START_DATE).days / 30
                    trend_factor = 1 + (0.022 * months_elapsed)
                    noise = np.random.normal(1.0, 0.07)
                    cost  = base * weekday_factor * trend_factor * noise
                    cost  = _apply_gcp_anomaly(cost, current, service, team, anomalies_config)

                    rows.append({
                        "usage_start_time": current.strftime("%Y-%m-%d %H:%M:%S UTC"),
                        "service_description": service,
                        "sku_description":     meta["sku"],
                        "cost":                round(max(cost, 0), 4),
                        "currency":            "USD",
                        "project_id":          f"gcp-{team}-{env}",
                        "labels":              json.dumps({"team": team, "env": env}),
                        "location_region":     random.choice(["us-central1", "europe-west1", "asia-east1"]),
                    })
        current += timedelta(days=1)

    return pd.DataFrame(rows)


def _apply_gcp_anomaly(cost, date, service, team, cfg):
    for anomaly in cfg:
        if anomaly["provider"] != "gcp":
            continue
        start = datetime.strptime(anomaly["start"], "%Y-%m-%d")
        end   = datetime.strptime(anomaly["end"],   "%Y-%m-%d")
        if not (start <= date <= end):
            continue
        if anomaly.get("service") and anomaly["service"] != service:
            continue
        if anomaly.get("team") and anomaly["team"] != team:
            continue

        atype = anomaly["type"]
        if atype == "spike":
            cost *= anomaly["multiplier"]
        elif atype == "gradual_drift":
            days_in = (date - start).days
            total   = (end - start).days or 1
            cost   *= 1 + (anomaly["max_multiplier"] - 1) * (days_in / total)

    return cost


# ══════════════════════════════════════════════════════════════════════════════
#  Anomaly Injection Config  (labeled ground truth for evaluation)
# ══════════════════════════════════════════════════════════════════════════════
def get_anomaly_config():
    # Calculate dates relative to today
    today = datetime.now()

    def dstr(days_ago_start, days_ago_end):
        s = (today - timedelta(days=days_ago_start)).strftime("%Y-%m-%d")
        e = (today - timedelta(days=days_ago_end)).strftime("%Y-%m-%d")
        return s, e

    configs = []

    # 1. AWS EC2 spike — sudden autoscaling loop
    s, e = dstr(80, 74)
    configs.append({
        "id": "ANO-001", "provider": "aws", "type": "spike",
        "service": "Amazon EC2", "team": "ml-team",
        "start": s, "end": e, "multiplier": 4.8,
        "description": "EC2 autoscaling loop caused by failed health check",
        "label": 1
    })

    # 2. AWS S3 gradual drift — misconfigured backup
    s, e = dstr(120, 90)
    configs.append({
        "id": "ANO-002", "provider": "aws", "type": "gradual_drift",
        "service": "Amazon S3", "team": "data-eng",
        "start": s, "end": e, "max_multiplier": 3.2,
        "description": "S3 backup job misconfigured — storing duplicates",
        "label": 1
    })

    # 3. Azure VM spike — dev environment left running
    s, e = dstr(50, 44)
    configs.append({
        "id": "ANO-003", "provider": "azure", "type": "spike",
        "service": "Virtual Machines",
        "start": s, "end": e, "multiplier": 3.1,
        "description": "Dev VMs not shut down over weekend",
        "label": 1
    })

    # 4. Azure correlated anomaly — VM + Bandwidth spike
    s, e = dstr(30, 26)
    configs.append({
        "id": "ANO-004", "provider": "azure", "type": "correlated",
        "service": "Azure Bandwidth",
        "start": s, "end": e, "multiplier": 5.5,
        "description": "Public bucket exposure causing egress spike",
        "label": 1
    })

    # 5. GCP BigQuery spike — runaway query
    s, e = dstr(60, 57)
    configs.append({
        "id": "ANO-005", "provider": "gcp", "type": "spike",
        "service": "BigQuery", "team": "data-eng",
        "start": s, "end": e, "multiplier": 6.2,
        "description": "Runaway BigQuery scan without partition filter",
        "label": 1
    })

    # 6. GCP gradual drift — Kubernetes over-provisioning
    s, e = dstr(140, 100)
    configs.append({
        "id": "ANO-006", "provider": "gcp", "type": "gradual_drift",
        "service": "Kubernetes Engine", "team": "platform",
        "start": s, "end": e, "max_multiplier": 2.4,
        "description": "GKE node pool not autoscaling down after load test",
        "label": 1
    })

    return configs


# ══════════════════════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════════════════════
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("🔧 Generating synthetic billing data...")

    anomalies = get_anomaly_config()

    # Save anomaly ground truth labels
    with open(f"{OUTPUT_DIR}/anomaly_labels.json", "w") as f:
        json.dump(anomalies, f, indent=2)
    print(f"  ✅ Saved anomaly_labels.json ({len(anomalies)} injected anomalies)")

    # Generate AWS
    print("  ⏳ Generating AWS CUR data...")
    aws_df = generate_aws_cur(anomalies)
    aws_df.to_csv(f"{OUTPUT_DIR}/aws_cur.csv", index=False)
    print(f"  ✅ aws_cur.csv — {len(aws_df):,} rows")

    # Generate Azure
    print("  ⏳ Generating Azure Cost Management data...")
    azure_df = generate_azure_cost(anomalies)
    azure_df.to_csv(f"{OUTPUT_DIR}/azure_cost.csv", index=False)
    print(f"  ✅ azure_cost.csv — {len(azure_df):,} rows")

    # Generate GCP
    print("  ⏳ Generating GCP Billing Export data...")
    gcp_df = generate_gcp_billing(anomalies)
    gcp_df.to_csv(f"{OUTPUT_DIR}/gcp_billing.csv", index=False)
    print(f"  ✅ gcp_billing.csv — {len(gcp_df):,} rows")

    print(f"\n✅ Done! Raw data saved to ./{OUTPUT_DIR}/")
    return aws_df, azure_df, gcp_df, anomalies


if __name__ == "__main__":
    main()
