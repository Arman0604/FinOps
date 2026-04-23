# -*- coding: utf-8 -*-
"""
FinOps Anomaly Detection Dashboard Generator
=============================================
Loads the 60k-row cloud cost dataset, runs Isolation Forest for anomaly
detection, and generates a self-contained interactive HTML dashboard with:
  1. Time-series of total daily cost with anomalies highlighted
  2. Bar charts: spend & anomaly count by provider/service/team/env/region
  3. Heatmaps: team×service and region×service for spend & anomalies
  4. Distribution plot: anomalous vs normal cost distributions
  5. Savings comparison: total spend vs cleaned spend

Run:  python dashboard_generator.py
"""

from __future__ import annotations
import sys, warnings, os
warnings.filterwarnings("ignore")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import LabelEncoder
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.express as px

# ══════════════════════════════════════════════════════════════════════════════
#  1. LOAD DATA
# ══════════════════════════════════════════════════════════════════════════════
CSV_PATH = os.path.join("data", "processed", "daily_billing.csv")
print(f"[1/6] Loading dataset from {CSV_PATH} ...")
df = pd.read_csv(CSV_PATH, parse_dates=["date"])
print(f"       Loaded {len(df):,} rows  |  {df['date'].min().date()} → {df['date'].max().date()}")

# ══════════════════════════════════════════════════════════════════════════════
#  2. ISOLATION FOREST
# ══════════════════════════════════════════════════════════════════════════════
print("[2/6] Running Isolation Forest ...")

le_dict = {}
for col in ["provider", "service", "category", "team", "environment", "region"]:
    le = LabelEncoder()
    df[f"{col}_enc"] = le.fit_transform(df[col])
    le_dict[col] = le

feature_cols = [
    "cost_usd", "provider_enc", "service_enc", "category_enc",
    "team_enc", "environment_enc", "region_enc",
]
X = df[feature_cols].values

iso = IsolationForest(
    n_estimators=100, contamination=0.05,
    random_state=42, n_jobs=-1,
)
iso.fit(X)
df["anomaly_score"] = -iso.decision_function(X)
df["is_anomaly"] = iso.predict(X) == -1

n_anom = df["is_anomaly"].sum()
print(f"       Detected {n_anom:,} anomalies ({n_anom/len(df)*100:.1f}%)")

# ══════════════════════════════════════════════════════════════════════════════
#  3. BUILD PLOTLY FIGURES
# ══════════════════════════════════════════════════════════════════════════════
print("[3/6] Building visualizations ...")

COLORS = {
    "bg": "#0f1117", "card": "#1a1d27", "text": "#e2e8f0",
    "accent": "#06b6d4", "accent2": "#8b5cf6", "accent3": "#f59e0b",
    "danger": "#ef4444", "success": "#10b981", "grid": "#2a2d3a",
    "normal": "#3b82f6", "anomaly": "#ef4444",
}
PROV_COLORS = {"aws": "#06b6d4", "azure": "#3b82f6", "gcp": "#8b5cf6"}

layout_defaults = dict(
    paper_bgcolor=COLORS["bg"], plot_bgcolor=COLORS["card"],
    font=dict(family="Inter, sans-serif", color=COLORS["text"], size=12),
    margin=dict(l=60, r=30, t=50, b=50),
    xaxis=dict(gridcolor=COLORS["grid"], zerolinecolor=COLORS["grid"]),
    yaxis=dict(gridcolor=COLORS["grid"], zerolinecolor=COLORS["grid"]),
)

figures_html = []

# ── FIG 1: Time-series with anomalies ────────────────────────────────────────
daily = df.groupby("date").agg(
    total_cost=("cost_usd", "sum"),
    anomaly_cost=("cost_usd", lambda x: x[df.loc[x.index, "is_anomaly"]].sum()),
    anomaly_count=("is_anomaly", "sum"),
).reset_index()

anom_days = daily[daily["anomaly_count"] > 0]

