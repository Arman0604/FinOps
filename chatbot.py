# -*- coding: utf-8 -*-
"""
Phase 5 — AI Chatbot Engine
============================
Provides conversational FinOps intelligence powered by Groq.
Reads live data from finops.db to answer questions about:
  - Cost spikes & anomalies ("why did costs spike?")
  - Team overspend       ("which team overspent?")
  - What-if analysis     ("what if we switch EC2 to reserved instances?")
  - Forecasts & budgets

Usage (standalone):
    python chatbot.py

Used by api.py:
    from chatbot import chat, ChatMessage
"""

from __future__ import annotations

import sys
import os
import json
import logging
from datetime import date, datetime, timedelta
from typing import List

# ── stdout UTF-8 on Windows ──────────────────────────────────────────────────
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
except AttributeError:
    pass

# ── Load .env ────────────────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv()

from groq import Groq
from pydantic import BaseModel

from storage import get_conn, DB_PATH

log = logging.getLogger("chatbot")

# ════════════════════════════════════════════════════════════════════════════
#  Groq client setup
# ════════════════════════════════════════════════════════════════════════════

_GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
if not _GROQ_API_KEY:
    log.warning("GROQ_API_KEY not set in .env — AI responses will be unavailable")

_GROQ_CLIENT = None
if _GROQ_API_KEY:
    _GROQ_CLIENT = Groq(api_key=_GROQ_API_KEY)

_MODEL_NAME = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


# ════════════════════════════════════════════════════════════════════════════
#  Pydantic models
# ════════════════════════════════════════════════════════════════════════════

class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str
    context_used: dict = {}


# ════════════════════════════════════════════════════════════════════════════
#  Live data snapshot from finops.db
# ════════════════════════════════════════════════════════════════════════════

