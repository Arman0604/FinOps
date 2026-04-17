import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  TrendingUp, CheckCircle, AlertTriangle, Activity,
  GitBranch, Sparkles, BarChart2, RefreshCw, Loader2, Cpu, DollarSign, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { api } from '../data/api';
import type { SummaryResponse, DetectionStatus } from '../data/api';
import styles from './CommandCenter.module.css';

/* ─── Custom bar tooltip ─────────────────────────────────────────── */
const BarTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-cyan)',
      borderRadius: 10, padding: '10px 14px', fontSize: '0.8rem',
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.fill, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: 'inline-block' }} />
          {p.name}: <strong style={{ color: 'var(--text-primary)', marginLeft: 2 }}>${p.value?.toLocaleString() ?? '—'}</strong>
        </div>
      ))}
    </div>
  );
};

/* ─── Animated progress bar ─────────────────────────────────────── */
const ProgressBar = ({ pct, color }: { pct: number; color: string }) => (
  <div className={styles.progressTrack}>
    <div
      className={styles.progressFill}
      style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}55` }}
    />
  </div>
);

/* ════════════════════════ COMPONENT ════════════════════════════════ */
const CommandCenter: React.FC = () => {
  const [data,    setData]    = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [detStatus, setDetStatus] = useState<DetectionStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api.summary()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Stop polling when detection finishes
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const handleRunDetection = async () => {
    if (running) return;
    setRunning(true);
    setDetStatus(null);
    try {
      await api.runDetection();
      // Poll status every 2 seconds
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.detectionStatus();
          setDetStatus(s);
          if (!s.running) {
            stopPolling();
            setRunning(false);
            // Reload dashboard data now that anomalies are updated
            await load();
          }
        } catch {
          stopPolling();
          setRunning(false);
        }
      }, 2000);
    } catch (e) {
      console.error(e);
      setRunning(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  if (loading) return (
    <div className="loader-screen">
      <Loader2 size={20} className="spin" style={{ color: 'var(--cyan-primary)' }} />
      Loading live data…
    </div>
  );

  if (error) return (
    <div className="error-block">
      <strong>API Error:</strong> {error}
      <br /><small>Make sure the API is running: <code>python api.py</code></small>
    </div>
  );

  const d = data!;
  const topAnomaly = d.anomalies.count > 0 ? d.anomalies.severity : 'All clear';

  const metrics = [
    {
      title: 'Total Spend (MTD)',
      value: d.totalSpend.value,
      sub: d.totalSpend.trend,
      subClass: styles.metricTrend,
      SubIcon: TrendingUp,
      Icon: DollarSign,
      iconBg: 'rgba(6,182,212,0.12)',
      iconColor: 'var(--cyan-lite)',
      accent: 'accentCyan',
    },
    {
      title: 'Savings Opportunities',
      value: d.savings.value,
      sub: `${d.savings.active} active anomalies`,
      subClass: styles.metricActive,
      SubIcon: CheckCircle,
      Icon: Zap,
      iconBg: 'rgba(16,185,129,0.12)',
      iconColor: 'var(--emerald)',
      accent: 'accentGreen',
    },
    {
      title: 'Active Anomalies',
      value: d.anomalies.count < 10 ? `0${d.anomalies.count}` : `${d.anomalies.count}`,
      sub: topAnomaly,
      subClass: styles.metricAlert,
      SubIcon: AlertTriangle,
      Icon: Cpu,
      iconBg: 'rgba(239,68,68,0.1)',
      iconColor: 'var(--alert-red)',
      accent: 'accentRed',
    },
  ];

  return (
    <div className={styles.page}>

      {/* ── Page header ───────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <div className={styles.pageEyebrow}>Security &amp; Cost Intelligence</div>
          <h1 className={styles.pageTitle}>Command Center</h1>
        </div>
        <div className={styles.pageActions}>
          <button onClick={load} className={styles.btnGhost}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button onClick={handleRunDetection} disabled={running} className={styles.btnPrimary}>
            {running
              ? <><Loader2 size={13} className="spin" /> Running…</>
              : <><Activity size={13} /> Re-run Detection</>}
          </button>
        </div>
      </div>

      {/* ── Detection progress panel ────────────────────────────────── */}
      {(running || (detStatus && detStatus.step !== 'idle')) && (() => {
        const STEPS = [
          { n: 1, label: 'Loading billing data from database',    icon: '⬡' },
          { n: 2, label: 'Running Z-Score + STL detector',         icon: '⬡' },
          { n: 3, label: 'Training Isolation Forest (100 trees)',   icon: '⬡' },
          { n: 4, label: 'Bulk-saving anomalies to database',       icon: '⬡' },
          { n: 5, label: 'Computing SHAP for top 50 anomalies',     icon: '⬡' },
        ];
        const cur   = detStatus?.step_num ?? 0;
        const total = detStatus?.total_steps ?? 5;
        const pct   = Math.round((cur / total) * 100);
        const done  = !running && !detStatus?.error;
        const failed = !!detStatus?.error;

        return (
          <div className={styles.detPanel}>

            {/* ── Header row ─────────────────────────── */}
            <div className={styles.detHeader}>
              <div className={styles.detHeaderLeft}>
                {running
                  ? <Loader2 size={14} className="spin" style={{ color: 'var(--cyan-primary)' }} />
                  : done
                    ? <CheckCircle size={14} style={{ color: '#22C55E' }} />
                    : <AlertTriangle size={14} style={{ color: 'var(--alert-red)' }} />
                }
                <span className={styles.detTitle}>
                  {running ? 'ANOMALY DETECTION · RUNNING' : done ? 'DETECTION COMPLETE' : 'DETECTION FAILED'}
                </span>
              </div>
              <div className={styles.detHeaderRight}>
                {running && (
                  <span className={styles.detStepBadge}>{cur}/{total}</span>
                )}
                {!running && (
                  <button className={styles.detDismiss} onClick={() => setDetStatus(null)}>✕</button>
                )}
              </div>
            </div>

            {/* ── Master progress bar ─────────────────── */}
            <div className={styles.detMasterTrack}>
              <div
                className={styles.detMasterFill}
                style={{
                  width: `${pct}%`,
                  background: failed
                    ? 'var(--alert-red)'
                    : done
                      ? '#22C55E'
                      : 'linear-gradient(90deg, #06b6d4, #818cf8)',
                  boxShadow: done ? '0 0 12px rgba(34,197,94,0.4)' : '0 0 12px rgba(6,182,212,0.35)',
                }}
              />
            </div>

            {/* ── Step timeline ───────────────────────── */}
            <div className={styles.detSteps}>
              {STEPS.map(s => {
                const isDone    = cur > s.n || (done && cur === s.n) || (done);
                const isActive  = running && cur === s.n;
                const isPending = !isDone && !isActive;
                return (
                  <div key={s.n} className={`${styles.detStep} ${isDone ? styles.detStepDone : isActive ? styles.detStepActive : styles.detStepPending}`}>
                    <div className={styles.detStepIconWrap}>
                      {isDone
                        ? <CheckCircle size={12} />
                        : isActive
                          ? <Loader2 size={12} className="spin" />
                          : <div className={styles.detStepDot} />
                      }
                      {s.n < STEPS.length && <div className={styles.detStepLine} />}
                    </div>
                    <div className={styles.detStepBody}>
                      <span className={styles.detStepNum}>STEP {s.n}</span>
                      <span className={styles.detStepLabel}>{s.label}</span>
                    </div>
                    {isActive && (
                      <span className={styles.detStepRunningBadge}>running</span>
                    )}
                    {isDone && !running && (
                      <span className={styles.detStepDoneBadge}>done</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Live count / result footer ──────────── */}
            {running && detStatus && detStatus.live_count > 0 && (
              <div className={styles.detLiveRow}>
                <span className={styles.detLiveDot} />
                <span className={styles.detLiveNum}>{detStatus.live_count.toLocaleString()}</span>
                <span className={styles.detLiveLabel}>anomalies detected so far</span>
              </div>
            )}
            {done && detStatus && detStatus.last_count > 0 && (
              <div className={styles.detResultRow}>
                <Zap size={11} style={{ color: '#F59E0B' }} />
                <span><strong>{detStatus.last_count.toLocaleString()}</strong> anomalies saved to database · dashboard refreshed</span>
              </div>
            )}
            {failed && (
              <div className={styles.detErrorRow}>
                <AlertTriangle size={11} />
                <span>{detStatus?.error}</span>
              </div>
            )}

          </div>
        );
      })()}

      {/* ── KPI metrics ───────────────────────────────────────────── */}

      <div className={styles.metricsRow}>
        {metrics.map((m, i) => (
          <div
            key={m.title}
            className={`${styles.metricCard} ${styles[m.accent]}`}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div
              className={styles.metricIconWrapper}
              style={{ background: m.iconBg }}
            >
              <m.Icon size={18} style={{ color: m.iconColor }} />
            </div>
            <div className={styles.metricTitle}>{m.title}</div>
            <div className={styles.metricValue}>{m.value}</div>
            <div className={`${styles.metricSub} ${m.subClass}`}>
              <m.SubIcon size={13} /> {m.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── Pipeline flow ──────────────────────────────────────────── */}
      <div className={styles.commandBlock}>
        <div className={styles.commandBlockHeader}>
          <div className={styles.commandBlockTitle}>
            <Activity size={16} style={{ color: 'var(--cyan-lite)' }} />
            <span className={styles.commandBlockTitleText}>Detection Pipeline</span>
            <span className={styles.commandBlockBadge}>LIVE</span>
          </div>
          <div className={styles.commandBlockMeta}>
            {d.anomalies.count} anomalies · {d.savings.active} flagged
          </div>
        </div>

        <div className={styles.pipeline}>
          {/* Node 1 */}
          <div className={styles.pipelineNode}>
            <div className={`${styles.pipelineIconBox} ${styles.alert}`}>
              <AlertTriangle size={22} />
            </div>
            <div className={styles.pipelineNodeLabel}>Anomaly</div>
            <div className={styles.pipelineNodeValue}>{d.anomalies.count} flagged</div>
          </div>

          <div className={styles.pipelineArrow} />

          {/* Node 2 */}
          <div className={styles.pipelineNode}>
            <div className={`${styles.pipelineIconBox} ${styles.cyan}`}>
              <Activity size={22} />
            </div>
            <div className={styles.pipelineNodeLabel}>Classification</div>
            <div className={styles.pipelineNodeValue}>Z-score + Isolation Forest</div>
          </div>

          <div className={styles.pipelineArrow} />

          {/* Node 3 */}
          <div className={styles.pipelineNode}>
            <div className={`${styles.pipelineIconBox} ${styles.violet}`}>
              <GitBranch size={22} />
            </div>
            <div className={styles.pipelineNodeLabel}>Root Cause</div>
            <div className={styles.pipelineNodeValue}>SHAP attribution</div>
          </div>

          <div className={styles.pipelineArrow} />

          {/* AI Result */}
          <div className={styles.aiRecCard}>
            <div className={styles.aiRecTitle}>
              <Sparkles size={13} /> AI Analysis
            </div>
            <div className={styles.aiRecBody}>
              <strong style={{ color: 'var(--text-primary)' }}>{d.savings.value}</strong> in anomalies detected.
              Top severity: <strong style={{ color: 'var(--alert-red)' }}>{d.anomalies.severity}</strong>.
              {d.totalSpend.trend.startsWith('+') && ' Spend is trending up — review flagged services.'}
            </div>
            <button className={styles.aiRecBtn} onClick={() => window.location.href = '/anomaly-watch'}>
              View Anomalies →
            </button>
          </div>
        </div>
      </div>

      {/* ── Bottom grid ────────────────────────────────────────────── */}
      <div className={styles.bottomGrid}>

        {/* Spend Forecast Bar Chart */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div className={styles.chartTitleGroup}>
              <div className={styles.chartTitle}>
                <BarChart2 size={17} style={{ color: 'var(--cyan-lite)' }} />
                Spend Forecast Intelligence
              </div>
              <div className={styles.chartSubtitle}>Weekly actual vs ML-predicted spend · side-by-side</div>
            </div>
            <div className={styles.legend}>
              <div className={styles.legendItem}>
                <div className={styles.legendDot} style={{ background: '#475569', borderRadius: 2 }} />
                Actual
              </div>
              <div className={styles.legendItem}>
                <div className={styles.legendDot} style={{ background: 'var(--cyan-primary)', borderRadius: 2 }} />
                Predicted
              </div>
            </div>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={d.spendForecast}
                barGap={2}
                barCategoryGap="28%"
                margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="barActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64748B" stopOpacity={1} />
                    <stop offset="100%" stopColor="#334155" stopOpacity={1} />
                  </linearGradient>
                  <linearGradient id="barPredicted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cyan-lite)" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--cyan-deep)" stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={48}
                />
                <Tooltip content={<BarTip />} cursor={{ fill: 'rgba(255,255,255,0.02)', radius: 4 }} />
                <Bar dataKey="actual"    name="Actual"    fill="url(#barActual)"    radius={[4,4,0,0]} barSize={14} />
                <Bar dataKey="predicted" name="Predicted" fill="url(#barPredicted)" radius={[4,4,0,0]} barSize={14}
                  style={{ filter: 'drop-shadow(0 -2px 6px rgba(6,182,212,0.35))' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Department Budget */}
        <div className={styles.smallCard}>
          <div className={styles.smallCardTitle}>Dept Budget vs Actual</div>
          {d.departmentBudget.map((dept, i) => {
            const pct = Math.min(100, (dept.actual / dept.budget) * 100);
            const color = pct >= 100 ? 'var(--alert-red)' : pct >= 80 ? 'var(--amber)' : 'var(--cyan-primary)';
            return (
              <div key={i} className={styles.budgetRow}>
                <div className={styles.budgetInfo}>
                  <span className={styles.budgetName}>{dept.name}</span>
                  <span className={styles.budgetNums}>
                    <strong>${(dept.actual / 1000).toFixed(0)}k</strong>
                    &nbsp;/ ${(dept.budget / 1000).toFixed(0)}k
                  </span>
                </div>
                <ProgressBar pct={pct} color={color} />
              </div>
            );
          })}
        </div>

        {/* Provider Distribution */}
        <div className={styles.smallCard}>
          <div className={styles.smallCardTitle}>Provider Distribution</div>
          <div className={styles.providerCard}>
            <div className={styles.providerList}>
              {d.providerBreakdown.map((p, i) => (
                <div key={i} className={styles.providerRow}>
                  <div className={styles.providerDot} style={{ background: p.fill, boxShadow: `0 0 6px ${p.fill}88` }} />
                  <span className={styles.providerName}>{p.name}</span>
                  <span className={styles.providerPct}>{p.value}%</span>
                </div>
              ))}
            </div>
            <div className={styles.pieWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={d.providerBreakdown}
                    innerRadius={36}
                    outerRadius={50}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {d.providerBreakdown.map((entry, i) => (
                      <Cell
                        key={`cell-${i}`}
                        fill={entry.fill}
                        style={{ filter: `drop-shadow(0 0 4px ${entry.fill}66)` }}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default CommandCenter;