fig1 = go.Figure()
fig1.add_trace(go.Scatter(
    x=daily["date"], y=daily["total_cost"], mode="lines",
    name="Total Daily Cost", line=dict(color=COLORS["accent"], width=2),
    fill="tozeroy", fillcolor="rgba(6,182,212,0.1)",
))
fig1.add_trace(go.Scatter(
    x=anom_days["date"], y=anom_days["total_cost"], mode="markers",
    name=f"Anomaly Days ({len(anom_days)})",
    marker=dict(color=COLORS["danger"], size=8, symbol="diamond",
                line=dict(width=1, color="#fff")),
))
fig1.update_layout(
    **layout_defaults, title="Daily Cloud Spend with Detected Anomalies",
    xaxis_title="Date", yaxis_title="Cost (USD)",
    legend=dict(orientation="h", y=1.12, x=0.5, xanchor="center"),
    height=420,
)
figures_html.append(("time_series", fig1.to_html(full_html=False, include_plotlyjs=False)))

# ── FIG 2: Spend & Anomaly Count by Provider ─────────────────────────────────
def dual_bar(group_col, title_label):
    spend = df.groupby(group_col)["cost_usd"].sum().sort_values(ascending=False)
    anom_ct = df[df["is_anomaly"]].groupby(group_col)["is_anomaly"].count()
    anom_ct = anom_ct.reindex(spend.index, fill_value=0)
    cats = spend.index.tolist()
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    fig.add_trace(go.Bar(
        x=cats, y=spend.values, name="Total Spend ($)",
        marker_color=COLORS["accent"], opacity=0.85,
    ), secondary_y=False)
    fig.add_trace(go.Scatter(
        x=cats, y=anom_ct.values, name="Anomaly Count",
        mode="lines+markers", line=dict(color=COLORS["danger"], width=2.5),
        marker=dict(size=7),
    ), secondary_y=True)
    fig.update_layout(
        **layout_defaults, title=f"Spend & Anomalies by {title_label}",
        legend=dict(orientation="h", y=1.15, x=0.5, xanchor="center"),
        height=370,
    )
    fig.update_yaxes(title_text="Spend ($)", secondary_y=False,
                     gridcolor=COLORS["grid"])
    fig.update_yaxes(title_text="Anomalies", secondary_y=True,
                     gridcolor=COLORS["grid"], showgrid=False)
    return fig

for col, label in [("provider","Provider"),("service","Service"),
                    ("team","Team"),("environment","Environment"),("region","Region")]:
    f = dual_bar(col, label)
    figures_html.append((f"bar_{col}", f.to_html(full_html=False, include_plotlyjs=False)))

# ── FIG 3: Heatmaps ──────────────────────────────────────────────────────────
def heatmap_fig(row_col, col_col, val_col, agg, title):
    if agg == "sum":
        piv = df.pivot_table(index=row_col, columns=col_col, values=val_col, aggfunc="sum", fill_value=0)
    else:
        piv = df[df["is_anomaly"]].pivot_table(
            index=row_col, columns=col_col, values="is_anomaly",
            aggfunc="count", fill_value=0,
        )
    fig = go.Figure(go.Heatmap(
        z=piv.values, x=piv.columns.tolist(), y=piv.index.tolist(),
        colorscale="Viridis", texttemplate="%{z:,.0f}", textfont=dict(size=10),
    ))
    fig.update_layout(**layout_defaults, title=title, height=400)
    return fig

for rc, cc, ttl in [
    ("team","service","Spend Heatmap: Team × Service"),
    ("region","service","Spend Heatmap: Region × Service"),
]:
    f = heatmap_fig(rc, cc, "cost_usd", "sum", ttl)
    figures_html.append((f"heatmap_spend_{rc}", f.to_html(full_html=False, include_plotlyjs=False)))

for rc, cc, ttl in [
    ("team","service","Anomaly Count Heatmap: Team × Service"),
    ("region","service","Anomaly Count Heatmap: Region × Service"),
]:
    f = heatmap_fig(rc, cc, "is_anomaly", "count", ttl)
    figures_html.append((f"heatmap_anom_{rc}", f.to_html(full_html=False, include_plotlyjs=False)))

# ── FIG 4: Distribution ──────────────────────────────────────────────────────
normal_costs = df[~df["is_anomaly"]]["cost_usd"]
anomaly_costs = df[df["is_anomaly"]]["cost_usd"]