def _get_live_context() -> dict:
    """
    Query finops.db for a concise, up-to-date snapshot of the platform state.
    Returns a dict that will be serialised into the system prompt.
    """
    ctx: dict = {}
    today = date.today().isoformat()
    month_start = date.today().replace(day=1).isoformat()
    prev_first   = (date.today().replace(day=1) - timedelta(days=1)).replace(day=1).isoformat()
    prev_last    = (date.today().replace(day=1) - timedelta(days=1)).isoformat()
    week_ago     = (date.today() - timedelta(days=7)).isoformat()

    with get_conn(DB_PATH) as conn:

        # ── MTD total spend ───────────────────────────────────────────────
        row = conn.execute(
            "SELECT SUM(cost_usd) as total FROM daily_billing WHERE date >= ? AND date <= ?",
            [month_start, today]
        ).fetchone()
        ctx["mtd_total_usd"] = round(float(row["total"] or 0), 2)

        # ── Previous month total ──────────────────────────────────────────
        row2 = conn.execute(
            "SELECT SUM(cost_usd) as total FROM daily_billing WHERE date >= ? AND date <= ?",
            [prev_first, prev_last]
        ).fetchone()
        ctx["prev_month_total_usd"] = round(float(row2["total"] or 0), 2)

        # ── Spend by provider (all time) ──────────────────────────────────
        rows = conn.execute(
            "SELECT provider, ROUND(SUM(cost_usd),2) AS total FROM daily_billing GROUP BY provider ORDER BY total DESC"
        ).fetchall()
        ctx["spend_by_provider"] = {r["provider"]: r["total"] for r in rows}

        # ── Spend by team (all time) ─────────────────────────────────────
        rows = conn.execute(
            "SELECT team, ROUND(SUM(cost_usd),2) AS total FROM daily_billing GROUP BY team ORDER BY total DESC"
        ).fetchall()
        ctx["spend_by_team"] = {r["team"]: r["total"] for r in rows}

        # ── Spend by service top-10 ───────────────────────────────────────
        rows = conn.execute(
            "SELECT service, ROUND(SUM(cost_usd),2) AS total FROM daily_billing GROUP BY service ORDER BY total DESC LIMIT 10"
        ).fetchall()
        ctx["top_services"] = {r["service"]: r["total"] for r in rows}

        # ── Last 7 days daily totals ──────────────────────────────────────
        rows = conn.execute(
            "SELECT date, ROUND(SUM(cost_usd),2) AS total FROM daily_billing WHERE date >= ? GROUP BY date ORDER BY date",
            [week_ago]
        ).fetchall()
        ctx["last_7_days"] = {r["date"]: r["total"] for r in rows}

        # ── Active anomalies summary ──────────────────────────────────────
        row = conn.execute("SELECT COUNT(*) as n FROM detected_anomalies").fetchone()
        ctx["total_anomalies"] = row["n"]

        rows = conn.execute(
            """SELECT severity, COUNT(*) as n FROM detected_anomalies
               GROUP BY severity ORDER BY CASE severity
               WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
               WHEN 'MEDIUM'   THEN 3 ELSE 4 END"""
        ).fetchall()
        ctx["anomalies_by_severity"] = {r["severity"]: r["n"] for r in rows}

        # ── Top 5 worst anomalies ─────────────────────────────────────────
        rows = conn.execute(
            """SELECT date, provider, service, team, severity,
                      ROUND(cost_usd,2) as cost, ROUND(expected_cost,2) as expected,
                      ROUND(deviation_pct,1) as deviation_pct, description
               FROM detected_anomalies
               ORDER BY deviation_pct DESC LIMIT 5"""
        ).fetchall()
        ctx["top_anomalies"] = [dict(r) for r in rows]

        # ── Budget utilisation ────────────────────────────────────────────
        budgets = conn.execute("SELECT team, amount_usd FROM budgets").fetchall()
        budget_status = []
        for b in budgets:
            spend_row = conn.execute(
                "SELECT SUM(cost_usd) as s FROM daily_billing WHERE team=? AND date >= ?",
                [b["team"], month_start]
            ).fetchone()
            actual = float(spend_row["s"] or 0)
            budget_amt = float(b["amount_usd"])
            util = round(actual / budget_amt * 100, 1) if budget_amt else 0
            status = "BREACH" if util >= 100 else ("WARNING" if util >= 80 else "OK")
            budget_status.append({
                "team": b["team"],
                "budget": round(budget_amt, 2),
                "actual_mtd": round(actual, 2),
                "utilization_pct": util,
                "status": status,
            })
        ctx["budget_status"] = budget_status

        # ── 30-day ensemble forecast (total) ─────────────────────────────
        rows = conn.execute(
            """SELECT target_date, ROUND(p10,2) as p10, ROUND(p50,2) as p50, ROUND(p90,2) as p90
               FROM forecasts WHERE horizon=30 AND model='ensemble'
                 AND provider IS NULL AND team IS NULL AND service IS NULL
               ORDER BY target_date LIMIT 30"""
        ).fetchall()
        if rows:
            ctx["forecast_30d_p50_end"] = rows[-1]["p50"]
            ctx["forecast_30d_range"]   = f"${rows[0]['p50']:,.0f}–${rows[-1]['p50']:,.0f}/day"
        else:
            ctx["forecast_30d_p50_end"] = None
            ctx["forecast_30d_range"]   = "N/A (run forecast first)"

        # ── Largest recent spike ──────────────────────────────────────────
        row = conn.execute(
            """SELECT date, service, team, provider,
                      ROUND(cost_usd,2) as cost, ROUND(deviation_pct,1) as dev
               FROM detected_anomalies WHERE date >= ?
               ORDER BY deviation_pct DESC LIMIT 1""",
            [week_ago]
        ).fetchone()
        ctx["biggest_recent_spike"] = dict(row) if row else None

    return ctx


# ════════════════════════════════════════════════════════════════════════════
#  System prompt builder
# ════════════════════════════════════════════════════════════════════════════

_SYSTEM_INTRO = """You are a senior FinOps AI assistant embedded in a Cloud Cost Intelligence Platform.
You have direct access to live billing data, anomaly detections, forecasts, and budget information.
Your job is to help engineers and finance teams:
  1. Understand cost spikes and their root causes.
  2. Identify which teams or services are over budget.
  3. Run what-if scenario analyses (e.g., Reserved Instances vs On-demand).
  4. Interpret forecast trends.
  5. Suggest actionable cost optimisation recommendations.

Guidelines:
  - Always cite specific dollar amounts and percentages from the data provided.
  - Be concise but precise. Use bullet points for multi-point answers.
  - For what-if questions, produce a clear before/after comparison.
  - If the data is insufficient to answer, say so and suggest what data might help.
  - Today's date: {today}
"""

