export interface AIEvaluationMetric {
  readonly correlationId: string;
  readonly organizationId: string;
  readonly providerName: string;
  readonly latencyMs: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly toolSuggested?: string;
  readonly securityBlocked: boolean;
}

const metricsHistory: AIEvaluationMetric[] = [];

export const aiEvaluation = {
  recordMetric(metric: AIEvaluationMetric): void {
    metricsHistory.push(metric);
    if (metricsHistory.length > 200) {
      metricsHistory.shift();
    }
  },

  getMetrics(): readonly AIEvaluationMetric[] {
    return [...metricsHistory];
  },

  clearMetrics(): void {
    metricsHistory.length = 0;
  },
};

