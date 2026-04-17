# -*- coding: utf-8 -*-
"""
Phase 2 - Anomaly Detection Engine
====================================
Detects cost anomalies in daily_billing using three complementary approaches:

  1. Z-score with STL seasonal decomposition  (statsmodels)
  2. Isolation Forest                          (scikit-learn)
  3. Ensemble vote → severity scoring          (LOW / MEDIUM / HIGH / CRITICAL)
  4. SHAP-based root cause attribution         (shap + IsolationForest explainer)
  5. Persists results via save_detected_anomaly()

Run:  python anomaly_detector.py
"""

from __future__ import annotations

import json
import warnings
import logging
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd

# ── statsmodels ──────────────────────────────────────────────────────────────
from statsmodels.tsa.seasonal import STL

# ── scikit-learn ──────────────────────────────────────────────────────────────
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

# ── shap ──────────────────────────────────────────────────────────────────────
try:
    import shap
    _SHAP_AVAILABLE = True
except ImportError:
    _SHAP_AVAILABLE = False
    warnings.warn(
        "shap not installed — root cause attribution will be skipped. "
        "Install with: pip install shap",
        UserWarning,
        stacklevel=1,
    )

# ── local Phase-1 storage layer ───────────────────────────────────────────────
from storage import get_time_series, get_total_daily_spend, save_detected_anomaly

warnings.filterwarnings("ignore")

# ══════════════════════════════════════════════════════════════════════════════
#  Logging
# ══════════════════════════════════════════════════════════════════════════════

# Make stdout UTF-8 safe on Windows (no-op on UTF-8 terminals)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except AttributeError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("anomaly_detector")


# ══════════════════════════════════════════════════════════════════════════════
#  Configuration
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class DetectorConfig:
    # Z-score / STL
    zscore_threshold: float = 2.5          # |z| above this → anomaly candidate
    stl_period: int = 7                    # weekly seasonality
    min_stl_points: int = 14              # need ≥ this many rows for STL
    residual_threshold: float = 2.5       # σ of STL residuals

    # Isolation Forest
    if_contamination: float = 0.05        # expected anomaly fraction
    if_n_estimators: int = 100            # reduced from 200 for speed (still accurate)
    if_random_state: int = 42

    # Severity thresholds (deviation_pct from expected)
    severity_low: float = 20.0            # %
    severity_medium: float = 50.0
    severity_high: float = 100.0
    # ≥ high → CRITICAL

    # Ensemble: anomaly needs votes from at least this many detectors
    min_detector_votes: int = 1


CFG = DetectorConfig()


# ══════════════════════════════════════════════════════════════════════════════
#  Data Structures
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class AnomalyRecord:
    date: str
    provider: str
    service: str
    team: str
    environment: str
    cost_usd: float
    expected_cost: float
    deviation_pct: float
    severity: str
    anomaly_type: str
    detector: str
    shap_factors: dict = field(default_factory=dict)
    description: str = ""


# ══════════════════════════════════════════════════════════════════════════════
#  Severity Scorer
# ══════════════════════════════════════════════════════════════════════════════

def score_severity(deviation_pct: float) -> str:
    """
    Map relative deviation (%) to a severity label.

    LOW      :  20% ≤ dev < 50%
    MEDIUM   :  50% ≤ dev < 100%
    HIGH     : 100% ≤ dev < 200%
    CRITICAL : dev ≥ 200%
    """
    abs_dev = abs(deviation_pct)
    if abs_dev >= 200.0:
        return "CRITICAL"
    elif abs_dev >= CFG.severity_high:
        return "HIGH"
    elif abs_dev >= CFG.severity_medium:
        return "MEDIUM"
    else:
        return "LOW"


# ══════════════════════════════════════════════════════════════════════════════
#  Detector 1 — Z-score with STL Seasonal Decomposition
# ══════════════════════════════════════════════════════════════════════════════

