import React, { useEffect, useState, useCallback } from 'react';
import {
  GitMerge, Cloud, Server, Database, Activity,
  TrendingUp, Loader2, RefreshCw, Filter,
  AlertTriangle, Zap, Target, DollarSign,
} from 'lucide-react';
import { api } from '../data/api';
import type { AnomalyItem, AnomaliesResponse } from '../data/api';
import styles from './AnomalyWatch.module.css';

const SEV_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444',
  HIGH:     '#F97316',
  MEDIUM:   '#EAB308',
  LOW:      '#06B6D4',
};

/* ═══════════════ COMPONENT ═════════════════════════════════════════ */
const AnomalyWatch: React.FC = () => {
  const [data,     setData]     = useState<AnomaliesResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>('');
  const [selected, setSelected] = useState<AnomalyItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.anomalies(severity ? { severity, limit: 50 } : { limit: 50 });
      setData(res);
      if (res.items.length > 0 && !selected) setSelected(res.items[0]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [severity]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="loader-screen">
      <Loader2 size={20} className="spin" style={{ color: 'var(--alert-red)' }} />
      Loading anomalies…
    </div>
  );

  if (error) return (
    <div className="error-block">
      <strong>API Error:</strong> {error}
      <br /><small>Run: <code>python api.py</code></small>
    </div>
  );

  const d = data!;
  const focus = selected ?? (d.items[0] ?? null);

  const shapFactors = focus?.shap_factors
    ? Object.entries(focus.shap_factors)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 4)
    : [];
  const maxShap = shapFactors.length ? Math.max(...shapFactors.map(([, v]) => Math.abs(v))) : 1;

  /* ── Parsed service / team from focused anomaly ─────────────────── */
  const sevColor  = focus ? SEV_COLORS[focus.severity] : 'var(--alert-red)';
  const deviationPos = (focus?.deviation_pct ?? 0) > 0;

  /* signal bar heights & coloring for provider card */
  const signalHeights = [8, 14, 20, 18];
  const signalColors  = signalHeights.map((_, i) => {
    if (!focus) return 'rgba(255,255,255,0.12)';
    if (focus.severity === 'CRITICAL' && i >= 2) return 'var(--alert-red)';
    if (focus.severity === 'HIGH'     && i >= 3) return 'var(--amber)';
    return 'var(--cyan-primary)';
  });

  return (
    <div className={styles.page}>

      {/* ════════════════ HERO CARD ══════════════════════════════════ */}
      <div className={styles.heroCard}>
        <div className={styles.heroAccentBar} style={{ background: `linear-gradient(90deg, transparent 0%, ${sevColor} 30%, #F97316 60%, transparent 100%)` }} />

        {/* ── Eyebrow row ───────────────────────────────────────────── */}
        <div className={styles.heroBrow}>
          <span
            className={styles.severityBadge}
            style={{ background: sevColor, color: '#000' }}
          >
            <AlertTriangle size={11} strokeWidth={3} />
            {focus?.severity ?? 'NO'}&nbsp;ANOMALY
          </span>
          <div className={styles.heroDivider} />
          <span className={styles.detectedAt}>
            {focus?.detected_at
              ? `Detected ${new Date(focus.detected_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : 'No detection timestamp'}
          </span>
        </div>

        {/* ── Title ─────────────────────────────────────────────────── */}
        <h1 className={styles.heroTitle}>
          {focus ? (
            <>
              <span className={styles.heroTitleService}>{focus.service}</span>
              <span className={styles.heroTitleSep}>/</span>
              <span className={styles.heroTitleTeam}>{focus.team}</span>
            </>
          ) : (
            <span className={styles.heroTitleService}>No anomalies detected</span>
          )}
        </h1>

        {/* ── Description ───────────────────────────────────────────── */}
        <p className={styles.heroDesc}>
          {focus?.description ?? 'Run anomaly detection to populate this view.'}
        </p>

        {/* ════ 4 STAT BOXES ════════════════════════════════════════ */}
        <div className={styles.heroStats}>

          {/* 1 — Projected Drift */}
          <div className={`${styles.statBox} ${styles.statRed}`}>
            <div className={styles.statBoxIcon} style={{ background: 'rgba(239,68,68,0.12)' }}>
              <DollarSign size={14} style={{ color: 'var(--alert-red)' }} />
            </div>
            <div className={styles.statLabel}>Projected Drift</div>
            <div className={styles.statValue}>
              {focus
                ? `+$${focus.projected_monthly_drift.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </div>
            <div className={styles.statSub}>per month · rolling estimate</div>
          </div>

          {/* 2 — Detected Delta */}
          <div className={`${styles.statBox} ${deviationPos ? styles.statRed : styles.statCyan}`}>
            <div className={styles.statBoxIcon} style={{ background: 'rgba(239,68,68,0.1)' }}>
              <TrendingUp size={14} style={{ color: deviationPos ? 'var(--alert-red)' : 'var(--cyan-lite)' }} />
            </div>
            <div className={styles.statLabel}>Detected Delta</div>
            <div className={styles.statValue}>
              {focus ? `${deviationPos ? '+' : ''}${focus.deviation_pct.toFixed(1)}%` : '—'}
            </div>
            <div className={styles.statSub}>vs rolling baseline</div>
          </div>

          {/* 3 — Provider */}
          <div className={`${styles.statBox} ${styles.statCyan}`}>
            <div className={styles.statBoxIcon} style={{ background: 'rgba(6,182,212,0.1)' }}>
              <Cloud size={14} style={{ color: 'var(--cyan-lite)' }} />
            </div>
            <div className={styles.statLabel}>Provider</div>
            <div className={styles.statValue} style={{ fontSize: '1.25rem', letterSpacing: 1 }}>
              {focus?.provider.toUpperCase() ?? '—'}
            </div>
            <div className={styles.signalBars}>
              {signalHeights.map((h, i) => (
                <div
                  key={i}
                  className={styles.signalBar}
                  style={{ height: `${h}px`, background: signalColors[i] }}
                />
              ))}
            </div>
          </div>

          {/* 4 — Action Priority */}
          <div
            className={`${styles.statBox} ${
              focus?.severity === 'CRITICAL' || focus?.severity === 'HIGH'
                ? styles.statRed
                : focus?.severity === 'MEDIUM'
                ? styles.statAmber
                : styles.statCyan
            }`}
          >
            <div className={styles.statBoxIcon} style={{ background: `${sevColor}18` }}>
              <Target size={14} style={{ color: sevColor }} />
            </div>
            <div className={styles.statLabel}>Action Priority</div>
            <div className={styles.statValue} style={{ color: sevColor }}>
              {focus?.severity ?? 'None'}
            </div>
            <div className={styles.statSub}>
              {focus ? `Detector: ${focus.detector}` : 'All clear'}
            </div>
          </div>

        </div>
      </div>

      {/* ════════════════ FILTER BAR ═════════════════════════════════ */}
      <div className={styles.filterBar}>
        <Filter size={13} className={styles.filterIcon} />
        <span className={styles.filterLabel}>Severity</span>
        {['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => (
          <button
            key={s}
            className={`${styles.filterChip} ${severity === s ? styles.chipActive : ''}`}
            style={
              severity === s
                ? { background: SEV_COLORS[s] ?? 'var(--cyan-primary)', color: '#000', borderColor: 'transparent' }
                : {}
            }
            onClick={() => setSeverity(s)}
          >
            {s || 'ALL'}
          </button>
        ))}
        <span className={styles.filterSpacer} />
        <span className={styles.filterTotal}>{d.total} anomalies</span>
        <button onClick={load} className={styles.btnGhost}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* ════════════════ ROOT CAUSE VIZ ════════════════════════════ */}
      {focus && (
        <div className={styles.vizCard}>
          <div className={styles.vizHeader}>
            <GitMerge size={14} />
            Root Cause Visualization — {focus.service}
          </div>
          <div className={styles.vizBody}>
            <div className={styles.graphArea}>

              <div className={styles.graphRow}>
                <div className={`${styles.graphNode} ${styles.nodeRoot}`}>
                  <Cloud size={22} className={styles.nodeIcon} />
                  <div>
                    <div className={styles.nodeLabel}>Provider</div>
                    <div className={styles.nodeName}>{focus.provider.toUpperCase()} · {focus.environment}</div>
                  </div>
                </div>
              </div>

              <div className={styles.connectorLine} />

              <div className={styles.graphRow}>
                <div className={styles.graphNode}>
                  <Server size={22} className={styles.nodeIcon} />
                  <div>
                    <div className={styles.nodeLabel}>Service</div>
                    <div className={styles.nodeName}>{focus.service}</div>
                  </div>
                </div>
                <div className={`${styles.graphNode} ${styles.nodeAlert}`}>
                  <Database size={22} className={styles.nodeIcon} />
                  <div>
                    <div className={styles.nodeLabel} style={{ color: sevColor }}>Anomaly Core</div>
                    <div className={styles.nodeName}>{focus.team} · {focus.anomaly_type}</div>
                  </div>
                </div>
              </div>

              {shapFactors.length > 0 && (
                <>
                  <div className={styles.connectorLine} />
                  <div className={styles.graphRow}>
                    <div className={styles.shapCard}>
                      <div className={styles.shapHeader}>
                        <Activity size={11} />
                        SHAP Root Cause Factors
                      </div>
                      {shapFactors.map(([k, v]) => {
                        const barPct   = (Math.abs(v) / maxShap) * 100;
                        const barColor = v < 0 ? 'var(--alert-red)' : 'var(--cyan-lite)';
                        return (
                          <div key={k}>
                            <div className={styles.shapRow}>
                              <span className={styles.shapKey}>{k}</span>
                              <span className={styles.shapVal} style={{ color: barColor }}>
                                {v > 0 ? '+' : ''}{v.toFixed(4)}
                              </span>
                            </div>
                            <div className={styles.shapTrack}>
                              <div
                                className={styles.shapFill}
                                style={{ width: `${barPct}%`, background: barColor, opacity: 0.75 }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ ANOMALY LIST ═══════════════════════════════ */}
      {d.items.length > 0 ? (
        <div className={styles.anomalyList}>
          {d.items.map(item => (
            <div
              key={item.id}
              className={`${styles.anomalyItem} ${selected?.id === item.id ? styles.selected : ''}`}
              onClick={() => setSelected(item)}
            >
              <span
                className={styles.anomalySeverityTag}
                style={{ background: SEV_COLORS[item.severity] ?? 'var(--bg-card)', color: '#000' }}
              >
                {item.severity}
              </span>

              <div className={styles.anomalyMeta}>
                <div className={styles.anomalyName}>
                  {item.service}
                  <span className={styles.anomalyNameSub}> · {item.team}</span>
                </div>
                <div className={styles.anomalyInfo}>
                  {item.date} · {item.provider.toUpperCase()} · {item.anomaly_type}
                </div>
              </div>

              <div className={styles.anomalyRight}>
                <div
                  className={styles.anomalyDeviation}
                  style={{ color: item.deviation_pct > 0 ? 'var(--alert-red)' : 'var(--cyan-primary)' }}
                >
                  {item.deviation_pct > 0 ? '+' : ''}{item.deviation_pct.toFixed(1)}%
                </div>
                <div className={styles.anomalyCost}>${item.cost_usd.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          No anomalies found. Try a different severity filter or re-run detection.
        </div>
      )}

    </div>
  );
};

export default AnomalyWatch;
