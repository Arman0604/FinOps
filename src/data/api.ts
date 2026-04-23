// src/data/api.ts
// ------------------------------------------------------------------
// Central API client — all fetches go through here.
// The base URL auto-detects dev (Vite) vs prod.
// ------------------------------------------------------------------

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---------- Types --------------------------------------------------------

export interface SummaryResponse {
  totalSpend:        { value: string; trend: string; raw: number };
  savings:           { value: string; active: number; raw: number };
  anomalies:         { count: number; severity: string };
  providerBreakdown: { name: string; value: number; fill: string; total: number }[];
  departmentBudget:  { name: string; budget: number; actual: number }[];
  spendForecast:     { name: string; actual: number | null; predicted: number | null }[];
}

export interface AnomalyItem {
  id: number;
  detected_at: string;
  date: string;
  provider: string;
  service: string;
  team: string;
  environment: string;
  cost_usd: number;
  expected_cost: number;
  deviation_pct: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  anomaly_type: string;
  detector: string;
  shap_factors: Record<string, number>;
  description: string;
  projected_monthly_drift: number;
}

export interface AnomaliesResponse {
  total: number;
  items: AnomalyItem[];
  top: { severity: string; date: string; service: string; team: string; deviation_pct: number } | null;
}

export interface ForecastPoint {
  name: string;
  target_date: string;
  p10: number;
  p50: number;
  p90: number;
}

export interface ForecastResponse {
  horizon: number;
  model: string;
  projected_end_of_period: number;
  series: ForecastPoint[];
  historical: { name: string; actual: number }[];
}

export interface BudgetItem {
  team: string;
  period: string;
  budget: number;
  actual_mtd: number;
  utilization_pct: number;
  status: "OK" | "WARNING" | "BREACH";
  projected_eom: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  reply: string;
  context_used: Record<string, unknown>;
}

export interface DetectionStatus {
  running: boolean;
  step: string;
  step_num: number;
  total_steps: number;
  last_run_at: string | null;
  last_count: number;
  live_count: number;
  error: string | null;
}

export interface RecentAnomaly {
  id: number;
  date: string;
  provider: string;
  service: string;
  team: string;
  environment: string;
  cost_usd: number;
  expected_cost: number;
  deviation_pct: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  anomaly_type: string;
  detector: string;
  description: string;
}

export interface UploadStatus {
  status: "idle" | "validating" | "loading" | "detecting" | "streaming" | "complete" | "error";
  total_rows: number;
  processed_rows: number;
  anomaly_count: number;
  current_row: { date: string; provider: string; service: string; team: string; cost_usd: number } | null;
  recent_anomalies: RecentAnomaly[];
  error: string | null;
  filename: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface UploadAnalytics {
  cost_by_provider:    { name: string; value: number }[];
  cost_by_service:     { name: string; value: number }[];
  cost_trend:          { date: string; cost: number }[];
  cost_by_team:        { name: string; value: number }[];
  anomaly_by_severity: { name: string; value: number }[];
  anomaly_by_detector: { name: string; value: number }[];
  anomaly_by_provider: { name: string; value: number }[];
  anomaly_by_service:  { name: string; value: number }[];
  anomaly_by_team:     { name: string; value: number }[];
  anomaly_by_region:   { name: string; value: number }[];
  spend_by_env:        { name: string; value: number }[];
  spend_by_region:     { name: string; value: number }[];
  normal_vs_anomaly:   { name: string; value: number }[];
  cost_time_series_with_anomalies: {
    date: string; cost: number; rolling_avg: number;
    is_anomaly: boolean; anomaly_cost: number | null;
  }[];
  forecast_comparison: { date: string; actual: number; predicted: number }[];
  detailed_anomalies: {
    date: string; provider: string; service: string; team: string;
    environment: string; cost_usd: number; expected_cost: number;
    deviation_pct: number; severity: string; anomaly_type: string;
    detector: string; anomaly_score: number; description: string;
  }[];
  provider_service_breakdown: { provider: string; service: string; count: number }[];
  top_anomalies:       { date: string; provider: string; service: string; team: string; severity: string; cost: number; deviation: number }[];
  model_stats: {
    total_rows: number;
    total_anomalies: number;
    total_cost: number;
    anomaly_cost: number;
    savings: number;
    detection_rate: number;
    models_used: string[];
    ensemble_method: string;
  };
}

export interface UploadHistoryItem {
  id: number;
  filename: string;
  uploaded_at: string;
  total_rows: number;
  total_cost: number;
  anomaly_count: number;
  savings: number;
  detection_rate: number;
  providers: string[];
  severity_breakdown: Record<string, number>;
}

export interface UploadHistoryResponse {
  items: UploadHistoryItem[];
  aggregate: {
    total_files: number;
    total_rows: number;
    total_cost: number;
    total_anomalies: number;
    total_savings: number;
  };
}

// ---------- Exports --------------------------------------------------------

export const api = {
  summary:      ()                               => get<SummaryResponse>("/api/summary"),
  anomalies:    (params?: Record<string, string | number | undefined>) => get<AnomaliesResponse>("/api/anomalies", params),
  forecast:     (horizon = 30, model = "ensemble", filters?: { provider?: string; team?: string; service?: string }) =>
    get<ForecastResponse>("/api/forecast", { horizon, model, ...filters }),
  timeseries:   (params?: Record<string, string>)  => get<{ data: { date: string; cost_usd: number }[] }>("/api/timeseries", params),
  budgets:      (team?: string)                    => get<{ items: BudgetItem[] }>("/api/budgets", team ? { team } : undefined),
  runDetection:    ()                                 => post<{ status: string; message: string }>("/api/run-detection"),
  detectionStatus: ()                                 => get<DetectionStatus>("/api/detection-status"),
  runForecast:     (horizons = [7, 30, 90])           => post<{ status: string; message: string }>("/api/run-forecast"),
  chat:         (message: string, history: ChatMessage[] = []) =>
    post<ChatResponse>("/api/chat", { message, history }),

  // ── CSV Upload + Streaming Detection ──────────────────────────
  uploadCSV: async (file: File): Promise<{ status: string; message: string; filename: string; total_rows: number }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/api/upload-csv`, { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message || `Upload failed: ${res.status}`);
    }
    return res.json();
  },
  uploadStatus:       () => get<UploadStatus>("/api/upload-status"),
  uploadReset:        () => post<{ status: string; message: string }>("/api/upload-reset"),
  uploadAnalytics:    () => get<UploadAnalytics>("/api/upload-analytics"),
  clearData:          () => post<{ status: string; message: string }>("/api/clear-data"),
  saveUploadHistory:  () => post<{ status: string; filename: string }>("/api/save-upload-history"),
  uploadHistory:      () => get<UploadHistoryResponse>("/api/upload-history"),
};
