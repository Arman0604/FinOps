"""
Phase 1 — Multi-Cloud Billing Normalizer
Maps AWS CUR, Azure Cost Management, GCP Billing Export
into a single unified cost taxonomy.

Unified Schema:
    date            : YYYY-MM-DD
    provider        : aws | azure | gcp
    service         : normalized service name
    category        : compute | storage | networking | database | analytics | other
    team            : cost allocation tag
    environment     : production | staging | development
    region          : normalized region string
    cost_usd        : float — daily cost in USD
    account_id      : provider-specific account/subscription/project
    raw_service     : original service name (for traceability)
"""

import pandas as pd
import numpy as np
import json
import os
import re

# ── Category Mapping ──────────────────────────────────────────────────────────

AWS_CATEGORY_MAP = {
    "Amazon EC2":        "compute",
    "Amazon S3":         "storage",
    "Amazon RDS":        "database",
    "AWS Lambda":        "compute",
    "Amazon CloudFront": "networking",
    "Amazon EKS":        "compute",
    "AWS Data Transfer": "networking",
    "Amazon DynamoDB":   "database",
}

AZURE_CATEGORY_MAP = {
    "Virtual Machines":         "compute",
    "Azure Blob Storage":       "storage",
    "Azure SQL Database":       "database",
    "Azure Kubernetes Service": "compute",
    "Azure CDN":                "networking",
    "Azure Functions":          "compute",
    "Azure Bandwidth":          "networking",
}

GCP_CATEGORY_MAP = {
    "Compute Engine":    "compute",
    "Cloud Storage":     "storage",
    "BigQuery":          "analytics",
    "Cloud Run":         "compute",
    "Cloud SQL":         "database",
    "Networking":        "networking",
    "Kubernetes Engine": "compute",
}

# ── Service Name Normalization ─────────────────────────────────────────────────
# Maps provider-specific names → unified canonical names
SERVICE_CANONICAL = {
    # Compute
    "Amazon EC2":               "Virtual Machines",
    "Virtual Machines":         "Virtual Machines",
    "Compute Engine":           "Virtual Machines",
    "Amazon EKS":               "Kubernetes",
    "Azure Kubernetes Service": "Kubernetes",
    "Kubernetes Engine":        "Kubernetes",
    "AWS Lambda":               "Serverless Functions",
    "Azure Functions":          "Serverless Functions",
    "Cloud Run":                "Serverless Functions",
    # Storage
    "Amazon S3":                "Object Storage",
    "Azure Blob Storage":       "Object Storage",
    "Cloud Storage":            "Object Storage",
    # Database
    "Amazon RDS":               "Managed Database",
    "Azure SQL Database":       "Managed Database",
    "Cloud SQL":                "Managed Database",
    "Amazon DynamoDB":          "NoSQL Database",
    # Networking
    "Amazon CloudFront":        "CDN",
    "Azure CDN":                "CDN",
    "AWS Data Transfer":        "Data Transfer",
    "Azure Bandwidth":          "Data Transfer",
    "Networking":               "Data Transfer",
    # Analytics
    "BigQuery":                 "Data Analytics",
}

# ── Region Normalization ───────────────────────────────────────────────────────
REGION_CANONICAL = {
    # US East
    "us-east-1":    "us-east",
    "eastus":       "us-east",
    "us-east4":     "us-east",
    # US West
    "us-west-2":    "us-west",
    "westus":       "us-west",
    "us-central1":  "us-central",
    # Europe
    "eu-west-1":    "eu-west",
    "westeurope":   "eu-west",
    "europe-west1": "eu-west",
    # Asia
    "southeastasia": "asia-southeast",
    "asia-east1":    "asia-east",
}


# ══════════════════════════════════════════════════════════════════════════════
#  Individual Cloud Normalizers
# ══════════════════════════════════════════════════════════════════════════════

