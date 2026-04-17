/**
 * src/types/index.ts
 * Central TypeScript type definitions for the FinOps platform.
 * Re-exports API types and adds UI-specific types.
 */

// ── Re-export all API response types ──────────────────────────────────────────
export type {
  SummaryResponse,
  AnomalyItem,
  AnomaliesResponse,
  ForecastPoint,
  ForecastResponse,
  BudgetItem,
  ChatMessage,
  ChatResponse,
} from '../data/api';

// ── Severity ───────────────────────────────────────────────────────────────────
export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  CRITICAL: '#EF4444',
  HIGH:     '#F97316',
  MEDIUM:   '#EAB308',
  LOW:      '#06B6D4',
};

export const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  CRITICAL: 1,
  HIGH:     2,
  MEDIUM:   3,
  LOW:      4,
};

// ── Provider ───────────────────────────────────────────────────────────────────
export type CloudProvider = 'aws' | 'azure' | 'gcp';

export const PROVIDER_COLORS: Record<string, string> = {
  AWS:   '#06B6D4',
  AZURE: '#3B82F6',
  GCP:   '#8B5CF6',
};

// ── Chart data ────────────────────────────────────────────────────────────────
export interface SpendDataPoint {
  name: string;
  actual: number | null;
  predicted: number | null;
}

export interface BudgetDataPoint {
  name: string;
  budget: number;
  actual: number;
}

// ── UI state ─────────────────────────────────────────────────────────────────
export type LoadState = 'idle' | 'loading' | 'success' | 'error';

export type ForecastHorizon = 7 | 30 | 90;