fig4 = go.Figure()
fig4.add_trace(go.Histogram(
    x=normal_costs, name=f"Normal ({len(normal_costs):,})",
    marker_color=COLORS["normal"], opacity=0.7, nbinsx=80,
))
fig4.add_trace(go.Histogram(
    x=anomaly_costs, name=f"Anomalous ({len(anomaly_costs):,})",
    marker_color=COLORS["anomaly"], opacity=0.7, nbinsx=80,
))
fig4.update_layout(
    **layout_defaults, barmode="overlay",
    title="Cost Distribution: Normal vs Anomalous Spending",
    xaxis_title="Cost (USD)", yaxis_title="Frequency",
    legend=dict(orientation="h", y=1.12, x=0.5, xanchor="center"),
    height=400,
)
figures_html.append(("distribution", fig4.to_html(full_html=False, include_plotlyjs=False)))

# Box plot version
fig4b = go.Figure()
fig4b.add_trace(go.Box(
    y=normal_costs, name="Normal", marker_color=COLORS["normal"],
    boxmean="sd", jitter=0.1,
))
fig4b.add_trace(go.Box(
    y=anomaly_costs, name="Anomalous", marker_color=COLORS["anomaly"],
    boxmean="sd", jitter=0.1,
))
fig4b.update_layout(
    **layout_defaults,
    title="Cost Box Plot: Normal vs Anomalous",
    yaxis_title="Cost (USD)", height=400,
)
figures_html.append(("boxplot", fig4b.to_html(full_html=False, include_plotlyjs=False)))

# ── FIG 5: Savings Comparison ────────────────────────────────────────────────
total_spend = df["cost_usd"].sum()
anomaly_spend = df[df["is_anomaly"]]["cost_usd"].sum()
clean_spend = total_spend - anomaly_spend
savings_pct = anomaly_spend / total_spend * 100

fig5 = go.Figure()
fig5.add_trace(go.Bar(
    x=["Total Spend", "Spend After Removing\nAnomalies", "Potential\nSavings"],
    y=[total_spend, clean_spend, anomaly_spend],
    marker_color=[COLORS["accent"], COLORS["success"], COLORS["danger"]],
    text=[f"${total_spend:,.0f}", f"${clean_spend:,.0f}", f"${anomaly_spend:,.0f}"],
    textposition="outside", textfont=dict(size=14, color=COLORS["text"]),
))
fig5.update_layout(
    **layout_defaults,
    title=f"Savings Opportunity — {savings_pct:.1f}% of Total Spend Flagged as Anomalous",
    yaxis_title="Cost (USD)", height=420,
    showlegend=False,
)
figures_html.append(("savings", fig5.to_html(full_html=False, include_plotlyjs=False)))

# ══════════════════════════════════════════════════════════════════════════════
#  4. KPI METRICS
# ══════════════════════════════════════════════════════════════════════════════
print("[4/6] Computing KPI metrics ...")
date_range = f"{df['date'].min().strftime('%b %d, %Y')} — {df['date'].max().strftime('%b %d, %Y')}"
avg_daily = daily["total_cost"].mean()
max_daily = daily["total_cost"].max()
max_day = daily.loc[daily["total_cost"].idxmax(), "date"].strftime("%b %d")
top_service = df.groupby("service")["cost_usd"].sum().idxmax()
top_team = df.groupby("team")["cost_usd"].sum().idxmax()

# ══════════════════════════════════════════════════════════════════════════════
#  5. ASSEMBLE HTML
# ══════════════════════════════════════════════════════════════════════════════
print("[5/6] Assembling HTML dashboard ...")

kpi_cards_html = f"""
<div class="kpi-grid">
  <div class="kpi-card">
    <div class="kpi-label">Total Rows</div>
    <div class="kpi-value">{len(df):,}</div>
    <div class="kpi-sub">{date_range}</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">Total Spend</div>
    <div class="kpi-value">${total_spend:,.0f}</div>
    <div class="kpi-sub">Avg ${avg_daily:,.0f}/day</div>
  </div>
  <div class="kpi-card kpi-danger">
    <div class="kpi-label">Anomalies Detected</div>
    <div class="kpi-value">{n_anom:,}</div>
    <div class="kpi-sub">{n_anom/len(df)*100:.1f}% of records</div>
  </div>
  <div class="kpi-card kpi-warning">
    <div class="kpi-label">Anomalous Spend</div>
    <div class="kpi-value">${anomaly_spend:,.0f}</div>
    <div class="kpi-sub">{savings_pct:.1f}% potential savings</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">Peak Day</div>
    <div class="kpi-value">${max_daily:,.0f}</div>
    <div class="kpi-sub">{max_day}</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-label">Top Service</div>
    <div class="kpi-value" style="font-size:1.4rem">{top_service}</div>
    <div class="kpi-sub">Highest total spend</div>
  </div>
</div>
"""

