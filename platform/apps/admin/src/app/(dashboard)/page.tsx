/**
 * Main Dashboard Page
 * 
 * Server Component that fetches all metrics in parallel
 * and passes data to client components for D3 rendering.
 */

import { Suspense } from 'react';
import { DashboardLayout } from '@/components/layout';
import { MetricCard, Card, Spinner, Badge, EmptyState } from '@/components/ui';
import { UsageDashboard, SlidingLineChart } from '@/components/visualizations/UsageDashboard';
import { TokenTree } from '@/components/visualizations/TokenTree';
import { VmHeatmap } from '@/components/visualizations/VmHeatmap';
import { RealTimeMetrics } from '@/components/visualizations';
import { getDashboardMetrics, getUsageAnalytics, getTokenUsageTree, getVmPoolStats, getMetricSeries, getVmHeatmap } from '@/lib/api/admin';
import { formatNumber, formatCurrency, formatPercent, formatLatency } from '@/lib/utils';
import type { MetricSeries, TokenUsageNode, HeatmapCell, DashboardMetrics } from '@/types';

// Force dynamic rendering for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 30; // Revalidate every 30 seconds

// Default empty data structures for error states
const emptyMetrics: DashboardMetrics = {
  users: { total: 0, active: 0, newToday: 0, growth: 0 },
  projects: { total: 0, active: 0, createdToday: 0 },
  tokens: { used: 0, limit: 0, cached: 0, costUsd: 0 },
  vms: { total: 0, running: 0, coldStarts: 0, avgLatencyMs: 0 },
  errors: { count24h: 0, rate: 0, topErrors: [] },
};

const emptySeries: MetricSeries[] = [];

const emptyTree: TokenUsageNode = { name: 'No Data', value: 0 };

const emptyHeatmap: HeatmapCell[][] = [];

export default async function DashboardPage() {
  // Fetch all data in parallel (as per PRD requirement)
  const [metricsResult, analyticsResult, tokenTreeResult, vmStatsResult, seriesResult, heatmapResult] = await Promise.all([
    getDashboardMetrics(),
    getUsageAnalytics('7d'),
    getTokenUsageTree(),
    getVmPoolStats(),
    getMetricSeries(),
    getVmHeatmap(),
  ]);

  // Extract data with fallbacks
  const metrics = metricsResult.success && metricsResult.data ? metricsResult.data : emptyMetrics;
  const metricSeries = seriesResult.success && seriesResult.data ? seriesResult.data.series : emptySeries;
  const tokenTree = tokenTreeResult.success && tokenTreeResult.data ? tokenTreeResult.data.tree : emptyTree;
  const vmHeatmap = heatmapResult.success && heatmapResult.data ? heatmapResult.data.heatmap : emptyHeatmap;
  
  // Track API errors for display
  const apiErrors = [
    !metricsResult.success && 'Dashboard metrics',
    !seriesResult.success && 'Metric series',
    !tokenTreeResult.success && 'Token usage tree',
    !heatmapResult.success && 'VM heatmap',
  ].filter(Boolean) as string[];

  return (
    <DashboardLayout title="Dashboard">
      {/* API Error Warning */}
      {apiErrors.length > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium text-yellow-800">
              Some data sources unavailable: {apiErrors.join(', ')}
            </span>
          </div>
        </div>
      )}
      
      {/* Top Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Users"
          value={metrics.users.total}
          change={metrics.users.growth}
          icon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.664.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07z" />
            </svg>
          }
        />
        <MetricCard
          title="Active Users"
          value={metrics.users.active}
          change={metrics.users.activeChange}
          variant="success"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          }
        />
        <MetricCard
          title="Token Usage"
          value={formatNumber(metrics.tokens.used)}
          unit="/ 1B"
          change={metrics.tokens.usageChange}
          icon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.456a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
            </svg>
          }
        />
        <MetricCard
          title="Cost (USD)"
          value={formatCurrency(metrics.tokens.costUsd)}
          format="raw"
          change={metrics.tokens.costChange}
          variant="warning"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.122 2.122 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.115.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .115-.07.34-.433.582a2.122 2.122 0 01-.567.267z" />
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.584 6 7.149 6 8c0 .846.594 1.412 1.324 1.745.48.227.996.367 1.676.467v1.698a2.122 2.122 0 01-.567-.267c-.364-.243-.433-.468-.433-.582a1 1 0 10-2 0c0 .846.594 1.412 1.324 1.745.48.227.996.367 1.676.467V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.416 14 12.851 14 12c0-.846-.594-1.412-1.324-1.745A4.535 4.535 0 0011 9.79V8.092c.22.071.412.164.567.267.364.243.433.468.433.582a1 1 0 102 0c0-.846-.594-1.412-1.324-1.745A4.535 4.535 0 0011 6.21V5z" clipRule="evenodd" />
            </svg>
          }
        />
      </div>

      {/* Second Row Metrics */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Running VMs"
          value={`${metrics.vms.running}/${metrics.vms.total}`}
          format="raw"
          change={metrics.vms.runningChange}
          icon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
          }
        />
        <MetricCard
          title="Avg Latency"
          value={formatLatency(metrics.vms.avgLatencyMs)}
          format="raw"
          change={metrics.vms.latencyChange}
          variant="success"
        />
        <MetricCard
          title="Cold Starts"
          value={metrics.vms.coldStarts}
          change={metrics.vms.coldStartsChange}
        />
        <MetricCard
          title="Error Rate"
          value={metrics.errors.rate}
          format="percent"
          change={metrics.errors.rateChange}
          variant={metrics.errors.rate > 1 ? 'danger' : 'default'}
        />
      </div>

      {/* Real-Time Metrics via WebSocket */}
      <div className="mt-6">
        <Card title="Live System Metrics" subtitle="Real-time data via WebSocket">
          <Suspense fallback={<Spinner size="lg" />}>
            <RealTimeMetrics />
          </Suspense>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Real-time Metrics Chart */}
        <Card title="System Metrics" subtitle="Real-time CPU and Memory usage">
          <div className="h-80">
            <Suspense fallback={<Spinner size="lg" />}>
              <UsageDashboard data={metricSeries} />
            </Suspense>
          </div>
        </Card>

        {/* Token Usage TreeMap */}
        <Card title="Token Usage by User/Project" subtitle="Hierarchical view of token consumption">
          <div className="h-80">
            <Suspense fallback={<Spinner size="lg" />}>
              <TokenTree data={tokenTree} />
            </Suspense>
          </div>
        </Card>
      </div>

      {/* VM Heatmap */}
      <div className="mt-6">
        <Card title="VM Load Distribution" subtitle="Resource utilization across VM pool">
          <div className="h-64">
            <Suspense fallback={<Spinner size="lg" />}>
              <VmHeatmap
                data={vmHeatmap}
                xLabels={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
                yLabels={Array.from({ length: 10 }, (_, i) => `Pool ${i + 1}`)}
              />
            </Suspense>
          </div>
        </Card>
      </div>

      {/* Recent Alerts */}
      <div className="mt-6">
        <Card title="Recent Alerts" subtitle="Last 24 hours">
          <div className="space-y-3">
            {metrics.errors.topErrors.map((error, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <Badge variant={error.count > 50 ? 'danger' : 'warning'}>{error.code}</Badge>
                  <div>
                    <p className="font-medium">{error.message}</p>
                    <p className="text-sm text-gray-500">{error.service}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">{error.count} occurrences</p>
                  <p className="text-sm text-gray-500">Last: {new Date(error.lastOccurrence).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
