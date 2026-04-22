# -*- coding: utf-8 -*-
"""
Stream Detector — CSV Upload + Real-Time Anomaly Streaming
===========================================================
Runs the full Z-score + IsolationForest pipeline on uploaded CSV data,
then saves detected anomalies **one-by-one** with a short delay so the
frontend can display them appearing in real time.

Used exclusively by the /api/upload-csv endpoint.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import sys
import time
import warnings
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

log = logging.getLogger("stream_detector")

# ══════════════════════════════════════════════════════════════════════════════
#  Shared upload state — read by GET /api/upload-status
# ══════════════════════════════════════════════════════════════════════════════

REQUIRED_COLUMNS = {"date", "provider", "service", "category", "team", "environment", "region", "cost_usd"}

_upload_state: dict = {
    "status":          "idle",       # idle | validating | loading | detecting | streaming | complete | error
    "total_rows":      0,
    "processed_rows":  0,
    "anomaly_count":   0,
    "current_row":     None,         # { date, provider, service, team, cost_usd }
    "recent_anomalies": [],          # last 20 anomalies (for live table)
    "error":           None,
    "filename":        None,
    "started_at":      None,
    "completed_at":    None,
}

_stop_requested = False


def get_upload_state() -> dict:
    """Return a copy of the current upload state."""
    return dict(_upload_state)


def reset_upload_state():
    """Reset state to idle and signal any running task to stop."""
    global _stop_requested
    _stop_requested = True
    _upload_state.update(
        status="idle",
        total_rows=0,
        processed_rows=0,
        anomaly_count=0,
        current_row=None,
        recent_anomalies=[],
        error=None,
        filename=None,
        started_at=None,
        completed_at=None,
    )


def _update_state(**kwargs):
    _upload_state.update(**kwargs)


# ══════════════════════════════════════════════════════════════════════════════
#  CSV Validation
# ══════════════════════════════════════════════════════════════════════════════

def validate_csv(file_bytes: bytes, filename: str) -> tuple[bool, str, int]:
    """
    Validate that the CSV contains all required columns.
    Returns (ok, error_message, row_count).
    """
    try:
        text = file_bytes.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        headers = set(reader.fieldnames or [])
        # Normalize headers
        headers = {h.strip().lower().replace(" ", "_") for h in headers}

        missing = REQUIRED_COLUMNS - headers
        if missing:
            return False, f"Missing columns: {', '.join(sorted(missing))}", 0

        # Count rows
        row_count = sum(1 for _ in reader)
        if row_count == 0:
            return False, "CSV file is empty (no data rows)", 0

        return True, "", row_count

    except UnicodeDecodeError:
        return False, "File is not a valid UTF-8 CSV", 0
    except Exception as e:
        return False, f"CSV parsing error: {e}", 0


# ══════════════════════════════════════════════════════════════════════════════
#  Main streaming pipeline
# ══════════════════════════════════════════════════════════════════════════════

def run_streaming_detection(file_bytes: bytes, filename: str):
    """
    Full pipeline:
      1. Validate + parse CSV
      2. Clear old data & load into daily_billing
      3. Run Z-score + IsolationForest ensemble
      4. Save anomalies one-by-one (streaming simulation)
    """
    global _stop_requested
    _stop_requested = False

    from storage import get_conn, DB_PATH, init_db
    from anomaly_detector import (
        run_zscore_detector, run_isolation_forest,
        merge_detectors, generate_description, score_severity,
    )

    _update_state(
        status="validating",
        filename=filename,
        started_at=datetime.utcnow().isoformat() + "Z",
        completed_at=None,
        error=None,
        anomaly_count=0,
        processed_rows=0,
        recent_anomalies=[],
        current_row=None,
    )

    try:
        # ── 1. Parse CSV ──────────────────────────────────────────────────
        log.info("[upload] Parsing CSV: %s", filename)
        text = file_bytes.decode("utf-8-sig")
        df = pd.read_csv(io.StringIO(text))

        # Normalize column names
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

        total_rows = len(df)
        _update_state(status="loading", total_rows=total_rows)
        log.info("[upload] CSV parsed: %d rows", total_rows)

        if _stop_requested:
            _update_state(status="idle")
            return

        # ── 2. Clear old data & load into DB ──────────────────────────────
        log.info("[upload] Clearing old data and loading CSV into DB ...")

        # Ensure date is string format YYYY-MM-DD
        df["date"] = pd.to_datetime(df["date"], format="mixed", utc=True).dt.strftime("%Y-%m-%d")
        df["cost_usd"] = pd.to_numeric(df["cost_usd"], errors="coerce").fillna(0.0)

        init_db()

        with get_conn(DB_PATH) as conn:
            conn.execute("DELETE FROM daily_billing")
            conn.execute("DELETE FROM detected_anomalies")

        # Load in chunks, updating progress
        chunk_size = 500
        for i in range(0, total_rows, chunk_size):
            if _stop_requested:
                _update_state(status="idle")
                return

            chunk = df.iloc[i:i + chunk_size]
            with get_conn(DB_PATH) as conn:
                chunk.to_sql("daily_billing", conn, if_exists="append", index=False, method="multi")

            processed = min(i + chunk_size, total_rows)
            _update_state(
                processed_rows=processed,
                current_row={
                    "date": str(chunk.iloc[-1].get("date", "")),
                    "provider": str(chunk.iloc[-1].get("provider", "")),
                    "service": str(chunk.iloc[-1].get("service", "")),
                    "team": str(chunk.iloc[-1].get("team", "")),
                    "cost_usd": float(chunk.iloc[-1].get("cost_usd", 0)),
                },
            )

        log.info("[upload] Data loaded: %d rows inserted", total_rows)

        # ── 3. Run anomaly detection ──────────────────────────────────────
        _update_state(status="detecting", processed_rows=total_rows)
        log.info("[upload] Running Z-score + STL detector ...")

        # Re-query from DB in the format the detectors expect
        from storage import get_time_series
        df_raw = get_time_series()

        if df_raw.empty:
            _update_state(status="complete", completed_at=datetime.utcnow().isoformat() + "Z")
            log.info("[upload] No billing data after load. Done.")
            return

        # Z-score
        z_df = run_zscore_detector(df_raw)
        n_z = z_df["is_anomaly_z"].sum() if not z_df.empty else 0
        log.info("[upload]   Z-score flagged %d candidates", n_z)

        if _stop_requested:
            _update_state(status="idle")
            return

        # Isolation Forest
        log.info("[upload] Running Isolation Forest ...")
        if_df, iforest, scaler, feature_cols, X_scaled = run_isolation_forest(df_raw)
        n_if = if_df["is_anomaly_if"].sum() if not if_df.empty else 0
        log.info("[upload]   Isolation Forest flagged %d candidates", n_if)

        if _stop_requested:
            _update_state(status="idle")
            return

        # Ensemble merge
        log.info("[upload] Merging detectors ...")
        merged = merge_detectors(z_df, if_df)

        if merged.empty:
            _update_state(
                status="complete",
                completed_at=datetime.utcnow().isoformat() + "Z",
            )
            log.info("[upload] No anomalies detected. Done.")
            return

        log.info("[upload] Ensemble confirmed %d anomalies", len(merged))

        # ── 4. Stream anomalies one by one ────────────────────────────────
        _update_state(status="streaming")

        # Sort: most severe first
        severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
        merged["sev_ord"] = merged["severity"].map(severity_order).fillna(4)
        merged = merged.sort_values(["sev_ord", "deviation_pct"], ascending=[True, False])
        merged = merged.drop(columns=["sev_ord"])

        now_str = datetime.utcnow().isoformat()
        anomaly_count = 0
        recent: list[dict] = []

        # Calculate delay to make streaming visible but not too slow
        n_anomalies = len(merged)
        # Aim for ~20-60 seconds total streaming time
        delay = max(0.05, min(0.3, 30.0 / max(n_anomalies, 1)))

        for idx, (_, row) in enumerate(merged.iterrows()):
            if _stop_requested:
                _update_state(status="idle")
                return

            # Build anomaly record
            desc = generate_description(row)
            deviation = float(row["deviation_pct"])
            cost = float(row["cost_usd"])
            expected = float(row["expected_cost"])

            anomaly_dict = {
                "date":          str(row["date"]),
                "provider":      str(row["provider"]),
                "service":       str(row["service"]),
                "team":          str(row["team"]),
                "environment":   str(row["environment"]),
                "cost_usd":      cost,
                "expected_cost": expected,
                "deviation_pct": deviation,
                "severity":      str(row["severity"]),
                "anomaly_type":  str(row["anomaly_type"]),
                "detector":      str(row["detector"]),
                "shap_factors":  {},
                "description":   desc,
            }

            # Save to DB one by one
            with get_conn(DB_PATH) as conn:
                conn.execute("""
                    INSERT INTO detected_anomalies
                        (detected_at, date, provider, service, team, environment,
                         cost_usd, expected_cost, deviation_pct, severity,
                         anomaly_type, detector, shap_factors, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    now_str,
                    anomaly_dict["date"], anomaly_dict["provider"],
                    anomaly_dict["service"], anomaly_dict["team"],
                    anomaly_dict["environment"], anomaly_dict["cost_usd"],
                    anomaly_dict["expected_cost"], anomaly_dict["deviation_pct"],
                    anomaly_dict["severity"], anomaly_dict["anomaly_type"],
                    anomaly_dict["detector"],
                    json.dumps(anomaly_dict["shap_factors"]),
                    anomaly_dict["description"],
                ))

            anomaly_count += 1

            # Keep last 20 for live table
            live_item = {
                "id":             anomaly_count,
                "date":           anomaly_dict["date"],
                "provider":       anomaly_dict["provider"],
                "service":        anomaly_dict["service"],
                "team":           anomaly_dict["team"],
                "environment":    anomaly_dict["environment"],
                "cost_usd":       round(cost, 2),
                "expected_cost":  round(expected, 2),
                "deviation_pct":  round(deviation, 1),
                "severity":       anomaly_dict["severity"],
                "anomaly_type":   anomaly_dict["anomaly_type"],
                "detector":       anomaly_dict["detector"],
                "description":    anomaly_dict["description"],
            }
            recent.insert(0, live_item)
            if len(recent) > 20:
                recent = recent[:20]

            _update_state(
                anomaly_count=anomaly_count,
                recent_anomalies=list(recent),
                current_row={
                    "date":     anomaly_dict["date"],
                    "provider": anomaly_dict["provider"],
                    "service":  anomaly_dict["service"],
                    "team":     anomaly_dict["team"],
                    "cost_usd": round(cost, 2),
                },
            )

            # Delay for streaming effect
            time.sleep(delay)

        # ── Done ──────────────────────────────────────────────────────────
        _update_state(
            status="complete",
            completed_at=datetime.utcnow().isoformat() + "Z",
        )
        log.info("[upload] Streaming complete — %d anomalies saved", anomaly_count)

    except Exception as exc:
        log.error("[upload] Failed: %s", exc, exc_info=True)
        _update_state(status="error", error=str(exc))
