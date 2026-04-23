import React, { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell, ComposedChart, Area,
} from 'recharts';
import { BarChart2, TrendingUp, AlertTriangle, Activity, Table2, GitBranch } from 'lucide-react';
import type { UploadAnalytics } from '../../data/api';
import styles from './VisualizationSection.module.css';

const SEV_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444', HIGH: '#F97316', MEDIUM: '#EAB308', LOW: '#06B6D4',
};
const PALETTE = ['#06b6d4','#8b5cf6','#f59e0b','#22c55e','#f43f5e','#14b8a6','#a78bfa','#fb923c','#34d399','#60a5fa'];
const PROV_COLORS: Record<string, string> = { AWS:'#06B6D4', AZURE:'#3B82F6', GCP:'#8B5CF6' };

/* ── Custom Tooltip ───────────────────────────────────────────────────── */
const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color || p.fill }} />
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.7rem' }}>{p.name}:</span>
          <span style={{ color: p.color || p.fill }}>
            {typeof p.value === 'number'
              ? p.name?.toLowerCase().includes('cost') || p.name?.toLowerCase().includes('spend') || p.name?.toLowerCase().includes('actual') || p.name?.toLowerCase().includes('predict')
                ? `$${p.value.toLocaleString()}`
                : p.value.toLocaleString()
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ── Simple Bar helper ───────────────────────────────────────────────── */
const SimpleBar: React.FC<{
  data: { name: string; value: number }[];
  color?: string;
  height?: number;
  isCost?: boolean;
}> = ({ data, color = '#06b6d4', height = 200, isCost = false }) => (
  <div style={{ height }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 12, left: isCost ? 10 : -10, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="name" axisLine={false} tickLine={false}
          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
          angle={-30} textAnchor="end" interval={0} />
        <YAxis axisLine={false} tickLine={false}
          tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
          tickFormatter={v => isCost ? `$${(v/1000).toFixed(0)}k` : String(v)} width={isCost ? 50 : 35} />
        <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
        <Bar dataKey="value" name={isCost ? 'Spend' : 'Count'} radius={[4,4,0,0]} maxBarSize={48}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

/* ── Severity Color Bar ────────────────────────────────────────────────── */
const SeverityBar: React.FC<{ data: { name: string; value: number }[] }> = ({ data }) => (
  <div style={{ height: 200 }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="name" axisLine={false} tickLine={false}
          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700 }} />
        <YAxis axisLine={false} tickLine={false}
          tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} width={35} />
        <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
        <Bar dataKey="value" name="Count" radius={[4,4,0,0]} maxBarSize={60}>
          {data.map((d) => <Cell key={d.name} fill={SEV_COLORS[d.name] ?? '#64748b'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

/* ── Box Plot Proxy ──────────────────────────────────────────────────── */
const BoxPlotProxy: React.FC<{ data: UploadAnalytics['cost_by_provider'] }> = ({ data }) => {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.value));
  return (
    <div style={{ padding: '0.5rem 0' }}>
      {data.map((d, i) => {
        const pct = max > 0 ? (d.value / max) * 100 : 0;
        const q1 = pct * 0.25; const q3 = pct * 0.75; const med = pct * 0.55;
        return (
          <div key={d.name} className={styles.boxRow}>
            <div className={styles.boxLabel}>{d.name}</div>
            <div className={styles.boxTrack}>
              <div className={styles.boxFill} style={{ left: `${q1}%`, width: `${q3 - q1}%` }} />
              <div className={styles.boxMedian} style={{ left: `${med}%` }} />
              <div className={styles.boxMin} style={{ left: '2%' }} />
              <div className={styles.boxMax} style={{ left: `${Math.min(pct, 98)}%` }} />
            </div>
            <div className={styles.boxStats}>${(d.value/1000).toFixed(1)}k</div>
          </div>
        );
      })}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Main Component
   ════════════════════════════════════════════════════════════════════════ */
interface Props { analytics: UploadAnalytics; }

const VisualizationSection: React.FC<Props> = ({ analytics: a }) => {
  const ts = a.cost_time_series_with_anomalies ?? [];
  const anomalyPoints = ts.filter(d => d.is_anomaly);

  // Build stacked bar for provider-service breakdown
  const provServices = useMemo(() => {
    const services = [...new Set((a.provider_service_breakdown ?? []).map(r => r.service))].slice(0, 6);
    const providers = [...new Set((a.provider_service_breakdown ?? []).map(r => r.provider))];
    return {
      rows: providers.map(prov => {
        const entry: Record<string, any> = { name: prov };
        services.forEach(svc => {
          const found = (a.provider_service_breakdown ?? []).find(r => r.provider === prov && r.service === svc);
          entry[svc] = found?.count ?? 0;
        });
        return entry;
      }),
      services,
    };
  }, [a.provider_service_breakdown]);

  return (
    <div className={styles.section}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className={styles.sectionHeader}>
        <div className={styles.sectionIcon}><Activity size={18} /></div>
        <div>
          <div className={styles.sectionTitle}>Deep Visualization Analysis</div>
          <div className={styles.sectionSub}>
            Comprehensive anomaly patterns, spend distributions, forecasts &amp; cost intelligence
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          1. TIME-SERIES with anomalies + rolling avg
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><TrendingUp size={12} /> Cost Over Time &amp; Anomaly Detection</div>
      {ts.length > 0 && (
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><TrendingUp size={14} /> Daily Cost · Anomaly Points · 7-Day Rolling Average</div>
          <div className={styles.chartBody}>
            <div className={styles.lineWrapLg}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ts} margin={{ top: 8, right: 16, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vizCostGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false}
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                    tickFormatter={v => v.slice(5)} interval={Math.floor(ts.length / 8)} />
                  <YAxis axisLine={false} tickLine={false}
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                    tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={52} />
                  <Tooltip content={<Tip />} />
                  <Legend wrapperStyle={{ fontSize: '0.72rem', paddingTop: '8px' }} />
                  <Area type="monotone" dataKey="cost" name="Daily Cost"
                    stroke="#06b6d4" strokeWidth={1.5} fill="url(#vizCostGrad)" dot={false} />
                  <Line type="monotone" dataKey="rolling_avg" name="7-Day Avg"
                    stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                  <Line type="monotone" dataKey="anomaly_cost" name="Anomaly"
                    stroke="#ef4444" strokeWidth={0} dot={{ r: 5, fill: '#ef4444', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          2. SPEND DISTRIBUTION — provider / service / team / env / region
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><BarChart2 size={12} /> Total Spend Distribution</div>
      <div className={styles.grid2}>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><BarChart2 size={13} /> Spend by Provider</div>
          <div className={styles.chartBody}><SimpleBar data={a.cost_by_provider} isCost /></div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><BarChart2 size={13} /> Spend by Environment</div>
          <div className={styles.chartBody}><SimpleBar data={a.spend_by_env} isCost /></div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><BarChart2 size={13} /> Spend by Team</div>
          <div className={styles.chartBody}><SimpleBar data={a.cost_by_team} isCost /></div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><BarChart2 size={13} /> Spend by Region</div>
          <div className={styles.chartBody}><SimpleBar data={a.spend_by_region ?? []} isCost /></div>
        </div>
      </div>
      {/* Service spend full-width */}
      <div className={styles.chartCard}>
        <div className={styles.chartCardHeader}><BarChart2 size={13} /> Spend by Service (Top 8)</div>
        <div className={styles.chartBody}><SimpleBar data={a.cost_by_service} isCost height={220} /></div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          3. ANOMALY COUNTS — provider / service / team / region
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><AlertTriangle size={12} /> Anomaly Count Distribution</div>
      <div className={styles.grid2}>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><AlertTriangle size={13} /> Anomalies by Provider</div>
          <div className={styles.chartBody}><SimpleBar data={a.anomaly_by_provider} color="#ef4444" /></div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><AlertTriangle size={13} /> Anomalies by Team</div>
          <div className={styles.chartBody}><SimpleBar data={a.anomaly_by_team ?? []} color="#f97316" /></div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><AlertTriangle size={13} /> Anomalies by Service (Top 10)</div>
          <div className={styles.chartBody}><SimpleBar data={a.anomaly_by_service ?? []} color="#8b5cf6" /></div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><AlertTriangle size={13} /> Anomalies by Region</div>
          <div className={styles.chartBody}><SimpleBar data={a.anomaly_by_region ?? []} color="#f43f5e" /></div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          4. BOX PLOT PROXY + SEVERITY DISTRIBUTION
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><BarChart2 size={12} /> Cost Distribution &amp; Severity</div>
      <div className={styles.grid2}>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><BarChart2 size={13} /> Cost Box Plot by Provider</div>
          <div className={styles.chartBody}><BoxPlotProxy data={a.cost_by_provider} /></div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><AlertTriangle size={13} /> Severity Distribution</div>
          <div className={styles.chartBody}><SeverityBar data={a.anomaly_by_severity} /></div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          5. STACKED / GROUPED — Provider-wise + Service-wise anomaly breakdown
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><GitBranch size={12} /> Provider &amp; Service Anomaly Breakdown</div>
      <div className={styles.chartCard}>
        <div className={styles.chartCardHeader}><GitBranch size={13} /> Anomalies by Provider × Service (Stacked)</div>
        <div className={styles.chartBody}>
          {provServices.rows.length > 0 ? (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={provServices.rows} margin={{ top: 4, right: 16, left: -8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false}
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700 }} />
                  <YAxis axisLine={false} tickLine={false}
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} width={35} />
                  <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                  <Legend wrapperStyle={{ fontSize: '0.7rem' }} />
                  {provServices.services.map((svc, i) => (
                    <Bar key={svc} dataKey={svc} stackId="a" fill={PALETTE[i % PALETTE.length]}
                      radius={i === provServices.services.length - 1 ? [4,4,0,0] : [0,0,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.2)', padding: '2rem', textAlign: 'center', fontSize: '0.8rem' }}>
              No breakdown data available
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          6. BUDGET FORECAST — actual vs forecast + avg vs predicted
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><TrendingUp size={12} /> Budget Forecast &amp; Prediction</div>
      {(a.forecast_comparison ?? []).length > 0 && (
        <>
          <div className={styles.chartCard}>
            <div className={styles.chartCardHeader}><TrendingUp size={13} /> Actual Daily Spend vs Forecasted (Expected) Cost</div>
            <div className={styles.chartBody}>
              <div className={styles.lineWrapLg}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={a.forecast_comparison} margin={{ top: 8, right: 16, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                      tickFormatter={v => v.slice(5)} interval={Math.floor((a.forecast_comparison?.length ?? 0) / 6)} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                      tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={52} />
                    <Tooltip content={<Tip />} />
                    <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                    <Line type="monotone" dataKey="actual" name="Actual Spend"
                      stroke="#06b6d4" strokeWidth={2} dot={{ r: 3, fill: '#06b6d4' }} />
                    <Line type="monotone" dataKey="predicted" name="Forecasted"
                      stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3"
                      dot={{ r: 3, fill: '#f59e0b' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className={styles.chartCard}>
            <div className={styles.chartCardHeader}><Activity size={13} /> Average Daily Spend vs Predicted Values</div>
            <div className={styles.chartBody}>
              <div className={styles.lineWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={a.forecast_comparison} margin={{ top: 8, right: 16, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                      tickFormatter={v => v.slice(5)} interval={Math.floor((a.forecast_comparison?.length ?? 0) / 6)} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                      tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={52} />
                    <Tooltip content={<Tip />} />
                    <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                    <Area type="monotone" dataKey="actual" name="Avg Daily Spend"
                      stroke="#8b5cf6" strokeWidth={2} fill="url(#actualGrad)" dot={false} />
                    <Line type="monotone" dataKey="predicted" name="Predicted"
                      stroke="#22c55e" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          7. NORMAL vs ANOMALY distribution
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><AlertTriangle size={12} /> Upload Data Results</div>
      <div className={styles.grid2}>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><BarChart2 size={13} /> Normal vs Anomaly Distribution</div>
          <div className={styles.chartBody}>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.normal_vs_anomaly ?? []} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false}
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700 }} />
                  <YAxis axisLine={false} tickLine={false}
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} width={50} />
                  <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                  <Bar dataKey="value" name="Records" radius={[6,6,0,0]} maxBarSize={80}>
                    <Cell fill="#3b82f6" />
                    <Cell fill="#ef4444" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartCardHeader}><AlertTriangle size={13} /> Severity Breakdown — Uploaded Data</div>
          <div className={styles.chartBody}><SeverityBar data={a.anomaly_by_severity} /></div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          8. DETAILED ANOMALY TABLE
          ══════════════════════════════════════════════════════════════ */}
      <div className={styles.subLabel}><Table2 size={12} /> Detailed Anomaly Results Table</div>
      <div className={styles.chartCard}>
        <div className={styles.chartCardHeader}><Table2 size={13} /> All Detected Anomalies — Cost, Score, Severity &amp; Metadata</div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th><th>Provider</th><th>Service</th><th>Team</th>
                <th>Environment</th><th>Cost (USD)</th><th>Expected</th>
                <th>Deviation</th><th>Score</th><th>Severity</th>
                <th>Type</th><th>Detector</th>
              </tr>
            </thead>
            <tbody>
              {(a.detailed_anomalies ?? []).map((row, i) => (
                <tr key={i}>
                  <td>{row.date}</td>
                  <td style={{ color: PROV_COLORS[row.provider?.toUpperCase()] || '#64748b', fontWeight: 700 }}>
                    {row.provider?.toUpperCase()}
                  </td>
                  <td className={styles.serviceCell}>{row.service}</td>
                  <td>{row.team}</td>
                  <td style={{ color: 'rgba(255,255,255,0.45)' }}>{row.environment}</td>
                  <td className={styles.costCell}>${row.cost_usd?.toLocaleString()}</td>
                  <td style={{ color: 'rgba(255,255,255,0.4)' }}>${row.expected_cost?.toLocaleString()}</td>
                  <td className={row.deviation_pct > 0 ? styles.deviUp : styles.deviDown}>
                    {row.deviation_pct > 0 ? '+' : ''}{row.deviation_pct}%
                  </td>
                  <td className={styles.scoreCell}>{row.anomaly_score?.toFixed(3)}</td>
                  <td>
                    <span className={styles.sevBadge} style={{ background: SEV_COLORS[row.severity] || '#64748b' }}>
                      {row.severity}
                    </span>
                  </td>
                  <td style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>{row.anomaly_type}</td>
                  <td style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.68rem' }}>{row.detector}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default VisualizationSection;