def _build_system_prompt(ctx: dict) -> str:
    today = date.today().strftime("%B %d, %Y")
    intro = _SYSTEM_INTRO.format(today=today)

    mom_change = (
        f"{((ctx['mtd_total_usd'] - ctx['prev_month_total_usd']) / ctx['prev_month_total_usd'] * 100):+.1f}% (note: MTD is partial)"
        if ctx['prev_month_total_usd']
        else "N/A (no previous month data)"
    )

    ctx_block = f"""
## Live FinOps Data Snapshot (as of {today})

### Monthly Spend
- MTD Total: ${ctx['mtd_total_usd']:,.2f}
- Previous Month Total: ${ctx['prev_month_total_usd']:,.2f}
- MoM Change: {mom_change}

### Spend by Cloud Provider
{json.dumps(ctx['spend_by_provider'], indent=2)}

### Spend by Team (All Time)
{json.dumps(ctx['spend_by_team'], indent=2)}

### Top 10 Services by Cost
{json.dumps(ctx['top_services'], indent=2)}

### Last 7 Days Daily Spend
{json.dumps(ctx['last_7_days'], indent=2)}

### Anomaly Summary
- Total anomalies detected: {ctx['total_anomalies']}
- By severity: {json.dumps(ctx['anomalies_by_severity'])}

### Top 5 Anomalies (by deviation %)
{json.dumps(ctx['top_anomalies'], indent=2)}

### Budget Status (MTD)
{json.dumps(ctx['budget_status'], indent=2)}

### 30-Day Forecast
- End-of-period P50 daily spend: ${ctx.get('forecast_30d_p50_end') or 'N/A'}
- Daily range: {ctx.get('forecast_30d_range', 'N/A')}

### Biggest Recent Spike (last 7 days)
{json.dumps(ctx.get('biggest_recent_spike'), indent=2)}
"""

    what_if_guide = """
## What-If Analysis Guidelines

When the user asks "what if we switch X to reserved instances?" or similar:
1. Identify the service/team from the data above.
2. Apply these approximate savings estimates:
   - EC2 On-Demand → 1-year Reserved: ~40% savings
   - EC2 On-Demand → 3-year Reserved: ~60% savings
   - RDS On-Demand → Reserved: ~35% savings
   - Spot Instances (if applicable): ~70% vs On-Demand
   - Azure VMs → Reserved: ~38% savings
   - GCP Compute → Committed Use: ~37% savings
3. Calculate monthly and annual savings based on the team/service spend shown above.
4. Mention trade-offs: commitment length, flexibility, upfront cost.
5. Suggest checking Savings Plans if the workload is variable.
"""

    return intro + ctx_block + what_if_guide


# ════════════════════════════════════════════════════════════════════════════
#  Main chat function
# ════════════════════════════════════════════════════════════════════════════

def chat(message: str, history: List[ChatMessage] | None = None) -> ChatResponse:
    """
    Send a message to the FinOps AI chatbot and return its reply.

    Args:
        message:  The user's question.
        history:  Prior conversation turns (role/content pairs).

    Returns:
        ChatResponse with .reply and .context_used
    """
    if not _GROQ_CLIENT:
        return ChatResponse(
            reply="⚠️ GROQ_API_KEY is not configured. Please add it to your `.env` file:\n\n```\nGROQ_API_KEY=your_key_here\n```\n\nGet a free key at: https://console.groq.com/keys",
            context_used={},
        )

    history = history or []

    # Pull live data from finops.db
    try:
        ctx = _get_live_context()
    except Exception as exc:
        log.error("Failed to load live context: %s", exc)
        ctx = {}

    system_prompt = _build_system_prompt(ctx)

    # Build conversation history in OpenAI format for Groq
    groq_history = [{"role": "system", "content": system_prompt}]
    for msg in history:
        groq_history.append({"role": msg.role, "content": msg.content})
    
    # Add current message
    groq_history.append({"role": "user", "content": message})

    try:
        chat_completion = _GROQ_CLIENT.chat.completions.create(
            model=_MODEL_NAME,
            messages=groq_history,
            temperature=0.4,
            max_tokens=2048,
        )
        reply = chat_completion.choices[0].message.content.strip()
    except Exception as exc:
        log.error("Groq API error: %s", exc)
        reply = f"❌ AI service error: {exc}\n\nPlease check your GROQ_API_KEY and network connection."

    return ChatResponse(reply=reply, context_used=ctx)


# ════════════════════════════════════════════════════════════════════════════
#  CLI for standalone testing
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    print("\n🤖  FinOps AI Chatbot  (type 'exit' to quit)\n")
    history: List[ChatMessage] = []

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input or user_input.lower() in ("exit", "quit", "q"):
            print("Goodbye!")
            break

        result = chat(user_input, history)
        print(f"\nAI: {result.reply}\n")

        history.append(ChatMessage(role="user",    content=user_input))
        history.append(ChatMessage(role="assistant", content=result.reply))
