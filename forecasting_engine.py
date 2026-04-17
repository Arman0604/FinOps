# -*- coding: utf-8 -*-
"""
Phase 3 - Forecasting Engine
==============================
Generates 7 / 30 / 90-day probabilistic cost forecasts using:

  1. Prophet      - additive time-series model with weekly seasonality
  2. LightGBM     - quantile regression (alpha 0.1 / 0.5 / 0.9) on
                    lag + rolling + calendar features
  3. Ensemble     - weighted average of Prophet and LightGBM outputs

Forecast dimensions:
  - Total daily spend  (no dimension filter)
  - Per provider       (aws | azure | gcp)
  - Per team
  - Per service

Outputs p10 / p50 / p90 confidence bands and saves every row to the
`forecasts` table via storage.save_forecast().

Run:  python forecasting_engine.py
      python forecasting_engine.py --horizons 7 30
      python forecasting_engine.py --keep-previous
"""

from __future__ import annotations

import contextlib
import io
import logging
import sys
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

# ── stdout UTF-8 fix (Windows cp1252 terminals) ───────────────────────────────
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except AttributeError:
    pass

warnings.filterwarnings("ignore")

# ── Prophet ───────────────────────────────────────────────────────────────────
try:
    from prophet import Prophet
    _PROPHET_AVAILABLE = True
except ImportError:
    _PROPHET_AVAILABLE = False
    warnings.warn(
        "prophet not installed - Prophet forecasts will be skipped. "
        "Install with: pip install prophet",
        UserWarning, stacklevel=1,
    )

# ── LightGBM ──────────────────────────────────────────────────────────────────
try:
    from lightgbm import LGBMRegressor
    _LGBM_AVAILABLE = True
except ImportError:
    _LGBM_AVAILABLE = False
    warnings.warn(
        "lightgbm not installed - LightGBM forecasts will be skipped. "
        "Install with: pip install lightgbm",
        UserWarning, stacklevel=1,
    )

# ── Storage layer (Phase 1) ───────────────────────────────────────────────────
from storage import (
    get_time_series,
    save_forecast,
    get_conn,
    DB_PATH,
)

# ── Silence noisy loggers from Prophet / cmdstanpy ────────────────────────────
for _logger_name in ("prophet", "cmdstanpy", "pystan"):
    logging.getLogger(_logger_name).setLevel(logging.WARNING)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("forecasting_engine")


# ══════════════════════════════════════════════════════════════════════════════
#  Configuration
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class ForecastConfig:
    horizons: list = field(default_factory=lambda: [7, 30, 90])

    # Prophet
    prophet_interval_width: float = 0.80   # ~p10 to p90

    # LightGBM quantile
    lgbm_n_estimators: int = 400
    lgbm_learning_rate: float = 0.05
    lgbm_num_leaves: int = 31
    lgbm_min_child_samples: int = 5
    lgbm_random_state: int = 42

    # Ensemble weights (must sum to 1.0 when both models available)
    w_prophet: float = 0.50
    w_lgbm: float = 0.50

    # Minimum training points required
    min_train_points: int = 14


CFG = ForecastConfig()

# Feature columns used by LightGBM
FEATURE_COLS = [
    "day_of_week", "day_of_month", "month", "week_of_year", "quarter",
    "is_weekend", "trend",
    "lag_1", "lag_7", "lag_14", "lag_30",
    "roll_mean_7", "roll_std_7", "roll_mean_14", "roll_mean_30",
    "roll_min_7", "roll_max_7",
]


# ══════════════════════════════════════════════════════════════════════════════
#  Feature Engineering
# ══════════════════════════════════════════════════════════════════════════════

def _calendar_features(dt_series: pd.Series, trend_offset: int = 0) -> pd.DataFrame:
    """Return calendar feature columns for a Series of Timestamps."""
    iso = dt_series.dt.isocalendar()
    return pd.DataFrame({
        "day_of_week":  dt_series.dt.dayofweek,
        "day_of_month": dt_series.dt.day,
        "month":        dt_series.dt.month,
        "week_of_year": iso.week.astype(int),
        "quarter":      dt_series.dt.quarter,
        "is_weekend":   (dt_series.dt.dayofweek >= 5).astype(int),
        "trend":        np.arange(trend_offset, trend_offset + len(dt_series)),
    })


