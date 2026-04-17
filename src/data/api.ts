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
};