# Build chart sections
sections = {
    "time_series": ("📈 Time-Series: Daily Cost with Anomalies", "full"),
    "bar_provider": ("☁️ Spend & Anomalies by Provider", "half"),
    "bar_service": ("⚙️ Spend & Anomalies by Service", "half"),
    "bar_team": ("👥 Spend & Anomalies by Team", "half"),
    "bar_environment": ("🌍 Spend & Anomalies by Environment", "half"),
    "bar_region": ("📍 Spend & Anomalies by Region", "full"),
    "heatmap_spend_team": ("🔥 Spend Heatmap: Team × Service", "half"),
    "heatmap_spend_region": ("🔥 Spend Heatmap: Region × Service", "half"),
    "heatmap_anom_team": ("⚠️ Anomaly Heatmap: Team × Service", "half"),
    "heatmap_anom_region": ("⚠️ Anomaly Heatmap: Region × Service", "half"),
    "distribution": ("📊 Cost Distribution: Normal vs Anomalous", "half"),
    "boxplot": ("📦 Box Plot: Normal vs Anomalous", "half"),
    "savings": ("💰 Savings: Total Spend vs Cleaned Spend", "full"),
}

chart_html_parts = []
in_row = False
for key, plot_html in figures_html:
    title, size = sections[key]
    cls = "chart-full" if size == "full" else "chart-half"
    if size == "full":
        if in_row:
            chart_html_parts.append("</div>")
            in_row = False
        chart_html_parts.append(f'<div class="{cls}"><h3>{title}</h3>{plot_html}</div>')
    else:
        if not in_row:
            chart_html_parts.append('<div class="chart-row">')
            in_row = True
        chart_html_parts.append(f'<div class="{cls}"><h3>{title}</h3>{plot_html}</div>')
        # close row after every 2 halves
        # Check if next is also half or end
        idx = [k for k,_ in figures_html].index(key)
        next_size = None
        if idx + 1 < len(figures_html):
            next_key = figures_html[idx+1][0]
            next_size = sections[next_key][1]
        if next_size != "half" or not in_row:
            pass
        # Simple: close row every 2nd half
if in_row:
    chart_html_parts.append("</div>")

# Simpler approach: just pair them up
chart_html_parts = []
i = 0
figs_list = figures_html
while i < len(figs_list):
    key, plot_html = figs_list[i]
    title, size = sections[key]
    if size == "full":
        chart_html_parts.append(f'<div class="chart-full"><h3>{title}</h3>{plot_html}</div>')
        i += 1
    else:
        chart_html_parts.append('<div class="chart-row">')
        chart_html_parts.append(f'<div class="chart-half"><h3>{title}</h3>{plot_html}</div>')
        if i + 1 < len(figs_list):
            k2, p2 = figs_list[i+1]
            t2, s2 = sections[k2]
            if s2 == "half":
                chart_html_parts.append(f'<div class="chart-half"><h3>{t2}</h3>{p2}</div>')
                i += 2
            else:
                chart_html_parts.append("</div>")
                i += 1
                continue
        else:
            i += 1
        chart_html_parts.append("</div>")