def build_train_features(series: pd.Series) -> pd.DataFrame:
    """
    Build the full feature matrix from a date-indexed daily cost Series.
    Uses shifted values so there is no data leakage.
    """
    df = pd.DataFrame({"ds": series.index, "y": series.values}).sort_values("ds").reset_index(drop=True)

    cal = _calendar_features(df["ds"])
    for col in cal.columns:
        df[col] = cal[col].values

    y = df["y"]
    df["lag_1"]  = y.shift(1)
    df["lag_7"]  = y.shift(7)
    df["lag_14"] = y.shift(14)
    df["lag_30"] = y.shift(30)

    shifted = y.shift(1)
    df["roll_mean_7"]  = shifted.rolling(7,  min_periods=1).mean()
    df["roll_std_7"]   = shifted.rolling(7,  min_periods=1).std().fillna(0)
    df["roll_mean_14"] = shifted.rolling(14, min_periods=1).mean()
    df["roll_mean_30"] = shifted.rolling(30, min_periods=1).mean()
    df["roll_min_7"]   = shifted.rolling(7,  min_periods=1).min()
    df["roll_max_7"]   = shifted.rolling(7,  min_periods=1).max()

    return df


def build_future_features(series: pd.Series, horizon: int) -> pd.DataFrame:
    """
    Build feature matrix for `horizon` future days.
    Lag features use the known training tail — no recursive prediction needed.
    This is a 'direct' multi-step strategy.
    """
    last_date = series.index[-1]
    future_dates = pd.date_range(
        start=last_date + timedelta(days=1), periods=horizon, freq="D"
    )

    n = len(series)
    cal = _calendar_features(pd.Series(future_dates), trend_offset=n)

    rows = []
    for i, dt in enumerate(future_dates):
        # For lag features: use the actual trailing training values wherever
        # available; otherwise fall back to the rolling mean.
        def _lag(k: int) -> float:
            idx = n - k + i        # position in the full series (extended by i)
            if idx < n:
                return float(series.iloc[idx])
            return float(series.tail(7).mean())   # extrapolate with recent mean

        tail7  = series.tail(7)
        tail14 = series.tail(14)
        tail30 = series.tail(30)

        row = {c: cal[c].iloc[i] for c in cal.columns}
        row["lag_1"]        = _lag(1)
        row["lag_7"]        = _lag(7)
        row["lag_14"]       = _lag(14)
        row["lag_30"]       = _lag(30)
        row["roll_mean_7"]  = float(tail7.mean())
        row["roll_std_7"]   = float(tail7.std(ddof=1)) if len(tail7) > 1 else 0.0
        row["roll_mean_14"] = float(tail14.mean())
        row["roll_mean_30"] = float(tail30.mean())
        row["roll_min_7"]   = float(tail7.min())
        row["roll_max_7"]   = float(tail7.max())
        rows.append(row)

    df = pd.DataFrame(rows)
    df["ds"] = future_dates
    return df


# ══════════════════════════════════════════════════════════════════════════════
#  Utility: suppress stdout/stderr (for Prophet's fit output)
# ══════════════════════════════════════════════════════════════════════════════

@contextlib.contextmanager
def _silent():
    """Redirect stdout + stderr to /dev/null (suppresses C-level output)."""
    with contextlib.redirect_stdout(io.StringIO()):
        with contextlib.redirect_stderr(io.StringIO()):
            yield


# ══════════════════════════════════════════════════════════════════════════════
#  Detector 1 — Prophet
# ══════════════════════════════════════════════════════════════════════════════

def run_prophet(series: pd.Series, horizon: int) -> Optional[pd.DataFrame]:
    """
    Fit Prophet and return a DataFrame with columns:
        target_date (str), p10, p50, p90

    Returns None if Prophet is unavailable or fitting fails.
    """
    if not _PROPHET_AVAILABLE:
        return None
    if len(series) < CFG.min_train_points:
        return None

    try:
        train_df = pd.DataFrame({
            "ds": pd.to_datetime(series.index),
            "y":  series.values.astype(float),
        })

        # Clip negatives just in case
        train_df["y"] = train_df["y"].clip(lower=0)

        model = Prophet(
            interval_width=CFG.prophet_interval_width,   # p10/p90 bounds
            yearly_seasonality=False,                    # <1 year of data
            weekly_seasonality=True,
            daily_seasonality=False,
            seasonality_mode="additive",
        )

        with _silent():
            model.fit(train_df)

        future   = model.make_future_dataframe(periods=horizon, freq="D")
        forecast = model.predict(future)

        # Keep only the future rows
        last_dt      = train_df["ds"].max()
        future_fcast = forecast[forecast["ds"] > last_dt].head(horizon).copy()

        result = pd.DataFrame({
            "target_date": future_fcast["ds"].dt.strftime("%Y-%m-%d").values,
            "p10": np.clip(future_fcast["yhat_lower"].values, 0, None),
            "p50": np.clip(future_fcast["yhat"].values,       0, None),
            "p90": np.clip(future_fcast["yhat_upper"].values, 0, None),
        })

        # Enforce p10 <= p50 <= p90 ordering
        result["p10"] = np.minimum(result["p10"], result["p50"])
        result["p90"] = np.maximum(result["p90"], result["p50"])

        return result

    except Exception as exc:
        log.debug("Prophet failed: %s", exc)
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  Detector 2 — LightGBM Quantile Regression
# ══════════════════════════════════════════════════════════════════════════════

