import { MetricsAggregator } from '../services/metrics_aggregator.js';
import { RevenueCalculator } from '../services/revenue_calculator.js';
import { prisma } from '@workspace/database';

export const DailySnapshotWorker = {
  async run(): Promise<void> {
    console.log('[DailySnapshot] Starting...');
    
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [dailyMetrics, mrr] = await Promise.all([
      MetricsAggregator.getDailyMetrics(today),
      RevenueCalculator.calculateMRR()
    ]);

    console.log('[DailySnapshot] Completed');
  }
};
