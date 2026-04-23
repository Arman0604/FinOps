import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, Activity, Loader2, CheckCircle2,
  AlertTriangle, RotateCcw, Zap, Database, TrendingUp,
  DollarSign, ArrowRight, Shield, BarChart2, ToggleLeft, ToggleRight,
  Cpu, GitMerge, Layers, Target,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { api } from '../data/api';
import type { UploadStatus, RecentAnomaly, SummaryResponse, UploadAnalytics } from '../data/api';
import styles from './DataUpload.module.css';
import VisualizationSection from '../components/VisualizationSection/VisualizationSection';

/* ── Colors ──────────────────────────────────────────────────────── */
const SEV_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444', HIGH: '#F97316', MEDIUM: '#EAB308', LOW: '#06B6D4',
};
const PROVIDER_COLORS: Record<string, string> = {
  AWS: '#06B6D4', AZURE: '#3B82F6', GCP: '#8B5CF6', OTHER: '#64748b',
};
const PIE_COLORS = ['#06B6D4', '#8B5CF6', '#F97316', '#22C55E', '#EAB308', '#EC4899', '#64748B', '#14B8A6'];
const SEV_PIE = ['#EF4444', '#F97316', '#EAB308', '#06B6D4'];

const STATUS_LABELS: Record<string, string> = {
  idle: 'Ready', validating: 'Validating', loading: 'Loading Data',
  detecting: 'Detecting', streaming: 'Streaming', complete: 'Complete', error: 'Error',
};

/* ── Custom Tooltip ──────────────────────────────────────────────── */
const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(10,15,25,0.95)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8, padding: '8px 12px', fontSize: '0.75rem',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 3, fontSize: '0.68rem' }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color || '#06b6d4', fontWeight: 700 }}>
          ${p.value?.toLocaleString()}
        </div>
      ))}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════
   DataUpload Component
   ════════════════════════════════════════════════════════════════════ */