def run_lgbm(series: pd.Series, horizon: int) -> Optional[pd.DataFrame]:
    """
    Train three LightGBM quantile models (alpha=0.1, 0.5, 0.9) and return
    a DataFrame with columns: target_date (str), p10, p50, p90.

    Returns None if LightGBM is unavailable or training fails.
    """
    if not _LGBM_AVAILABLE:
        return None
    if len(series) < CFG.min_train_points:
        return None

    try:
        df       = build_train_features(series)
        train_df = df.dropna(subset=FEATURE_COLS).copy()

        if len(train_df) < CFG.min_train_points:
            return None

        X_train = train_df[FEATURE_COLS].values.astype(float)
        y_train = train_df["y"].values.astype(float)

        common = dict(
            n_estimators=CFG.lgbm_n_estimators,
            learning_rate=CFG.lgbm_learning_rate,
            num_leaves=CFG.lgbm_num_leaves,
            min_child_samples=CFG.lgbm_min_child_samples,
            random_state=CFG.lgbm_random_state,
            n_jobs=-1,
            verbose=-1,
        )

        models: dict[str, LGBMRegressor] = {}
        for q_name, alpha in [("p10", 0.1), ("p50", 0.5), ("p90", 0.9)]:
            m = LGBMRegressor(objective="quantile", alpha=alpha, **common)
            m.fit(X_train, y_train)
            models[q_name] = m

        # Build future features
        future_df = build_future_features(series, horizon)
        X_future  = future_df[FEATURE_COLS].fillna(0).values.astype(float)

        p10 = np.clip(models["p10"].predict(X_future), 0, None)
        p50 = np.clip(models["p50"].predict(X_future), 0, None)
        p90 = np.clip(models["p90"].predict(X_future), 0, None)

        result = pd.DataFrame({
            "target_date": future_df["ds"].dt.strftime("%Y-%m-%d").values,
            "p10": np.minimum(p10, p50),   # guard crossing quantiles
            "p50": p50,
            "p90": np.maximum(p90, p50),
        })

        return result

    except Exception as exc:
        log.debug("LightGBM failed: %s", exc)
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  Ensemble
# ══════════════════════════════════════════════════════════════════════════════

def ensemble_blend(
    prophet_df: Optional[pd.DataFrame],
    lgbm_df: Optional[pd.DataFrame],
) -> Optional[pd.DataFrame]:
    """
    Weighted average of Prophet and LightGBM predictions.
    Falls back to whichever model is available.
    """
    if prophet_df is None and lgbm_df is None:
        return None

    if prophet_df is None:
        return lgbm_df.copy()

    if lgbm_df is None:
        return prophet_df.copy()

    # Align on target_date (inner join to handle any length mismatches)
    merged = prophet_df.merge(lgbm_df, on="target_date", suffixes=("_pr", "_lg"))

    wp, wl = CFG.w_prophet, CFG.w_lgbm
    result = pd.DataFrame({
        "target_date": merged["target_date"],
        "p10": wp * merged["p10_pr"] + wl * merged["p10_lg"],
        "p50": wp * merged["p50_pr"] + wl * merged["p50_lg"],
        "p90": wp * merged["p90_pr"] + wl * merged["p90_lg"],
    })

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  Single-series Forecaster
# ══════════════════════════════════════════════════════════════════════════════

