export const DEFAULT_RUN_LIMITS = {
  maxSteps: 12,
  maxToolCalls: 8,
  maxModelCalls: 4,
  maxDurationMs: 600_000,
  maxOutputTokens: 800,
  maxInputTokens: 6000,
  maxRetries: 1,
  maxActiveRuns: 5,
} as const;

export type RunLimits = {
  maxSteps: number;
  maxToolCalls: number;
  maxModelCalls: number;
  maxDurationMs: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxRetries: number;
  maxActiveRuns: number;
};

export function estimateCostMinor(inputTokens: number, outputTokens: number, inputPerMillion: number, outputPerMillion: number): number {
  const input = Math.max(0, inputTokens) * Math.max(0, inputPerMillion);
  const output = Math.max(0, outputTokens) * Math.max(0, outputPerMillion);
  return Math.round((input + output) / 1_000_000);
}

export function monthStartDate(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