const DataUpload: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus]       = useState<UploadStatus | null>(null);
  const [dragging, setDragging]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [prevCount, setPrevCount] = useState(0);
  const [pulse, setPulse]         = useState(false);
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [analytics, setAnalytics]     = useState<UploadAnalytics | null>(null);
  const [applyToDashboard, setApplyToDashboard] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ────────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.uploadStatus();
        setStatus(s);
        if (s.anomaly_count !== prevCount) {
          setPrevCount(s.anomaly_count);
          setPulse(true);
          setTimeout(() => setPulse(false), 800);
        }
        if (s.status === 'complete' || s.status === 'error' || s.status === 'idle') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          if (s.status === 'complete') {
            api.summary().then(setSummaryData).catch(() => {});
            api.uploadAnalytics().then(setAnalytics).catch(() => {});
            api.saveUploadHistory().catch(() => {});
          }
        }
      } catch { /* ignore */ }
    }, 500);
  }, [prevCount]);

  useEffect(() => {
    api.uploadStatus().then(s => {
      setStatus(s);
      if (s.status === 'complete') {
        api.summary().then(setSummaryData).catch(() => {});
        api.uploadAnalytics().then(setAnalytics).catch(() => {});
      }
      if (s.status !== 'idle' && s.status !== 'complete' && s.status !== 'error') {
        startPolling();
      }
    }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('Please upload a .csv file'); return; }
    setError(null);
    setAnalytics(null);
    setSummaryData(null);
    try { await api.uploadCSV(file); setPrevCount(0); startPolling(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Upload failed'); }
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); };
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; };

  const handleReset = async () => {
    try {
      await api.uploadReset();
      setStatus(null); setPrevCount(0); setError(null); setSummaryData(null); setAnalytics(null); setApplyToDashboard(true);
      const s = await api.uploadStatus(); setStatus(s);
    } catch { /* ignore */ }
  };

  // Derived
  const s = status;
  const isActive = s && !['idle', 'complete', 'error'].includes(s.status);
  const progressPct = s && s.total_rows > 0 ? Math.round((s.processed_rows / s.total_rows) * 100) : 0;
  const anomalies: RecentAnomaly[] = s?.recent_anomalies ?? [];
  const statusClass = s ? ({
    idle: styles.statusIdle, validating: styles.statusLoading, loading: styles.statusLoading,
    detecting: styles.statusDetecting, streaming: styles.statusStreaming,
    complete: styles.statusComplete, error: styles.statusError,
  }[s.status] ?? styles.statusIdle) : styles.statusIdle;

  const a = analytics;
  const ms = a?.model_stats;

  return (
    <div className={styles.page}>

      {/* ═══════════ PAGE HEADER ═══════════════════════════════════════ */}
      <div className={styles.pageHeader}>
        <div className={styles.pageIcon}><Upload size={18} /></div>
        <h1 className={styles.pageTitle}>Data Upload</h1>
        <span className={styles.pageSub}>Upload billing CSV • Real-time anomaly detection</span>
      </div>

      {/* ═══════════ UPLOAD ZONE ═══════════════════════════════════════ */}
      <div
        className={`${styles.uploadZone} ${dragging ? styles.uploadZoneDragging : ''} ${isActive ? styles.uploadZoneDisabled : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !isActive && inputRef.current?.click()}
      >
        <div className={styles.uploadIcon}>
          {isActive ? <Loader2 size={24} className={styles.spin} /> : <FileSpreadsheet size={24} />}
        </div>
        <div className={styles.uploadTitle}>{isActive ? 'Processing...' : 'Drop your billing CSV here'}</div>
        <div className={styles.uploadSub}>
          {isActive
            ? `Processing ${s?.filename ?? 'file'}...`
            : 'or click to browse. Required: date, provider, service, category, team, environment, region, cost_usd'}
        </div>
        {!isActive && <button className={styles.uploadBrowseBtn} type="button"><Upload size={13} /> Browse Files</button>}
        <div className={styles.uploadFormats}>Supported: .csv • UTF-8 encoded</div>
        <input ref={inputRef} type="file" accept=".csv" className={styles.hiddenInput} onChange={onFileChange} />
      </div>

      {/* ═══════════ ERROR ═════════════════════════════════════════════ */}
      {(error || s?.error) && (
        <div className={styles.errorBanner}><AlertTriangle size={16} />{error || s?.error}</div>
      )}

      {/* ═══════════ PROGRESS ═════════════════════════════════════════ */}
      {s && s.status !== 'idle' && (
        <div className={styles.progressCard}>
          <div className={styles.progressHeader}>
            <div className={styles.progressTitle}><Activity size={15} />Pipeline Progress</div>
            <div className={`${styles.statusBadge} ${statusClass}`}>
              {s.status === 'streaming' && <span className={styles.tableLiveDot} />}
              {s.status === 'complete' && <CheckCircle2 size={11} />}
              {STATUS_LABELS[s.status] ?? s.status}
            </div>
          </div>
          <div className={styles.progressBarWrap}>
            <div className={styles.progressBarFill} style={{
              width: ['complete','detecting','streaming'].includes(s.status) ? '100%' : `${progressPct}%`,
            }} />
          </div>
          <div className={styles.progressStats}>
            <span>Rows: <strong>{s.processed_rows.toLocaleString()} / {s.total_rows.toLocaleString()}</strong></span>
            <span>Progress: <strong>{s.status === 'complete' ? '100' : progressPct}%</strong></span>
            {s.started_at && <span>Started: <strong>{new Date(s.started_at).toLocaleTimeString()}</strong></span>}
            {s.completed_at && <span>Done: <strong>{new Date(s.completed_at).toLocaleTimeString()}</strong></span>}
          </div>
          {s.filename && <div className={styles.fileTag}><FileSpreadsheet size={11} />{s.filename}</div>}
        </div>
      )}

      {/* ═══════════ COUNTER CARDS ════════════════════════════════════ */}
      {s && s.status !== 'idle' && (
        <div className={styles.counterRow}>
          <div className={`${styles.counterCard} ${styles.counterCardRed}`}>
            <div className={styles.counterLabel}>Anomalies</div>
            <div className={`${styles.counterValue} ${styles.counterValueRed} ${pulse ? styles.counterPulse : ''}`}>{s.anomaly_count}</div>
            <div className={styles.counterSub}><Zap size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> detected</div>
          </div>
          <div className={`${styles.counterCard} ${styles.counterCardCyan}`}>
            <div className={styles.counterLabel}>Records</div>
            <div className={`${styles.counterValue} ${styles.counterValueCyan}`}>{s.total_rows.toLocaleString()}</div>
            <div className={styles.counterSub}><Database size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> billing rows</div>
          </div>
          <div className={`${styles.counterCard} ${styles.counterCardPurple}`}>
            <div className={styles.counterLabel}>Rate</div>
            <div className={`${styles.counterValue} ${styles.counterValuePurple}`}>
              {s.total_rows > 0 ? `${((s.anomaly_count / s.total_rows) * 100).toFixed(1)}%` : '—'}
            </div>
            <div className={styles.counterSub}><TrendingUp size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> anomaly ratio</div>
          </div>
        </div>
      )}

      {/* ═══════════ LIVE TABLE ═══════════════════════════════════════ */}
      {s && s.status !== 'idle' && (
        <div className={styles.tableCard}>
          <div className={styles.tableHeader}>
            {s.status === 'streaming' && <div className={styles.tableLiveDot} />}
            <Activity size={14} /> Live Anomaly Feed
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', opacity: 0.4 }}>Latest {anomalies.length}</span>
            {(s.status === 'complete' || s.status === 'error') && (
              <button className={styles.resetBtn} onClick={handleReset}><RotateCcw size={12} /> Reset</button>
            )}
          </div>
          <div className={styles.tableHead}>
            <span>Severity</span><span>Service</span><span>Team</span><span>Cost</span><span>Deviation</span><span>Date</span>
          </div>
          <div className={styles.tableBody}>
            {anomalies.length > 0 ? anomalies.map(a => (
              <div key={`${a.id}-${a.date}-${a.service}`} className={styles.tableRow}>
                <span><span className={styles.sevTag} style={{ background: SEV_COLORS[a.severity] ?? '#64748b' }}>{a.severity}</span></span>
                <span className={styles.cellService}>{a.service}</span>
                <span className={styles.cellTeam}>{a.team}</span>
                <span className={styles.cellCost}>${a.cost_usd.toLocaleString()}</span>
                <span className={`${styles.cellDeviation} ${a.deviation_pct > 0 ? styles.deviationUp : styles.deviationDown}`}>
                  {a.deviation_pct > 0 ? '+' : ''}{a.deviation_pct.toFixed(1)}%
                </span>
                <span className={styles.cellDate}>{a.date}</span>
              </div>
            )) : (
              <div className={styles.emptyTable}>
                {['streaming','detecting'].includes(s.status) ? 'Waiting for anomalies...' : s.status === 'complete' ? 'No anomalies detected.' : 'Upload a CSV to begin.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          ANALYTICS DASHBOARD — Shown after completion
          ═══════════════════════════════════════════════════════════════ */}
      {s && s.status === 'complete' && a && (
        <>
          {/* ── Section Header ───────────────────────────────────────── */}
          <div className={styles.vizSectionHeader}>
            <div className={styles.vizSectionIcon}><BarChart2 size={16} /></div>
            <div>
              <h2 className={styles.vizSectionTitle}>Analytics & Model Insights</h2>
              <p className={styles.vizSectionSub}>Visualizations from your uploaded dataset and anomaly detection pipeline</p>
            </div>
          </div>

          {/* ── Model Overview Cards ─────────────────────────────────── */}
          <div className={styles.modelRow}>
            <div className={`${styles.modelCard} ${styles.modelCardCyan}`}>
              <div className={styles.modelCardIcon}><Cpu size={18} /></div>
              <div className={styles.modelCardTitle}>Z-Score + STL</div>
              <div className={styles.modelCardDesc}>Statistical decomposition detecting seasonal & trend anomalies using rolling Z-score thresholds</div>
              <div className={styles.modelCardMeta}>
                <span className={styles.modelTag}>Statistical</span>
                <span className={styles.modelTag}>Unsupervised</span>
              </div>
            </div>
            <div className={`${styles.modelCard} ${styles.modelCardPurple}`}>
              <div className={styles.modelCardIcon}><GitMerge size={18} /></div>
              <div className={styles.modelCardTitle}>Isolation Forest</div>
              <div className={styles.modelCardDesc}>Tree-based ensemble isolating anomalous cost patterns in multi-dimensional feature space</div>
              <div className={styles.modelCardMeta}>
                <span className={styles.modelTag}>ML</span>
                <span className={styles.modelTag}>100 Trees</span>
              </div>
            </div>
            <div className={`${styles.modelCard} ${styles.modelCardGreen}`}>
              <div className={styles.modelCardIcon}><Layers size={18} /></div>
              <div className={styles.modelCardTitle}>Ensemble Merge</div>
              <div className={styles.modelCardDesc}>Multi-detector consensus combining both models for higher precision and fewer false positives</div>
              <div className={styles.modelCardMeta}>
                <span className={styles.modelTag}>Consensus</span>
                <span className={styles.modelTag}>{ms?.detection_rate}% Rate</span>
              </div>
            </div>
          </div>

          {/* ── Key Metrics Row ──────────────────────────────────────── */}
          <div className={styles.metricsRow}>
            {[
              { label: 'Total Spend', value: `$${(ms?.total_cost ?? 0).toLocaleString()}`, color: '#06b6d4', icon: <DollarSign size={14} /> },
              { label: 'Anomaly Cost', value: `$${(ms?.anomaly_cost ?? 0).toLocaleString()}`, color: '#f97316', icon: <AlertTriangle size={14} /> },
              { label: 'Potential Savings', value: `$${(ms?.savings ?? 0).toLocaleString()}`, color: '#22c55e', icon: <Zap size={14} /> },
              { label: 'Detection Rate', value: `${ms?.detection_rate ?? 0}%`, color: '#8b5cf6', icon: <Target size={14} /> },
            ].map(m => (
              <div key={m.label} className={styles.metricMini}>
                <div className={styles.metricMiniIcon} style={{ background: `${m.color}18`, color: m.color }}>{m.icon}</div>
                <div className={styles.metricMiniLabel}>{m.label}</div>
                <div className={styles.metricMiniValue} style={{ color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* ── Chart Grid ──────────────────────────────────────────── */}
          <div className={styles.chartGrid}>

            {/* Cost Trend */}
            <div className={`${styles.chartCard} ${styles.chartCardWide}`}>
              <div className={styles.chartCardHeader}><TrendingUp size={14} /> Daily Spend Trend</div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={a.cost_trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                      tickFormatter={v => v.slice(5)} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                      tickFormatter={v => `$${v}`} width={50} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="cost" stroke="#06b6d4" strokeWidth={2}
                      fill="url(#costGrad)" dot={{ r: 3, fill: '#06b6d4', stroke: '#0a0f19', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Provider Distribution */}
            <div className={styles.chartCard}>
              <div className={styles.chartCardHeader}><Layers size={14} /> Cost by Provider</div>
              <div className={styles.chartWrapSmall}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={a.cost_by_provider} innerRadius={40} outerRadius={60} paddingAngle={3}
                      dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
                      {a.cost_by_provider.map((e, i) => (
                        <Cell key={i} fill={PROVIDER_COLORS[e.name] ?? PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className={styles.pieLegend}>
                  {a.cost_by_provider.map((p, i) => (
                    <div key={p.name} className={styles.pieLegendItem}>
                      <div className={styles.pieLegendDot} style={{ background: PROVIDER_COLORS[p.name] ?? PIE_COLORS[i] }} />
                      <span className={styles.pieLegendName}>{p.name}</span>
                      <span className={styles.pieLegendVal}>${p.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Anomaly Severity */}
            <div className={styles.chartCard}>
              <div className={styles.chartCardHeader}><AlertTriangle size={14} /> Anomaly Severity</div>
              <div className={styles.chartWrapSmall}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={a.anomaly_by_severity} innerRadius={40} outerRadius={60} paddingAngle={3}
                      dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
                      {a.anomaly_by_severity.map((e, i) => (
                        <Cell key={i} fill={SEV_COLORS[e.name] ?? SEV_PIE[i % SEV_PIE.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className={styles.pieLegend}>
                  {a.anomaly_by_severity.map(sv => (
                    <div key={sv.name} className={styles.pieLegendItem}>
                      <div className={styles.pieLegendDot} style={{ background: SEV_COLORS[sv.name] }} />
                      <span className={styles.pieLegendName}>{sv.name}</span>
                      <span className={styles.pieLegendVal}>{sv.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Service Breakdown Bar */}
            <div className={`${styles.chartCard} ${styles.chartCardWide}`}>
              <div className={styles.chartCardHeader}><BarChart2 size={14} /> Top Services by Spend</div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={a.cost_by_service} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis type="number" axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                      tickFormatter={v => `$${v}`} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600 }}
                      width={120} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                    <Bar dataKey="value" name="Spend" radius={[0, 4, 4, 0]} barSize={18}>
                      {a.cost_by_service.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Team Breakdown */}
            <div className={styles.chartCard}>
              <div className={styles.chartCardHeader}><Database size={14} /> Spend by Team</div>
              <div className={styles.teamList}>
                {a.cost_by_team.map((t, i) => {
                  const maxVal = Math.max(...a.cost_by_team.map(x => x.value));
                  const pct = maxVal > 0 ? (t.value / maxVal) * 100 : 0;
                  return (
                    <div key={t.name} className={styles.teamItem}>
                      <div className={styles.teamInfo}>
                        <span className={styles.teamName}>{t.name}</span>
                        <span className={styles.teamVal}>${t.value.toLocaleString()}</span>
                      </div>
                      <div className={styles.teamBarTrack}>
                        <div className={styles.teamBarFill} style={{
                          width: `${pct}%`, background: PIE_COLORS[i % PIE_COLORS.length],
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detector Comparison */}
            <div className={styles.chartCard}>
              <div className={styles.chartCardHeader}><Cpu size={14} /> Detector Contribution</div>
              <div className={styles.teamList}>
                {a.anomaly_by_detector.map((d, i) => {
                  const maxD = Math.max(...a.anomaly_by_detector.map(x => x.value));
                  const pct = maxD > 0 ? (d.value / maxD) * 100 : 0;
                  return (
                    <div key={d.name} className={styles.teamItem}>
                      <div className={styles.teamInfo}>
                        <span className={styles.teamName}>{d.name}</span>
                        <span className={styles.teamVal}>{d.value} anomalies</span>
                      </div>
                      <div className={styles.teamBarTrack}>
                        <div className={styles.teamBarFill} style={{
                          width: `${pct}%`, background: i === 0 ? '#06b6d4' : '#8b5cf6',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Top Anomalies Table ──────────────────────────────────── */}
          {a.top_anomalies.length > 0 && (
            <div className={styles.tableCard}>
              <div className={styles.tableHeader}>
                <Target size={14} /> Top Anomalies by Deviation
              </div>
              <div className={styles.tableHead}>
                <span>Severity</span><span>Service</span><span>Team</span><span>Cost</span><span>Deviation</span><span>Date</span>
              </div>
              <div className={styles.tableBody}>
                {a.top_anomalies.map((ta, i) => (
                  <div key={i} className={styles.tableRow}>
                    <span><span className={styles.sevTag} style={{ background: SEV_COLORS[ta.severity] ?? '#64748b' }}>{ta.severity}</span></span>
                    <span className={styles.cellService}>{ta.service}</span>
                    <span className={styles.cellTeam}>{ta.team}</span>
                    <span className={styles.cellCost}>${ta.cost.toLocaleString()}</span>
                    <span className={`${styles.cellDeviation} ${ta.deviation > 0 ? styles.deviationUp : styles.deviationDown}`}>
                      {ta.deviation > 0 ? '+' : ''}{ta.deviation.toFixed(1)}%
                    </span>
                    <span className={styles.cellDate}>{ta.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Deep Visualization Section ───────────────────────────── */}
          <VisualizationSection analytics={a} />

          {/* ── Completion + Toggle + Actions ───────────────────────── */}
          {summaryData && (
            <div className={styles.completionCard}>
              <div className={styles.completionHeader}>
                <CheckCircle2 size={20} style={{ color: '#22c55e' }} />
                <div>
                  <div className={styles.completionTitle}>Analysis Complete</div>
                  <div className={styles.completionSub}>
                    {s.anomaly_count} anomalies • {s.total_rows.toLocaleString()} records • {a.cost_trend.length} days
                  </div>
                </div>
              </div>

              <div className={styles.toggleRow}>
                <button className={styles.toggleBtn} onClick={() => setApplyToDashboard(!applyToDashboard)}>
                  {applyToDashboard
                    ? <ToggleRight size={28} style={{ color: '#22c55e' }} />
                    : <ToggleLeft size={28} style={{ color: 'rgba(255,255,255,0.25)' }} />}
                </button>
                <div>
                  <div className={styles.toggleLabel}>Apply results to dashboard</div>
                  <div className={styles.toggleDesc}>
                    {applyToDashboard
                      ? 'Anomalies & savings will appear in Command Center and Anomaly Watch'
                      : 'Results will be discarded when you upload another file'}
                  </div>
                </div>
              </div>

              <div className={styles.completionActions}>
                {applyToDashboard && (
                  <>
                    <button className={styles.dashboardBtn} onClick={() => navigate('/')}>
                      <Shield size={14} /> View Command Center <ArrowRight size={14} />
                    </button>
                    <button className={styles.anomalyBtn} onClick={() => navigate('/anomaly-watch')}>
                      <AlertTriangle size={14} /> View Anomaly Watch <ArrowRight size={14} />
                    </button>
                  </>
                )}
                <button className={styles.resetBtn} onClick={handleReset}>
                  <RotateCcw size={12} /> Upload Another
                </button>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
};

export default DataUpload;