def _rolling_zscore(series: pd.Series, window: int = 14) -> pd.Series:
    """Fallback: simple rolling-window z-score when series is too short for STL."""
    roll_mean = series.rolling(window=window, min_periods=3).mean()
    roll_std  = series.rolling(window=window, min_periods=3).std().replace(0, np.nan)
    z = (series - roll_mean) / roll_std
    return z.fillna(0.0)


def run_zscore_detector(df_day: pd.DataFrame) -> pd.DataFrame:
    """
    For each (provider, service, team, environment) group, compute a
    z-score on the STL residuals (or raw costs if too few points).

    Returns rows where |z| > threshold with columns:
        [date, provider, service, team, environment,
         cost_usd, expected_cost, z_score, is_anomaly_z]
    """
    results: list[dict] = []

    groups = df_day.groupby(["provider", "service", "team", "environment"],
                            observed=True)

    for keys, grp in groups:
        provider, service, team, env = keys
        grp = grp.sort_values("date").copy()
        costs = grp["cost_usd"].values.astype(float)
        dates = grp["date"].tolist()

        if len(costs) < 4:
            continue  # not enough history

        # ── STL decomposition ──────────────────────────────────────────────
        if len(costs) >= CFG.min_stl_points:
            try:
                period = min(CFG.stl_period, len(costs) // 2)
                stl = STL(costs, period=period, robust=True)
                res = stl.fit()
                residuals = pd.Series(res.resid)
                trend     = pd.Series(res.trend)
                seasonal  = pd.Series(res.seasonal)

                mu  = residuals.mean()
                sigma = residuals.std(ddof=1) or 1e-9
                z_scores = (residuals - mu) / sigma

                expected = (trend + seasonal).values

            except Exception as exc:
                log.debug("STL failed for %s/%s/%s/%s: %s — using rolling z-score",
                          provider, service, team, env, exc)
                costs_s = pd.Series(costs)
                z_scores = _rolling_zscore(costs_s)
                expected = costs_s.rolling(14, min_periods=3).mean().fillna(costs_s.mean()).values

        else:
            costs_s = pd.Series(costs)
            z_scores = _rolling_zscore(costs_s)
            expected = costs_s.rolling(14, min_periods=3).mean().fillna(costs_s.mean()).values

        # ── flag anomalies ─────────────────────────────────────────────────
        for i, (dt, cost, z, exp) in enumerate(
            zip(dates, costs, z_scores, expected)
        ):
            is_anom = abs(z) > CFG.zscore_threshold
            results.append({
                "date":        str(dt.date()) if hasattr(dt, "date") else str(dt),
                "provider":    provider,
                "service":     service,
                "team":        team,
                "environment": env,
                "cost_usd":    float(cost),
                "expected_cost": float(max(exp, 0.0)),
                "z_score":     float(z),
                "is_anomaly_z": is_anom,
            })

    return pd.DataFrame(results)


# ══════════════════════════════════════════════════════════════════════════════
#  Detector 2 — Isolation Forest
# ══════════════════════════════════════════════════════════════════════════════

def _build_features(df_day: pd.DataFrame) -> pd.DataFrame:
    """
    Engineer temporal + contextual features for Isolation Forest.
    All features are numeric.
    """
    df = df_day.copy()

    # Temporal features
    df["dayofweek"]  = df["date"].dt.dayofweek
    df["dayofmonth"] = df["date"].dt.day
    df["month"]      = df["date"].dt.month
    df["weekofyear"] = df["date"].dt.isocalendar().week.astype(int)

    # Rolling statistics per group
    df = df.sort_values(["provider", "service", "team", "environment", "date"])
    grp_cols = ["provider", "service", "team", "environment"]

    df["roll7_mean"] = (
        df.groupby(grp_cols, observed=True)["cost_usd"]
          .transform(lambda s: s.shift(1).rolling(7, min_periods=1).mean())
    )
    df["roll7_std"] = (
        df.groupby(grp_cols, observed=True)["cost_usd"]
          .transform(lambda s: s.shift(1).rolling(7, min_periods=1).std().fillna(0))
    )
    df["roll30_mean"] = (
        df.groupby(grp_cols, observed=True)["cost_usd"]
          .transform(lambda s: s.shift(1).rolling(30, min_periods=1).mean())
    )

    df["cost_vs_roll7"]  = df["cost_usd"] / (df["roll7_mean"].replace(0, np.nan)).fillna(1)
    df["cost_vs_roll30"] = df["cost_usd"] / (df["roll30_mean"].replace(0, np.nan)).fillna(1)

    # Encode categoricals as integer codes (no leakage — just ordinal encoding)
    for col in ["provider", "service", "team", "environment"]:
        df[f"{col}_code"] = df[col].astype("category").cat.codes

    feature_cols = [
        "cost_usd",
        "dayofweek", "dayofmonth", "month", "weekofyear",
        "roll7_mean", "roll7_std", "roll30_mean",
        "cost_vs_roll7", "cost_vs_roll30",
        "provider_code", "service_code", "team_code", "environment_code",
    ]

    return df, feature_cols


def run_isolation_forest(df_day: pd.DataFrame) -> pd.DataFrame:
    """
    Train an Isolation Forest on engineered features.
    Returns the input dataframe with added columns:
        [if_score, is_anomaly_if]
    Score is the raw anomaly score (higher = more anomalous).
    """
    df, feature_cols = _build_features(df_day)

    X = df[feature_cols].fillna(0).values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    iforest = IsolationForest(
        n_estimators=CFG.if_n_estimators,
        contamination=CFG.if_contamination,
        random_state=CFG.if_random_state,
        n_jobs=-1,
    )
    iforest.fit(X_scaled)

    # decision_function: negative = anomaly, lower = more anomalous
    raw_scores  = iforest.decision_function(X_scaled)
    predictions = iforest.predict(X_scaled)          # -1 = anomaly, 1 = normal

    df["if_score"]     = -raw_scores                 # flip: higher → more anomalous
    df["is_anomaly_if"] = predictions == -1

    return df, iforest, scaler, feature_cols, X_scaled


# ══════════════════════════════════════════════════════════════════════════════
#  SHAP Root-Cause Attribution
# ══════════════════════════════════════════════════════════════════════════════

def compute_shap_factors(
    iforest: IsolationForest,
    X_scaled: np.ndarray,
    feature_cols: list[str],
    anomaly_indices: list[int],
    top_k: int = 5,
) -> list[dict]:
    """
    Use TreeExplainer (SHAP) to attribute each anomaly's score
    to top-k contributing features.

    Returns a list of {feature_name: shap_value} dicts,
    one per anomaly index.
    """
    if not _SHAP_AVAILABLE:
        return [{} for _ in anomaly_indices]

    if len(anomaly_indices) == 0:
        return []

    try:
        # Use a background sample to speed up computation
        bg_size = min(200, len(X_scaled))
        bg_idx  = np.random.default_rng(42).choice(len(X_scaled), bg_size, replace=False)
        background = X_scaled[bg_idx]

        explainer = shap.TreeExplainer(iforest, data=background,
                                       feature_perturbation="interventional")

        anom_X   = X_scaled[anomaly_indices]
        shap_vals = explainer.shap_values(anom_X)   # shape: (n_anomalies, n_features)

        factors_list = []
        for row_shap in shap_vals:
            abs_shap = np.abs(row_shap)
            top_idx  = np.argsort(abs_shap)[::-1][:top_k]
            factors  = {
                feature_cols[i]: round(float(row_shap[i]), 6)
                for i in top_idx
            }
            factors_list.append(factors)

        return factors_list

    except Exception as exc:
        log.warning("SHAP attribution failed: %s — storing empty factors", exc)
        return [{} for _ in anomaly_indices]


# ══════════════════════════════════════════════════════════════════════════════
#  Ensemble & Merge
# ══════════════════════════════════════════════════════════════════════════════

def _classify_anomaly_type(z_score: float, deviation_pct: float,
                            row_date: pd.Timestamp) -> str:
    """Heuristic anomaly type classification."""
    abs_z = abs(z_score) if not np.isnan(z_score) else 0
    abs_dev = abs(deviation_pct)

    if abs_z > 4.0 or abs_dev > 150:
        return "spike"
    elif abs_dev < 60 and abs_z < 3.5:
        return "drift"
    else:
        return "seasonal"


def merge_detectors(
    z_df: pd.DataFrame,
    if_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Join Z-score and Isolation Forest results on the key dimensions.
    Compute:
      - ensemble votes
      - deviation_pct
      - severity
      - anomaly_type
    """
    key = ["date", "provider", "service", "team", "environment"]

    # Z-score side  (date already stored as plain string)
    z_side = z_df[key + ["cost_usd", "expected_cost", "z_score", "is_anomaly_z"]].copy()
    z_side["date"] = z_side["date"].astype(str)

    # IF side  (date may be datetime64 — coerce to string)
    if_side = if_df[key + ["if_score", "is_anomaly_if"]].copy()
    if_side["date"] = if_side["date"].astype(str)

    # Aggregate per (date, provider, service, team, env)
    if_side = (
        if_side.groupby(key, as_index=False)
               .agg(if_score=("if_score", "mean"),
                    is_anomaly_if=("is_anomaly_if", "any"))
    )

    merged = z_side.merge(if_side, on=key, how="inner")

    merged["votes"] = (
        merged["is_anomaly_z"].astype(int) +
        merged["is_anomaly_if"].astype(int)
    )

    # At least one detector flagged it
    merged = merged[merged["votes"] >= CFG.min_detector_votes].copy()

    # Deviation %
    merged["deviation_pct"] = (
        (merged["cost_usd"] - merged["expected_cost"])
        / merged["expected_cost"].replace(0, np.nan)
        * 100
    ).fillna(0.0)

    # Only keep meaningful deviations (>20% to avoid noise)
    merged = merged[merged["deviation_pct"].abs() >= CFG.severity_low].copy()

    if merged.empty:
        return merged

    # Severity
    merged["severity"] = merged["deviation_pct"].apply(score_severity)

    # Anomaly type
    merged["anomaly_type"] = merged.apply(
        lambda r: _classify_anomaly_type(
            r["z_score"], r["deviation_pct"],
            pd.Timestamp(r["date"])
        ), axis=1
    )

    # Detector label
    merged["detector"] = merged.apply(
        lambda r: "zscore+isolation_forest"
                  if r["is_anomaly_z"] and r["is_anomaly_if"]
                  else ("zscore" if r["is_anomaly_z"] else "isolation_forest"),
        axis=1,
    )

    return merged.reset_index(drop=True)


# ══════════════════════════════════════════════════════════════════════════════
#  Description Generator
# ══════════════════════════════════════════════════════════════════════════════

def generate_description(row: pd.Series) -> str:
    direction = "spike" if row["deviation_pct"] > 0 else "drop"
    return (
        f"{row['severity']} {direction}: {row['service']} costs for "
        f"{row['team']}/{row['environment']} on {row['date']} were "
        f"${row['cost_usd']:,.2f} vs expected ${row['expected_cost']:,.2f} "
        f"({row['deviation_pct']:+.1f}%). "
        f"Detected by: {row['detector']}."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Main Pipeline
# ══════════════════════════════════════════════════════════════════════════════

def run_anomaly_detection(clear_previous: bool = True) -> list[AnomalyRecord]:
    """
    Full Phase-2 pipeline:
      1. Load billing data
      2. Z-score + STL
      3. Isolation Forest (100 estimators — faster)
      4. Ensemble merge
      5. Bulk-save ALL anomalies to DB immediately  <- appear in dashboard NOW
      6. SHAP attribution for top-50 only           <- 30x faster than all rows
      7. Update those 50 records with SHAP
    """
    from storage import (
        save_detected_anomalies_batch, update_anomaly_shap,
        get_conn, DB_PATH,
    )

    separator = "=" * 60

    print(f"\n{separator}")
    print("  PHASE 2 - ANOMALY DETECTION ENGINE")
    print(separator)

    # ── 1. Load data ─────────────────────────────────────────────────────────
    log.info("Loading billing data from finops.db …")
    df_raw = get_time_series()

    if df_raw.empty:
        log.error("No billing data found. Run Phase 1 first (python storage.py).")
        return []

    log.info("Loaded %d billing rows spanning %s → %s",
             len(df_raw),
             df_raw["date"].min().date(),
             df_raw["date"].max().date())

    # -- 2. Clear previous detections ----------------------------------------
    if clear_previous:
        with get_conn(DB_PATH) as conn:
            deleted = conn.execute("DELETE FROM detected_anomalies").rowcount
        log.info("Cleared %d previous anomaly records", deleted)

    # ── 3. Z-score + STL ─────────────────────────────────────────────────────
    log.info("Running Z-score / STL detector …")
    z_df = run_zscore_detector(df_raw)
    n_z  = z_df["is_anomaly_z"].sum() if not z_df.empty else 0
    log.info("  Z-score flagged %d candidate rows", n_z)

    # -- 4. Isolation Forest (100 estimators) ---------------------------------
    log.info("Running Isolation Forest (n_estimators=%d) ...", CFG.if_n_estimators)
    if_df, iforest, scaler, feature_cols, X_scaled = run_isolation_forest(df_raw)
    n_if = if_df["is_anomaly_if"].sum() if not if_df.empty else 0
    log.info("  Isolation Forest flagged %d candidate rows", n_if)

    # ── 5. Ensemble merge ─────────────────────────────────────────────────────
    log.info("Merging detectors (ensemble vote) …")
    merged = merge_detectors(z_df, if_df)

    if merged.empty:
        log.info("No anomalies survived ensemble merge. All good? ✅")
        return []

    log.info("  Ensemble confirmed %d anomalies", len(merged))

    # -- 6. Bulk-save ALL anomalies immediately (no SHAP yet) -----------------
    #  These appear in the dashboard / Anomaly Watch RIGHT NOW.
    log.info("Bulk-saving %d anomalies to DB (pre-SHAP) ...", len(merged))

    pre_records: list[dict] = []
    for _, row in merged.iterrows():
        pre_records.append({
            "date":          str(row["date"]),
            "provider":      str(row["provider"]),
            "service":       str(row["service"]),
            "team":          str(row["team"]),
            "environment":   str(row["environment"]),
            "cost_usd":      float(row["cost_usd"]),
            "expected_cost": float(row["expected_cost"]),
            "deviation_pct": float(row["deviation_pct"]),
            "severity":      str(row["severity"]),
            "anomaly_type":  str(row["anomaly_type"]),
            "detector":      str(row["detector"]),
            "shap_factors":  {},
            "description":   generate_description(row),
        })

    row_ids = save_detected_anomalies_batch(pre_records)
    log.info("  %d anomalies now visible in dashboard", len(row_ids))

    # -- 7. SHAP attribution -- TOP 50 only -----------------------------------
    TOP_N_SHAP = 50
    log.info("Computing SHAP for top %d anomalies by deviation ...", TOP_N_SHAP)

    key = ["date", "provider", "service", "team", "environment"]
    if_df["date"]  = if_df["date"].astype(str)
    merged["date"] = merged["date"].astype(str)

    if_df_reset = if_df.reset_index(drop=True)
    key_to_ifidx: dict[tuple, int] = {}
    for idx, row in if_df_reset.iterrows():
        key_to_ifidx[tuple(row[c] for c in key)] = int(idx)

    merged_to_ifidx: list[int] = [
        key_to_ifidx.get(tuple(row[c] for c in key), 0)
        for _, row in merged.iterrows()
    ]

    top_positions: list[int] = (
        merged["deviation_pct"].abs().nlargest(TOP_N_SHAP).index.tolist()
    )
    top_if_indices = [merged_to_ifidx[pos] for pos in top_positions]

    shap_results = compute_shap_factors(
        iforest, X_scaled, feature_cols, top_if_indices
    )

    for pos, shap_factors in zip(top_positions, shap_results):
        if pos < len(row_ids) and shap_factors:
            update_anomaly_shap(row_ids[pos], shap_factors)

    log.info("  SHAP updated for %d top anomalies", len(shap_results))

    # -- 8. Summary report ----------------------------------------------------
    saved_records = [
        AnomalyRecord(
            date=r["date"], provider=r["provider"], service=r["service"],
            team=r["team"], environment=r["environment"],
            cost_usd=r["cost_usd"], expected_cost=r["expected_cost"],
            deviation_pct=r["deviation_pct"], severity=r["severity"],
            anomaly_type=r["anomaly_type"], detector=r["detector"],
            shap_factors=r["shap_factors"], description=r["description"],
        )
        for r in pre_records
    ]

    _print_summary(saved_records)
    return saved_records


# ══════════════════════════════════════════════════════════════════════════════
#  Summary Report
# ══════════════════════════════════════════════════════════════════════════════

def _print_summary(records: list[AnomalyRecord]) -> None:
    if not records:
        return

    print("\n" + "-" * 60)
    print("  ANOMALY DETECTION SUMMARY")
    print("-" * 60)

    df = pd.DataFrame([asdict(r) for r in records])

    # By severity
    sev_counts = df["severity"].value_counts().to_dict()
    print(f"\n  Total anomalies detected : {len(records)}")
    for lvl in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]:
        cnt = sev_counts.get(lvl, 0)
        bar = "#" * cnt if cnt <= 30 else "#" * 30 + f"... (+{cnt-30})"
        print(f"    {lvl:<10} {cnt:>4}  {bar}")

    # By provider
    print("\n  By provider:")
    for prov, cnt in df["provider"].value_counts().items():
        print(f"    {prov:<8} {cnt}")

    # By anomaly type
    print("\n  By anomaly type:")
    for atype, cnt in df["anomaly_type"].value_counts().items():
        print(f"    {atype:<15} {cnt}")

    # Top 5 worst deviations
    print("\n  Top 5 worst deviations:")
    top5 = df.nlargest(5, "deviation_pct")[
        ["date", "provider", "service", "team", "deviation_pct", "severity"]
    ]
    for _, row in top5.iterrows():
        print(
            f"    {row['date']}  {row['provider']:<6} {row['service']:<25} "
            f"{row['team']:<12}  {row['deviation_pct']:+.1f}%  [{row['severity']}]"
        )

    # SHAP insights for CRITICAL/HIGH
    critical_high = [r for r in records if r.severity in ("CRITICAL", "HIGH")]
    if critical_high:
        print(f"\n  SHAP root-cause snapshot ({len(critical_high)} CRITICAL/HIGH):")
        shown = 0
        for r in critical_high[:5]:
            if r.shap_factors:
                top = sorted(r.shap_factors.items(), key=lambda x: abs(x[1]), reverse=True)[:3]
                factors_str = "  |  ".join(f"{k}: {v:+.4f}" for k, v in top)
                print(f"    [{r.date}] {r.service}/{r.team} -> {factors_str}")
                shown += 1
        if shown == 0:
            print("    (SHAP not available — install shap for attribution)")

    print("\n" + "-" * 60)
    print("  [OK] Phase 2 complete. Results saved to detected_anomalies.")
    print("-" * 60)


# ══════════════════════════════════════════════════════════════════════════════
#  Entry Point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="FinOps Phase 2 — Anomaly Detection Engine"
    )
    parser.add_argument(
        "--keep-previous",
        action="store_true",
        default=False,
        help="Keep existing detected_anomalies rows instead of clearing them first.",
    )
    parser.add_argument(
        "--zscore-threshold",
        type=float,
        default=CFG.zscore_threshold,
        help=f"Z-score threshold (default: {CFG.zscore_threshold})",
    )
    parser.add_argument(
        "--contamination",
        type=float,
        default=CFG.if_contamination,
        help=f"Isolation Forest contamination ratio (default: {CFG.if_contamination})",
    )
    args = parser.parse_args()

    # Apply CLI overrides
    CFG.zscore_threshold  = args.zscore_threshold
    CFG.if_contamination  = args.contamination

    records = run_anomaly_detection(clear_previous=not args.keep_previous)

    print(f"\n  → {len(records)} anomalies written to finops.db / detected_anomalies\n")