charts_combined = "\n".join(chart_html_parts)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FinOps Anomaly Detection Dashboard</title>
<meta name="description" content="Interactive FinOps anomaly detection dashboard with Isolation Forest ML model on 60K cloud cost records across AWS, Azure, and GCP.">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Inter', sans-serif; background: {COLORS['bg']};
    color: {COLORS['text']}; min-height: 100vh;
  }}
  .dashboard {{ max-width: 1440px; margin: 0 auto; padding: 24px; }}
  header {{
    text-align: center; padding: 36px 20px 28px;
    background: linear-gradient(135deg, rgba(6,182,212,0.12), rgba(139,92,246,0.12));
    border-radius: 16px; margin-bottom: 28px;
    border: 1px solid rgba(255,255,255,0.06);
  }}
  header h1 {{
    font-size: 2.2rem; font-weight: 800;
    background: linear-gradient(135deg, #06b6d4, #8b5cf6, #f59e0b);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }}
  header p {{ color: #94a3b8; margin-top: 8px; font-size: 0.95rem; }}
  .badge {{
    display: inline-block; padding: 4px 12px; border-radius: 20px;
    font-size: 0.75rem; font-weight: 600; margin: 4px;
    background: rgba(6,182,212,0.15); color: #06b6d4;
  }}
  .badge.if {{ background: rgba(139,92,246,0.15); color: #8b5cf6; }}
  .kpi-grid {{
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px; margin-bottom: 28px;
  }}
  .kpi-card {{
    background: {COLORS['card']}; border-radius: 12px; padding: 20px;
    border: 1px solid rgba(255,255,255,0.06);
    transition: transform 0.2s, box-shadow 0.2s;
  }}
  .kpi-card:hover {{
    transform: translateY(-3px);
    box-shadow: 0 8px 25px rgba(6,182,212,0.15);
  }}
  .kpi-label {{ font-size: 0.8rem; color: #64748b; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }}
  .kpi-value {{ font-size: 1.8rem; font-weight: 700; margin: 6px 0; color: #06b6d4; }}
  .kpi-sub {{ font-size: 0.8rem; color: #64748b; }}
  .kpi-danger .kpi-value {{ color: #ef4444; }}
  .kpi-warning .kpi-value {{ color: #f59e0b; }}
  .chart-full, .chart-half {{
    background: {COLORS['card']}; border-radius: 12px; padding: 20px;
    margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.06);
  }}
  .chart-full h3, .chart-half h3 {{
    font-size: 1rem; font-weight: 600; margin-bottom: 12px; color: #cbd5e1;
  }}
  .chart-row {{
    display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;
  }}
  .chart-row .chart-half {{ margin-bottom: 0; }}
  @media (max-width: 900px) {{
    .chart-row {{ grid-template-columns: 1fr; }}
    .kpi-grid {{ grid-template-columns: repeat(2, 1fr); }}
  }}
  footer {{
    text-align: center; padding: 24px; color: #475569; font-size: 0.8rem;
    border-top: 1px solid rgba(255,255,255,0.06); margin-top: 20px;
  }}
</style>
</head>
<body>
<div class="dashboard">
  <header>
    <h1>FinOps Anomaly Detection Dashboard</h1>
    <p>Cloud Cost Intelligence — ML-Powered Anomaly Detection & Spend Analysis</p>
    <div>
      <span class="badge">🗂️ {len(df):,} Records</span>
      <span class="badge if">🤖 Isolation Forest (100 Trees)</span>
      <span class="badge">☁️ AWS · Azure · GCP</span>
      <span class="badge" style="background:rgba(239,68,68,0.15);color:#ef4444;">⚠️ {n_anom:,} Anomalies</span>
    </div>
  </header>
  {kpi_cards_html}
  {charts_combined}
  <footer>
    FinOps Anomaly Detection Dashboard · Isolation Forest (contamination=5%, 100 estimators) ·
    Generated from {len(df):,} billing records · {date_range}
  </footer>
</div>
</body>
</html>"""

# ══════════════════════════════════════════════════════════════════════════════
#  6. SAVE
# ══════════════════════════════════════════════════════════════════════════════
out_path = os.path.join(os.path.dirname(__file__), "finops_dashboard.html")
print(f"[6/6] Writing dashboard → {out_path}")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)
print(f"\n  ✅ Dashboard saved!  Open {out_path} in a browser.\n")
print(f"  📊 Dataset:    {len(df):,} rows")
print(f"  ⚠️  Anomalies:  {n_anom:,} ({n_anom/len(df)*100:.1f}%)")
print(f"  💰 Total Spend: ${total_spend:,.0f}")
print(f"  💸 Savings:     ${anomaly_spend:,.0f} ({savings_pct:.1f}%)")