def normalize_aws(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize AWS CUR format → unified schema."""
    out = pd.DataFrame()

    out["date"]        = pd.to_datetime(df["line_item_usage_start_date"]).dt.strftime("%Y-%m-%d")
    out["provider"]    = "aws"
    out["raw_service"] = df["line_item_product_code"]
    out["service"]     = df["line_item_product_code"].map(SERVICE_CANONICAL).fillna(df["line_item_product_code"])
    out["category"]    = df["line_item_product_code"].map(AWS_CATEGORY_MAP).fillna("other")
    out["team"]        = df["resource_tags_user_team"].fillna("untagged")
    out["environment"] = df["resource_tags_user_env"].fillna("unknown")
    out["region"]      = df["product_region"].map(REGION_CANONICAL).fillna(df["product_region"])
    out["cost_usd"]    = pd.to_numeric(df["line_item_unblended_cost"], errors="coerce").fillna(0)
    out["account_id"]  = df["line_item_usage_account_id"]

    return out


def normalize_azure(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize Azure Cost Management format → unified schema."""
    out = pd.DataFrame()

    out["date"]        = pd.to_datetime(df["Date"]).dt.strftime("%Y-%m-%d")
    out["provider"]    = "azure"
    out["raw_service"] = df["ServiceName"]
    out["service"]     = df["ServiceName"].map(SERVICE_CANONICAL).fillna(df["ServiceName"])
    out["category"]    = df["ServiceName"].map(AZURE_CATEGORY_MAP).fillna("other")
    out["cost_usd"]    = pd.to_numeric(df["CostUSD"], errors="coerce").fillna(0)
    out["region"]      = df["Location"].map(REGION_CANONICAL).fillna(df["Location"])
    out["account_id"]  = df["SubscriptionName"]

    # Parse Tags JSON → team + environment
    def parse_tag(tags_str, key):
        try:
            return json.loads(tags_str).get(key, "untagged")
        except Exception:
            return "untagged"

    out["team"]        = df["Tags"].apply(lambda t: parse_tag(t, "team"))
    out["environment"] = df["Tags"].apply(lambda t: parse_tag(t, "env"))

    return out


def normalize_gcp(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize GCP Billing Export format → unified schema."""
    out = pd.DataFrame()

    out["date"]        = pd.to_datetime(df["usage_start_time"]).dt.strftime("%Y-%m-%d")
    out["provider"]    = "gcp"
    out["raw_service"] = df["service_description"]
    out["service"]     = df["service_description"].map(SERVICE_CANONICAL).fillna(df["service_description"])
    out["category"]    = df["service_description"].map(GCP_CATEGORY_MAP).fillna("other")
    out["cost_usd"]    = pd.to_numeric(df["cost"], errors="coerce").fillna(0)
    out["region"]      = df["location_region"].map(REGION_CANONICAL).fillna(df["location_region"])
    out["account_id"]  = df["project_id"]

    def parse_label(labels_str, key):
        try:
            return json.loads(labels_str).get(key, "untagged")
        except Exception:
            return "untagged"

    out["team"]        = df["labels"].apply(lambda l: parse_label(l, "team"))
    out["environment"] = df["labels"].apply(lambda l: parse_label(l, "env"))

    return out


# ══════════════════════════════════════════════════════════════════════════════
#  Pipeline
# ══════════════════════════════════════════════════════════════════════════════

UNIFIED_COLUMNS = [
    "date", "provider", "service", "raw_service",
    "category", "team", "environment", "region",
    "cost_usd", "account_id"
]

def run_normalization_pipeline(
    raw_dir: str = os.path.join(os.path.dirname(__file__), "data", "raw"),
    output_dir: str = os.path.join(os.path.dirname(__file__), "data", "processed"),
) -> pd.DataFrame:
    os.makedirs(output_dir, exist_ok=True)
    frames = []

    # ── AWS ────────────────────────────────────────────────────────────────────
    aws_path = os.path.join(raw_dir, "aws_cur.csv")
    if os.path.exists(aws_path):
        print("  📦 Normalizing AWS CUR...")
        aws_df = pd.read_csv(aws_path)
        frames.append(normalize_aws(aws_df))
        print(f"     ✅ {len(aws_df):,} rows processed")

    # ── Azure ──────────────────────────────────────────────────────────────────
    azure_path = os.path.join(raw_dir, "azure_cost.csv")
    if os.path.exists(azure_path):
        print("  📦 Normalizing Azure Cost Management...")
        azure_df = pd.read_csv(azure_path)
        frames.append(normalize_azure(azure_df))
        print(f"     ✅ {len(azure_df):,} rows processed")

    # ── GCP ────────────────────────────────────────────────────────────────────
    gcp_path = os.path.join(raw_dir, "gcp_billing.csv")
    if os.path.exists(gcp_path):
        print("  📦 Normalizing GCP Billing Export...")
        gcp_df = pd.read_csv(gcp_path)
        frames.append(normalize_gcp(gcp_df))
        print(f"     ✅ {len(gcp_df):,} rows processed")

    if not frames:
        raise FileNotFoundError("No raw billing files found. Run data_generator.py first.")

    # ── Merge & Clean ──────────────────────────────────────────────────────────
    unified = pd.concat(frames, ignore_index=True)
    unified = unified[UNIFIED_COLUMNS]
    unified["date"]     = pd.to_datetime(unified["date"])
    unified["cost_usd"] = unified["cost_usd"].clip(lower=0)

    # Drop zero-cost rows
    unified = unified[unified["cost_usd"] > 0].reset_index(drop=True)

    # ── Aggregate to daily granularity per (provider, service, team, env, region)
    daily = (
        unified
        .groupby(["date", "provider", "service", "category", "team", "environment", "region"], as_index=False)
        .agg(cost_usd=("cost_usd", "sum"))
        .sort_values("date")
        .reset_index(drop=True)
    )

    # ── Save ───────────────────────────────────────────────────────────────────
    unified.to_csv(f"{output_dir}/unified_billing.csv", index=False)
    daily.to_csv(f"{output_dir}/daily_billing.csv", index=False)
    print(f"\n  📊 Unified: {len(unified):,} rows → Daily aggregated: {len(daily):,} rows")

    # ── Summary stats ──────────────────────────────────────────────────────────
    _print_summary(daily)

    return daily


def _print_summary(df: pd.DataFrame):
    print("\n" + "═" * 52)
    print("  UNIFIED BILLING SUMMARY")
    print("═" * 52)
    total = df["cost_usd"].sum()
    print(f"  Total Spend (6 months) : ${total:,.2f}")
    print(f"  Date Range             : {df['date'].min().date()} → {df['date'].max().date()}")
    print(f"  Unique Services        : {df['service'].nunique()}")
    print()

    print("  Spend by Provider:")
    for provider, grp in df.groupby("provider"):
        pct = grp["cost_usd"].sum() / total * 100
        print(f"    {provider.upper():<8} ${grp['cost_usd'].sum():>12,.2f}  ({pct:.1f}%)")

    print()
    print("  Spend by Category:")
    cat_summary = df.groupby("category")["cost_usd"].sum().sort_values(ascending=False)
    for cat, cost in cat_summary.items():
        pct = cost / total * 100
        print(f"    {cat:<12} ${cost:>12,.2f}  ({pct:.1f}%)")

    print()
    print("  Spend by Team:")
    team_summary = df.groupby("team")["cost_usd"].sum().sort_values(ascending=False)
    for team, cost in team_summary.items():
        pct = cost / total * 100
        print(f"    {team:<14} ${cost:>12,.2f}  ({pct:.1f}%)")
    print("═" * 52)


if __name__ == "__main__":
    run_normalization_pipeline()
