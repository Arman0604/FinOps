// src/data/api.ts
// ------------------------------------------------------------------
// Central API client — all fetches go through here.
// The base URL auto-detects dev (Vite) vs prod.
// ------------------------------------------------------------------

const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8000" : "");
const TOKEN_KEY = "finops.auth.token";
const USER_KEY = "finops.auth.user";

function apiUrl(path: string): string {
  const base = BASE || window.location.origin;
  return new URL(path, base).toString();
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  company: string | null;
  role: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: AuthUser;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function setAuthSession(auth: AuthResponse): void {
  localStorage.setItem(TOKEN_KEY, auth.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
}

export function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  if (res.status === 401) {
    clearAuthSession();
    window.dispatchEvent(new Event("finops:auth-expired"));
  }

  const body = await res.json().catch(async () => ({ detail: await res.text().catch(() => res.statusText) }));
  const message = body.detail || body.message || `API ${res.status}`;
  throw new Error(Array.isArray(message) ? message.map((m) => m.msg ?? String(m)).join(", ") : String(message));
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(apiUrl(path));
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), { headers: authHeaders() });
  return handleResponse<T>(res);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
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
  login:        (email: string, password: string) =>
    post<AuthResponse>("/api/auth/login", { email, password }),
  register:     (payload: { email: string; password: string; name?: string; company?: string }) =>
    post<AuthResponse>("/api/auth/register", payload),
  me:           () => get<{ user: AuthUser }>("/api/auth/me"),
  summary:      ()                               => get<SummaryResponse>("/api/summary"),
  anomalies:    (params?: Record<string, string | number | undefined>) => get<AnomaliesResponse>("/api/anomalies", params),
  forecast:     (horizon = 30, model = "ensemble", filters?: { provider?: string; team?: string; service?: string }) =>
    get<ForecastResponse>("/api/forecast", { horizon, model, ...filters }),
  timeseries:   (params?: Record<string, string>)  => get<{ data: { date: string; cost_usd: number }[] }>("/api/timeseries", params),
  budgets:      (team?: string)                    => get<{ items: BudgetItem[] }>("/api/budgets", team ? { team } : undefined),
  runDetection:    ()                                 => post<{ status: string; message: string }>("/api/run-detection"),
  detectionStatus: ()                                 => get<DetectionStatus>("/api/detection-status"),
  runForecast:     (horizons = [7, 30, 90]) => {
    const params = new URLSearchParams();
    horizons.forEach((horizon) => params.append("horizons", String(horizon)));
    return post<{ status: string; message: string }>(`/api/run-forecast?${params.toString()}`);
  },
  chat:         (message: string, history: ChatMessage[] = []) =>
    post<ChatResponse>("/api/chat", { message, history }),

  // ── CSV Upload + Streaming Detection ──────────────────────────
  uploadCSV: async (file: File): Promise<{ status: string; message: string; filename: string; total_rows: number }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(apiUrl("/api/upload-csv"), {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    return handleResponse(res);
  },
  uploadStatus:       () => get<UploadStatus>("/api/upload-status"),
  uploadReset:        () => post<{ status: string; message: string }>("/api/upload-reset"),
  uploadAnalytics:    () => get<UploadAnalytics>("/api/upload-analytics"),
  clearData:          () => post<{ status: string; message: string }>("/api/clear-data"),
  saveUploadHistory:  () => post<{ status: string; filename: string }>("/api/save-upload-history"),
  uploadHistory:      () => get<UploadHistoryResponse>("/api/upload-history"),
};
