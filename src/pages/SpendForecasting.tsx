import React, { useEffect, useState, useCallback } from 'react';
import { Lightbulb, AlertCircle, Clock, Loader2, RefreshCw, Play } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { api } from '../data/api';
import type { ForecastResponse, BudgetItem } from '../data/api';
import styles from './SpendForecasting.module.css';

const HORIZON_OPTIONS = [7, 30, 90] as const;
type Horizon = typeof HORIZON_OPTIONS[number];

/* ─── Custom tooltip ────────────────────────────────────────────── */
const ForecastTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-cyan)',
      borderRadius: 10, padding: '10px 14px', fontSize: '0.8rem', minWidth: 140,
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>{label}</div>
      {payload.filter((p: any) => p.value !== undefined).map((p: any) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
          <span style={{ color: p.stroke ?? p.fill, fontSize: '0.75rem' }}>{p.name}</span>
          <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            ${p.value?.toLocaleString() ?? '—'}
          </strong>
        </div>
      ))}
    </div>
  );
};

/* ─── Progress bar ──────────────────────────────────────────────── */
const ProgressBar = ({ pct, color }: { pct: number; color: string }) => (
  <div className={styles.progressTrack}>
    <div
      className={styles.progressFill}
      style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}55` }}
    />
  </div>
);

/* ════════════════════ COMPONENT ════════════════════════════════════ */
const SpendForecasting: React.FC = () => {
  const [forecast,  setForecast] = useState<ForecastResponse | null>(null);
  const [budgets,   setBudgets]  = useState<BudgetItem[]>([]);
  const [horizon,   setHorizon]  = useState<Horizon>(30);
  const [loading,   setLoading]  = useState(true);
  const [error,     setError]    = useState<string | null>(null);
  const [running,   setRunning]  = useState(false);
  const [runMsg,    setRunMsg]   = useState<string | null>(null);

  const load = useCallback(async (h: Horizon = horizon) => {
    setLoading(true); setError(null);
    try {
      const [fc, bdg] = await Promise.all([api.forecast(h), api.budgets()]);
      setForecast(fc);
      setBudgets(bdg.items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [horizon]);

  useEffect(() => { load(horizon); }, [horizon]);

  const handleRunForecast = async () => {
    setRunning(true); setRunMsg(null);
    try {
      const res = await api.runForecast();
      setRunMsg(res.message);
      setTimeout(() => { load(horizon); setRunMsg(null); }, 8000);
    } catch (e) { console.error(e); }
    finally { setTimeout(() => setRunning(false), 8000); }
  };

  if (loading) return (
    <div className="loader-screen">
      <Loader2 size={20} className="spin" style={{ color: 'var(--violet)' }} />
      Loading forecasts…
    </div>
  );

  if (error) return (
    <div className="error-block">
      <strong>API Error:</strong> {error}
      <br /><small>Run: <code>python api.py</code></small>
    </div>
  );

  const fc = forecast!;

  const chartData = [
    ...fc.historical.map(h => ({ name: h.name, actual: h.actual, p50: undefined, p10: undefined, p90: undefined })),
    ...fc.series.map(s => ({ name: s.name, actual: undefined, p50: s.p50, p10: s.p10, p90: s.p90 })),
  ];

  // Split index for reference line
  const splitIdx = fc.historical.length;
  const splitName = chartData[splitIdx]?.name;

  const breachRisks = budgets
    .filter(b => b.utilization_pct >= 75)
    .sort((a, b) => b.utilization_pct - a.utilization_pct);

  const projectedEOM = fc.projected_end_of_period;
  const projectedLabel = projectedEOM >= 1_000_000
    ? `$${(projectedEOM / 1_000_000).toFixed(2)}M`
    : `$${projectedEOM.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className={styles.page}>

      {/* ── Page Header ───────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <div className={styles.pageEyebrow}>Ensemble ML · Prophet + LightGBM</div>
          <h1 className={styles.pageTitle}>Spend Forecasting</h1>
          <div className={styles.pageMeta}>
            <span className={styles.highlightMeta}>AI-driven predictions</span>
            <span>·</span>
            <span>Live from finops.db</span>
          </div>
        </div>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.horizonGroup}>
          {HORIZON_OPTIONS.map(h => (
            <button
              key={h}
              className={`${styles.horizonBtn} ${horizon === h ? styles.active : ''}`}
              onClick={() => setHorizon(h)}
            >
              {h}-day
            </button>
          ))}
        </div>

        <button onClick={() => load(horizon)} className={styles.btnGhost}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button onClick={handleRunForecast} disabled={running} className={styles.btnPrimary}>
          {running
            ? <><Loader2 size={13} className="spin" /> Running…</>
            : <><Play size={13} /> Re-run Forecasting</>}
        </button>
        {runMsg && <span className={styles.runMsg}>{runMsg}</span>}
      </div>

      {/* ── Main Forecast card ────────────────────────────────────── */}
      <div className={styles.mainCard}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleGroup}>
            <div className={styles.cardTitle}>Projected Daily Spend — {horizon}-Day Horizon</div>
            <div className={styles.cardSubtitle}>
              Prophet + LightGBM quantile regression · p10 / p50 / p90 bands
            </div>
          </div>
          <div className={styles.spendKpi}>
            <div className={styles.spendValue}>{projectedLabel}</div>
            <div className={styles.spendLabel}>End-of-period P50</div>
          </div>
        </div>

        {/* Chart legend */}
        <div className={styles.chartLegend}>
          <div className={styles.legendItem}>
            <div className={styles.legendLine} style={{ background: 'var(--cyan-primary)' }} />
            Actual
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendDash} style={{ borderColor: 'var(--text-muted)' }} />
            P50 Forecast
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendDash} style={{ borderColor: 'var(--violet)' }} />
            P90 Band
          </div>
        </div>

        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--cyan-primary)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--cyan-primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradP90" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8B5CF6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                dy={8}
                interval="preserveStartEnd"
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                width={46}
              />
              <Tooltip content={<ForecastTip />} />
              {splitName && (
                <ReferenceLine
                  x={splitName}
                  stroke="rgba(255,255,255,0.15)"
                  strokeDasharray="4 2"
                  label={{ value: 'NOW', position: 'top', fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }}
                />
              )}
              <Area type="monotone" dataKey="p90"    name="P90 Band"     stroke="#8B5CF6" strokeWidth={1.5} strokeDasharray="4 3" fill="url(#gradP90)"    fillOpacity={1} connectNulls />
              <Area type="monotone" dataKey="p50"    name="P50 Forecast" stroke="var(--text-muted)" strokeWidth={2} strokeDasharray="6 3" fill="none" connectNulls />
              <Area type="monotone" dataKey="actual" name="Actual"        stroke="var(--cyan-primary)" strokeWidth={2.5} fill="url(#gradActual)" fillOpacity={1} connectNulls
                style={{ filter: 'drop-shadow(0 0 6px rgba(6,182,212,0.4))' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* AI Observation */}
        <div className={styles.aiObservation}>
          <div className={styles.obsIconWrap}>
            <Lightbulb size={18} />
          </div>
          <div className={styles.obsText}>
            <strong style={{ color: 'var(--cyan-lite)' }}>AI Observation:</strong>{' '}
            {horizon}-day ensemble forecast projects daily spend ending at{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{projectedLabel}</strong>.{' '}
            {breachRisks.length > 0
              ? `${breachRisks.length} team(s) approaching budget limits: ${breachRisks.slice(0, 3).map(b => `${b.team} (${b.utilization_pct.toFixed(0)}%)`).join(', ')}.`
              : 'All teams are within budget thresholds — no immediate action required.'}
          </div>
        </div>
      </div>

      {/* ── Bottom Grid ───────────────────────────────────────────── */}
      <div className={styles.bottomGrid}>

        {/* Budget Status */}
        <div className={styles.subCard}>
          <div className={styles.subCardTitle}>Team Budget Status (MTD)</div>
          <div className={styles.subCardSubtitle}>Actual vs monthly budget · Real-time</div>
          {budgets.map(b => {
            const pct   = Math.min(100, b.utilization_pct);
            const color = pct >= 100 ? 'var(--alert-red)' : pct >= 80 ? 'var(--amber)' : 'var(--cyan-primary)';
            return (
              <div key={b.team} className={styles.budgetRow}>
                <div className={styles.budgetRowHeader}>
                  <span className={styles.budgetTeam}>{b.team}</span>
                  <div className={styles.budgetValues}>
                    <span style={{ color }}>
                      ${(b.actual_mtd / 1000).toFixed(1)}k / ${(b.budget / 1000).toFixed(0)}k
                      &nbsp;({b.utilization_pct.toFixed(0)}%)
                    </span>
                    {b.status !== 'OK' && (
                      <span className={styles.statusTag} style={{ background: color }}>
                        {b.status}
                      </span>
                    )}
                  </div>
                </div>
                <ProgressBar pct={pct} color={color} />
              </div>
            );
          })}
        </div>

        {/* Forecast Events */}
        <div className={styles.subCard}>
          <div className={styles.subCardTitle}>Forecast Events</div>
          <div className={styles.subCardSubtitle}>Budget breach predictions</div>

          {breachRisks.slice(0, 3).map(b => (
            <div key={b.team} className={styles.eventItem}>
              <div className={`${styles.eventIconWrap} ${styles.eventIconAlert}`}>
                <AlertCircle size={16} />
              </div>
              <div className={styles.eventContent}>
                <div className={styles.eventTitle}>Forecast Breach Risk</div>
                <div className={styles.eventDesc}>
                  {b.team} — {b.utilization_pct.toFixed(0)}% of budget used
                  {b.projected_eom ? ` · EOM p50: $${b.projected_eom.toLocaleString()}` : ''}
                </div>
              </div>
            </div>
          ))}

          {breachRisks.length === 0 && (
            <div className={styles.eventItem}>
              <div className={`${styles.eventIconWrap} ${styles.eventIconClock}`}>
                <Clock size={16} />
              </div>
              <div className={styles.eventContent}>
                <div className={styles.eventTitle}>All Teams On Budget</div>
                <div className={styles.eventDesc}>No breach risks detected for this period.</div>
              </div>
            </div>
          )}

          <div className={styles.eventItem}>
            <div className={`${styles.eventIconWrap} ${styles.eventIconClock}`}>
              <Clock size={16} />
            </div>
            <div className={styles.eventContent}>
              <div className={styles.eventTitle}>Next Forecast Refresh</div>
              <div className={styles.eventDesc}>Re-run Phase 3 forecasting to update projections</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpendForecasting;