def forecast_series(
    series: pd.Series,
    horizon: int,
    dimension_meta: dict,
) -> list[dict]:
    """
    Run Prophet + LightGBM + Ensemble on one aggregated time series.
    Returns a list of row dicts compatible with save_forecast().
    """
    if len(series) < CFG.min_train_points:
        log.debug("Skipping series (only %d points)", len(series))
        return []

    prophet_df = run_prophet(series, horizon)
    lgbm_df    = run_lgbm(series, horizon)
    ens_df     = ensemble_blend(prophet_df, lgbm_df)

    rows: list[dict] = []

    model_map = [
        (prophet_df, "prophet"),
        (lgbm_df,    "lgbm"),
        (ens_df,     "ensemble"),
    ]

    for df, model_name in model_map:
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            rows.append({
                **dimension_meta,
                "horizon":     horizon,
                "target_date": str(row["target_date"]),
                "p10":         float(row["p10"]),
                "p50":         float(row["p50"]),
                "p90":         float(row["p90"]),
                "model":       model_name,
            })

    return rows


# ══════════════════════════════════════════════════════════════════════════════
#  Main Forecasting Pipeline
# ══════════════════════════════════════════════════════════════════════════════

def run_forecasting(
    clear_previous: bool = True,
    horizons: list[int] = None,
) -> int:
    """
    Full Phase-3 pipeline:
      1. Load billing data
      2. Forecast: total, by-provider, by-team, by-service
      3. Run Prophet + LightGBM + Ensemble per series × horizon
      4. Save all rows to forecasts table
    """
    if horizons:
        CFG.horizons = horizons

    print("\n" + "=" * 62)
    print("  PHASE 3 - FORECASTING ENGINE")
    print("=" * 62)

    # ──────────────────────────────────────────────────────────────
    # 1. Load data
    # ──────────────────────────────────────────────────────────────
    log.info("Loading billing data from finops.db ...")
    df_raw = get_time_series()

    if df_raw.empty:
        log.error("No billing data found. Run Phase 1 first (python storage.py).")
        return 0

    log.info(
        "Loaded %d billing rows spanning %s to %s",
        len(df_raw),
        df_raw["date"].min().date(),
        df_raw["date"].max().date(),
    )

    # ──────────────────────────────────────────────────────────────
    # 2. Optionally clear previous forecasts
    # ──────────────────────────────────────────────────────────────
    if clear_previous:
        with get_conn(DB_PATH) as conn:
            deleted = conn.execute("DELETE FROM forecasts").rowcount
        log.info("Cleared %d previous forecast records", deleted)

    # Ensure date column is a proper DatetimeIndex-friendly type
    df_raw["date"] = pd.to_datetime(df_raw["date"])

    all_rows: list[dict] = []

    # Helper: aggregate a sub-DataFrame to a sorted date Series
    def _agg(sub_df: pd.DataFrame) -> pd.Series:
        return (
            sub_df.groupby("date")["cost_usd"]
                  .sum()
                  .sort_index()
        )

    def _run_all_horizons(series: pd.Series, meta: dict, label: str) -> None:
        for h in CFG.horizons:
            rows = forecast_series(series, h, meta)
            all_rows.extend(rows)
            log.info("    horizon=%d  rows=%d  [%s]", h, len(rows), label)

    # ──────────────────────────────────────────────────────────────
    # 3a. Total daily spend
    # ──────────────────────────────────────────────────────────────
    log.info("[1/4] Forecasting total daily spend ...")
    total_series = _agg(df_raw)
    _run_all_horizons(total_series, {}, "total")

    # ──────────────────────────────────────────────────────────────
    # 3b. Per provider
    # ──────────────────────────────────────────────────────────────
    providers = sorted(df_raw["provider"].unique())
    log.info("[2/4] Forecasting by provider (%s) ...", ", ".join(providers))
    for prov in providers:
        series = _agg(df_raw[df_raw["provider"] == prov])
        _run_all_horizons(series, {"provider": prov}, f"provider={prov}")

    # ──────────────────────────────────────────────────────────────
    # 3c. Per team
    # ──────────────────────────────────────────────────────────────
    teams = sorted(df_raw["team"].unique())
    log.info("[3/4] Forecasting by team (%d teams) ...", len(teams))
    for team in teams:
        series = _agg(df_raw[df_raw["team"] == team])
        _run_all_horizons(series, {"team": team}, f"team={team}")

    # ──────────────────────────────────────────────────────────────
    # 3d. Per service
    # ──────────────────────────────────────────────────────────────
    services = sorted(df_raw["service"].unique())
    log.info("[4/4] Forecasting by service (%d services) ...", len(services))
    for svc in services:
        series = _agg(df_raw[df_raw["service"] == svc])
        _run_all_horizons(series, {"service": svc}, f"service={svc}")

    # ──────────────────────────────────────────────────────────────
    # 4. Persist
    # ──────────────────────────────────────────────────────────────
    log.info("Saving %d forecast rows to DB ...", len(all_rows))
    # Batch in chunks to avoid huge single transactions
    chunk_size = 500
    for i in range(0, len(all_rows), chunk_size):
        save_forecast(all_rows[i : i + chunk_size])
    log.info("  Saved %d rows to forecasts table", len(all_rows))

    _print_summary(all_rows)
    return len(all_rows)


# ══════════════════════════════════════════════════════════════════════════════
#  Summary Report
# ══════════════════════════════════════════════════════════════════════════════

def _print_summary(rows: list[dict]) -> None:
    if not rows:
        return

    df = pd.DataFrame(rows)

    print("\n" + "-" * 62)
    print("  FORECAST SUMMARY")
    print("-" * 62)

    print(f"\n  Total forecast rows saved : {len(rows)}")

    # Rows by model
    print("\n  By model:")
    for model, cnt in df["model"].value_counts().items():
        print(f"    {model:<12} {cnt:>5} rows")

    # Rows by horizon
    print("\n  By horizon (days):")
    for h, cnt in df["horizon"].value_counts().sort_index().items():
        print(f"    {h:>3}-day     {cnt:>5} rows")

    # Sample: total spend forecasts (p50) for each horizon, model=ensemble
    print("\n  Total-spend ensemble forecast (p50):")
    total_ens = df[
        df["model"].eq("ensemble") &
        df["provider"].isna() &
        df["team"].isna() &
        df["service"].isna()
    ].sort_values(["horizon", "target_date"])

    if total_ens.empty:
        # Fallback: any total-scope rows
        total_ens = df[
            df["provider"].isna() &
            df["team"].isna() &
            df["service"].isna()
        ].sort_values(["horizon", "target_date"])

    for h in sorted(df["horizon"].unique()):
        sub = total_ens[total_ens["horizon"] == h]
        if sub.empty:
            continue
        first = sub.iloc[0]
        last  = sub.iloc[-1]
        print(
            f"    {h:>3}-day: "
            f"{first['target_date']} p50=${first['p50']:>9,.0f}"
            f"  ...  "
            f"{last['target_date']} p50=${last['p50']:>9,.0f}"
        )

    # Provider breakdown (7-day, p50, prophet)
    print("\n  Provider 7-day forecast window (prophet, p50 avg):")
    prov_7d = df[df["horizon"].eq(7) & df["model"].eq("prophet") & df["provider"].notna()]
    if not prov_7d.empty:
        for prov, grp in prov_7d.groupby("provider"):
            print(f"    {prov:<8}  avg p50 = ${grp['p50'].mean():>9,.0f}/day")

    print("\n" + "-" * 62)
    print("  [OK] Phase 3 complete. Forecasts saved to forecasts table.")
    print("-" * 62)


# ══════════════════════════════════════════════════════════════════════════════
#  Entry Point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="FinOps Phase 3 - Forecasting Engine"
    )
    parser.add_argument(
        "--horizons",
        nargs="+",
        type=int,
        default=[7, 30, 90],
        metavar="DAYS",
        help="Forecast horizons in days (default: 7 30 90)",
    )
    parser.add_argument(
        "--keep-previous",
        action="store_true",
        default=False,
        help="Keep existing forecasts rows instead of clearing first.",
    )
    parser.add_argument(
        "--w-prophet",
        type=float,
        default=CFG.w_prophet,
        help=f"Ensemble weight for Prophet (default: {CFG.w_prophet})",
    )
    parser.add_argument(
        "--w-lgbm",
        type=float,
        default=CFG.w_lgbm,
        help=f"Ensemble weight for LightGBM (default: {CFG.w_lgbm})",
    )
    parser.add_argument(
        "--lgbm-estimators",
        type=int,
        default=CFG.lgbm_n_estimators,
        help=f"LightGBM n_estimators (default: {CFG.lgbm_n_estimators})",
    )
    args = parser.parse_args()

    # Apply CLI overrides
    CFG.w_prophet       = args.w_prophet
    CFG.w_lgbm          = args.w_lgbm
    CFG.lgbm_n_estimators = args.lgbm_estimators

    # Validate ensemble weights
    total_w = args.w_prophet + args.w_lgbm
    if abs(total_w - 1.0) > 1e-6:
        log.warning(
            "Ensemble weights sum to %.3f (not 1.0) — normalizing.", total_w
        )
        CFG.w_prophet /= total_w
        CFG.w_lgbm    /= total_w

    n_rows = run_forecasting(
        clear_previous=not args.keep_previous,
        horizons=args.horizons,
    )

    print(f"\n  -> {n_rows} forecast rows written to finops.db / forecasts\n")
